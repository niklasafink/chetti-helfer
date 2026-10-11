/**
 * Vollständig lokaler Weg: Transkription und Notiz laufen auf dem Rechner der Praxis, ohne Schlüssel und ohne Internet.
 *
 * Aufträge, Prüfungen und Schreibprofile sind dieselben wie im Cloud-Weg (server/provider.mjs); nur das Ziel der
 * Anfragen wechselt auf zwei OpenAI-kompatible Dienste am Loopback: Spracherkennung (whisper.cpp `whisper-server`)
 * und Sprachmodell (Ollama oder llama.cpp `llama-server`). Andere Adressen als 127.0.0.1/localhost werden abgelehnt,
 * damit „lokal“ nicht stillschweigend ein Netzwerkziel wird. Start der Dienste: README „Lokal ohne Cloud“.
 * Die Sprecherzuordnung (server/sprecher.mjs) entfällt lokal: Sie kostete die Hälfte der Zeit einer Notiz und ist für die Notiz nicht nötig.
 *
 * Meldungen dieses Wegs bleiben deutsch und stehen nicht in den Wörterbüchern (nur Entwicklungsansicht /dev).
 */
import os from 'node:os';
import { MistralProvider } from './provider.mjs';
import { Classifier } from './classifier.mjs';
import { DecisionClassifier } from './entscheider.mjs';
import { LiveFacts } from './livefakten.mjs';

export const LOCAL_DEFAULTS = { sttUrl: 'http://127.0.0.1:8178/v1', sttModel: 'whisper-large-v3-turbo', llmUrl: 'http://127.0.0.1:11434/v1', llmModel: 'gemma3:12b' };
/**
 * Modellpaket für den lokalen Weg (Kennungen aus server/modelle.mjs): ab 16 GB Arbeitsspeicher Ministral 8B, darunter Ministral 3B,
 * dazu die Spracherkennung. Gemessen: reports/KPI-Status lokal gegen Cloud.md (8B 15 bis 17 von 17 Fakten, 3B 13).
 */
export const localPackage = (totalmem = os.totalmem()) => ({ llm: totalmem >= 15.5e9 ? 'ministral-3:8b' : 'ministral-3:3b', stt: 'whisper-large-v3-turbo' });
/**
 * Fenster des Sprachmodells in Tokens. Es belegt Arbeitsspeicher, auch wenn es leer bleibt: Ministral 3B braucht über Ollama
 * mit 16.384 Tokens 4,1 GB, mit 4.096 Tokens 2,7 GB (gemessen 2026-10-12). Die Live-Fakten schicken je Abschnitt nur einen
 * Bruchteil davon; das kleine Modell für Rechner mit 8 GB bekommt deshalb das kleine Fenster.
 */
export const localContext = model => (model === 'ministral-3:3b' ? 4096 : 16384);
// Lokale Modelle brauchen je nach Rechner deutlich länger als ein Cloud-Endpoint.
const TIMEOUT_MS = 10 * 60_000;
// Diese Modelle liefern nur ohne Denkphase eine Notiz (reports/Notiztest lokale Modelle.md).
const REASONING_OFF = /^qwen3/;

export function localConfig(env = process.env) {
  const config = {
    sttUrl: env.CHETTI_LOCAL_STT_URL || LOCAL_DEFAULTS.sttUrl, sttModel: env.CHETTI_LOCAL_STT_MODEL || LOCAL_DEFAULTS.sttModel,
    llmUrl: env.CHETTI_LOCAL_LLM_URL || LOCAL_DEFAULTS.llmUrl, llmModel: env.CHETTI_LOCAL_LLM_MODEL || (env.CHETTI_WEG === 'lokal' ? localPackage().llm : LOCAL_DEFAULTS.llmModel),
    llmContext: 0,
    // Optional: Entscheidungsmodell (Jev-Schnittstelle, server/entscheider.mjs) für Fachgebiet und Belegprüfung statt des Sprachmodells.
    // Live-Fakten (server/livefakten.mjs): Notiz entsteht während der Aufnahme. CHETTI_LOCAL_LIVE=0 schaltet auf die Notiz in einem Aufruf zurück.
    live: env.CHETTI_LOCAL_LIVE !== '0',
    deciderUrl: env.CHETTI_LOCAL_DECIDER_URL || '', deciderModel: env.CHETTI_LOCAL_DECIDER_MODEL || 'kev-latest', deciderTasks: (env.CHETTI_LOCAL_DECIDER_TASKS || 'choose').split(',').map(t => t.trim()).filter(Boolean),
  };
  config.llmContext = Number(env.CHETTI_LOCAL_LLM_CONTEXT) || localContext(config.llmModel);
  for (const key of ['sttUrl', 'llmUrl', ...(config.deciderUrl ? ['deciderUrl'] : [])]) {
    let host = '';
    try { host = new URL(config[key]).hostname; } catch { /* ungültige Adresse */ }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error(`Lokale Dienste müssen auf diesem Rechner laufen (127.0.0.1): ${key}.`);
    config[key] = config[key].replace(/\/$/, '');
  }
  return config;
}

// Auftrag, Schreibprofil und Vorlage der Notiz in einem Aufruf sowie Platz für die Antwort (Tokens, geschätzt).
const PROMPT_RESERVE = 2700;
/** Teilt einen langen Text an Satzenden in Stücke, die das Sprachmodell einzeln auswertet. */
const pieces = (text, size = 1200) => (text.match(/[^.!?\n]+[.!?\n]*/g) ?? [text]).reduce((parts, sentence) => {
  if (parts.length && parts.at(-1).length + sentence.length <= size) parts[parts.length - 1] += sentence; else parts.push(sentence);
  return parts;
}, []).map(part => part.trim()).filter(Boolean);

/** Klassifizierer am lokalen Sprachmodell; die knappen Zeitlimits der Cloud-Aufrufe gelten hier nicht. */
class LocalClassifier extends Classifier {
  complete(apiKey, system, user, signal, options = {}) { return super.complete(apiKey, system, user, signal, { ...options, timeoutMs: TIMEOUT_MS }); }
}

export class LocalProvider extends MistralProvider {
  constructor(fetcher = fetch, local = localConfig()) {
    const llm = new LocalClassifier({ fetcher, endpoint: local.llmUrl, model: local.llmModel });
    super(fetcher, { classifier: local.deciderUrl ? new DecisionClassifier({ fetcher, endpoint: local.deciderUrl, model: local.deciderModel, tasks: local.deciderTasks, fallback: llm }) : llm });
    this.local = local;
    this.live = local.live ? new LiveFacts({ fetcher, endpoint: local.llmUrl, model: local.llmModel }) : null;
  }
  /** Einstellungen für die Aufrufe: kein Schlüssel nötig; der Platzhalter schaltet nur die Klassifizierer-Schritte frei. */
  config(base) { return { ...base, model: 'mistralai/mistral-small-2603', apiKey: '', mistralApiKey: '', openRouterApiKey: 'lokal' }; }
  async requestOpenRouter(config, route, init, signal) {
    const audio = route === '/audio/transcriptions';
    let body = init.body;
    if (audio) body.set('model', this.local.sttModel);
    // Modellname und Anbieterwahl der Cloud-Anfrage entfallen; alles andere (Auftrag, JSON-Format, Temperatur) bleibt.
    else if (typeof body === 'string') { const { provider, ...rest } = JSON.parse(body); body = JSON.stringify({ ...rest, model: this.local.llmModel, ...(REASONING_OFF.test(this.local.llmModel) && { reasoning_effort: 'none' }) }); }
    let response;
    try {
      response = await this.fetcher(`${audio ? this.local.sttUrl : this.local.llmUrl}${route}`, { ...init, body, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    } catch (error) {
      if (signal?.aborted) throw new Error('Vorgang abgebrochen.');
      throw new Error(`${audio ? 'Die lokale Spracherkennung' : 'Das lokale Sprachmodell'} ${error.name === 'TimeoutError' ? 'antwortet nicht rechtzeitig' : 'ist nicht erreichbar'}.`);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${audio ? 'Die lokale Spracherkennung' : 'Das lokale Sprachmodell'} meldet Fehler ${response.status}.`); }
    return response.json();
  }
  request(config, route, init, signal) { return this.requestOpenRouter(config, route, init, signal); }
  /**
   * Notiz in einem Aufruf (Rückfall der Live-Fakten, eingefügte Transkripte, Briefe). Passt das Gespräch nicht in das Fenster
   * des Sprachmodells, schnitte der Dienst es still ab; es wird deshalb erst abschnittsweise zu Stichpunkten verdichtet.
   */
  async summarize(segments, config, signal) {
    const room = (this.local.llmContext - PROMPT_RESERVE) * 3; // etwa drei Zeichen je Token
    if (this.live && segments.reduce((sum, s) => sum + s.text.length, 0) > room) segments = await this.condense(segments, signal);
    return super.summarize(segments, config, signal);
  }
  async condense(segments, signal) {
    const state = this.live.start();
    let before;
    for (const segment of segments) for (const text of pieces(segment.text)) { const part = { id: segment.id, text }; await this.live.add(state, part, before, signal); before = part; }
    const lines = state.lines.filter(l => !l.gone);
    const short = segments.map(s => ({ ...s, text: lines.filter(l => l.id === s.id).map(l => l.text).join('. ') })).filter(s => s.text);
    return short.length ? short : segments;
  }
  /** Keine Sprecher je Satz: das Transkript bleibt, wie es transkribiert wurde. */
  async speakers() { return null; }
  /** Erreichbarkeit beider Dienste, ohne Gesprächsdaten. `llmReady`: das gewählte Modell ist geladen bzw. vorhanden. */
  async status() {
    const probe = async url => { try { const r = await this.fetcher(url, { signal: AbortSignal.timeout(2000) }); const data = r.ok ? await r.json().catch(() => ({})) : null; await r.body?.cancel().catch(() => {}); return data; } catch { return null; } };
    const [models, stt] = await Promise.all([probe(`${this.local.llmUrl}/models`), probe(`${this.local.sttUrl.replace(/\/v1$/, '')}/health`)]);
    const known = Array.isArray(models?.data) ? models.data.map(m => m?.id) : [];
    return { stt: this.local.sttModel, llm: this.local.llmModel, sttReady: Boolean(stt), llmReady: known.includes(this.local.llmModel) };
  }
}
