import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mapLimit } from './classifier.mjs';

// Auf Vercel liegt der Code gebündelt; dort ist das Arbeitsverzeichnis die Projektwurzel (Dateien: outputFileTracingIncludes).
const ROOT = process.env.VERCEL ? process.cwd() : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Der Helfer kann die Wissensbasis in seinem Datenordner halten und nennt ihn dann in CHETTI_KNOWLEDGE (helper/wissen.mjs).
const KNOWLEDGE = pathToFileURL((process.env.CHETTI_KNOWLEDGE || path.join(/* turbopackIgnore: true */ ROOT, 'knowledge')) + path.sep);
const read = async name => JSON.parse(await readFile(new URL(`begriffe/${name}.json`, KNOWLEDGE), 'utf8')).eintraege;

/**
 * Fachgebiete, die Chetti kennt. `terms` sind die Dateien in knowledge/begriffe/ (ohne Endung), aus denen Begriffe zum
 * Gespräch gezogen werden. Zahnmedizin bekommt keine Begriffe (bisheriges Verhalten, unverändert).
 * `glossar` (optional) sind handgeschriebene Verzeichnisse mit dem Feld `suche` (Abkürzungen, Fachbegriffe, Handelsnamen), siehe `glossaryOf`.
 * Ein neues Fachgebiet braucht: Profil `knowledge/stil/schreibprofil-<id>.md`, Begriffe (scripts/knowledge/build.py) und einen Eintrag hier.
 */
export const FACHGEBIETE = {
  zahnmedizin: {
    name: 'Zahnmedizin', adjektiv: 'zahnärztlichen', profile: 'schreibprofil.md', terms: [],
    kriterium: 'Zahnärztliches Gespräch: Zähne, Zahnfleisch, Kiefer, Füllung, Krone, Wurzelbehandlung, Zahnreinigung, Zahnersatz.',
    transkription: 'Zahnmedizin. Fachbegriffe: Zahnnummern, FDI, Karies, Sekundärkaries, approximal, Randspalt, Komposit, Adhäsiv, Füllung, Krone, Zirkonoxid, Brücke, Implantat, PZR, PSI, Parodontitis, Sondierungstiefen, Vitalitätsprobe, Perkussion, Lokalanästhesie, Articain, Kofferdam, Clindamycin, Amoxicillin, Chlorhexidin, Bruxismus, Aufbissschiene, OPG, Osteotomie, Wurzelkanalbehandlung, okklusal, mesial, distal, vestibulär, oral, palatinal, lingual.',
  },
  innere: {
    name: 'Innere Medizin', adjektiv: 'internistischen', profile: 'schreibprofil-innere.md', terms: ['skalen-innere', 'atc-innere', 'icd10gm-innere'],
    kriterium: 'Internistisches Gespräch: Herz und Kreislauf, Lunge, Magen-Darm und Leber, Niere, Diabetes und Stoffwechsel, Schilddrüse. Nicht: Tumorbehandlung im Vordergrund, Narkose oder Zahnbehandlung.',
    transkription: 'Innere Medizin. Fachbegriffe: Anamnese, Dyspnoe, Herzinsuffizienz, NYHA, HFrEF, Ejektionsfraktion, Mitralinsuffizienz, KHK, Vorhofflimmern, arrhythmisch, CHA2DS2-VASc, Apixaban, COPD, Exazerbation, Tiotropium, Rasselgeräusche, Diabetes, HbA1c, Kreatinin, GFR, NT-proBNP, Echokardiographie, Koloskopie, Gastroskopie, Blutdruck, Metformin, Ramipril, Torasemid, Sacubitril-Valsartan, Spironolacton, Dapagliflozin, Atorvastatin, L-Thyroxin, Allopurinol.',
  },
  anaesthesie: {
    name: 'Anästhesiologie', adjektiv: 'anästhesiologischen', profile: 'schreibprofil-anaesthesie.md', terms: ['skalen-anaesthesie', 'atc-anaesthesie', 'icd10gm-anaesthesie', 'leitlinien-fachbegriffe-anaesthesie'],
    kriterium: 'Anästhesiologisches Gespräch: Prämedikation, Narkoseaufklärung, Vollnarkose, Regionalanästhesie, Nüchternheit, Atemweg, Aufwachraum, Intensivmedizin, Schmerztherapie rund um eine Operation.',
    transkription: 'Anästhesiologie. Fachbegriffe: Prämedikation, ASA, NYHA, Mallampati, Nüchternheit, Intubationsnarkose, Videolaryngoskop, TIVA, Larynxmaske, Spinalanästhesie, Periduralkatheter, Sevofluran, Propofol, Remifentanil, Sufentanil, Rocuronium, Sugammadex, Succinylcholin, Midazolam, Piritramid, Metamizol, Dexamethason, Ondansetron, Apfel-Score, PONV, Apixaban, INR, HbA1c, Ejektionsfraktion, maligne Hyperthermie, Aspiration, Awareness, Aufwachraum.',
  },
  onkologie: {
    name: 'Onkologie', adjektiv: 'onkologischen', profile: 'schreibprofil-onkologie.md', terms: ['skalen-onkologie', 'atc-onkologie', 'icd10gm-onkologie', 'leitlinien-fachbegriffe-onkologie'],
    kriterium: 'Onkologisches Gespräch: Tumorerkrankung, Staging, Chemotherapie, Immuntherapie, Strahlentherapie, Tumorboard, Nebenwirkungen einer Krebstherapie, Nachsorge.',
    transkription: 'Onkologie. Fachbegriffe: Tumor, Metastase, TNM, Staging, Restaging, kurativ, palliativ, Chemotherapie, Zyklus, FOLFOX, Oxaliplatin, 5-FU, Folinsäure, Immuntherapie, Pembrolizumab, Panitumumab, Bevacizumab, KRAS, BRAF, MSI, Strahlentherapie, Tumorboard, ECOG, CTCAE, Neuropathie, Neutropenie, G-CSF, Filgrastim, CEA, Aprepitant, Ondansetron, Loperamid, Mukositis, Enoxaparin, Port, Rezidiv, Remission.',
  },
  augenheilkunde: {
    name: 'Augenheilkunde', adjektiv: 'augenärztlichen', profile: 'schreibprofil-augenheilkunde.md', terms: [null, 'atc-augenheilkunde', 'icd10gm-augenheilkunde', 'leitlinien-fachbegriffe-augenheilkunde'],
    glossar: ['abkuerzungen-augenheilkunde', 'skalen-augenheilkunde', 'fachbegriffe-augenheilkunde', 'handelsnamen-augenheilkunde'],
    kriterium: 'Augenärztliches Gespräch: Sehschärfe, Brille oder Kontaktlinsen, Augeninnendruck, Grauer oder Grüner Star, Netzhaut und Makula, Spritzen ins Auge, Augentropfen, Lid, Tränen, Schielen, Sehstörungen.',
    transkription: 'Augenheilkunde. Fachbegriffe: Visus, sine correctione, cum correctione, Refraktion, sphärisch, Zylinder, Achse, Tensio applanatorisch, Pachymetrie, Spaltlampe, Pseudoexfoliation, Katarakt, Cataracta nuclearis, Pseudophakie, Phakoemulsifikation, YAG-Kapsulotomie, Papille, Cup-Disc-Ratio, Exkavation, Makula, Drusen, Netzhautdicke, OCT, Mikroaneurysmen, Exsudate, Glaukom, Trabekulektomie, SLT, AMD, IVOM, Aflibercept, Eylea, Faricimab, Vabysmo, Lucentis, Beovu, Latanoprost, Dorzolamid, Timolol, Mydriasis, Tropicamid, Blepharitis, Endophthalmitis.',
  },
};
export const DEFAULT_FACH = 'zahnmedizin';
export const isFach = id => typeof id === 'string' && Object.hasOwn(FACHGEBIETE, id);

const profiles = Object.fromEntries(await Promise.all(Object.entries(FACHGEBIETE).map(async ([id, f]) => [id, await readFile(new URL(`stil/${f.profile}`, KNOWLEDGE), 'utf8')])));
export const profileOf = id => profiles[id];

/** Kleinschreibung, ä→ae, ß→ss, übrige Akzente weg: Umlaute und Schreibvarianten sollen sich treffen. */
export const fold = s => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
const words = s => fold(s).match(/[a-z]+/g) ?? [];

function withinOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Wörter → Einträge; sehr häufige Wörter („Erkrankung“) unterscheiden nichts und fallen weg. */
function indexWords(entries, textOf, { minLength = 8, maxDf = 40 } = {}) {
  const byWord = new Map();
  for (const entry of entries) for (const w of new Set(words(textOf(entry)).filter(x => x.length >= minLength))) byWord.set(w, [...(byWord.get(w) ?? []), entry]);
  for (const [w, list] of byWord) if (list.length > maxDf) byWord.delete(w);
  return byWord;
}

const cache = new Map();
async function termsOf(fach) {
  if (cache.has(fach)) return cache.get(fach);
  const load = (async () => {
    const files = FACHGEBIETE[fach].terms;
    const [skalen = [], atc = [], icd = [], abk = []] = await Promise.all(files.map(f => (f ? read(f) : [])));
    const wirkstoffe = new Map(atc.map(e => [fold(e.wirkstoff).replace(/[^a-z]/g, ''), e.wirkstoff]).filter(([k]) => k.length >= 6));
    // Abkürzungen aus den Leitlinien: je Kürzel bis zu zwei verschiedene Bedeutungen (je nach Leitlinie können sie abweichen).
    const abkuerzungen = new Map();
    for (const e of abk) {
      if (e.art !== 'abkuerzung' || (e.begriff.match(/[A-ZÄÖÜ]/g) ?? []).length < 2) continue;
      const list = abkuerzungen.get(e.begriff) ?? [];
      if (list.length < 2 && !list.some(x => fold(x) === fold(e.bedeutung))) abkuerzungen.set(e.begriff, [...list, e.bedeutung]);
    }
    return { skalen, wirkstoffe, abkuerzungen, icd: indexWords(icd, e => e.titel) };
  })();
  cache.set(fach, load);
  return load;
}

const SHORT = /^(?=.*[A-ZÄÖÜ])[A-ZÄÖÜ0-9]{2,3}$/;
const norm = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const glossaries = new Map();
/**
 * Handgeschriebene Verzeichnisse eines Fachgebiets (Abkürzungen, Fachbegriffe, Handelsnamen), aufbereitet für die Suche im Gespräch.
 * Jeder Eintrag trägt `suche`: geschriebene und gesprochene Formen samt bekannter Fehlhörungen („Eilea“ für Eylea).
 * Kurze Großbuchstaben-Kürzel (RA, ALT, HH) treffen nur genau so geschrieben, damit „alt“ oder „ra“ im Satz nichts auslösen;
 * alles andere trifft unabhängig von Groß- und Kleinschreibung als ganzes Wort oder ganze Wortfolge.
 */
async function glossaryOf(fach) {
  if (glossaries.has(fach)) return glossaries.get(fach);
  const load = (async () => {
    const exact = new Map(), word = new Map(), phrases = [];
    const put = (map, key, entry) => { if (!map.has(key)) map.set(key, entry); };
    for (const file of FACHGEBIETE[fach].glossar ?? []) for (const e of await read(file)) {
      const entry = { label: e.kuerzel ?? e.begriff ?? e.handelsname, text: e.bedeutung ?? e.wirkstoff, marke: Boolean(e.handelsname) };
      for (const raw of e.suche ?? []) {
        if (SHORT.test(raw)) { put(exact, raw, entry); continue; }
        const key = norm(raw);
        if (key.includes(' ')) phrases.push([` ${key} `, entry]);
        else if (key.length >= 4) put(word, key, entry);
      }
    }
    // Für Tippfehler und Wortanfänge („Kapsulotomien“) nur lange, eindeutige Wörter.
    return { exact, word, phrases, long: [...word].filter(([k]) => k.length >= 7) };
  })();
  glossaries.set(fach, load);
  return load;
}

/** Einträge des Glossars, die im Text vorkommen, in der Reihenfolge des Gesprächs; dazu ähnlich geschriebene Wörter (ein Zeichen Abweichung). */
function glossaryHits({ exact, word, phrases, long }, text) {
  const hits = new Set(), similar = new Map();
  const flat = ` ${norm(text)} `;
  for (const raw of text.match(/[A-Za-zÄÖÜäöüß0-9]+(?:-[A-Za-zÄÖÜäöüß0-9]+)*/g) ?? []) {
    for (const part of new Set([raw, ...raw.split('-')])) {
      if (exact.has(part)) { hits.add(exact.get(part)); continue; }
      const t = norm(part);
      if (word.has(t)) { hits.add(word.get(t)); continue; }
      if (t.length < 7 || t.includes(' ')) continue;
      const start = long.find(([k]) => t.startsWith(k) && t.length - k.length <= 3);
      if (start) { hits.add(start[1]); continue; }
      const near = long.find(([k]) => k[0] === t[0] && withinOne(k, t));
      if (near && !similar.has(t)) similar.set(t, near[1]);
    }
  }
  for (const [key, entry] of phrases) if (flat.includes(key)) hits.add(entry);
  for (const [t, entry] of similar) if (hits.has(entry)) similar.delete(t);
  return { hits: [...hits], similar };
}

/** Bis zu `limit` Titel mit den meisten (nach Seltenheit gewichteten) Wortübereinstimmungen; bei Gleichstand der kürzeste. Varianten desselben Oberbegriffs („X, permanent“, „X: Total“) zählen einmal. */
function best(byWord, tokens, limit) {
  const score = new Map();
  for (const t of tokens) { const list = byWord.get(t); if (list) for (const e of list) score.set(e, (score.get(e) ?? 0) + 1 / list.length); }
  const seen = new Set();
  return [...score].sort((a, b) => b[1] - a[1] || a[0].titel.length - b[0].titel.length).map(([e]) => e.titel)
    .filter(titel => { const key = fold(titel.split(/[:,]/)[0]).trim(); return !seen.has(key) && seen.add(key); }).slice(0, limit);
}

/**
 * Begriffe aus dem Fachgebietsverzeichnis, die im Gespräch vorkommen. Sie helfen nur bei Erkennung und Schreibweise
 * (Wirkstoffe, Skalen, amtliche Diagnosebezeichnungen); Fakten kommen daraus nie in die Notiz. Leerer Text, wenn nichts passt.
 */
export async function termHints(fach, text, { maxPerGroup = 8 } = {}) {
  if (!isFach(fach) || !FACHGEBIETE[fach].terms.length) return '';
  const { skalen, wirkstoffe, abkuerzungen, icd } = await termsOf(fach);
  const tokens = [...new Set(words(text))];
  const lines = [];

  if (FACHGEBIETE[fach].glossar) {
    const found = glossaryHits(await glossaryOf(fach), text);
    const show = e => (e.marke ? `${e.label} (${e.text})` : `${e.label} = ${e.text}`);
    const begriffe = found.hits.filter(e => !e.marke), marken = found.hits.filter(e => e.marke);
    if (begriffe.length) lines.push(`Abkürzungen und Fachbegriffe (so schreiben, wie im Gespräch gesagt, ein ausgesprochenes Wort nicht durch das Kürzel ersetzen; Bedeutung nur zum Verständnis): ${begriffe.slice(0, maxPerGroup * 4).map(show).join('; ')}`);
    if (marken.length) lines.push(`Handelsnamen (Schreibweise laut Verzeichnis; Wirkstoff nur zur Einordnung, nicht ergänzen): ${marken.slice(0, maxPerGroup * 2).map(show).join('; ')}`);
    if (found.similar.size) lines.push(`Ähnlich geschriebene Fachbegriffe, evtl. Erkennungsfehler (nur übernehmen, wenn eindeutig gemeint, sonst in den Hinweisen vermerken): ${[...found.similar].slice(0, maxPerGroup).map(([t, e]) => `„${t}“ ≈ ${e.label}`).join(', ')}`);
  }

  const exact = new Set(), similar = new Map();
  for (const t of tokens.filter(x => x.length >= 6)) {
    const hit = wirkstoffe.get(t) ?? (t.length >= 7 ? [...wirkstoffe].find(([k]) => k.startsWith(t) || (k.length >= 7 && t.startsWith(k)))?.[1] : undefined);
    if (hit) exact.add(hit);
    else if (t.length >= 7) { const near = [...wirkstoffe].find(([k]) => k[0] === t[0] && withinOne(k, t)); if (near) similar.set(t, near[1]); }
  }
  if (exact.size) lines.push(`Wirkstoffe (Schreibweise laut Verzeichnis): ${[...exact].slice(0, maxPerGroup).join(', ')}`);
  if (similar.size) lines.push(`Ähnlich geschrieben, evtl. Erkennungsfehler (nur übernehmen, wenn eindeutig gemeint, sonst in den Hinweisen vermerken): ${[...similar].slice(0, maxPerGroup).map(([t, w]) => `„${t}“ ≈ ${w}`).join(', ')}`);

  const scale = skalen.filter(e => e.kuerzel.split(/\s*\/\s*|,\s*/).some(alias => { const first = words(alias)[0]; return first && first.length >= 3 && tokens.includes(first); }));
  if (scale.length) lines.push(`Skalen und Abkürzungen: ${scale.slice(0, maxPerGroup).map(e => `${e.kuerzel} = ${e.bedeutung}`).join('; ')}`);

  // Nur groß geschriebene Kürzel genau wie im Verzeichnis: „HER2“ trifft, das Wort „her“ nicht.
  const written = [...new Set(text.match(/[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9-]{1,}/g) ?? [])].filter(t => abkuerzungen.has(t)).slice(0, 5);
  if (written.length) lines.push(`Abkürzungen aus Leitlinien (Bedeutung kann je nach Zusammenhang abweichen): ${written.map(t => `${t} = ${abkuerzungen.get(t).join(' / ')}`).join('; ')}`);

  const diagnosen = best(icd, tokens, 3);
  if (diagnosen.length) lines.push(`Amtliche Diagnosebezeichnungen zu genannten Begriffen (nur zum Verständnis; die im Gespräch gesagte Formulierung bleibt maßgeblich): ${diagnosen.join('; ')}`);
  return lines.map(l => `- ${l}`).join('\n');
}

/**
 * Fachbegriffe, die im Text vorkommen, als Liste ihrer Schreibweisen: die Begriffsliste des Fachgebiets (`transkription`),
 * dazu Glossar, Wirkstoffe und Leitlinien-Abkürzungen aus dem Verzeichnis.
 * Für die Entwicklungsansicht (server/dev.mjs): Maß dafür, wie viele Fachbegriffe des Gesprächs in der Notiz ankommen.
 */
export async function termsIn(fach, text) {
  if (!isFach(fach)) return [];
  const flat = ` ${norm(text)} `;
  const listed = (FACHGEBIETE[fach].transkription.match(/Fachbegriffe: (.*)$/)?.[1] ?? '').replace(/\.$/, '').split(', ').filter(t => /^[A-ZÄÖÜ0-9]{2,5}$/.test(t) ? new RegExp(`(^|[^A-Za-zÄÖÜäöüß0-9])${t}($|[^A-Za-zÄÖÜäöüß0-9])`).test(text) : norm(t).length >= 4 && flat.includes(` ${norm(t)}`));
  const found = new Set(listed);
  if (!FACHGEBIETE[fach].terms.length) return [...found];
  const { wirkstoffe, abkuerzungen } = await termsOf(fach);
  if (FACHGEBIETE[fach].glossar) for (const e of glossaryHits(await glossaryOf(fach), text).hits) found.add(e.label);
  for (const t of new Set(words(text).filter(x => x.length >= 6))) { const hit = wirkstoffe.get(t); if (hit) found.add(hit); }
  for (const t of new Set(text.match(/[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9-]{1,}/g) ?? [])) if (abkuerzungen.has(t)) found.add(t);
  // Dieselbe Sache nur einmal zählen („Apixaban“ aus Liste und Verzeichnis).
  const seen = new Set();
  return [...found].filter(t => { const key = fold(t); return !seen.has(key) && seen.add(key); });
}

const ROUTE_LIMIT = 6000;
export const ROUTE_MIN_P = 0.6;

/**
 * Fachgebiet des Gesprächs per automatischer Erkennung. Ohne Klassifizierer, bei Unsicherheit (p < 0,6) oder
 * „sonstiges“ gilt `fallback`. Ein fest gewähltes Fachgebiet (`forced`) hat Vorrang und braucht keinen Aufruf.
 */
export async function routeFachgebiet(classifier, apiKey, segments, { forced = '', fallback = DEFAULT_FACH, signal } = {}) {
  if (isFach(forced)) return { fach: forced, quelle: 'festgelegt' };
  if (!classifier?.enabled || !apiKey) return { fach: fallback, quelle: 'standard' };
  const criteria = { ...Object.fromEntries(Object.entries(FACHGEBIETE).map(([id, f]) => [id, f.kriterium])), sonstiges: 'Anderes Fachgebiet oder nicht erkennbar.' };
  const gespraech = segments.map(s => s.text).join(' ').slice(0, ROUTE_LIMIT);
  const answer = await classifier.choose(apiKey, { gespraech }, 'In welchem medizinischen Fachgebiet findet dieses Arztgespräch statt?', criteria, signal);
  if (answer && isFach(answer.key) && answer.p >= ROUTE_MIN_P) return { fach: answer.key, quelle: 'erkannt', p: answer.p };
  return { fach: fallback, quelle: answer ? 'unsicher' : 'standard' };
}

export const SUPPORT_MIN_P = 0.25;
const SUPPORT_FRAGE = 'Wird die Aussage durch den Gesprächsausschnitt ausdrücklich belegt? Antworte nein, wenn die Aussage etwas hinzufügt, eine Zahl, Dosis, Seite oder Einheit verändert, eine Verneinung umkehrt oder Geplantes als Durchgeführtes (oder umgekehrt) darstellt.';

/**
 * Prüft jeden Stichpunkt gegen die Segmente, auf die er sich beruft. Gibt die Texte zurück, deren Beleg der
 * Klassifizierer für unwahrscheinlich hält (p < 0,25). Die Stichpunkte bleiben stehen: Sie werden nur in den
 * „Hinweisen zur Prüfung“ genannt. Ohne Klassifizierer leer.
 */
export async function unsupportedItems(classifier, apiKey, entries, segments, signal) {
  if (!classifier?.enabled || !apiKey) return [];
  const byId = new Map(segments.map(s => [s.id, s.text]));
  const checkable = entries.filter(e => e?.text && Array.isArray(e.evidence) && e.evidence.length && e.evidence.every(id => byId.has(id))).slice(0, 24);
  const verdicts = await mapLimit(checkable, 6, e => classifier.ask(apiKey, { gespraechsausschnitt: e.evidence.map(id => byId.get(id)).join(' '), aussage: e.text }, SUPPORT_FRAGE, signal));
  return checkable.filter((_, i) => verdicts[i] !== null && verdicts[i] < SUPPORT_MIN_P).map(e => e.text);
}
