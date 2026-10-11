/**
 * Entscheidungsmodell („System One“, Jev-Schnittstelle POST /v1/systemone) als Klassifizierer für die Auswahlfragen des Dienstes.
 * Solche Modelle beantworten Auswahl- und Ja/Nein-Fragen in einem Durchlauf ohne Textausgabe, lokal in Millisekunden
 * (etwa Kev oder Laya am Loopback). Sie liefern Wahrscheinlichkeiten statt JSON-Text; `choose` und `ask` gehen hierher,
 * freie JSON-Antworten (`json`, etwa Sprecher je Satz oder Textbausteine) an den hinterlegten Rückfall-Klassifizierer.
 * Im Testlauf vom 2026-10-11 erkannte Kev-0.8B das Fachgebiet in 20 von 20 Fällen (wie die Cloud), Laya in 10 von 20. Bei der
 * Belegprüfung (Ja/Nein) lagen beide weit hinter dem Sprachmodell (Kev 57 %, Laya 73 %, Mistral 97 %), deshalb geht `ask`
 * nur an das Entscheidungsmodell, wenn `tasks` es ausdrücklich enthält.
 */
const TIMEOUT_MS = 20_000;

export class DecisionClassifier {
  constructor({ fetcher = fetch, endpoint, model = 'kev-latest', fallback = null, timeoutMs = TIMEOUT_MS, tasks = ['choose'] } = {}) {
    this.fetcher = fetcher; this.endpoint = String(endpoint ?? '').replace(/\/$/, ''); this.model = model; this.fallback = fallback; this.timeoutMs = timeoutMs; this.tasks = new Set(tasks);
  }
  get enabled() { return Boolean(this.endpoint) || Boolean(this.fallback?.enabled); }
  handles(task) { return Boolean(this.endpoint) && this.tasks.has(task); }
  async systemone(state, questions, signal) {
    const response = await this.fetcher(`${this.endpoint}/v1/systemone`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, model: this.model, questions }),
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]),
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`Entscheidungsmodell meldet Fehler ${response.status}.`); }
    return (await response.json())?.answers ?? {};
  }
  /** Auswahl einer Option: { key, p } (p = Wahrscheinlichkeit der gewählten Option) oder null. */
  async choose(apiKey, state, instructions, criteria, signal) {
    if (!this.handles('choose')) return this.fallback?.choose(apiKey, state, instructions, criteria, signal) ?? null;
    try {
      const { wahl } = await this.systemone(state, { wahl: { type: 'choice', instructions, criteria } }, signal);
      if (!wahl || typeof wahl.choice !== 'string' || !Object.hasOwn(criteria, wahl.choice)) return null;
      const p = wahl.probabilities?.[wahl.choice];
      return { key: wahl.choice, p: Number.isFinite(p) ? p : 1 };
    } catch { return null; }
  }
  /** Ja/Nein-Frage: Wahrscheinlichkeit für „ja“ oder null. */
  async ask(apiKey, state, instructions, signal) {
    if (!this.handles('ask')) return this.fallback?.ask(apiKey, state, instructions, signal) ?? null;
    try {
      const { ja } = await this.systemone(state, { ja: { type: 'noul', instructions } }, signal);
      return Number.isFinite(ja?.noul) ? ja.noul : null;
    } catch { return null; }
  }
  /** Freie JSON-Antworten kann ein Entscheidungsmodell nicht liefern; sie gehen an den Rückfall-Klassifizierer. */
  async json(apiKey, state, instructions, signal, options) { return this.fallback?.json(apiKey, state, instructions, signal, options) ?? null; }
  async complete(...args) { if (!this.fallback) throw new Error('Nicht eingerichtet.'); return this.fallback.complete(...args); }
}
