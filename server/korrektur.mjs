/**
 * Fachbegriff-Schicht: prüft die Wörter eines Transkripts gegen das Begriffsverzeichnis des Fachgebiets (knowledge/begriffe/)
 * und ersetzt Fehlhörungen von Fachbegriffen, Wirkstoffen, Handelsnamen und Abkürzungen durch die richtige Schreibweise.
 *
 * Zwei Wege: (1) bekannte Varianten aus den `suche`-Listen der Glossare treffen genau; (2) unsichere oder unbekannte Wörter
 * werden phonetisch (Kölner Phonetik) mit kleiner Schreibdistanz einem Begriff zugeordnet. Häufige Wörter des deutschen
 * medizinischen Wortschatzes (knowledge/begriffe/wortschatz.json) werden nie phonetisch ersetzt, damit aus „Amt“ nicht AMD wird,
 * es sei denn, die Spracherkennung war sich bei dem Wort selbst unsicher. Jede Änderung wird mit Grund zurückgegeben.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FACHGEBIETE, fold, isFach } from './fachgebiet.mjs';

const ROOT = process.env.VERCEL ? process.cwd() : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE = pathToFileURL((process.env.CHETTI_KNOWLEDGE || path.join(/* turbopackIgnore: true */ ROOT, 'knowledge')) + path.sep);
const readTerms = async name => { try { return JSON.parse(await readFile(new URL(`begriffe/${name}.json`, KNOWLEDGE), 'utf8')).eintraege; } catch { return []; } };

/** Kölner Phonetik eines Wortes (Buchstaben a–z nach `fold`). Gleich klingende Wörter bekommen denselben Code. */
export function koelner(word) {
  const w = fold(word).replace(/[^a-z]/g, '');
  if (!w) return '';
  const codes = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i], prev = w[i - 1] ?? '', next = w[i + 1] ?? '';
    let code;
    if ('aeijouy'.includes(c)) code = '0';
    else if (c === 'h') code = '-';
    else if (c === 'b') code = '1';
    else if (c === 'p') code = next === 'h' ? '3' : '1';
    else if ('dt'.includes(c)) code = 'csz'.includes(next) ? '8' : '2';
    else if ('fvw'.includes(c)) code = '3';
    else if ('gkq'.includes(c)) code = '4';
    else if (c === 'c') {
      if (i === 0) code = 'ahkloqrux'.includes(next) ? '4' : '8';
      else if ('sz'.includes(prev)) code = '8';
      else code = 'ahkoqux'.includes(next) ? '4' : '8';
    }
    else if (c === 'x') code = 'ckq'.includes(prev) ? '8' : '48';
    else if (c === 'l') code = '5';
    else if ('mn'.includes(c)) code = '6';
    else if (c === 'r') code = '7';
    else code = '8'; // s, z
    codes.push(code);
  }
  let out = '';
  for (const c of codes.join('')) if (c !== '-' && c !== out[out.length - 1]) out += c;
  // Nullen bleiben nur am Anfang.
  return out[0] + out.slice(1).replace(/0/g, '');
}

export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const letters = s => fold(s).replace(/[^a-z]/g, '');
const SHORT = /^(?=.*[A-ZÄÖÜ])[A-ZÄÖÜ0-9]{2,4}$/;
const allowed = len => (len <= 5 ? 1 : len <= 8 ? 2 : len <= 12 ? 3 : 4);
// Buchstaben, die beim Hören zusammenfallen (Kürzel werden buchstabiert gesprochen): d/t, f/v/w, k/c/q/g, s/z, i/y, b/p.
const CLASS = { d: 't', t: 't', f: 'f', v: 'f', w: 'f', k: 'k', c: 'k', q: 'k', g: 'k', s: 's', z: 's', i: 'i', y: 'i', b: 'p', p: 'p' };
const heard = s => letters(s).replace(/[a-z]/g, c => CLASS[c] ?? c);

/**
 * Begriffsverzeichnis eines Fachgebiets für die Korrektur. `extra`: weitere Begriffe ({ kanonisch, varianten? }), etwa gelernte Listen.
 * Jede Schreibform (Begriff und seine Varianten) ist ein eigenes phonetisches Ziel; eine Variante, die wie der Begriff klingt,
 * gilt als Fehlhörung und wird durch den Begriff ersetzt, eine anders klingende (Synonym, Langform) bleibt stehen.
 * Kürzel treffen nur genau oder buchstabenweise ähnlich, nie über die Phonetik ganzer Wörter.
 */
export async function termIndex(fach, extra = []) {
  const entries = [];
  const put = (kanonisch, { varianten = [], art = 'begriff' } = {}) => {
    const k = String(kanonisch ?? '').trim();
    if (!k || letters(k).length < 2) return;
    const forms = [];
    for (const v of [k, ...varianten]) { const text = String(v).trim(); const key = fold(text).replace(/[^a-z0-9]+/g, ' ').trim(); if (text && key && !forms.some(f => f.key === key)) forms.push({ text, key }); }
    entries.push({ kanonisch: k, forms, art, kurz: SHORT.test(k) });
  };
  if (isFach(fach)) {
    const f = FACHGEBIETE[fach];
    for (const t of (f.transkription.split(/Fachbegriffe:\s*/)[1] ?? '').split(/,\s*/)) put(t.replace(/\.$/, ''), { art: 'prompt' });
    const [skalen, atc, icd, abk] = await Promise.all((f.terms ?? []).map(name => (name ? readTerms(name) : [])));
    for (const e of skalen ?? []) for (const k of String(e.kuerzel).split(/\s*\/\s*|,\s*/)) put(k.replace(/\s*\d[\d–-]*$/, ''), { varianten: e.suche ?? [], art: 'skala' });
    for (const e of atc ?? []) put(e.wirkstoff, { art: 'wirkstoff' });
    for (const e of abk ?? []) if (e.art === 'abkuerzung') put(e.begriff, { art: 'abkuerzung' });
    // Amtliche Diagnosebezeichnungen: nur lange Einzelwörter, kurze sind Alltagssprache.
    const seen = new Set();
    for (const e of icd ?? []) for (const w of String(e.titel).match(/[A-Za-zÄÖÜäöüß-]{9,}/g) ?? []) { const k = fold(w); if (!seen.has(k)) { seen.add(k); put(w, { art: 'diagnose' }); } }
    for (const name of f.glossar ?? []) for (const e of await readTerms(name)) put(e.kuerzel ?? e.begriff ?? e.handelsname, { varianten: e.suche ?? [], art: e.handelsname ? 'handelsname' : e.kuerzel ? 'abkuerzung' : 'begriff' });
  }
  for (const e of extra) put(e.kanonisch, { varianten: e.varianten ?? [], art: e.art ?? 'gelernt' });

  const exact = new Map(), byCode = new Map(), joined = new Map(), short = [];
  let maxWords = 1;
  for (const e of entries) {
    const canonCore = letters(e.kanonisch), canonCode = koelner(canonCore);
    for (const form of e.forms) {
      const core = form.key.replace(/[^a-z]/g, '');
      // Ziel der Ersetzung: der Begriff selbst, wenn die Form wie er klingt (Fehlhörung), sonst die Form in ihrer Schreibweise.
      const mishearing = form.text !== e.kanonisch && (koelner(core) === canonCode || levenshtein(core, canonCore, allowed(core.length)) <= allowed(core.length));
      const target = mishearing || form.text === e.kanonisch ? e.kanonisch : form.text;
      if (!exact.has(form.key)) exact.set(form.key, { entry: e, target, mishearing });
      maxWords = Math.max(maxWords, form.key.split(' ').length);
      if (e.kurz && form.text === e.kanonisch) { short.push({ entry: e, heard: heard(e.kanonisch), target: e.kanonisch }); continue; }
      if (SHORT.test(form.text)) continue;
      if (core.length >= 4 && !joined.has(core)) joined.set(core, { entry: e, target });
      if (core.length >= 4) { const code = koelner(core); byCode.set(code, [...(byCode.get(code) ?? []), { entry: e, core, target }]); }
    }
  }
  return { entries, exact, byCode, joined, short, maxWords };
}

let vocabulary;
/** Häufigkeit deutscher medizinischer Wörter (fold); fehlt die Datei, ist der Wortschatz leer und jedes Wort gilt als unbekannt. */
export async function wordFrequencies() {
  if (vocabulary) return vocabulary;
  try { vocabulary = new Map(Object.entries(JSON.parse(await readFile(new URL('begriffe/wortschatz.json', KNOWLEDGE), 'utf8')).woerter)); } catch { vocabulary = new Map(); }
  return vocabulary;
}

const splitWord = token => { const m = token.match(/^([^A-Za-zÄÖÜäöüß0-9]*)(.*?)([^A-Za-zÄÖÜäöüß0-9]*)$/); return { pre: m[1], core: m[2], post: m[3] }; };

/**
 * Korrigiert Wörter eines Transkripts. `words`: [{ text, p? }] (p: Sicherheit der Spracherkennung 0–1, optional).
 * Liefert den Text und die Änderungen. Zahlen und Einheiten bleiben unangetastet.
 */
export function correctWords(words, index, vocab = new Map(), { minP = 0.6, safeCount = 3, zusatz = 0 } = {}) {
  // `zusatz`: erlaubte Schreibdistanz um so viel erhöhen (aggressivere Zuordnung, nur sinnvoll mit nachgeschalteter Kontextprüfung).
  const out = [], changes = [];
  const parts = words.map(w => ({ ...w, ...splitWord(w.text) }));
  const replace = (slice, target, grund, extra = {}) => {
    const original = slice.map(x => x.core).join(' ');
    changes.push({ von: original, nach: target, grund, p: Math.min(...slice.map(x => x.p ?? 1)), ...extra });
    out.push(slice[0].pre + target + slice[slice.length - 1].post);
  };
  for (let i = 0; i < parts.length;) {
    let done = false;
    // (1) Bekannte Schreibformen und Fehlhörungen aus den Verzeichnissen, längste Wortfolge zuerst.
    for (let n = Math.min(index.maxWords, 3, parts.length - i); n >= 1 && !done; n--) {
      const slice = parts.slice(i, i + n);
      if (slice.some(x => !x.core)) continue;
      const hit = index.exact.get(slice.map(x => fold(x.core).replace(/[^a-z0-9]+/g, ' ').trim()).join(' '));
      if (!hit) continue;
      const original = slice.map(x => x.core).join(' ');
      // Nie ein gesprochenes Wort durch sein Kürzel ersetzen; Schreibweise nur angleichen, wenn sich Buchstaben unterscheiden.
      if (fold(original) !== fold(hit.target) && !(hit.entry.kurz && letters(original).length > letters(hit.target).length + 1)) replace(slice, hit.target, hit.mishearing ? 'fehlhoerung' : 'schreibweise');
      else out.push(...slice.map(x => x.text));
      i += n; done = true;
    }
    if (done) continue;
    const w = parts[i];
    const core = letters(w.core);
    const known = vocab.get(core) ?? 0;
    const unsure = w.p !== undefined && w.p < minP;
    // (2) Kürzel, buchstabenweise ähnlich gehört („IFO“ für IVOM, „Amt“ für AMD): nur wenn das Wort kein geläufiges Wort ist.
    if (core.length >= 3 && core.length <= 6 && known < safeCount && !/\d/.test(w.core)) {
      const h = heard(w.core), caps = /^[A-ZÄÖÜ0-9]+$/.test(w.core);
      // Buchstabenklassen-Abstand höchstens 1 und roher Abstand höchstens 2; ein schon groß geschriebenes Kürzel gleicher Länge
      // („GPT“) wird nur bei fast gleicher Schreibung ersetzt, sonst würden fremde Kürzel ineinander übergehen.
      const best = index.short.map(s => ({ ...s, dist: levenshtein(h, s.heard, 1), roh: levenshtein(core, letters(s.target), 2) }))
        .filter(s => s.dist <= 1 && s.roh <= 2 && Math.abs(s.heard.length - h.length) <= 1 && !(caps && s.heard.length === h.length && (s.dist > 0 || s.roh > 1)) && !(unsure === false && known > 0))
        .sort((a, b) => a.dist - b.dist || a.roh - b.roh)[0];
      if (best && fold(best.target) !== fold(w.core)) { replace([w], best.target, 'kuerzel', { dist: best.dist }); i++; continue; }
    }
    // (3) Phonetisch: einzelnes Wort oder zwei zusammengehörende Wörter („Tropica med“), wenn unbekannt oder unsicher.
    if (core.length >= 4 && !/\d/.test(w.core)) {
      const candidates = [];
      const consider = (text, n, p) => {
        const kn = vocab.get(text) ?? 0, un = p !== undefined && p < minP;
        if (kn >= safeCount && !un) return; // ein geläufiges Wort bleibt stehen, außer die Erkennung war unsicher
        const join = index.joined.get(text);
        if (join) candidates.push({ ...join, dist: 0, n, p });
        for (const c of index.byCode.get(koelner(text)) ?? []) {
          // Beugungsformen eines bekannten Wortes („subretinale“ zu „subretinal“) sind keine Fehlhörungen.
          if (kn > 0 && (text.startsWith(c.core) || c.core.startsWith(text))) continue;
          const limit = allowed(text.length) + zusatz - (kn && !un ? 1 : 0);
          const dist = levenshtein(text, c.core, limit);
          if (dist <= limit) candidates.push({ ...c, dist, n, p });
        }
      };
      consider(core, 1, w.p);
      const next = parts[i + 1];
      if (next && letters(next.core).length >= 2 && !/\d/.test(next.core) && !w.post) consider(core + letters(next.core), 2, Math.min(w.p ?? 1, next.p ?? 1));
      candidates.sort((a, b) => a.dist - b.dist || b.n - a.n);
      const best = candidates[0];
      if (best) {
        const slice = best.n === 2 ? [w, next] : [w];
        if (fold(slice.map(x => x.core).join(' ')) !== fold(best.target)) { replace(slice, best.target, best.dist === 0 ? 'zusammengesetzt' : 'phonetisch', { dist: best.dist }); i += best.n; continue; }
      }
    }
    out.push(w.text); i++;
  }
  return { text: out.join(' '), changes };
}

/** Bequemer Einstieg: Text eines Fachgebiets korrigieren (ohne Sicherheiten je Wort). */
export async function correctText(fach, text, { extra = [], ...options } = {}) {
  const [index, vocab] = await Promise.all([termIndex(fach, extra), wordFrequencies()]);
  return correctWords(text.split(/\s+/).filter(Boolean).map(t => ({ text: t })), index, vocab, options);
}
