/**
 * Lokale KI-Modelle laden (Einstellungen und /dev): ein Klick je Modell, der Stand bleibt sichtbar.
 *
 * Sprachmodelle kommen über Ollama aus dessen Verzeichnis (ollama.com), die Spracherkennung als Datei von Hugging Face
 * (wie scripts/lokal.mjs). Läuft Ollama nicht, wird es gestartet; fehlt es, wird es einmalig von der Projektseite
 * (GitHub-Release) in den Chetti-Ordner geladen und entpackt. Jeder dieser Schritte steht im Stand des Modells
 * (`job`: Schritt, geladene und erwartete Bytes, Restzeit), den die Oberfläche mit `models.list` abfragt.
 * Der Stand liegt nur im Speicher dieses Prozesses. Gehostet (Vercel) gibt es nur die Liste.
 * Meldungen bleiben deutsch und stehen als Vorlagentext da (siehe server/lokal.mjs).
 */
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { localConfig } from './lokal.mjs';

/** Größen in Bytes laut Verzeichnis (Stand 2026-10-11); beim Laden zählt die Angabe der Gegenstelle. Reihenfolge: reports/Notiztest lokale Modelle.md. */
export const CATALOG = [
  { id: 'gemma4:31b', name: 'Gemma 4 31B', kind: 'llm', bytes: 20_385_457_992 },
  { id: 'qwen3.8:27b', name: 'Qwen 3.8 27B', kind: 'llm', bytes: 17_741_871_939 },
  { id: 'gemma3:12b', name: 'Gemma 3 12B', kind: 'llm', bytes: 8_164_039_587 },
  { id: 'ministral-3:8b', name: 'Ministral 8B', kind: 'llm', bytes: 6_022_236_102 },
  { id: 'ministral-3:3b', name: 'Ministral 3B', kind: 'llm', bytes: 2_953_840_294 },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', kind: 'stt', bytes: 574_041_195, file: 'ggml-large-v3-turbo-q5_0.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin' },
];

const HOSTED = () => Boolean(process.env.VERCEL);
const RELEASE = 'https://github.com/ollama/ollama/releases/latest/download/';
const ARCHIVES = { 'darwin-arm64': 'ollama-darwin.tgz', 'darwin-x64': 'ollama-darwin.tgz', 'win32-x64': 'ollama-windows-amd64.zip', 'win32-arm64': 'ollama-windows-arm64.zip' };
const EXE = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
// Wie scripts/lokal.mjs: der Auftrag der Notiz passt nicht in das Standardfenster von Ollama.
const CONTEXT = '16384';
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gb = bytes => (bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 });
/** Meldung, die so in der Oberfläche erscheinen darf; alles andere wird zu einer allgemeinen Meldung. */
const say = text => Object.assign(new Error(text), { shown: true });
const folder = home => path.join(home, '.cache', 'chetti');
const origin = () => new URL(localConfig().llmUrl).origin;
const up = async (fetcher, url) => { try { const r = await fetcher(url, { signal: AbortSignal.timeout(1500) }); await r.body?.cancel().catch(() => {}); return r.ok; } catch { return false; } };

const jobs = new Map();
/** Fortschritt eines Schritts; das Tempo zählt ab dem ersten Wert, damit fortgesetzte Downloads nicht zu schnell wirken. */
function progress(job, done, total) {
  job.done = done; if (total) job.total = total;
  job.from ??= { at: performance.now(), done };
}
function step(job, name) { job.step = name; job.done = 0; job.total = 0; job.from = null; }
/** Stand für die Oberfläche; Restzeit in ms, sobald drei Sekunden Tempo gemessen sind. */
export function jobView(job, now = performance.now()) {
  if (!job) return null;
  const span = job.from ? now - job.from.at : 0, rate = span > 3000 ? (job.done - job.from.done) / span : 0;
  return { step: job.step, done: job.done, total: job.total, eta: rate > 0 && job.total > job.done ? Math.round((job.total - job.done) / rate) : null, ...(job.error && { error: job.error }) };
}

/** Lädt eine Datei mit Zwischenstand; ein abgebrochener Download wird fortgesetzt, wenn die Gegenstelle Teilabrufe kann. */
async function download(url, file, job, { fetcher }) {
  await mkdir(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  const have = await stat(part).then(s => s.size, () => 0);
  const response = await fetcher(url, { signal: job.controller.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
  if (response.status === 416) { await rm(part, { force: true }); return download(url, file, job, { fetcher }); }
  if (!response.ok || !response.body) throw say(`Der Download ist fehlgeschlagen (${response.status}).`);
  const resumed = response.status === 206, start = resumed ? have : 0;
  const length = Number(response.headers.get('content-length')) || 0;
  progress(job, start, length ? start + length : 0);
  await pipeline(Readable.fromWeb(response.body), async function* (source) { for await (const chunk of source) { progress(job, job.done + chunk.length); yield chunk; } }, createWriteStream(part, { flags: resumed ? 'a' : 'w' }), { signal: job.controller.signal });
  await rename(part, file);
}

/** Ollama auf diesem Rechner: der eigene Ordner, der Suchpfad und die üblichen Orte (eine Desktop-App erbt den Suchpfad der Shell nicht). */
export async function findOllama({ home }) {
  const places = [path.join(folder(home), 'ollama', EXE), 'ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama',
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')] : [])];
  for (const place of places) { try { await run(place, ['--version'], { timeout: 5000, windowsHide: true }); return place; } catch { /* nächster Ort */ } }
  return null;
}
/** Beendet Ollama, wenn Chetti es gestartet hat; ein schon laufendes oder vom Nutzer gestartetes Ollama bleibt unberührt. */
export function stopOllama() { const running = daemon; daemon = null; running?.kill(); return Boolean(running); }
/** Chetti hat dieses Ollama selbst gestartet (Download oder Konsultation) und darf es deshalb auch beenden. */
export const ownsOllama = () => Boolean(daemon);
/** Ein Modell wird gerade geladen: Ollama muss dafür weiterlaufen. */
export const downloading = () => [...jobs.values()].some(job => job.step !== 'fehler');
async function installOllama(job, context) {
  const archive = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!archive) throw say(`Ollama fehlt. Bitte von ollama.com/download installieren.`);
  const directory = path.join(folder(context.home), 'ollama'), file = path.join(directory, archive);
  step(job, 'laufzeit');
  await download(RELEASE + archive, file, job, context);
  step(job, 'entpacken');
  // tar (bsdtar) entpackt auf macOS und Windows beide Formate.
  await run('tar', ['-xf', file, '-C', directory], { timeout: 10 * 60_000, windowsHide: true });
  await rm(file, { force: true });
  return path.join(directory, EXE);
}

let daemon = null, starting = null;
process.once('exit', () => daemon?.kill());
/** Sorgt für ein laufendes Ollama und nennt dessen Adresse. Gleichzeitige Downloads teilen sich den Start. */
export async function ensureOllama(job, context) {
  const base = origin();
  if (await up(context.fetcher, `${base}/api/version`)) return base;
  step(job, 'dienst');
  starting ??= (async () => {
    const binary = (await findOllama(context)) ?? (await installOllama(job, context));
    step(job, 'dienst');
    daemon = spawn(binary, ['serve'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_HOST: new URL(base).host, OLLAMA_CONTEXT_LENGTH: process.env.OLLAMA_CONTEXT_LENGTH || CONTEXT } });
    daemon.on('error', () => { daemon = null; });
    for (let i = 0; i < 60; i++) { if (await up(context.fetcher, `${base}/api/version`)) return; await sleep(500); }
    throw say(`Ollama startet nicht.`);
  })().finally(() => { starting = null; });
  await starting;
  return base;
}

/** Lädt ein Sprachmodell über Ollama; dessen Zeilenstrom nennt je Schicht geladene und gesamte Bytes. */
async function pull(base, model, job, { fetcher }) {
  step(job, 'laden'); job.total = model.bytes;
  const response = await fetcher(`${base}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.id, stream: true }), signal: job.controller.signal });
  if (!response.ok || !response.body) throw say(`Ollama meldet Fehler ${response.status}.`);
  const layers = new Map(), decoder = new TextDecoder();
  let buffer = '', success = false;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.error) throw say(/not found|does not exist/i.test(event.error) ? `Dieses Modell gibt es im Verzeichnis nicht.` : `Der Download ist fehlgeschlagen.`);
      if (event.digest && event.total) {
        layers.set(event.digest, [Number(event.completed) || 0, Number(event.total)]);
        const sums = [...layers.values()].reduce(([d, t], [done, total]) => [d + done, t + total], [0, 0]);
        // Die Schichten melden sich nacheinander an; bis dahin gilt die Größe aus der Liste.
        progress(job, sums[0], Math.max(sums[1], layers.size > 1 ? 0 : model.bytes));
      } else if (/^(verifying|writing|removing)/.test(event.status ?? '') && job.step !== 'pruefen') step(job, 'pruefen');
      if (event.status === 'success') success = true;
    }
  }
  if (!success) throw say(`Der Download wurde unterbrochen.`);
}

/** Vorhandene Modelle: Ollama nennt seine eigenen; läuft es nicht, zählen dessen Verzeichniseinträge. */
async function installed({ fetcher, home }) {
  const found = new Set(CATALOG.filter(m => m.kind === 'stt' && existsSync(path.join(folder(home), m.file))).map(m => m.id));
  let tags = null;
  try { const r = await fetcher(`${origin()}/api/tags`, { signal: AbortSignal.timeout(1500) }); tags = r.ok ? await r.json() : null; } catch { /* kein Dienst */ }
  const library = path.join(process.env.OLLAMA_MODELS || path.join(home, '.ollama', 'models'), 'manifests', 'registry.ollama.ai', 'library');
  const names = Array.isArray(tags?.models) ? tags.models.map(m => m?.name) : CATALOG.filter(m => m.kind === 'llm' && existsSync(path.join(library, ...m.id.split(':')))).map(m => m.id);
  for (const name of names) found.add(name);
  return found;
}

async function work(model, job, context) {
  try {
    const free = await context.free();
    if (free < model.bytes * 1.02) throw say(`Zu wenig Speicherplatz: ${gb(model.bytes)} GB nötig, ${gb(free)} GB frei.`);
    if (model.kind === 'stt') { step(job, 'laden'); await download(model.url, path.join(folder(context.home), model.file), job, context); }
    else await pull(await ensureOllama(job, context), model, job, context);
    if (jobs.get(model.id) === job) jobs.delete(model.id);
  } catch (error) {
    if (jobs.get(model.id) !== job) return; // abgebrochen
    job.step = 'fehler'; job.error = error?.shown ? error.message : `Der Download ist fehlgeschlagen. Bitte die Internetverbindung prüfen.`;
  }
}

async function list(context) {
  const have = HOSTED() ? new Set() : await installed(context);
  return { hosted: HOSTED(), models: CATALOG.map(({ id, name, kind, bytes }) => ({ id, name, kind, bytes, installed: have.has(id), job: jobView(jobs.get(id)) })) };
}

export async function modelBench(action, payload, { fetcher = fetch, home = os.homedir(), free = async () => { const s = await statfs(os.homedir()); return s.bavail * s.bsize; } } = {}) {
  const context = { fetcher, home, free };
  const model = CATALOG.find(m => m.id === payload?.id);
  switch (action) {
    case 'models.list': return list(context);
    case 'models.download': {
      if (!model) throw new Error(`Unbekanntes Modell.`);
      if (HOSTED()) throw new Error(`Modelle lädt nur die lokale App.`);
      const running = jobs.get(model.id);
      if (!running || running.step === 'fehler') {
        const job = { step: 'dienst', done: 0, total: 0, from: null, error: '', controller: new AbortController() };
        jobs.set(model.id, job);
        void work(model, job, context);
      }
      return list(context);
    }
    case 'models.cancel': {
      if (!model) throw new Error(`Unbekanntes Modell.`);
      const job = jobs.get(model.id);
      jobs.delete(model.id);
      job?.controller.abort();
      return list(context);
    }
    default: throw new Error('Diese Aktion wird nicht unterstützt.');
  }
}
