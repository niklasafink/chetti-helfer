import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore, TRANSCRIPT_MS } from './store.mjs';
import { correctText } from './korrektur.mjs';
import { ENDPOINTS, MistralProvider, SUMMARY_MODELS, parseTemplate, validatePatient, validateSummary } from './provider.mjs';
import { sectionMap, spokenName } from './livefakten.mjs';
import { DEFAULT_FACH, FACHGEBIETE, isFach } from './fachgebiet.mjs';
import { isLocale, readLocale, translate } from './i18n.mjs';
import { readSnippets } from './bausteine.mjs';

const isFachSetting = value => isFach(value) || value === 'auto';

/** Vorlage, mit der eine Notiz entstand — bereinigt auf die Grenzen aus lib/templates.ts, damit sie als Metadatum in die Notizdatei passt. */
export function readTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const id = text(raw.id, 40), name = text(raw.name, 60);
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !name) throw new Error('Ungültige Vorlage.');
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 8).map(item => {
    const entry = item && typeof item === 'object' ? item : {};
    return { name: text(entry.name, 30), fields: (Array.isArray(entry.fields) ? entry.fields : []).map(f => text(f, 30)).filter(Boolean).slice(0, 30) };
  }).filter(s => s.name);
  return { id, name, kind: raw.kind === 'Dokument' ? 'Dokument' : 'Notiz', sections, instruction: text(raw.instruction, 700) };
}

/** Chatverlauf für Rückfragen: abwechselnd Frage und Antwort, die letzte Nachricht ist eine Frage. */
export function readChat(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 24) throw new Error('Ungültiger Chatverlauf.');
  const messages = raw.map(item => {
    const entry = item && typeof item === 'object' ? item : {};
    if (!['user', 'assistant'].includes(entry.role) || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > 4000) throw new Error('Ungültiger Chatverlauf.');
    return { role: entry.role, content: entry.content.trim() };
  });
  if (messages.at(-1).role !== 'user') throw new Error('Ungültiger Chatverlauf.');
  return messages;
}

function osUserName() {
  if (process.env.VERCEL) return ''; // Gehostet ist der Systembenutzer kein Nutzername.
  try { return os.userInfo().username; } catch { return ''; }
}

export function mergeTranscript(previous, next) {
  const left = previous.trim().split(/\s+/), right = next.trim().split(/\s+/);
  const clean = word => word.toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]/gu, '');
  for (let n = Math.min(24, left.length, right.length); n >= 3; n--) {
    if (left.slice(-n).map(clean).join(' ') === right.slice(0, n).map(clean).join(' ')) return right.slice(n).join(' ');
  }
  return next.trim();
}

export function validateWav(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 3_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Ungültiges Audiopaket.');
  const wav = Buffer.from(encoded, 'base64');
  if (wav.length < 46 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.toString('ascii', 12, 16) !== 'fmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44 || wav.length % 2 !== 0) throw new Error('Audio muss als 16-kHz-Mono-WAV vorliegen.');
  return wav;
}

export class ChettiService {
  constructor({ directory, provider = new MistralProvider(), now = Date.now, keyStore, notes } = {}) {
    this.directory = directory;
    this.notes = notes ?? new NoteStore(path.join(directory, 'notes'), now);
    this.provider = provider; this.now = now; this.keyStore = keyStore;
    this.sessions = new Map();
    // Laufende „Neu generieren“-Aufträge je Notiz; das Transkript dafür kommt aus dem Notizspeicher.
    this.regenerating = new Map();
    // Verhältnis gemessene zu erwarteter Dauer der Notiz in einem Aufruf (restMs); gleitend aus den letzten Notizen.
    this.noteSpeed = 1;
    // Fachgebiet: zahnmedizin | innere | anaesthesie | onkologie | augenheilkunde | auto (automatisch erkennen, sonst Zahnmedizin). CHETTI_FACHGEBIET gibt den Startwert vor.
    this.config = { region: process.env.MISTRAL_BASE_URL === ENDPOINTS.eu ? 'eu' : 'standard', model: 'mistralai/mistral-small-2603', style: '', fachgebiet: isFachSetting(process.env.CHETTI_FACHGEBIET) ? process.env.CHETTI_FACHGEBIET : DEFAULT_FACH };
    this.mistralApiKey = process.env.MISTRAL_API_KEY || '';
    this.openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(path.join(this.directory, 'settings.md'), 'utf8');
      const config = JSON.parse(raw.match(/```json\n([\s\S]*?)\n```/)?.[1] || '{}');
      if (Object.hasOwn(ENDPOINTS, config.region) && SUMMARY_MODELS.includes(config.model)) this.config = { region: config.region, model: config.model, style: String(config.style || '').slice(0, 3000), fachgebiet: isFachSetting(config.fachgebiet) ? config.fachgebiet : this.config.fachgebiet };
    } catch (error) { if (error.code !== 'ENOENT') this.configWarning = 'Die Einstellungen konnten nicht geladen werden.'; }
    if (this.keyStore && (!this.mistralApiKey || !this.openRouterApiKey)) {
      const stored = await this.keyStore.read().catch(() => '');
      if (stored && typeof stored === 'object') { this.mistralApiKey ||= stored.mistral || ''; this.openRouterApiKey ||= stored.openRouter || ''; }
      else if (stored && !this.mistralApiKey) this.mistralApiKey = stored;
    }
    await this.notes.init();
    this.timer = setInterval(() => { this.sweep(); this.notes.prune().catch(() => { this.configWarning = 'Abgelaufene Notizen konnten nicht gelöscht werden. Bitte Dateizugriff prüfen.'; }); }, 60_000);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); for (const s of this.sessions.values()) s.controller.abort(); this.sessions.clear(); for (const r of this.regenerating.values()) r.controller.abort(); this.regenerating.clear(); this.mistralApiKey = ''; this.openRouterApiKey = ''; }
  sweep() {
    for (const [id, session] of this.sessions) if (this.now() - session.touched > 2 * 60 * 60 * 1000) { session.controller.abort(); this.sessions.delete(id); }
  }
  /** `locale`: Sprache der Oberfläche, in der ein Warnhinweis ausgegeben wird. */
  status(locale) {
    const mistralConfigured = Boolean(this.mistralApiKey), openRouterConfigured = Boolean(this.openRouterApiKey);
    const summaryReady = this.config.model.startsWith('mistralai/') ? openRouterConfigured : mistralConfigured;
    // „Automatisch“ (Fachgebiet erkennen) braucht nur den OpenRouter-Schlüssel, keine eigene Einrichtung mehr (server/classifier.mjs).
    // Lokaler Weg: keine Schlüssel nötig; `lokal` zeigt der Oberfläche, dass Transkription und Notiz auf diesem Rechner laufen.
    return { configured: Boolean(this.provider.local) || (openRouterConfigured && summaryReady), lokal: Boolean(this.provider.local), ...(this.provider.local && { paket: [this.provider.local.llmModel, this.provider.local.sttModel] }), mistralConfigured, openRouterConfigured, ...this.config, fachgebiete: Object.entries(FACHGEBIETE).map(([id, f]) => ({ id, name: f.name })), transcriptionModel: 'microsoft/mai-transcribe-2', storage: this.keyStore ? 'device' : 'session', retentionDays: 30, transcriptDays: TRANSCRIPT_MS / 86_400_000, warning: this.configWarning ? translate(this.configWarning, locale) : null, userName: osUserName(), models: SUMMARY_MODELS };
  }
  /** Eine Sitzung spricht gerade mit dem Anbieter (Transkription oder Zusammenfassung). */
  hasBusySession() { return [...this.sessions.values()].some(s => !s.noteId && (s.busy || s.finishing)); }
  getSession(id) {
    this.sweep();
    const s = this.sessions.get(id);
    if (!s) throw new Error('Die Sitzung ist nicht mehr vorhanden. Bitte eine neue Aufnahme starten.');
    s.touched = this.now();
    return s;
  }
  providerConfig(session) {
    const base = { ...(session?.config ?? this.config), apiKey: this.mistralApiKey, mistralApiKey: this.mistralApiKey, openRouterApiKey: this.openRouterApiKey };
    // Lokaler Weg (server/lokal.mjs): keine Schlüssel, Modell und Ziel kommen vom Anbieter.
    return this.provider.local ? this.provider.config(base) : base;
  }
  /** Live-Fakten (server/livefakten.mjs): jeder neue Abschnitt wird im Hintergrund ausgewertet, einer nach dem anderen. */
  collect(s) {
    const live = this.provider.live;
    if (!live || s.live?.failed) return;
    s.live ??= { state: live.start(), chain: Promise.resolve(), open: [], failed: false, startedAt: 0 };
    const job = s.live, segment = s.segments.at(-1), before = s.segments.at(-2);
    job.open.push(segment.text.length);
    job.chain = job.chain.then(async () => {
      if (job.failed) return;
      job.startedAt = performance.now();
      try { await live.add(job.state, segment, before, s.controller.signal); } catch { job.failed = true; } finally { job.open.shift(); job.startedAt = 0; }
    });
  }
  /**
   * Geschätzte Restzeit bis zur Notiz in Millisekunden, für den Fortschrittsbalken. Live-Fakten: offene Abschnitte nach
   * ihrer Länge. Sonst: Erfahrungswert je Zeichen Transkript, laufend an die gemessenen Zeiten angepasst.
   */
  restMs(s) {
    const now = performance.now(), job = s.live;
    if (job && !job.failed && !s.noteStartedAt) {
      // Zeit je Zeichen aus den bisherigen Abschnitten dieser Sitzung; offene Abschnitte zählen nach ihrer Länge.
      // Mit Aufschlag: dichte Abschnitte brauchen länger als der Schnitt, und die Spracherkennung teilt sich den Rechner.
      const perChar = 1.25 * (job.state.chars ? job.state.ms / job.state.chars : 35);
      // Ein Abschnitt, der länger läuft als erwartet, zählt weiter mit einem Viertel seiner erwarteten Zeit.
      return Math.round(job.open.reduce((sum, chars, i) => { const expected = 1000 + perChar * chars; return sum + Math.max(0.25 * expected, expected - (i === 0 && job.startedAt ? now - job.startedAt : 0)); }, 300));
    }
    const expected = this.expectedNoteMs(s.noteChars ?? s.segments.reduce((sum, x) => sum + x.text.length, 0)) * this.noteSpeed;
    return Math.round(s.noteStartedAt ? Math.max(600, expected - (now - s.noteStartedAt)) : expected);
  }
  /** Erfahrungswert für die Notiz in einem Aufruf: Cloud rund 3,5 s plus 1,3 ms je Zeichen (mit Sprecherzuordnung), lokal deutlich länger. */
  expectedNoteMs(chars) { return this.provider.local ? 8000 + 12 * chars : 3500 + 1.3 * chars; }
  /** `context.locale`: Sprache der Oberfläche; in ihr entstehen Notiz und Chat-Antworten (Deutsch, wenn nichts mitkommt). */
  /**
   * Fachbegriff-Schicht (server/korrektur.mjs): Fehlhörungen von Fachbegriffen, Wirkstoffen, Handelsnamen und Kürzeln werden
   * gegen das Verzeichnis des fest gewählten Fachgebiets berichtigt. Bei „Automatisch“ ist das Fachgebiet während der Aufnahme
   * noch unbekannt, dann bleibt der Text, wie er erkannt wurde. Ein Fehler der Schicht ändert nichts am Transkript.
   */
  async correct(session, text) {
    const fach = session.config.fachgebiet;
    if (!isFach(fach) || !text) return text;
    try { return (await correctText(fach, text)).text; } catch { return text; }
  }
  async dispatch(action, payload = {}, context = {}) {
    const locale = readLocale(context.locale);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Ungültige Anfrage.');
    switch (action) {
      case 'status': return this.status(locale);
      case 'settings.save': {
        // Laufende Sitzungen tragen ihre eigene Kopie der Einstellungen (session.start); nur ein gerade laufender
        // Aufruf an den Anbieter darf nicht unter den Füßen weg geändert werden. Liegengebliebene Sitzungen (etwa nach
        // einem Neuladen der Seite oder von einer anderen Person auf derselben gehosteten Instanz) sperren nichts mehr.
        if (this.hasBusySession()) throw new Error('Bitte kurz warten, bis die aktuelle Aufnahme verarbeitet ist.');
        const { region, model, style = '', fachgebiet = this.config.fachgebiet, apiKey, mistralApiKey, openRouterApiKey } = payload;
        if (!Object.hasOwn(ENDPOINTS, region) || !SUMMARY_MODELS.includes(model) || typeof style !== 'string' || style.length > 3000 || !isFachSetting(fachgebiet)) throw new Error('Ungültige Einstellungen.');
        for (const candidate of [apiKey, mistralApiKey, openRouterApiKey]) if (candidate !== undefined && (typeof candidate !== 'string' || candidate.length > 500 || /[\r\n\s]/.test(candidate))) throw new Error('Ungültiger API-Schlüssel.');
        const next = { region, model, style, fachgebiet };
        await writeFile(path.join(this.directory, 'settings.md'), `# Chetti · Einstellungen\n\n\`\`\`json\n${JSON.stringify(next, null, 2)}\n\`\`\`\n`, { mode: 0o600 });
        const nextMistral = mistralApiKey || apiKey;
        if (nextMistral || openRouterApiKey) {
          if (this.keyStore) await this.keyStore.write({ mistral: nextMistral || this.mistralApiKey, openRouter: openRouterApiKey || this.openRouterApiKey });
          if (nextMistral) this.mistralApiKey = nextMistral;
          if (openRouterApiKey) this.openRouterApiKey = openRouterApiKey;
        }
        this.config = next; this.configWarning = null;
        return this.status(locale);
      }
      case 'settings.check': return this.provider.check(this.providerConfig());
      case 'settings.removeKey': {
        if (this.hasBusySession()) throw new Error('Bitte kurz warten, bis die aktuelle Aufnahme verarbeitet ist.');
        await this.keyStore?.write(''); this.mistralApiKey = ''; this.openRouterApiKey = ''; return this.status(locale);
      }
      case 'session.start': {
        this.sweep();
        if (!this.provider.local && (!this.openRouterApiKey || (!this.config.model.startsWith('mistralai/') && !this.mistralApiKey))) throw new Error(this.config.model.startsWith('mistralai/') ? 'Bitte zuerst einen OpenRouter-API-Schlüssel hinterlegen.' : 'Bitte Mistral- und OpenRouter-API-Schlüssel hinterlegen.');
        if (this.sessions.size >= 10) throw new Error('Zu viele offene Sitzungen. Bitte alte Sitzungen schließen.');
        const id = randomUUID();
        const session = { touched: this.now(), config: { ...this.config }, controller: new AbortController(), segments: [], hashes: [], busy: false, noteId: null, draft: null, spoken: null };
        this.sessions.set(id, session);
        void this.provider.live?.warm(session.controller.signal);
        return { id };
      }
      case 'session.transcribe': {
        const s = this.getSession(payload.id);
        if (s.noteId || s.finishing) throw new Error('Diese Aufnahme ist bereits abgeschlossen.');
        const wav = validateWav(payload.audio);
        // Demo ohne Konto: Aufnahmezeit je Sitzung begrenzt (16 kHz, 16 Bit, mono = 32.000 Byte je Sekunde).
        const seconds = (wav.length - 44) / 32000;
        if (context.maxAudioSeconds && (s.audioSeconds ?? 0) + seconds > context.maxAudioSeconds) throw new Error('Die Demo ist auf 5 Minuten Aufnahme begrenzt. Für längere Aufnahmen bitte ein Konto anlegen.');
        const hash = createHash('sha256').update(wav).digest('hex');
        if (!Number.isInteger(payload.index) || payload.index < 0) throw new Error('Ungültige Audio-Reihenfolge.');
        if (payload.index < s.segments.length && s.hashes[payload.index] === hash) return { segments: s.segments };
        if (payload.index !== s.segments.length || s.busy) throw new Error('Audiopakete müssen in ihrer Reihenfolge verarbeitet werden.');
        if (s.segments.reduce((sum, x) => sum + x.text.length, 0) > 160000 || s.segments.length >= 300) throw new Error('Diese Sitzung ist zu lang. Bitte abschließen.');
        s.busy = true;
        try {
          const text = await this.provider.transcribe(wav, this.providerConfig(s), s.controller.signal, payload.language === 'auto' ? 'auto' : isLocale(payload.language) ? payload.language : 'de');
          if (s.controller.signal.aborted) throw new Error('Sitzung verworfen.');
          const preceding = s.segments.map(x => x.text).join(' ');
          s.segments.push({ id: `s${payload.index + 1}`, text: await this.correct(s, mergeTranscript(preceding, text)) });
          s.hashes.push(hash); s.audioSeconds = (s.audioSeconds ?? 0) + seconds; s.touched = this.now();
          this.collect(s);
          return { segments: s.segments };
        } finally { wav.fill(0); s.busy = false; }
      }
      case 'session.text': {
        const s = this.getSession(payload.id);
        if (s.busy || s.finishing || s.noteId || s.segments.length) throw new Error('In dieser Sitzung ist bereits eine Aufnahme vorhanden.');
        if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 160000) throw new Error('Bitte ein gültiges Transkript einfügen.');
        if (context.maxTextChars && payload.text.length > context.maxTextChars) throw new Error('Die Demo nimmt Texte bis 8.000 Zeichen an. Für längere Texte bitte ein Konto anlegen.');
        s.segments = [{ id: 's1', text: await this.correct(s, payload.text.trim()) }]; return { segments: s.segments };
      }
      case 'session.summarize': {
        const s = this.getSession(payload.id);
        // Die Vorlage darf bis zum Beenden gewechselt werden: Sie kommt mit der Anfrage, nicht aus dem Stand beim Sitzungsstart.
        const style = payload.style ?? s.config.style;
        if (typeof style !== 'string' || style.length > 3000) throw new Error('Ungültige Vorlage.');
        const template = readTemplate(payload.template);
        if (s.noteId) return this.notes.get(s.noteId);
        if (s.busy) throw new Error('Die Transkription ist noch nicht fertig.');
        if (s.finishing) return s.finishing;
        if (!s.segments.some(x => x.text.trim())) throw new Error('Es wurde noch keine Sprache erkannt.');
        if (payload.expectedSegments !== s.segments.length) throw new Error('Es fehlen noch Audiopakete. Bitte erst die Transkription abschließen.');
        if (s.draft && s.draftStyle !== style) s.draft = null; // Wiederholung nach Fehler mit anderer Vorlage: neu formulieren.
        // Position der Abschnitte in der Aufnahme (Sekunden) kennt nur die Oberfläche; sie kommt für die Transkript-Ansicht mit.
        const timing = new Map((Array.isArray(payload.timing) ? payload.timing : []).filter(t => t && typeof t === 'object' && typeof t.id === 'string').map(t => [t.id, { start: t.start, end: t.end }]));
        const transcript = s.segments.map(x => ({ ...x, ...timing.get(x.id) }));
        s.finishing = (async () => {
          // Ab hier läuft die Uhr für die Restzeit-Anzeige (restMs): Sprecherzuordnung und Notiz zählen beide.
          if (!s.live || s.live.failed || locale !== 'de' || !sectionMap(parseTemplate(style).template)) { s.noteStartedAt = performance.now(); s.noteChars = transcript.reduce((sum, x) => sum + x.text.length, 0); }
          // Sprecher je Satz aus dem Text, einmal je Sitzung; ohne Ergebnis bleibt das Transkript wie transkribiert.
          if (!s.spoken) s.spoken = (await this.provider.speakers?.(transcript, this.providerConfig(s), s.controller.signal).catch(() => null)) ?? null;
          const spoken = s.spoken ?? transcript;
          if (!s.draft && s.live && locale === 'de') {
            // Live-Fakten: Die Zeilen liegen bis auf den letzten Abschnitt schon vor; sie kommen in die Abschnitte der Vorlage.
            await s.live.chain;
            const tpl = parseTemplate(style).template, value = s.live.failed ? null : this.provider.live.note(s.live.state, tpl);
            if (value) try { s.draft = { body: validateSummary(value, spoken, tpl), patient: validatePatient(spokenName(spoken), spoken), hints: [] }; } catch { /* sonst die Notiz in einem Aufruf */ }
          }
          if (!s.draft) {
            if (!s.noteStartedAt) { s.noteStartedAt = performance.now(); s.noteChars = spoken.reduce((sum, x) => sum + x.text.length, 0); }
            const result = await this.provider.summarize(spoken, { ...this.providerConfig(s), style, locale }, s.controller.signal);
            this.noteSpeed = Math.min(4, Math.max(0.3, 0.7 * this.noteSpeed + 0.3 * ((performance.now() - s.noteStartedAt) / this.expectedNoteMs(s.noteChars))));
            s.draft = typeof result === 'string' ? { body: result, patient: '', hints: [] } : result;
          }
          s.draftStyle = style;
          if (s.controller.signal.aborted) throw new Error('Sitzung verworfen.');
          const note = await this.notes.create(s.draft.body, s.config.model, s.draft.patient, template, s.draft.hints);
          // Das Transkript wird zur Notiz abgelegt und nach 7 Tagen automatisch gelöscht: Bis dahin lässt es sich ansehen,
          // kopieren und die Notiz mit einer anderen Vorlage neu erstellen. Ohne Transkript gibt es keine Notiz.
          try { await this.notes.writeTranscript(note.id, spoken); } catch (error) { await this.notes.remove(note.id).catch(() => {}); throw error; }
          if (s.controller.signal.aborted) { await this.notes.remove(note.id); throw new Error('Sitzung verworfen.'); }
          s.noteId = note.id; s.hashes = []; s.draft = null; s.spoken = null; s.segments = []; s.live = null;
          return { ...note, transcriptUntil: this.notes.transcriptUntil(note.id) };
        })();
        try { return await s.finishing; } finally { s.finishing = null; s.noteStartedAt = 0; }
      }
      case 'session.progress': {
        // Restzeit bis zur Notiz für den Fortschrittsbalken; ohne Sitzung null, dann schätzt die Oberfläche selbst.
        const s = typeof payload.id === 'string' ? this.sessions.get(payload.id) : null;
        if (!s) return { restMs: null, packetMs: 0 };
        // packetMs: was ein noch nicht transkribiertes Audiopaket zusätzlich kostet, bis seine Zeilen vorliegen (nur Live-Fakten).
        const job = s.live && !s.live.failed && !s.noteStartedAt ? s.live.state : null;
        return { restMs: s.noteId ? 0 : this.restMs(s), packetMs: job?.chars ? Math.round(1000 + job.ms / job.count) : job ? 9000 : 0 };
      }
      case 'notes.regenerate': {
        // Notiz mit einer anderen oder angepassten Vorlage neu erstellen, solange ihr Transkript noch vorliegt (7 Tage).
        if (typeof payload.id !== 'string') throw new Error('Ungültige Notiz-ID.');
        if (!this.openRouterApiKey || (!this.config.model.startsWith('mistralai/') && !this.mistralApiKey)) throw new Error('Bitte zuerst einen OpenRouter-API-Schlüssel hinterlegen.');
        if (this.regenerating.has(payload.id)) throw new Error('Die Notiz wird gerade erstellt. Bitte kurz warten.');
        const style = payload.style ?? this.config.style;
        if (typeof style !== 'string' || style.length > 3000) throw new Error('Ungültige Vorlage.');
        const template = readTemplate(payload.template);
        const job = { controller: new AbortController() };
        this.regenerating.set(payload.id, job);
        try {
          const old = await this.notes.get(payload.id); // gelöschte Notizen werden nicht wiederbelebt
          const { segments } = await this.notes.getTranscript(payload.id);
          if (!segments.some(x => x.text.trim())) throw new Error('Das Transkript dieser Notiz ist leer.');
          const result = await this.provider.summarize(segments, { ...this.providerConfig(), style, locale }, job.controller.signal);
          const draft = typeof result === 'string' ? { body: result, patient: '' } : result;
          if (job.controller.signal.aborted) throw new Error('Abgebrochen.');
          return await this.notes.write(payload.id, draft.body, this.config.model, draft.patient ?? old.patient, template, draft.hints);
        } finally { this.regenerating.delete(payload.id); }
      }
      case 'session.discard': {
        const s = this.sessions.get(payload.id); s?.controller.abort();
        if (s) { s.segments = []; s.hashes = []; s.draft = null; s.spoken = null; }
        this.sessions.delete(payload.id); return { ok: true };
      }
      case 'notes.list': return this.notes.list();
      case 'notes.update': return this.notes.update(payload.id, payload.body);
      case 'notes.delete': return this.notes.remove(payload.id);
      case 'notes.hints': return this.notes.setHints(payload.id, payload.hints); // erledigte „Nicht erfragt“-Hinweise ausblenden
      case 'notes.transcript': return this.notes.getTranscript(payload.id);
      case 'notes.deleteTranscript': return this.notes.removeTranscript(payload.id);
      case 'notes.updateTranscript': {
        // Korrekturen am gespeicherten Transkript (Hörfehler, Namen); die Frist von 7 Tagen ab Erstellung bleibt.
        if (typeof payload.id !== 'string') throw new Error('Ungültige Notiz-ID.');
        await this.notes.getTranscript(payload.id); // ein gelöschtes Transkript wird nicht neu angelegt
        await this.notes.writeTranscript(payload.id, payload.segments);
        return this.notes.getTranscript(payload.id);
      }
      case 'notes.chat': {
        // Rückfragen zur Konsultation: beantwortet aus Notiz und, solange vorhanden, Transkript. Der Verlauf liegt nur in der Oberfläche.
        if (typeof payload.id !== 'string') throw new Error('Ungültige Notiz-ID.');
        if (!this.openRouterApiKey || (!this.config.model.startsWith('mistralai/') && !this.mistralApiKey)) throw new Error('Bitte zuerst einen OpenRouter-API-Schlüssel hinterlegen.');
        const messages = readChat(payload.messages);
        const note = await this.notes.get(payload.id);
        const segments = note.transcriptUntil ? (await this.notes.getTranscript(payload.id).catch(() => ({ segments: [] }))).segments : [];
        const reply = await this.provider.chat({ note: note.body, segments, messages }, { ...this.providerConfig(), locale });
        return { reply };
      }
      case 'notes.snippets': {
        // Welche Textbausteine passen zum Gespräch? `ids: null` heißt: nicht prüfbar, die Oberfläche nimmt ihren Ersatzweg.
        if (typeof payload.id !== 'string') throw new Error('Ungültige Notiz-ID.');
        const snippets = readSnippets(payload.snippets);
        const note = await this.notes.get(payload.id);
        const segments = note.transcriptUntil ? (await this.notes.getTranscript(payload.id).catch(() => ({ segments: [] }))).segments : [];
        return { ids: await this.provider.snippets({ note: note.body, segments, snippets }, this.providerConfig()) };
      }
      default:
        // Entwicklungsansicht /dev (Modelltests); erst bei Bedarf geladen.
        if (typeof action === 'string' && action.startsWith('dev.')) return (await import('./dev.mjs')).devBench(this, action, payload, locale);
        // Lokale Modelle laden (Einstellungen und /dev).
        if (typeof action === 'string' && action.startsWith('models.')) return (await import('./modelle.mjs')).modelBench(action, payload);
        throw new Error('Diese Aktion wird nicht unterstützt.');
    }
  }
}
