import { LOCALES, SOURCE_LOCALE, isLocale } from './i18n/locales.mjs';
import en from './i18n/en.mjs';
import es from './i18n/es.mjs';
import fr from './i18n/fr.mjs';
import it from './i18n/it.mjs';
import pt from './i18n/pt.mjs';
import nl from './i18n/nl.mjs';
import pl from './i18n/pl.mjs';
import tr from './i18n/tr.mjs';
import ja from './i18n/ja.mjs';

/**
 * Meldungen des Dienstes in der Sprache der Oberfläche. Der Dienst selbst arbeitet deutsch: Fehler werden mit ihrem deutschen Text
 * geworfen und erst an der Grenze nach außen (server/http.mjs, app/api/route.ts) übersetzt. Schlüssel = deutscher Text;
 * fehlt ein Eintrag, bleibt die deutsche Meldung.
 */
const DICTS = { en, es, fr, it, pt, nl, pl, tr, ja };

export { isLocale };
/** Sprache aus der Anfrage; unbekannte Angaben gelten als Deutsch. */
export const readLocale = value => (isLocale(value) ? value : SOURCE_LOCALE);
export const translate = (message, locale) => (typeof message === 'string' && DICTS[locale]?.[message]) || message;

/** Deutscher Name der Sprache für den Auftrag an das Sprachmodell („Antworte auf Englisch“). */
export const languageName = locale => LOCALES.find(l => l.id === locale)?.deutsch ?? 'Deutsch';

/**
 * Zusatz zum Auftrag an das Sprachmodell: Die Aufträge und Schreibprofile sind deutsch, die Ausgabe soll in der Sprache der Oberfläche stehen.
 * Für Deutsch entfällt der Zusatz.
 */
export function outputLanguageRule(locale) {
  const language = LOCALES.find(l => l.id === locale);
  if (!language || locale === SOURCE_LOCALE) return '';
  return `\n\nAUSGABESPRACHE: Schreibe alle Texte der Ausgabe auf ${language.deutsch} (${language.name}), auch wenn dieser Auftrag deutsch ist oder das Gespräch in einer anderen Sprache geführt wurde. Die Regeln oben zu Form, Länge und Sicherheit gelten sinngemäß in dieser Sprache; deutsche Abkürzungen und Wendungen aus dem Schreibprofil überträgst du in das dort übliche Fachvokabular. Überschriften und Feldnamen aus einer Vorlage übernimmst du buchstabengetreu. Eigennamen, Medikamentennamen, Zahlenwerte und Einheiten bleiben, wie sie gesagt wurden.`;
}
