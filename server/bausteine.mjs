/**
 * Textbausteine: Welche passen zu diesem Gespräch?
 *
 * Jeder Baustein beschreibt in eigenen Worten die Situation, in der er in die Notiz gehört („Wenn ein Zahn gezogen
 * wurde“). Das EU-geroutete Klassifizierer-Modell (server/classifier.mjs) prüft das gegen Notiz und Transkript, statt
 * nach Stichwörtern zu suchen. Ergebnis sind die Kennungen der passenden Bausteine, oder `null`, wenn die Prüfung
 * nicht möglich war; die Oberfläche nimmt dann ihren Ersatzweg über Name und Stichwörter.
 */
export const SNIPPETS_MAX = 60;
const NAME_MAX = 60, WHEN_MAX = 300, TEXT_MAX = 60_000;
const TIMEOUT_MS = 20_000;

const INSTRUCTIONS = `Du prüfst für eine ärztliche Dokumentation, welche Textbausteine zu einem Gespräch passen. Du erhältst die Notiz, das Gesprächstranskript (kann fehlen) und eine Liste von Bausteinen, jeder mit "id", "name" und "wann": der Situation, in der er in die Notiz gehört.
Ein Baustein passt nur, wenn die beschriebene Situation in diesem Gespräch tatsächlich eingetreten ist oder ausdrücklich so besprochen wurde. Es zählt der Sinn, nicht der Wortlaut: „der muss raus“ und danach „so, geschafft“ ist eine Zahnentfernung. Wird etwas nur erwähnt, verneint, für später geplant oder als Möglichkeit genannt, passt der Baustein nicht. Im Zweifel passt er nicht.
Antworte ausschließlich als JSON-Objekt: {"treffer": [<id jedes passenden Bausteins als String>]}. Passt keiner, ist die Liste leer.`;

/** Prüft und kürzt die Bausteinliste aus der Oberfläche; wirft bei unbrauchbarer Eingabe. */
export function readSnippets(raw) {
  if (!Array.isArray(raw) || raw.length > SNIPPETS_MAX) throw new Error('Ungültige Textbausteine.');
  return raw.map(item => {
    const entry = item && typeof item === 'object' ? item : {};
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(entry.id) || typeof entry.name !== 'string' || typeof entry.when !== 'string' || !entry.when.trim()) throw new Error('Ungültige Textbausteine.');
    return { id: entry.id, name: entry.name.trim().slice(0, NAME_MAX), wann: entry.when.trim().slice(0, WHEN_MAX) };
  });
}

/** Kennungen der Bausteine, deren Situation im Gespräch vorkam; `null`, wenn die Prüfung nicht möglich war. */
export async function matchSnippets(classifier, apiKey, { note, segments, snippets }, { signal } = {}) {
  if (!snippets.length) return [];
  if (!classifier?.enabled || !apiKey) return null;
  const gespraech = (Array.isArray(segments) ? segments : []).map(segment => segment?.text).filter(text => typeof text === 'string' && text.trim()).join('\n').slice(0, TEXT_MAX);
  const data = await classifier.json(apiKey, { notiz: String(note || '').slice(0, TEXT_MAX), gespraech, bausteine: snippets }, INSTRUCTIONS, signal, { maxTokens: 600, timeoutMs: TIMEOUT_MS });
  if (!data || !Array.isArray(data.treffer)) return null;
  const known = new Set(snippets.map(snippet => snippet.id));
  return [...new Set(data.treffer.filter(id => typeof id === 'string' && known.has(id)))];
}
