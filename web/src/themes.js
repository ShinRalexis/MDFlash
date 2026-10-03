// Temi: quelli inclusi (definiti in styles/themes.css) e quelli personali,
// file .css nella cartella %APPDATA%\MDFlash\themes.
import * as host from "./host.js";
import { getPrefs, setPref } from "./util.js";
import { clearMermaidCache } from "./render.js";

export const THEMES = [
  { id: "github", name: "GitHub", dark: false },
  { id: "carta", name: "Carta (serif, da lettura)", dark: false },
  { id: "seppia", name: "Seppia", dark: false },
  { id: "accademico", name: "Accademico", dark: false },
  { id: "notte", name: "Notte", dark: true },
  { id: "nord", name: "Nord", dark: true },
];

let userThemes = [];
let systemDark = false;

export const getUserThemes = () => userThemes;

export async function loadUserThemes() {
  const r = await host.call("listThemes");
  userThemes = r.themes || [];
  return r.dir;
}

export function setSystemDark(v) {
  systemDark = !!v;
  applyTheme();
}

export function effectiveTheme() {
  const p = getPrefs();
  if (p.followSystem && systemDark) return p.darkTheme || "notte";
  return p.theme;
}

export function applyTheme(id) {
  if (id) setPref("theme", id);
  const theme = effectiveTheme();
  const root = document.documentElement;
  let style = document.getElementById("user-theme");
  let dark;
  if (theme.startsWith("user:")) {
    const t = userThemes.find((u) => "user:" + u.name === theme);
    if (!style) { style = document.createElement("style"); style.id = "user-theme"; document.head.append(style); }
    style.textContent = t ? t.css : "";
    // un tema personale si dichiara scuro con il commento /* mdflash: dark */
    dark = !!(t && /\/\*\s*mdflash:\s*dark\s*\*\//i.test(t.css));
    root.dataset.theme = dark ? "notte" : "github";
  } else {
    if (style) style.textContent = "";
    const t = THEMES.find((x) => x.id === theme) || THEMES[0];
    root.dataset.theme = t.id;
    dark = t.dark;
  }
  root.dataset.dark = dark ? "1" : "0";
  root.style.colorScheme = dark ? "dark" : "light";
  clearMermaidCache();
  syncChrome(dark);
}

// Barra del titolo e menu della finestra (parte C) con i colori del tema.
function syncChrome(dark) {
  requestAnimationFrame(() => {
    const cs = getComputedStyle(document.documentElement);
    const toHex = (v) => {
      const c = document.createElement("canvas").getContext("2d");
      c.fillStyle = v.trim() || "#ffffff";
      return c.fillStyle; // il canvas normalizza in #rrggbb
    };
    host.call("setChrome", { dark, bg: toHex(cs.getPropertyValue("--chrome-bg")), fg: toHex(cs.getPropertyValue("--chrome-text")) });
  });
}

// Testo del file di esempio scritto nella cartella dei temi
export const THEME_README = `/* Tema personale di MDFlash
 *
 * Copia questo file, rinominalo (es. "mio-tema.css") e modificalo: comparirà
 * nel menu Temi al prossimo avvio (o con Temi > Ricarica temi personali).
 * Per un tema scuro aggiungi in cima un commento con le parole mdflash: dark
 * I nomi delle variabili sono quelli del tema "GitHub" (styles/themes.css).
 */
:root {
  --bg: #fbfaf7;
  --text: #2b2b2b;
  --accent: #b5543c;
  --link: #b5543c;
  --font-body: "Iowan Old Style", Georgia, serif;
  --font-heading: "Iowan Old Style", Georgia, serif;
  --chrome-bg: #f1efe9;
}
.markdown-body h1 { letter-spacing: -0.01em; }
`;
