/**
 * Laufzeit des Chetti-Helfers: Spracherkennung und Sprachmodell starten erst, wenn eine Konsultation sie braucht,
 * und werden nach einigen Minuten ohne Anfrage wieder beendet. Danach sind Arbeitsspeicher und Grafikspeicher des Rechners frei.
 *
 * Zwei Dienste: `stt` (whisper.cpp `whisper-server`) und `llm` (Ollama). Ein Dienst, der schon vorher lief (vom Nutzer
 * oder einem anderen Programm gestartet), wird mitbenutzt und nie beendet. Die Dienste selbst sind austauschbar
 * (`services`), damit Start und Leerlauf ohne echte Prozesse getestet werden können.
 */
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CATALOG, ensureOllama, findOllama, stopOllama } from '../server/modelle.mjs';

const KINDS = ['stt', 'llm'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const missing = text => Object.assign(new Error(text), { missing: true });

export class Runtime {
  /** `services[kind].start({ onExit })` liefert eine Funktion zum Beenden (oder null, wenn der Dienst nicht uns gehört); `warm` ist optional. */
  constructor({ services, idleMs = 5 * 60_000, now = Date.now } = {}) {
    this.services = services; this.idleMs = idleMs; this.now = now;
    this.slots = Object.fromEntries(KINDS.map(kind => [kind, { state: 'stopped', error: '', stop: null, starting: null }]));
    this.inflight = 0; this.last = now(); this.timer = null;
  }
  /** Stand für die Oberfläche: je Dienst `stopped | starting | ready | missing | error`. */
  snapshot() { return Object.fromEntries(KINDS.map(kind => [kind, { state: this.slots[kind].state, ...(this.slots[kind].error && { error: this.slots[kind].error }) }])); }
  touch() { this.last = this.now(); this.arm(); }
  arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.idle(), this.idleMs);
    this.timer.unref?.();
  }
  /** Läuft nichts mehr und war die letzte Anfrage lange her, werden die Dienste beendet; sonst wird weiter gewartet. */
  async idle() {
    if (this.inflight > 0 || this.now() - this.last < this.idleMs) { this.arm(); return false; }
    await this.stopAll();
    return true;
  }
  async ensure(kind) {
    const slot = this.slots[kind];
    this.touch();
    if (slot.state === 'ready') return;
    slot.starting ??= (async () => {
      slot.state = 'starting'; slot.error = '';
      try {
        slot.stop = await this.services[kind].start({ onExit: () => { if (slot.state === 'ready') { slot.state = 'stopped'; slot.stop = null; } } });
        slot.state = 'ready';
      } catch (error) {
        slot.state = error?.missing ? 'missing' : 'error'; slot.error = error?.message || 'Der Dienst startet nicht.';
        throw error;
      } finally { slot.starting = null; }
    })();
    await slot.starting;
  }
  /** Eine Anfrage an einen Dienst: stellt ihn bereit und hält ihn während der Anfrage am Leben. */
  async use(kind, task) {
    await this.ensure(kind);
    this.inflight++;
    try { return await task(); } finally { this.inflight--; this.touch(); }
  }
  /** Beide Dienste bereitmachen, sobald eine Konsultation beginnt, damit der Start hinter dem Gesprächsbeginn verschwindet. */
  async warmup() {
    await Promise.all(KINDS.map(kind => this.ensure(kind)));
    await this.services.llm.warm?.().catch(() => {});
  }
  async stopAll() {
    clearTimeout(this.timer);
    for (const kind of KINDS) {
      const slot = this.slots[kind];
      if (slot.state !== 'ready') continue;
      const stop = slot.stop; slot.state = 'stopped'; slot.stop = null;
      try { await stop?.(); } catch { /* Dienst war schon weg */ }
    }
  }
  close() { return this.stopAll(); }
}

const up = async (url, fetcher = fetch) => { try { const r = await fetcher(url, { signal: AbortSignal.timeout(1500) }); await r.body?.cancel().catch(() => {}); return r.ok; } catch { return false; } };
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Sucht ein Programm: eigener Ordner des Helfers (`bin`), Suchpfad, übliche Orte. */
export async function findBinary(name, { dirs = [] } = {}) {
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bin');
  const places = [process.env.CHETTI_BIN_DIR, here, ...dirs, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
  for (const dir of places) {
    const file = path.join(dir, name + EXE);
    try { await access(file, constants.X_OK); return file; } catch { /* nächster Ort */ }
  }
  return null;
}

const modelFile = home => path.join(home, '.cache', 'chetti', CATALOG.find(m => m.kind === 'stt').file);

/** whisper.cpp `whisper-server` am Loopback, wie scripts/lokal.mjs: Beam-Suche mit fünf Pfaden, Sprache automatisch. */
export function whisperService({ config, home = os.homedir(), fetcher = fetch, binary = () => findBinary('whisper-server'), exists = file => access(file).then(() => true, () => false) } = {}) {
  return {
    async start({ onExit }) {
      const url = new URL(config.sttUrl);
      if (await up(`${url.origin}/health`, fetcher)) return null;
      const model = modelFile(home);
      if (!(await exists(model))) throw missing('Die Spracherkennung ist noch nicht geladen.');
      const exe = await binary();
      if (!exe) throw missing('Das Spracherkennungsprogramm (whisper-server) fehlt.');
      const child = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', url.port, '--inference-path', `${url.pathname.replace(/\/$/, '')}/audio/transcriptions`, '-l', 'auto', '-bs', '5'], { stdio: 'ignore', windowsHide: true });
      let dead = false;
      child.on('exit', () => { dead = true; onExit?.(); });
      child.on('error', () => { dead = true; onExit?.(); });
      for (let i = 0; i < 180 && !dead; i++) {
        if (await up(`${url.origin}/health`, fetcher)) return async () => { child.kill(); };
        await sleep(500);
      }
      child.kill();
      throw new Error('Die Spracherkennung startet nicht.');
    },
  };
}

/** Ollama: wird gestartet, wenn es vorhanden ist; die Installation übernimmt der Modell-Download (server/modelle.mjs). */
export function ollamaService({ config, home = os.homedir(), fetcher = fetch } = {}) {
  const base = new URL(config.llmUrl).origin;
  return {
    async start() {
      // Ollama oder ein anderer OpenAI-kompatibler Dienst (z. B. llama-server) läuft schon: mitbenutzen, nie beenden.
      if (await up(`${base}/api/version`, fetcher) || await up(`${config.llmUrl}/models`, fetcher)) return null;
      if (!(await findOllama({ home }))) throw missing('Das Programm für das Sprachmodell (Ollama) fehlt.');
      await ensureOllama({ step: 'dienst', done: 0, total: 0, from: null, controller: new AbortController() }, { fetcher, home });
      return async () => { stopOllama(); };
    },
    /** Lädt das Sprachmodell in den Speicher, bevor die erste Anfrage kommt. */
    async warm() {
      const r = await fetcher(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.llmModel, keep_alive: '10m' }), signal: AbortSignal.timeout(120_000) });
      await r.body?.cancel().catch(() => {});
    },
  };
}
