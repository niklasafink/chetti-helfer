/**
 * Chetti-Helfer: der lokale Dienst hinter der Webapp. Der Browser zeigt nur die Oberfläche; Aufnahme, Spracherkennung und Notiz laufen
 * hier auf dem Rechner der Praxis, Daten und Modelle bleiben in einem lokalen Ordner. Cloud-Anbieter werden nie angesprochen.
 *
 * Schnittstelle (nur 127.0.0.1, https mit lokalem Zertifikat, nur von erlaubten Ursprüngen):
 *   GET  /helper/info    Version, Hardware, Modellpaket, Stand der Dienste (ohne Gesprächsdaten)
 *   POST /helper/warmup  Dienste bereitmachen (die Webapp ruft es beim Start einer Konsultation)
 *   POST /helper/stop    Dienste beenden und Speicher freigeben
 *   POST /api            dieselben Aktionen wie der lokale Server (server/service.mjs), ohne `auth.*` und `dev.*`
 *
 * Schutz: Der Host muss 127.0.0.1 oder localhost mit unserem Port sein (gegen DNS-Rebinding), und jede Anfrage trägt einen
 * erlaubten Origin. Eine fremde Webseite kommt damit weder durch die Browserprüfung (CORS) noch durch die Prüfung hier.
 */
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { ChettiService } from '../server/service.mjs';
import { LocalProvider, localConfig } from '../server/lokal.mjs';
import { readLocale, translate } from '../server/i18n.mjs';
import { assess } from './hardware.mjs';
import { Runtime, ollamaService, whisperService } from './runtime.mjs';

export const DEFAULT_PORT = 47813;
export const DEFAULT_ORIGINS = ['https://chettiai.de', 'https://www.chettiai.de'];
const MAX_BYTES = 3_100_000;
const BLOCKED = /^(auth|dev)\./;

export async function createHelper({ directory, port = DEFAULT_PORT, tls, origins = DEFAULT_ORIGINS, version = '0.1.0', hardware = assess(), runtime, provider, fetcher = fetch, home = os.homedir(), idleMs } = {}) {
  const env = { ...process.env, CHETTI_WEG: 'lokal', ...(hardware.tier && !process.env.CHETTI_LOCAL_LLM_MODEL ? { CHETTI_LOCAL_LLM_MODEL: hardware.tier } : {}) };
  const config = localConfig(env);
  // Ollama bekommt das Fenster beim Start (server/modelle.mjs); eine eigene Angabe des Nutzers hat Vorrang.
  process.env.OLLAMA_CONTEXT_LENGTH ||= String(config.llmContext);
  runtime ??= new Runtime({ idleMs, services: { stt: whisperService({ config, home, fetcher }), llm: ollamaService({ config, home, fetcher }) } });
  // Anfragen der Pipeline (Audio, Chat) starten den passenden Dienst bei Bedarf und halten ihn am Leben; Abfragen des Stands (GET) nicht.
  const guarded = (url, init) => {
    const target = String(url);
    const kind = init?.method === 'POST' ? (target.startsWith(new URL(config.sttUrl).origin) ? 'stt' : target.startsWith(new URL(config.llmUrl).origin) ? 'llm' : null) : null;
    return kind ? runtime.use(kind, () => fetcher(url, init)) : fetcher(url, init);
  };
  provider ??= new LocalProvider(guarded, config);
  // Je Konto ein eigener Dienst mit eigenem Datenordner und eigenen Sitzungen: Mehrere Konten auf einem Rechner sehen weder
  // die Notizen noch die laufenden Aufnahmen der anderen. Die Kennung kommt von der Webapp (die Seite ist durch den Origin
  // geprüft); sie trennt Daten, sie beweist keine Anmeldung.
  const services = new Map();
  const serviceFor = async account => {
    if (!services.has(account)) {
      services.set(account, (async () => { const instance = new ChettiService({ directory: path.join(directory, 'accounts', account), provider }); await instance.init(); return instance; })());
    }
    return services.get(account);
  };

  const hosts = port => [`127.0.0.1:${port}`, `localhost:${port}`];
  const server = (tls ? https.createServer({ key: tls.key, cert: tls.cert }) : http.createServer());
  server.on('request', async (req, res) => {
    const origin = req.headers.origin;
    const allowed = Boolean(origin) && origins.includes(origin);
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...(allowed && { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' }) };
    const json = (code, data) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (!hosts(server.address().port).includes(req.headers.host)) return json(403, { error: 'Ungültiger Host.' });
    if (origin && !allowed) return json(403, { error: 'Diese Anfrage ist nicht erlaubt.' });
    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' }); return res.end(); }
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { return json(400, { error: 'Ungültige Adresse.' }); }

    if (req.method === 'GET' && pathname === '/helper/info') {
      const { ramGb, cores, platform, arch, capable, reason, tier } = hardware;
      return json(200, { name: 'chetti-helper', version, protocol: 1, hardware: { ramGb, cores, platform, arch }, capable, reason, paket: [config.llmModel, config.sttModel], tier, context: config.llmContext, runtime: runtime.snapshot() });
    }
    // Alles Weitere verlangt einen erlaubten Origin: auch einfache Anfragen ohne Vorprüfung kommen nur aus der Webapp.
    if (req.method !== 'POST' || !allowed) return json(req.method === 'POST' ? 403 : 405, { error: req.method === 'POST' ? 'Diese Anfrage ist nicht erlaubt.' : 'Methode nicht erlaubt.' });
    if (pathname === '/helper/warmup') { void runtime.warmup().catch(() => {}); return json(200, { runtime: runtime.snapshot() }); }
    if (pathname === '/helper/stop') { await runtime.stopAll(); return json(200, { runtime: runtime.snapshot() }); }
    if (pathname !== '/api') return json(404, { error: 'Nicht gefunden.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(403, { error: 'Diese Anfrage ist nicht erlaubt.' });
    let raw = '', bytes = 0, locale = readLocale();
    try {
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BYTES) return json(413, { error: 'Audiopaket ist zu groß.' }); raw += chunk.toString('utf8'); }
      const { action, payload, locale: requested, account } = JSON.parse(raw);
      raw = ''; locale = readLocale(requested);
      if (typeof action !== 'string' || BLOCKED.test(action)) throw new Error('Diese Aktion wird nicht unterstützt.');
      if (typeof account !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(account)) throw new Error('Ungültige Anfrage.');
      // Beginnt eine Konsultation, laufen die Dienste schon an, während die Ärztin spricht.
      if (action === 'session.start') void runtime.warmup().catch(() => {});
      json(200, { result: await (await serviceFor(account)).dispatch(action, payload, { locale }) });
    } catch (error) {
      json(400, { error: translate(error instanceof SyntaxError ? 'Ungültige Anfrage.' : error.code ? 'Dateizugriff fehlgeschlagen. Bitte Schreibrechte prüfen.' : error.message || 'Die Aktion ist fehlgeschlagen.', locale) });
    }
  });
  server.requestTimeout = 120_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  return {
    server, runtime, serviceFor, port: address.port, url: `${tls ? 'https' : 'http'}://127.0.0.1:${address.port}`,
    close: async () => { for (const pending of services.values()) (await pending).close(); await runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
