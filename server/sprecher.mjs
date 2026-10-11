/**
 * Sprecherzuordnung im Nachgang, allein aus dem Text.
 *
 * Die Transkription liefert keine Sprecher. Nach dem Gespräch (oder für ein eingefügtes Skript) ordnet das
 * EU-geroutete Klassifizierer-Modell (server/classifier.mjs) jedem Satz eine Rolle zu: arzt, patient, assistenz
 * oder unklar. Aus den Sätzen entstehen neue Abschnitte je Sprecherwechsel, mit Zeit anteilig aus dem
 * Audiopaket. Es kommt kein neuer Anbieter und kein Audioweg hinzu; die Aufnahme bleibt unverändert.
 *
 * Fail-open: Jeder Fehler ergibt `null`, dann laufen Notiz und Transkript ohne Sprecher wie bisher.
 */
/** Mögliche Rollen; `unklar` bleibt in der Ansicht ohne Namen. */
export const SPRECHER = ['arzt', 'patient', 'assistenz', 'unklar'];
export const isSprecher = value => typeof value === 'string' && SPRECHER.includes(value);
/** Höchstzahl Abschnitte je Transkript (ein Abschnitt je Sprecherwechsel); darüber bleibt es bei den Audiopaketen. */
export const SEGMENTS_MAX = 2000;

/** Sätze je Aufruf. Die Antwort braucht rund 12 Token je Satz; das Zeitlimit liegt bei 30 s. */
export const BATCH = 80;
const CONTEXT = 6;
const MAX_TOKENS = 1800;
const TIMEOUT_MS = 30_000;
/** Ergebnisse gelten nur, wenn das Modell mindestens diesen Anteil der Sätze beantwortet hat. */
const MIN_ANSWERED = 0.5;

const SENTENCE_SPLIT = /(?<=[.!?…])\s+/;

const INSTRUCTIONS = `Du ordnest jedem Satz eines transkribierten Gesprächs aus einer Arztpraxis die sprechende Rolle zu. Das Transkript enthält keine Sprecherangaben; du erkennst die Rolle aus Inhalt, Anrede, Frage-Antwort-Mustern und Fachsprache.

Rollen:
- "arzt": Ärztin oder Arzt, behandelnde Person. Fragt nach Beschwerden, erhebt Befunde, erklärt Diagnose und Therapie, gibt Anweisungen.
- "patient": Patientin oder Patient (auch Begleitperson). Berichtet Beschwerden, beantwortet Fragen, stellt Rückfragen, stimmt zu.
- "assistenz": Praxispersonal. Reicht Instrumente, meldet Röntgenbilder oder Termine, organisiert.
- "unklar": nicht sicher zuzuordnen.

Regeln: Kurze Sätze wie „Ja.“, „Okay.“ oder „Danke.“ sind meist eine Antwort der jeweils anderen Seite als der Satz davor. Ohne erkennbaren Wechsel bleibt die Rolle des vorherigen Satzes. Nach einer Frage antwortet meist die andere Seite. Enthält ein Satz bereits eine Sprecherangabe (z. B. „Arzt:“, „Patientin:“), übernimm sie. Die Einträge unter "vorher" sind schon zugeordnet und dienen nur als Zusammenhang.

Antworte ausschließlich als JSON-Objekt: {"sprecher":[{"n":<Satznummer>,"rolle":"arzt"|"patient"|"assistenz"|"unklar"}]} mit genau einem Eintrag je Satz aus "saetze", in derselben Reihenfolge.`;

/**
 * Zerlegt Abschnitte in Sätze. Ohne Zeitangaben (eingefügtes Skript) trennt zusätzlich jeder Zeilenumbruch;
 * mit Zeitangaben werden Zeilenumbrüche zu Leerzeichen, wie in der Transkript-Ansicht (lib/transcript.ts).
 * `seg` ist der Index des Ursprungsabschnitts, `from`/`to` der Zeichenanteil im Abschnitt (für die Zeit).
 */
export function sentencesOf(segments) {
  const units = [];
  segments.forEach((segment, seg) => {
    const text = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (!text) return;
    const timed = Number.isFinite(segment.start) && Number.isFinite(segment.end);
    const lines = timed ? [text.replace(/\s*\n\s*/g, ' ')] : text.split(/\s*\n\s*/);
    const sentences = lines.flatMap(line => line.split(SENTENCE_SPLIT)).map(s => s.trim()).filter(Boolean);
    const total = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
    let before = 0;
    for (const sentence of sentences) { units.push({ seg, text: sentence, from: before / total, to: (before + sentence.length) / total }); before += sentence.length; }
  });
  return units;
}

/** Baut aus zugeordneten Sätzen neue Abschnitte: ein Abschnitt je Sprecherwechsel innerhalb eines Ursprungsabschnitts. */
export function segmentsFrom(segments, units, roles) {
  const out = [];
  units.forEach((unit, i) => {
    const speaker = roles[i];
    const source = segments[unit.seg];
    const timed = Number.isFinite(source.start) && Number.isFinite(source.end);
    const span = timed ? source.end - source.start : 0;
    const last = out[out.length - 1];
    if (last && last.seg === unit.seg && last.speaker === speaker) {
      last.text += ` ${unit.text}`;
      if (timed) last.end = source.start + unit.to * span;
      return;
    }
    out.push({ seg: unit.seg, speaker, text: unit.text, ...(timed ? { start: source.start + unit.from * span, end: source.start + unit.to * span } : {}) });
  });
  const round = value => Math.round(value * 100) / 100;
  return out.map((entry, i) => ({ id: `s${i + 1}`, text: entry.text, speaker: entry.speaker, ...(entry.start !== undefined ? { start: round(entry.start), end: round(entry.end) } : {}) }));
}

/** Antwort des Modells lesen: Rolle je Satznummer; wirft, wenn zu wenige Sätze beantwortet wurden. */
function readRoles(data, numbers) {
  const byNumber = new Map();
  const list = Array.isArray(data?.sprecher) ? data.sprecher : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.n) || !isSprecher(entry.rolle)) continue;
    byNumber.set(entry.n, entry.rolle);
  }
  const answered = numbers.filter(n => byNumber.has(n)).length;
  if (answered < Math.ceil(numbers.length * MIN_ANSWERED)) throw new Error('Zu wenige Sätze zugeordnet.');
  return numbers.map(n => byNumber.get(n) ?? 'unklar');
}

/**
 * Ordnet jedem Satz der Abschnitte einen Sprecher zu und liefert die neuen, sprecherbezogenen Abschnitte
 * (`speaker`, Zeit anteilig). Sätze gehen in Paketen von `BATCH` an das Modell, jeweils mit den zuletzt
 * zugeordneten Sätzen als Zusammenhang. Ohne Klassifizierer, ohne Schlüssel oder bei jedem Fehler: `null`.
 */
export async function assignSpeakers(classifier, apiKey, segments, { signal, batch = BATCH } = {}) {
  if (!classifier?.enabled || !apiKey || !Array.isArray(segments)) return null;
  const units = sentencesOf(segments);
  if (!units.length) return null;
  const roles = [];
  for (let at = 0; at < units.length; at += batch) {
    const slice = units.slice(at, at + batch);
    const numbers = slice.map((_, i) => at + i + 1);
    const back = Math.max(0, at - CONTEXT);
    const vorher = units.slice(back, at).map((unit, i) => ({ n: back + i + 1, rolle: roles[back + i], text: unit.text }));
    const state = { vorher, saetze: slice.map((unit, i) => ({ n: numbers[i], text: unit.text })) };
    const data = await classifier.json(apiKey, state, INSTRUCTIONS, signal, { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS });
    if (!data) return null;
    try { roles.push(...readRoles(data, numbers)); } catch { return null; }
  }
  const result = segmentsFrom(segments, units, roles);
  return result.length <= SEGMENTS_MAX ? result : null;
}
