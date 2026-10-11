import { mkdir, readFile, readdir, rename, unlink, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SEGMENTS_MAX, isSprecher } from './sprecher.mjs';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Transkripte bleiben 7 Tage ab Erstellung der Notiz und werden dann automatisch gelöscht. */
export const TRANSCRIPT_MS = 7 * 24 * 60 * 60 * 1000;
const NOTE_ID = /^(\d{13})_([a-f0-9-]{36})$/;
const TRANSCRIPT_MAX = 400_000;

/** Bereinigt ein Transkript für die Ablage: Abschnitte mit Text, optional mit Position in der Aufnahme (Sekunden) und Sprecher. */
export function readSegments(raw) {
  if (!Array.isArray(raw) || raw.length > SEGMENTS_MAX) throw new Error('Ungültiges Transkript.');
  const segments = raw.map(item => {
    const entry = item && typeof item === 'object' ? item : {};
    if (typeof entry.id !== 'string' || !/^s\d{1,4}$/.test(entry.id) || typeof entry.text !== 'string') throw new Error('Ungültiges Transkript.');
    const seconds = value => (Number.isFinite(value) && value >= 0 && value < 1e6 ? Math.round(value * 100) / 100 : undefined);
    const start = seconds(entry.start), end = seconds(entry.end);
    return { id: entry.id, text: entry.text, ...(start !== undefined && end !== undefined && end >= start ? { start, end } : {}), ...(isSprecher(entry.speaker) ? { speaker: entry.speaker } : {}) };
  });
  if (segments.reduce((sum, s) => sum + s.text.length, 0) > 160000) throw new Error('Das Transkript ist zu lang.');
  return segments;
}

/** „Nicht erfragt“-Hinweise einer Notiz: höchstens drei kurze Stichwörter (siehe provider.mjs); alles andere fällt weg. */
export function readHints(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(h => typeof h === 'string').map(h => h.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '')).filter(h => h && h.length <= 40))].slice(0, 3);
}

/** Unsichere Zahlen einer Notiz (server/livefakten.mjs): Text der Zeile und die markierten Stellen darin. */
export function readDoubts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(d => d && typeof d.text === 'string' && d.text.length <= 200 && Array.isArray(d.marks))
    .map(d => ({ text: d.text, marks: d.marks.filter(m => typeof m === 'string' && m && m.length <= 200 && d.text.includes(m)).slice(0, 5) })).filter(d => d.marks.length).slice(0, 12);
}

export class NoteStore {
  constructor(directory, now = Date.now) { this.directory = directory; this.now = now; }
  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await this.prune(); }
  file(id) {
    if (!NOTE_ID.test(id)) throw new Error('Ungültige Notiz-ID.');
    return path.join(this.directory, `${id}.md`);
  }
  /** Transkript der Notiz, als eigene Datei neben ihr; wird 7 Tage nach dem Erstellen gelöscht. */
  transcriptFile(id) {
    if (!NOTE_ID.test(id)) throw new Error('Ungültige Notiz-ID.');
    return path.join(this.directory, `${id}.transkript.json`);
  }
  created(id) { return Number(id.match(NOTE_ID)?.[1] ?? 0); }
  expired(id) { return this.created(id) + RETENTION_MS <= this.now(); }
  transcriptExpired(id) { return this.created(id) + TRANSCRIPT_MS <= this.now(); }
  transcriptUntil(id) { return new Date(this.created(id) + TRANSCRIPT_MS).toISOString(); }
  async atomic(file, text) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async prune() {
    const files = await readdir(this.directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const name of files) {
      const id = name.replace(/\.md$/, '');
      if (name.endsWith('.md') && NOTE_ID.test(id) && this.expired(id)) await unlink(this.file(id));
      const transcriptId = name.replace(/\.transkript\.json$/, '');
      if (name.endsWith('.transkript.json') && NOTE_ID.test(transcriptId) && this.transcriptExpired(transcriptId)) await unlink(this.transcriptFile(transcriptId));
      // Recover from an interrupted atomic write without keeping orphaned content.
      if (/^\d{13}_[a-f0-9-]{36}\.(md|transkript\.json)\.[a-f0-9-]{36}\.tmp$/.test(name)) {
        const file = path.join(this.directory, name);
        const stat = await lstat(file);
        if (this.now() - stat.mtimeMs > 60_000) await unlink(file);
      }
    }
  }
  async create(body, model, patient = '', template = null, hints = [], doubts = []) {
    const id = `${this.now()}_${randomUUID()}`;
    return this.write(id, body, model, patient, template, hints, doubts);
  }
  /** `template`: die Vorlage, mit der die Notiz entstand (bereinigt über readTemplate in service.mjs); bleibt beim Bearbeiten erhalten. */
  async write(id, body, model, patient = '', template = null, hints = [], doubts = []) {
    if (typeof body !== 'string' || !body.trim() || body.length > 20000) throw new Error('Die Notiz ist leer oder zu lang.');
    hints = readHints(hints);
    // Eine unsichere Zahl gilt, solange ihre Zeile unverändert in der Notiz steht.
    doubts = readDoubts(doubts).filter(d => body.includes(d.text));
    this.file(id);
    if (this.expired(id)) throw new Error('Diese Notiz ist abgelaufen.');
    const created = this.created(id);
    const metadata = { id, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + RETENTION_MS).toISOString(), model, ...(patient && { patient }), ...(template && { template }), ...(hints.length && { hints }), ...(doubts.length && { doubts }), format: 1 };
    await this.atomic(this.file(id), `---\n${JSON.stringify(metadata)}\n---\n\n${body.trim()}\n`);
    return { ...metadata, patient: patient || '', template: template ?? null, hints, doubts, body: body.trim(), transcriptUntil: await this.hasTranscript(id) ? this.transcriptUntil(id) : null };
  }
  async get(id) {
    const file = this.file(id);
    if (this.expired(id)) { await this.remove(id); throw new Error('Diese Notiz ist nach 30 Tagen abgelaufen.'); }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 30000) throw new Error('Ungültige Notizdatei.');
    const raw = await readFile(file, 'utf8');
    const match = raw.match(/^---\n([^\n]+)\n---\n\n([\s\S]*)$/);
    if (!match) throw new Error('Die Notizdatei ist beschädigt.');
    const metadata = JSON.parse(match[1]);
    const created = this.created(id);
    return { id, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + RETENTION_MS).toISOString(), model: metadata.model, patient: typeof metadata.patient === 'string' ? metadata.patient : '', template: metadata.template && typeof metadata.template === 'object' ? metadata.template : null, hints: readHints(metadata.hints), doubts: readDoubts(metadata.doubts), body: match[2].trim(), transcriptUntil: await this.hasTranscript(id) ? this.transcriptUntil(id) : null };
  }
  async list() {
    await this.prune();
    const files = await readdir(this.directory);
    const notes = [];
    for (const file of files.filter(f => f.endsWith('.md') && NOTE_ID.test(f.slice(0, -3)))) {
      // Malformed files don't expose arbitrary files or break the other notes.
      try { notes.push(await this.get(file.slice(0, -3))); } catch { /* not a readable note */ }
    }
    return notes.sort((a, b) => b.id.localeCompare(a.id));
  }
  async update(id, body) { const old = await this.get(id); return this.write(id, body, old.model, old.patient, old.template, old.hints, old.doubts); }
  /** Erledigte Hinweise fallen weg; der Notiztext bleibt. */
  async setHints(id, hints) { const old = await this.get(id); return this.write(id, old.body, old.model, old.patient, old.template, hints, old.doubts); }
  async remove(id) {
    await unlink(this.file(id)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await this.removeTranscript(id);
    return { ok: true };
  }

  async hasTranscript(id) {
    if (this.transcriptExpired(id)) return false;
    const stat = await lstat(this.transcriptFile(id)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    return Boolean(stat?.isFile());
  }
  /** Legt das Transkript zur Notiz ab (bereinigt über readSegments). */
  async writeTranscript(id, segments) {
    this.file(id);
    if (this.transcriptExpired(id)) throw new Error('Diese Notiz ist zu alt für ein Transkript.');
    const text = JSON.stringify({ id, createdAt: new Date(this.created(id)).toISOString(), expiresAt: this.transcriptUntil(id), segments: readSegments(segments), format: 1 });
    if (text.length > TRANSCRIPT_MAX) throw new Error('Das Transkript ist zu lang.');
    await this.atomic(this.transcriptFile(id), text);
    return { expiresAt: this.transcriptUntil(id) };
  }
  async getTranscript(id) {
    const file = this.transcriptFile(id);
    if (this.transcriptExpired(id)) { await this.removeTranscript(id); throw new Error('Das Transkript wurde nach 7 Tagen automatisch gelöscht.'); }
    const stat = await lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat) throw new Error('Das Transkript dieser Notiz ist nicht mehr vorhanden.');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > TRANSCRIPT_MAX) throw new Error('Ungültige Transkriptdatei.');
    let parsed;
    try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('Die Transkriptdatei ist beschädigt.'); }
    return { id, expiresAt: this.transcriptUntil(id), segments: readSegments(parsed?.segments) };
  }
  async removeTranscript(id) { await unlink(this.transcriptFile(id)).catch(e => { if (e.code !== 'ENOENT') throw e; }); return { ok: true }; }
}
