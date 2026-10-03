// Registro dei comandi: un solo elenco per tastiera, menu nativo, tavolozza
// dei comandi ed elenco delle scorciatoie.
import * as host from "./host.js";
import {
  app, emit, newDoc, openDialog, openPath, saveDoc, saveAll, closeDoc, reopenClosed, cycleTab, openFolder,
  clearRecent, toast, activate, updateTitle, requestQuit,
} from "./app.js";
import { getPrefs, setPref, $, joinPath, basename } from "./util.js";
import { quickOpen, commandPalette, preferences, versionHistory, about, shortcuts, tableDialog } from "./dialogs.js";
import { exportHtml, exportPdf, printDoc, exportPandoc, importFile } from "./export.js";
import { THEMES, applyTheme, getUserThemes, loadUserThemes, THEME_README } from "./themes.js";
import { toggleAi, runAiAction } from "./ai.js";
import { prompt } from "./ui-base.js";
import { t, LANGUAGES, getLanguage } from "./i18n.js";

let ui = {}; // findBar, sidebar, statusBar: impostati da main.js
export function setUi(u) { ui = u; }

const ed = () => app.active && app.active.editor;
const edRun = (name, arg) => () => { const e = ed(); if (e) { e.run(name, arg); e.focus(); } };

/* Un comando: { label, group, keys: ["Ctrl+B"], run, edit (solo con il cursore
 * nell'editor), checked() per le voci con spunta, hidden (fuori dalla tavolozza) } */
export const commands = {
  // ---- File
  "file.new": { group: t("File"), label: t("Nuovo"), keys: ["Ctrl+N"], run: () => newDoc() },
  "file.newWindow": { group: t("File"), label: t("Nuova finestra"), keys: ["Ctrl+Shift+N"], run: () => host.call("newWindow") },
  "file.open": { group: t("File"), label: t("Apri…"), keys: ["Ctrl+O"], run: () => openDialog() },
  "file.openFolder": { group: t("File"), label: t("Apri cartella…"), keys: ["Ctrl+Shift+O"], run: async () => { await openFolder(); if (app.folder) { setSidebar(true); ui.sidebar.show("files"); } } },
  "file.quickOpen": { group: t("File"), label: t("Apertura rapida…"), keys: ["Ctrl+P"], run: () => quickOpen() },
  "file.save": { group: t("File"), label: t("Salva"), keys: ["Ctrl+S"], run: () => saveDoc() },
  "file.saveAs": { group: t("File"), label: t("Salva con nome…"), keys: ["Ctrl+Shift+S"], run: () => saveDoc(app.active, { as: true }) },
  "file.saveAll": { group: t("File"), label: t("Salva tutto"), keys: ["Ctrl+Alt+S"], run: () => saveAll() },
  "file.rename": { group: t("File"), label: t("Rinomina…"), run: renameDoc },
  "file.history": { group: t("File"), label: t("Cronologia delle versioni…"), run: () => versionHistory(app.active) },
  "file.reload": { group: t("File"), label: t("Ricarica dal disco"), run: reloadFromDisk },
  "file.import": { group: t("File"), label: t("Importa (Word, HTML, CSV…)…"), run: () => importFile() },
  "file.exportPdf": { group: t("Esporta"), label: t("PDF…"), run: () => app.active && exportPdf(app.active) },
  "file.exportHtml": { group: t("Esporta"), label: t("HTML…"), run: () => app.active && exportHtml(app.active, true) },
  "file.exportHtmlPlain": { group: t("Esporta"), label: t("HTML senza stili…"), run: () => app.active && exportHtml(app.active, false) },
  "file.exportDocx": { group: t("Esporta"), label: t("Word (.docx)…"), run: () => app.active && exportPandoc(app.active, "docx") },
  "file.exportOdt": { group: t("Esporta"), label: t("OpenDocument (.odt)…"), run: () => app.active && exportPandoc(app.active, "odt") },
  "file.exportRtf": { group: t("Esporta"), label: t("RTF…"), run: () => app.active && exportPandoc(app.active, "rtf") },
  "file.exportEpub": { group: t("Esporta"), label: t("EPUB…"), run: () => app.active && exportPandoc(app.active, "epub") },
  "file.exportTex": { group: t("Esporta"), label: t("LaTeX…"), run: () => app.active && exportPandoc(app.active, "tex") },
  "file.exportRst": { group: t("Esporta"), label: t("reStructuredText…"), run: () => app.active && exportPandoc(app.active, "rst") },
  "file.exportWiki": { group: t("Esporta"), label: t("MediaWiki…"), run: () => app.active && exportPandoc(app.active, "wiki") },
  "file.print": { group: t("File"), label: t("Stampa…"), keys: ["Ctrl+Shift+P"], run: () => app.active && printDoc(app.active) },
  "file.showInFolder": { group: t("File"), label: t("Mostra in Esplora risorse"), run: () => app.active && app.active.path && host.call("showInFolder", { path: app.active.path }) },
  "file.copyPath": { group: t("File"), label: t("Copia percorso del file"), run: () => { if (app.active && app.active.path) { host.call("clipboardWrite", { text: app.active.path }); toast(t("Percorso copiato")); } } },
  "file.prefs": { group: t("File"), label: t("Preferenze…"), keys: ["Ctrl+,"], run: () => preferences({ userThemes: getUserThemes(), applyTheme: (v) => { applyTheme(v); emit("menu"); } }) },
  "file.close": { group: t("File"), label: t("Chiudi scheda"), keys: ["Ctrl+W", "Ctrl+F4"], run: () => closeDoc() },
  "file.reopen": { group: t("File"), label: t("Riapri scheda chiusa"), keys: ["Ctrl+Shift+T"], run: () => reopenClosed() },
  "file.clearRecent": { group: t("File"), label: t("Svuota elenco recenti"), run: () => clearRecent() },
  "file.quit": { group: t("File"), label: t("Esci"), run: () => requestQuit() },
  "tab.next": { group: t("Schede"), label: t("Scheda successiva"), keys: ["Ctrl+Tab", "Ctrl+PageDown"], run: () => cycleTab(1) },
  "tab.prev": { group: t("Schede"), label: t("Scheda precedente"), keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"], run: () => cycleTab(-1) },

  // ---- Modifica (Annulla, Taglia ecc. passano come tasti veri: vedi menu)
  "edit.undo": { group: t("Modifica"), label: t("Annulla"), keys: ["Ctrl+Z"], native: true, run: edRun("undo") },
  "edit.redo": { group: t("Modifica"), label: t("Ripeti"), keys: ["Ctrl+Y"], native: true, run: edRun("redo") },
  "edit.copyMd": { group: t("Modifica"), label: t("Copia come Markdown"), keys: ["Ctrl+Shift+C"], run: copyAsMarkdown },
  "edit.copyHtml": { group: t("Modifica"), label: t("Copia come HTML"), run: copyAsHtml },
  "edit.pastePlain": { group: t("Modifica"), label: t("Incolla come testo semplice"), keys: ["Ctrl+Shift+V"], edit: true, run: pastePlain },
  "edit.find": { group: t("Modifica"), label: t("Trova…"), keys: ["Ctrl+F"], run: () => ui.findBar.show(false) },
  "edit.replace": { group: t("Modifica"), label: t("Sostituisci…"), keys: ["Ctrl+H"], run: () => ui.findBar.show(true) },
  "edit.findNext": { group: t("Modifica"), label: t("Trova successivo"), keys: ["F3"], run: () => ui.findBar.next() },
  "edit.findPrev": { group: t("Modifica"), label: t("Trova precedente"), keys: ["Shift+F3"], run: () => ui.findBar.prev() },
  "edit.findInFolder": { group: t("Modifica"), label: t("Cerca nei documenti della cartella…"), keys: ["Ctrl+Shift+F"], run: () => { setSidebar(true); ui.sidebar.show("search"); } },
  "edit.palette": { group: t("Modifica"), label: t("Tavolozza dei comandi…"), keys: ["Ctrl+Shift+A"], run: () => commandPalette(commands, run) },

  // ---- Paragrafo
  "para.h1": { group: t("Paragrafo"), label: t("Titolo 1"), keys: ["Ctrl+1"], edit: true, run: edRun("heading", 1) },
  "para.h2": { group: t("Paragrafo"), label: t("Titolo 2"), keys: ["Ctrl+2"], edit: true, run: edRun("heading", 2) },
  "para.h3": { group: t("Paragrafo"), label: t("Titolo 3"), keys: ["Ctrl+3"], edit: true, run: edRun("heading", 3) },
  "para.h4": { group: t("Paragrafo"), label: t("Titolo 4"), keys: ["Ctrl+4"], edit: true, run: edRun("heading", 4) },
  "para.h5": { group: t("Paragrafo"), label: t("Titolo 5"), keys: ["Ctrl+5"], edit: true, run: edRun("heading", 5) },
  "para.h6": { group: t("Paragrafo"), label: t("Titolo 6"), keys: ["Ctrl+6"], edit: true, run: edRun("heading", 6) },
  "para.p": { group: t("Paragrafo"), label: t("Paragrafo normale"), keys: ["Ctrl+0"], edit: true, run: edRun("paragraph") },
  "para.up": { group: t("Paragrafo"), label: t("Alza livello del titolo"), keys: ["Ctrl+Alt+Up"], edit: true, run: edRun("headingUp") },
  "para.down": { group: t("Paragrafo"), label: t("Abbassa livello del titolo"), keys: ["Ctrl+Alt+Down"], edit: true, run: edRun("headingDown") },
  "para.quote": { group: t("Paragrafo"), label: t("Citazione"), keys: ["Ctrl+Shift+Q"], edit: true, run: edRun("quote") },
  "para.ul": { group: t("Paragrafo"), label: t("Elenco puntato"), keys: ["Ctrl+Shift+8"], edit: true, run: edRun("bulletList") },
  "para.ol": { group: t("Paragrafo"), label: t("Elenco numerato"), keys: ["Ctrl+Shift+7"], edit: true, run: edRun("orderedList") },
  "para.task": { group: t("Paragrafo"), label: t("Elenco di attività"), keys: ["Ctrl+Shift+9"], edit: true, run: edRun("taskList") },
  "para.indent": { group: t("Paragrafo"), label: t("Aumenta rientro elenco"), edit: true, run: edRun("indent") },
  "para.outdent": { group: t("Paragrafo"), label: t("Riduci rientro elenco"), edit: true, run: edRun("outdent") },
  "insert.table": { group: t("Inserisci"), label: t("Tabella…"), keys: ["Ctrl+T"], edit: true, run: (arg) => (arg ? edRun("table", arg)() : tableDialog(run)) },
  "insert.code": { group: t("Inserisci"), label: t("Blocco di codice"), keys: ["Ctrl+Shift+K"], edit: true, run: edRun("codeBlock") },
  "insert.math": { group: t("Inserisci"), label: t("Blocco di formule"), keys: ["Ctrl+Shift+M"], edit: true, run: edRun("mathBlock") },
  "insert.mermaid": { group: t("Inserisci"), label: t("Diagramma Mermaid"), edit: true, run: edRun("mermaid") },
  "insert.hr": { group: t("Inserisci"), label: t("Linea orizzontale"), edit: true, run: edRun("hr") },
  "insert.footnote": { group: t("Inserisci"), label: t("Nota a piè di pagina"), edit: true, run: edRun("footnote") },
  "insert.toc": { group: t("Inserisci"), label: t("Indice dei titoli"), edit: true, run: edRun("insertToc") },
  "insert.frontmatter": { group: t("Inserisci"), label: t("Front matter YAML"), run: insertFrontMatter },
  "insert.date": { group: t("Inserisci"), label: t("Data e ora"), keys: ["Ctrl+Shift+D"], edit: true, run: () => { const e = ed(); e && e.insertText(new Date().toLocaleString("it-IT", { dateStyle: "long", timeStyle: "short" })); } },

  // ---- Formato
  "fmt.bold": { group: t("Formato"), label: t("Grassetto"), keys: ["Ctrl+B"], edit: true, run: edRun("bold") },
  "fmt.italic": { group: t("Formato"), label: t("Corsivo"), keys: ["Ctrl+I"], edit: true, run: edRun("italic") },
  "fmt.strike": { group: t("Formato"), label: t("Barrato"), keys: ["Alt+Shift+5"], edit: true, run: edRun("strike") },
  "fmt.highlight": { group: t("Formato"), label: t("Evidenziato"), keys: ["Ctrl+Shift+H"], edit: true, run: edRun("highlight") },
  "fmt.code": { group: t("Formato"), label: t("Codice in linea"), keys: ["Ctrl+E"], edit: true, run: edRun("code") },
  "fmt.math": { group: t("Formato"), label: t("Formula in linea"), edit: true, run: edRun("inlineMath") },
  "fmt.link": { group: t("Formato"), label: t("Collegamento"), keys: ["Ctrl+K"], edit: true, run: edRun("link") },
  "fmt.image": { group: t("Formato"), label: t("Immagine"), keys: ["Ctrl+Shift+I"], edit: true, run: edRun("image") },
  "fmt.clear": { group: t("Formato"), label: t("Cancella formattazione"), keys: ["Ctrl+\\"], edit: true, run: edRun("clearFormat") },

  // ---- Vista
  "view.sidebar": { group: t("Vista"), label: t("Barra laterale"), keys: ["Ctrl+Shift+L"], checked: () => getPrefs().sidebarVisible, run: () => setSidebar(!getPrefs().sidebarVisible) },
  "view.outline": { group: t("Vista"), label: t("Struttura"), keys: ["Ctrl+Shift+1"], run: () => { setSidebar(true); ui.sidebar.show("outline"); } },
  "view.files": { group: t("Vista"), label: t("File"), keys: ["Ctrl+Shift+2"], run: () => { setSidebar(true); ui.sidebar.show("files"); } },
  "view.search": { group: t("Vista"), label: t("Cerca"), keys: ["Ctrl+Shift+3"], run: () => { setSidebar(true); ui.sidebar.show("search"); } },
  "view.source": { group: t("Vista"), label: t("Modalità sorgente"), keys: ["Ctrl+U", "Ctrl+/"], checked: () => !!(app.active && app.active.mode === "source"), run: toggleSource },
  "view.focus": { group: t("Vista"), label: t("Modalità concentrazione"), keys: ["F8"], checked: () => getPrefs().focusMode, run: () => { setPref("focusMode", !getPrefs().focusMode); applyModes(); } },
  "view.typewriter": { group: t("Vista"), label: t("Modalità macchina da scrivere"), keys: ["F9"], checked: () => getPrefs().typewriterMode, run: () => { setPref("typewriterMode", !getPrefs().typewriterMode); applyModes(); } },
  "view.statusbar": { group: t("Vista"), label: t("Barra di stato"), checked: () => getPrefs().showStatusBar, run: () => { setPref("showStatusBar", !getPrefs().showStatusBar); applyModes(); } },
  "view.fullscreen": { group: t("Vista"), label: t("Schermo intero"), keys: ["F11"], checked: () => !!nativeState.fullscreen, run: () => native("fullscreen") },
  "view.topmost": { group: t("Vista"), label: t("Sempre in primo piano"), checked: () => !!nativeState.topmost, run: () => native("topmost") },
  "view.zoomIn": { group: t("Vista"), label: t("Ingrandisci"), keys: ["Ctrl++", "Ctrl+="], run: () => native("zoomIn") },
  "view.zoomOut": { group: t("Vista"), label: t("Riduci"), keys: ["Ctrl+-"], run: () => native("zoomOut") },
  "view.zoomReset": { group: t("Vista"), label: t("Dimensione originale"), keys: ["Ctrl+Shift+0"], run: () => native("zoomReset") },
  "view.wordGoal": { group: t("Vista"), label: t("Obiettivo di parole…"), run: setWordGoal },
  "view.devtools": { group: t("Vista"), label: t("Strumenti per sviluppatori"), keys: ["Ctrl+Shift+F12"], run: () => native("devtools") },

  // ---- Assistente
  "ai.toggle": { group: t("Assistente"), label: t("Pannello dell'assistente"), keys: ["Ctrl+J"], run: () => toggleAi() },
  "ai.fix": { group: t("Assistente"), label: t("Correggi il testo selezionato"), run: () => runAiAction("fix") },
  "ai.improve": { group: t("Assistente"), label: t("Migliora il testo selezionato"), run: () => runAiAction("improve") },
  "ai.summary": { group: t("Assistente"), label: t("Riassumi"), run: () => runAiAction("summary") },
  "ai.translate": { group: t("Assistente"), label: t("Traduci"), run: () => runAiAction("translate") },

  // ---- Temi
  "theme.reload": { group: t("Temi"), label: t("Ricarica temi personali"), run: async () => { await loadUserThemes(); applyTheme(); emit("menu"); toast(t("Temi ricaricati")); } },
  "theme.folder": { group: t("Temi"), label: t("Apri cartella dei temi"), run: openThemesFolder },
  "theme.follow": { group: t("Temi"), label: t("Segui il tema di Windows"), checked: () => getPrefs().followSystem, run: () => { setPref("followSystem", !getPrefs().followSystem); applyTheme(); emit("menu"); } },

  // ---- Aiuto
  "help.guide": { group: t("Aiuto"), label: t("Guida rapida al Markdown"), keys: ["F1"], run: openGuide },
  "help.shortcuts": { group: t("Aiuto"), label: t("Scorciatoie da tastiera"), run: () => shortcuts(commands) },
  "help.assoc": { group: t("Aiuto"), label: t("Usa MDFlash per aprire i file .md…"), run: registerAssoc },
  "help.donate": { group: t("Aiuto"), label: t("Sostieni il progetto (Liberapay)…"), run: () => host.call("openExternal", { url: "https://liberapay.com/MetaDarko" }) },
  "help.github": { group: t("Aiuto"), label: t("Pagina dell'autore su GitHub"), run: () => host.call("openExternal", { url: "https://github.com/ShinRalexis" }) },
  "help.about": { group: t("Aiuto"), label: t("Informazioni su MDFlash"), run: () => about() },
};

for (const th of THEMES) {
  commands["theme." + th.id] = { group: t("Temi"), label: t(th.name), radio: true, checked: () => getPrefs().theme === th.id, run: () => { applyTheme(th.id); emit("menu"); } };
}

/* ---------- esecuzione ---------- */
export function run(id, arg) {
  if (id.startsWith("recent:")) return openPath(id.slice(7));
  if (id.startsWith("usertheme:")) { applyTheme("user:" + id.slice(10)); emit("menu"); return; }
  if (id.startsWith("lang:")) return changeLanguage(id.slice(5));
  if (id.startsWith("doc:")) { const d = app.docs.find((x) => String(x.id) === id.slice(4)); if (d) activate(d); return; }
  const c = commands[id];
  if (!c) return;
  try {
    const r = c.run(arg);
    if (r && r.then) r.then(() => emit("menu")).catch((e) => { console.error(e); toast(String(e.message || e), "error"); });
    else emit("menu");
  } catch (e) {
    console.error(e);
    toast(String(e.message || e), "error");
  }
}

/* ---------- tastiera ---------- */
const keyMap = new Map();
for (const [id, c] of Object.entries(commands)) for (const k of c.keys || []) keyMap.set(k.toLowerCase(), id);

function comboOf(e) {
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (e.code === "NumpadAdd") key = "+";
  else if (e.code === "NumpadSubtract") key = "-";
  else if (e.key === "ArrowUp") key = "Up";
  else if (e.key === "ArrowDown") key = "Down";
  else if (e.key === " ") key = "Space";
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  // con i tasti simbolo ("+", "/") Maiusc fa già parte del carattere
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) mods.push("Shift");
  return [...mods, key].join("+").toLowerCase();
}

function inEditableField(target) {
  return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
}
function inNestedCode(target) {
  // dentro un blocco di codice dell'editor WYSIWYG (CodeMirror annidato)
  return target && target.closest && target.closest(".milkdown .cm-editor");
}

export function installKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (!e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.key) && e.key !== "Tab") return;
    if (e.key === "Tab" && !e.ctrlKey) return;
    // Ctrl+Alt su Windows è AltGr (es. @ # [ ] nella tastiera italiana)
    let combo = comboOf(e);
    if (e.ctrlKey && e.altKey && !keyMap.has(combo)) return;
    const id = keyMap.get(combo);
    if (!id) {
      // Ctrl+Z/Y/C/V/X/A restano al comportamento normale; il resto non deve
      // finire al browser (Ctrl+R ricaricherebbe la pagina)
      if (e.ctrlKey && /^ctrl\+(r|shift\+r|g|shift\+g|d|l|shift\+del)$/.test(combo)) e.preventDefault();
      return;
    }
    const c = commands[id];
    if (c.native) return;
    const field = inEditableField(e.target) && !e.target.closest(".cm-editor");
    if (c.edit && (field || inNestedCode(e.target))) return;
    if (field && /^(edit\.find|edit\.replace|edit\.findNext|edit\.findPrev)$/.test(id) && e.target.closest("#findbar")) {
      if (id === "edit.findNext") { e.preventDefault(); ui.findBar.next(); }
      if (id === "edit.findPrev") { e.preventDefault(); ui.findBar.prev(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    run(id);
  }, true);
}

/* ---------- menu nativo (costruito dal C) ---------- */
const item = (id, extra = {}) => {
  const c = commands[id];
  return { label: extra.label || c.label, cmd: id, accel: c.keys ? c.keys[0] : undefined, checked: c.checked ? !!c.checked() : false, radio: !!c.radio, ...extra };
};
const keyItem = (label, keys, accel) => ({ label, cmd: "key:" + keys, accel });
const sep = { sep: true };

export function menuDefinition() {
  const d = app.active;
  const has = !!d;
  const hasPath = !!(d && d.path);
  const pandoc = !!app.info.pandoc;
  const userThemes = getUserThemes();
  return [
    { label: t("&File"), items: [
      item("file.new"), item("file.newWindow"), sep,
      item("file.open"), item("file.openFolder"), item("file.quickOpen"),
      { label: t("Apri &recenti"), items: app.recent.length
        ? [...app.recent.slice(0, 15).map((p, i) => ({ label: `${i < 9 ? "&" + (i + 1) + "  " : "    "}${basename(p).replace(/&/g, "&&")}`, cmd: "recent:" + p })), sep, item("file.clearRecent")]
        : [{ label: t("Nessun file recente"), enabled: false }] },
      sep,
      item("file.save", { enabled: has }), item("file.saveAs", { enabled: has }), item("file.saveAll"),
      item("file.rename", { enabled: hasPath }), item("file.reload", { enabled: hasPath }),
      item("file.history", { enabled: hasPath }), sep,
      item("file.import"),
      { label: t("&Esporta"), items: [
        item("file.exportPdf", { enabled: has }), item("file.exportHtml", { enabled: has }), item("file.exportHtmlPlain", { enabled: has }), sep,
        item("file.exportDocx", { enabled: has }),
        item("file.exportOdt", { enabled: has && pandoc }), item("file.exportRtf", { enabled: has && pandoc }),
        item("file.exportEpub", { enabled: has && pandoc }), item("file.exportTex", { enabled: has && pandoc }),
        item("file.exportRst", { enabled: has && pandoc }), item("file.exportWiki", { enabled: has && pandoc }),
        ...(pandoc ? [] : [sep, { label: t("Altri formati: installa Pandoc (pandoc.org)"), enabled: false }]),
      ] },
      item("file.print", { enabled: has }), sep,
      item("file.showInFolder", { enabled: hasPath }), item("file.copyPath", { enabled: hasPath }), sep,
      item("file.prefs"), sep,
      item("file.close", { enabled: has }), item("file.reopen"), { label: t("Esci"), cmd: "file.quit", accel: "Alt+F4" },
    ] },
    { label: t("&Modifica"), items: [
      keyItem(t("Annulla"), "ctrl+z", "Ctrl+Z"), keyItem(t("Ripeti"), "ctrl+y", "Ctrl+Y"), sep,
      keyItem(t("Taglia"), "ctrl+x", "Ctrl+X"), keyItem(t("Copia"), "ctrl+c", "Ctrl+C"), keyItem(t("Incolla"), "ctrl+v", "Ctrl+V"),
      item("edit.copyMd"), item("edit.copyHtml"), item("edit.pastePlain"), sep,
      keyItem(t("Seleziona tutto"), "ctrl+a", "Ctrl+A"), sep,
      item("edit.find"), item("edit.replace"), item("edit.findNext"), item("edit.findPrev"), sep,
      item("edit.findInFolder"), item("edit.palette"),
    ] },
    { label: t("&Paragrafo"), items: [
      item("para.h1"), item("para.h2"), item("para.h3"), item("para.h4"), item("para.h5"), item("para.h6"), item("para.p"), sep,
      item("para.up"), item("para.down"), sep,
      item("para.quote"), item("para.ul"), item("para.ol"), item("para.task"), item("para.indent"), item("para.outdent"), sep,
      item("insert.table"), item("insert.code"), item("insert.math"), item("insert.mermaid"), sep,
      item("insert.hr"), item("insert.footnote"), item("insert.toc"), item("insert.frontmatter"), item("insert.date"),
    ] },
    { label: t("F&ormato"), items: [
      item("fmt.bold"), item("fmt.italic"), item("fmt.strike"), item("fmt.highlight"), sep,
      item("fmt.code"), item("fmt.math"), sep, item("fmt.link"), item("fmt.image"), sep, item("fmt.clear"),
    ] },
    { label: t("&Vista"), items: [
      item("view.sidebar"), item("view.outline"), item("view.files"), item("view.search"), sep,
      item("view.source"), item("view.focus"), item("view.typewriter"), sep,
      item("view.statusbar"), item("view.fullscreen"), item("view.topmost"), sep,
      item("view.zoomIn"), item("view.zoomOut"), item("view.zoomReset"), sep,
      item("view.wordGoal"), sep,
      { label: t("&Schede"), items: app.docs.length ? [
        ...app.docs.map((x, i) => ({ label: (i < 9 ? `&${i + 1}  ` : "    ") + x.title.replace(/&/g, "&&") + (x.isDirty() ? "  ●" : ""), cmd: "doc:" + x.id, checked: x === d, radio: true })),
        sep, item("tab.next"), item("tab.prev"),
      ] : [{ label: t("Nessun documento aperto"), enabled: false }] },
      sep,
      { label: "&Lingua / Language", items: [
        { label: t("Automatica (lingua di Windows)"), cmd: "lang:auto", radio: true, checked: getPrefs().language === "auto" },
        sep,
        ...LANGUAGES.map((l) => ({ label: l.name, cmd: "lang:" + l.code, radio: true, checked: getPrefs().language === l.code })),
      ] },
      sep, item("view.devtools"),
    ] },
    { label: t("&Temi"), items: [
      ...THEMES.map((th) => item("theme." + th.id)),
      ...(userThemes.length ? [sep, ...userThemes.map((ut) => ({ label: ut.name.replace(/&/g, "&&"), cmd: "usertheme:" + ut.name, radio: true, checked: getPrefs().theme === "user:" + ut.name }))] : []),
      sep, item("theme.follow"), sep, item("theme.folder"), item("theme.reload"),
    ] },
    { label: t("&Assistente"), items: [
      item("ai.toggle"), sep, item("ai.fix"), item("ai.improve"), item("ai.summary"), item("ai.translate"),
    ] },
    { label: t("A&iuto"), items: [
      item("help.guide"), item("help.shortcuts"), sep, item("help.assoc"), sep, item("help.github"), item("help.donate"), sep, item("help.about"),
    ] },
  ];
}

let menuTimer;
export function refreshMenu() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => host.call("setMenu", { menu: menuDefinition() }), 80);
}

/* ---------- azioni di supporto ---------- */
const nativeState = { fullscreen: false, topmost: false };
async function native(cmd) {
  const r = await host.call("native", { cmd });
  nativeState.fullscreen = r.fullscreen;
  nativeState.topmost = r.topmost;
  document.body.classList.toggle("fullscreen", !!r.fullscreen);
  if (cmd.startsWith("zoom") && r.zoom) ui.statusBar && ui.statusBar.message(`Zoom ${Math.round(r.zoom * 100)}%`);
}

export function setSidebar(show) {
  setPref("sidebarVisible", show);
  applyModes();
}

export function applyModes() {
  const p = getPrefs();
  const b = document.body.classList;
  b.toggle("sidebar-hidden", !p.sidebarVisible);
  b.toggle("focus-mode", !!p.focusMode);
  b.toggle("typewriter", !!p.typewriterMode);
  b.toggle("statusbar-hidden", !p.showStatusBar);
  const r = document.documentElement.style;
  r.setProperty("--doc-font-size", p.fontSize + "px");
  r.setProperty("--doc-width", p.lineWidth >= 2000 ? "100%" : p.lineWidth + "px");
  r.setProperty("--doc-line-height", String(p.lineHeight));
  if (p.editorFont) r.setProperty("--font-body-user", p.editorFont); else r.removeProperty("--font-body-user");
  if (p.codeFont) r.setProperty("--font-code-user", p.codeFont); else r.removeProperty("--font-code-user");
  b.toggle("no-code-numbers", !p.codeLineNumbers);
  document.querySelectorAll(".editor-host [contenteditable]").forEach((n) => n.setAttribute("spellcheck", p.spellcheck ? "true" : "false"));
  refreshMenu();
}

async function toggleSource() {
  const d = app.active;
  if (!d) return;
  await d.setMode(d.mode === "source" ? "wysiwyg" : "source");
  emit("active", d);
  emit("docchange", d);
}

async function copyAsMarkdown() {
  const e = ed();
  if (!e) return;
  const md = e.selectedMarkdown() || app.active.fullText();
  await host.call("clipboardWrite", { text: md });
  toast(e.selectedMarkdown() ? t("Selezione copiata come Markdown") : t("Documento copiato come Markdown"));
}

async function copyAsHtml() {
  const e = ed();
  if (!e) return;
  let html = e.selectedHtml();
  if (!html) {
    const { renderDocHtml } = await import("./export.js");
    html = await renderDocHtml(app.active, { mode: "file" });
  }
  await host.call("clipboardWrite", { text: html, html });
  toast(t("Copiato come HTML (si incolla formattato in Word e nelle e-mail)"));
}

async function pastePlain() {
  const e = ed();
  if (!e) return;
  const r = await host.call("clipboardRead");
  if (r.text) e.insertText(r.text);
}

async function insertFrontMatter() {
  const d = app.active;
  if (!d) return;
  if (d.mode === "source") {
    const text = d.fullText();
    if (!text.startsWith("---\n")) d.editor.view.dispatch({ changes: { from: 0, insert: `---\ntitle: ${d.title.replace(/\.[^.]+$/, "")}\ndate: ${new Date().toISOString().slice(0, 10)}\ntags: []\n---\n\n` } });
    return;
  }
  if (d.fmBox.hidden) {
    d.setFrontMatter(`title: ${d.title.replace(/\.[^.]+$/, "")}\ndate: ${new Date().toISOString().slice(0, 10)}\ntags: []`);
    d.onChange && d.onChange(d);
    emit("docchange", d);
    d.lastDirty = true;
    emit("dirty", d);
  }
  d.fmArea.focus();
}

async function renameDoc() {
  const d = app.active;
  if (!d || !d.path) return;
  const name = await prompt(t("Rinomina documento"), t("Nuovo nome del file"), basename(d.path), { selectStem: true });
  if (name && name !== basename(d.path)) {
    const { renameActive } = await import("./app.js");
    await renameActive(name);
  }
}

async function reloadFromDisk() {
  const d = app.active;
  if (!d || !d.path) return;
  if (d.isDirty()) {
    const { confirmBox } = await import("./app.js");
    const i = await confirmBox(t("Ricaricare il file dal disco?"), t("Le modifiche non salvate andranno perse."), [t("Ricarica"), t("Annulla")]);
    if (i !== 0) return;
  }
  const r = await host.call("readFile", { path: d.path });
  if (r.error) return toast(r.error, "error");
  await d.replaceAll(r.text, { clean: true });
  d.mtime = r.mtime;
  emit("dirty", d);
  emit("docchange", d);
}

async function setWordGoal() {
  const v = await prompt(t("Obiettivo di parole"), t("Quante parole vuoi scrivere? (0 per toglierlo)"), String(getPrefs().wordGoal || 1000));
  if (v == null) return;
  setPref("wordGoal", Math.max(0, parseInt(v, 10) || 0));
  emit("prefs");
}

async function openThemesFolder() {
  const dir = await loadUserThemes();
  if (!dir) return;
  const sample = joinPath(dir, "LEGGIMI-esempio-tema.css.txt");
  const st = await host.call("stat", { path: sample });
  if (!st.exists) await host.call("writeFile", { path: sample, text: THEME_README });
  host.call("openExternal", { url: dir });
}

// La lingua cambia ricaricando l'interfaccia: la sessione (anche i testi non
// salvati) viene ripristinata subito dopo.
export async function changeLanguage(code) {
  if (getPrefs().language === code) return;
  setPref("language", code);
  const { saveSession } = await import("./app.js");
  saveSession.flush();
  await host.call("setLanguage", { lang: code });
  location.reload();
}

async function registerAssoc() {
  await host.call("registerAssoc");
  toast(t("Nelle Impostazioni di Windows scegli MDFlash per i file .md"));
}

async function openGuide() {
  // guida nella lingua dell'interfaccia, altrimenti in inglese o in italiano
  const lang = getLanguage();
  let text = "";
  for (const f of [lang === "it" ? "guida.md" : `guida-${lang}.md`, "guida-en.md", "guida.md"]) {
    try {
      const r = await fetch(f);
      if (r.ok) { text = await r.text(); break; }
    } catch { /* file mancante: si prova il successivo */ }
  }
  const doc = await newDoc(text, { title: t("Guida rapida al Markdown") });
  doc.markClean();
  emit("dirty", doc);
}

export { native, nativeState };
