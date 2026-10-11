/**
 * Sprachen von App und Website. Deutsch ist die Quellsprache: Im Code stehen die deutschen Texte,
 * jede weitere Sprache hat ein Wörterbuch „deutscher Text → Übersetzung“
 * (Oberfläche: lib/i18n/<id>.json, Dienst: server/i18n/<id>.mjs, Website: scripts/website/i18n/<id>.json).
 * `deutsch` ist der Name der Sprache im deutschen Auftrag an das Sprachmodell.
 */
export const LOCALES = [
  { id: 'de', name: 'Deutsch', deutsch: 'Deutsch' },
  { id: 'en', name: 'English', deutsch: 'Englisch' },
  { id: 'es', name: 'Español', deutsch: 'Spanisch' },
  { id: 'fr', name: 'Français', deutsch: 'Französisch' },
  { id: 'it', name: 'Italiano', deutsch: 'Italienisch' },
  { id: 'pt', name: 'Português', deutsch: 'Portugiesisch' },
  { id: 'nl', name: 'Nederlands', deutsch: 'Niederländisch' },
  { id: 'pl', name: 'Polski', deutsch: 'Polnisch' },
  { id: 'tr', name: 'Türkçe', deutsch: 'Türkisch' },
  { id: 'ja', name: '日本語', deutsch: 'Japanisch' },
];
export const SOURCE_LOCALE = 'de';
/** Gilt, wenn weder Browser noch Land zu einer der Sprachen passen. */
export const FALLBACK_LOCALE = 'en';
export const LOCALE_IDS = LOCALES.map(l => l.id);
export const isLocale = value => typeof value === 'string' && LOCALE_IDS.includes(value);

/** Wahl aus den Einstellungen der App (localStorage). */
export const LOCALE_KEY = 'chetti.locale';
/**
 * Läuft vor dem ersten Zeichnen (app/layout.tsx): Wechselt die Oberfläche gleich in eine andere Sprache, bleibt sie bis dahin
 * unsichtbar (globals.css, data-i18n), damit nicht kurz der deutsche Text aufblitzt. Gleiche Reihenfolge wie in lib/i18n.ts:
 * gespeicherte Wahl, `?lang=`, Sprachen des Browsers.
 */
export const LOCALE_BOOT = `try{var s=localStorage.getItem('${LOCALE_KEY}'),ids=${JSON.stringify(LOCALE_IDS)},q=new URLSearchParams(location.search).get('lang'),l=ids.indexOf(s)>=0?s:ids.indexOf(q)>=0?q:null;if(!l){var n=navigator.languages||[navigator.language];for(var i=0;i<n.length&&!l;i++){var c=String(n[i]).toLowerCase().split('-')[0];if(ids.indexOf(c)>=0)l=c}}if((l||'${FALLBACK_LOCALE}')!=='${SOURCE_LOCALE}')document.documentElement.setAttribute('data-i18n','loading')}catch(e){}`;
