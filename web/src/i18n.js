// Traduzioni dell'interfaccia. Nel codice i testi sono scritti in italiano
// dentro t("..."); ogni lingua ha un dizionario testo italiano -> traduzione.
// Segnaposto: {0}, {1}... sostituiti dagli argomenti dopo il testo.
import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import de from "./locales/de.js";
import ja from "./locales/ja.js";
import ko from "./locales/ko.js";
import zh from "./locales/zh.js";
import ru from "./locales/ru.js";

export const LANGUAGES = [
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "en", name: "English", locale: "en-US" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "ja", name: "日本語", locale: "ja-JP" },
  { code: "ko", name: "한국어", locale: "ko-KR" },
  { code: "zh", name: "中文（简体）", locale: "zh-CN" },
  { code: "ru", name: "Русский", locale: "ru-RU" },
];
const DICTS = { it: {}, en, es, fr, de, ja, ko, zh, ru };

let lang = "it";
let dict = {};

// "auto" segue la lingua di Windows; se non è tra quelle disponibili, inglese.
export function resolveLanguage(pref, systemLocale) {
  if (pref && pref !== "auto" && DICTS[pref]) return pref;
  const sys = (systemLocale || navigator.language || "en").slice(0, 2).toLowerCase();
  return DICTS[sys] ? sys : "en";
}

export function setLanguage(code) {
  lang = DICTS[code] ? code : "en";
  dict = DICTS[lang];
  document.documentElement.lang = LANGUAGES.find((l) => l.code === lang).locale;
}

export const getLanguage = () => lang;
export const getLocale = () => LANGUAGES.find((l) => l.code === lang).locale;

export function t(text, ...args) {
  const s = dict[text] ?? text;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : s;
}

// Numeri nel formato della lingua (1.234 in italiano, 1,234 in inglese)
export const num = (n) => Number(n).toLocaleString(getLocale());

// La lingua si sceglie subito, prima che gli altri moduli preparino i loro
// testi (le etichette dei comandi sono calcolate al caricamento).
let savedPref = "auto";
try { savedPref = JSON.parse(localStorage.getItem("mdflash.prefs.v2") || "{}").language || "auto"; } catch { /* preferenze illeggibili */ }
setLanguage(resolveLanguage(savedPref, navigator.language));
