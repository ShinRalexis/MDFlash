// Utilità comuni: percorsi Windows, preferenze, piccoli aiuti per il DOM.
import { getLocale } from "./i18n.js";

/* ---------- percorsi ---------- */
export const basename = (p) => (p || "").split(/[\\/]/).pop();
export const dirname = (p) => {
  const i = Math.max((p || "").lastIndexOf("\\"), (p || "").lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
};
export const stripExt = (n) => n.replace(/\.[^.\\/]+$/, "");
export const extname = (p) => {
  const m = /\.([^.\\/]+)$/.exec(p || "");
  return m ? m[1].toLowerCase() : "";
};
export const joinPath = (a, b) => (a.endsWith("\\") || a.endsWith("/") ? a + b : a + "\\" + b);
export const isAbsolute = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
export const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Risolve "./img/a.png" o "../x.png" rispetto alla cartella del documento.
export function resolvePath(base, rel) {
  if (isAbsolute(rel)) return rel.replace(/\//g, "\\");
  const parts = base.replace(/\//g, "\\").split("\\");
  for (const seg of rel.replace(/\//g, "\\").split("\\")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("\\");
}

// Percorso relativo da una cartella a un file (stessa unità), con barre "/".
export function relativePath(fromDir, to) {
  const a = fromDir.replace(/\//g, "\\").split("\\").filter(Boolean);
  const b = to.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (!a.length || !b.length || a[0].toLowerCase() !== b[0].toLowerCase()) return to;
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

// Indirizzo con cui la pagina vede un file locale: ogni unità ha il suo nome
// virtuale (lo crea il programma C), es. C:\a b.png -> https://c.drive.mdflash.example/a%20b.png
export function localFileUrl(absPath) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(absPath);
  if (!m) return absPath;
  const rest = m[2].split(/[\\/]/).map(encodeURIComponent).join("/");
  return `https://${m[1].toLowerCase()}.drive.mdflash.example/${rest}`;
}

// Converte un src di immagine del Markdown nell'indirizzo da mostrare.
export function displayUrl(src, docDir) {
  if (!src) return src;
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  let s = src;
  if (/^file:\/\//i.test(s)) s = decodeURI(s.replace(/^file:\/\/\/?/i, ""));
  try { s = decodeURI(s); } catch { /* lascia com'è */ }
  if (isAbsolute(s)) return localFileUrl(s);
  if (!docDir) return src;
  return localFileUrl(resolvePath(docDir, s));
}

/* ---------- preferenze ---------- */
const PREF_KEY = "mdflash.prefs.v2";
export const defaults = {
  theme: "github",
  followSystem: false,
  darkTheme: "notte",
  fontSize: 16,
  lineWidth: 860,
  lineHeight: 1.7,
  editorFont: "",
  codeFont: "",
  spellcheck: true,
  autosave: false,
  autosaveDelay: 2,
  restoreSession: true,
  imageMode: "assets",        // assets | docname | keep | absolute
  imageFolder: "assets",
  defaultEol: "lf",
  showStatusBar: true,
  sidebarVisible: true,
  sidebarPanel: "outline",
  sidebarWidth: 260,
  focusMode: false,
  typewriterMode: false,
  versionsKeep: 50,
  versionsEnabled: true,
  codeLineNumbers: true,
  wordGoal: 0,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "",
  aiLanguage: "",
  language: "auto",
  lastFolder: "",
  pdfPage: "A4",
  pdfMargin: 0.6,
  pdfLandscape: false,
};

let prefs = { ...defaults };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch { /* preferenze rovinate: si riparte dai valori predefiniti */ }

const prefListeners = new Set();
export const getPrefs = () => prefs;
export function setPref(key, value) {
  if (prefs[key] === value) return;
  prefs[key] = value;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* spazio esaurito */ }
  for (const fn of prefListeners) fn(key, value);
}
export const onPrefChange = (fn) => prefListeners.add(fn);

export function loadJSON(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
export function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* spazio esaurito */ }
}

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(getLocale(), { day: "2-digit", month: "short", year: "numeric" }) + " " +
    d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function timestampName() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Statistiche del testo: parole, caratteri, righe, tempo di lettura.
export function textStats(md) {
  const plain = md
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|=-]+/g, " ");
  // cinese e giapponese non separano le parole: ogni ideogramma o kana conta
  // come una parola (come fa Word); il coreano usa gli spazi e resta normale
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const cjkCount = (plain.match(cjk) || []).length;
  const words = (plain.replace(cjk, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length + cjkCount;
  const chars = md.replace(/\s/g, "").length;
  const lines = md ? md.split("\n").length : 0;
  return { words, chars, charsAll: md.length, lines, minutes: Math.max(1, Math.round(words / 220)) };
}
