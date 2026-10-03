// Avvio dell'interfaccia di MDFlash.
import "@milkdown/crepe/theme/common/style.css";
import "../styles/themes.css";
import "../styles/app.css";
import "../styles/document.css";

import * as host from "./host.js";
import {
  app, on, emit, newDoc, openPaths, openPath, restoreSession, checkExternalChanges, requestQuit, toast,
  importImagePath, isMarkdownPath, uploadImage, updateTitle,
} from "./app.js";
import { getPrefs, onPrefChange, $, el, basename, extname, stripExt } from "./util.js";
import { initTabs, initStatusBar, initFindBar } from "./ui-main.js";
import { initSidebar } from "./sidebar.js";
import { initAi } from "./ai.js";
import { commands, run, installKeys, refreshMenu, applyModes, setUi, setSidebar } from "./commands.js";
import { applyTheme, loadUserThemes, setSystemDark } from "./themes.js";
import { anyModalOpen, ICONS } from "./ui-base.js";
import { t, resolveLanguage, getLanguage } from "./i18n.js";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

async function start() {
  const info = await host.call("ready");
  app.info = info;
  host.call("setLanguage", { lang: getLanguage() });
  $("#docs").dataset.dropText = t("Rilascia per aprire i documenti o inserire le immagini");
  document.documentElement.style.setProperty("--ai-empty", JSON.stringify(t("La risposta comparirà qui.")));
  $("#sidebar-grip").title = t("Trascina per ridimensionare (doppio clic: larghezza iniziale)");

  await loadUserThemes();
  setSystemDark(info.systemDark);
  applyTheme();

  initTabs(run);
  const statusBar = initStatusBar(run);
  const findBar = initFindBar();
  const sidebar = initSidebar();
  initAi();
  setUi({ findBar, statusBar, sidebar });
  installKeys();
  applyModes();
  buildEmptyState();

  // menu nativo: si aggiorna quando cambia qualcosa che vi compare
  for (const ev of ["tabs", "active", "dirty", "recent", "menu", "saved", "prefs"]) on(ev, refreshMenu);
  onPrefChange((k) => { if (k === "showStatusBar" || k === "fontSize" || k === "lineWidth" || k === "lineHeight" || k === "editorFont" || k === "codeFont" || k === "codeLineNumbers" || k === "spellcheck") applyModes(); });
  on("prefs", (k) => { if (k === "theme" || k === "darkTheme" || k === "followSystem") applyTheme(); applyModes(); emit("prefs-autosave"); });

  // messaggi dal programma C
  host.on("menu", (d) => run(d.cmd));
  host.on("openFiles", (d) => openPaths(d.paths || []));
  host.on("closeRequest", () => requestQuit());
  host.on("activate", () => { checkExternalChanges(); emit("windowActivate"); });
  host.on("systemTheme", (d) => setSystemDark(d.dark));
  window.addEventListener("mdflash-refocus", () => app.active && app.active.editor && app.active.editor.focus());

  // file passati all'avvio (doppio clic su un .md) oppure la sessione precedente
  const restored = await restoreSession();
  if (info.files && info.files.length) await openPaths(info.files);
  else if (!restored) await newDoc("");
  document.body.classList.toggle("no-docs", app.docs.length === 0);

  setInterval(() => { if (document.visibilityState === "visible") checkExternalChanges(); }, 4000);
  installDragDrop();
  installPaste();
  refreshMenu();
  updateTitle();
  document.body.classList.add("ready");
}

/* ---------- pagina vuota (nessun documento aperto) ---------- */
function buildEmptyState() {
  const box = $("#empty-state");
  const render = () => {
    const recent = app.recent.slice(0, 8);
    box.replaceChildren(el("div", { class: "empty-inner" },
      el("img", { src: "icon.svg", alt: "", width: 64, height: 64, class: "empty-logo" }),
      el("h1", { text: "MDFlash" }),
      el("div", { class: "empty-actions" },
        el("button", { class: "btn primary", onclick: () => run("file.new") }, t("Nuovo documento") + " ", el("kbd", { text: "Ctrl+N" })),
        el("button", { class: "btn", onclick: () => run("file.open") }, t("Apri…") + " ", el("kbd", { text: "Ctrl+O" })),
        el("button", { class: "btn", onclick: () => run("file.openFolder") }, t("Apri cartella…") + " ", el("kbd", { text: "Ctrl+Shift+O" }))),
      recent.length ? el("div", { class: "empty-recent" },
        el("h2", { text: t("Recenti") }),
        ...recent.map((p) => el("button", { class: "recent-item", title: p, onclick: () => openPath(p) },
          el("span", { class: "tree-icon", html: ICONS.file }), el("span", { class: "name", text: stripExt(basename(p)) }), el("span", { class: "path", text: p })))) : null,
      el("div", { class: "empty-foot" },
        el("span", { text: "Elecktra Studio" }),
        el("button", { class: "foot-link", html: ICONS.github + "<span>GitHub</span>", onclick: () => host.call("openExternal", { url: "https://github.com/ShinRalexis" }) }),
        el("button", { class: "foot-link", html: ICONS.liberapay + "<span>Liberapay</span>", onclick: () => host.call("openExternal", { url: "https://liberapay.com/MetaDarko" }) }))));
  };
  on("recent", render);
  on("active", render);
  render();
}

/* ---------- trascinamento di file nella finestra ----------
 * I documenti si aprono in nuove schede; le immagini vengono copiate accanto
 * al documento e inserite dove sono state lasciate. I percorsi veri arrivano
 * dal programma C (postMessageWithAdditionalObjects). */
function installDragDrop() {
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    document.body.classList.add("dropping");
  });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
  window.addEventListener("drop", async (e) => {
    document.body.classList.remove("dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    let paths = [];
    if (host.isNative) {
      const r = await host.call("resolveFiles", {}, files);
      paths = r.paths || [];
    }
    const images = [], docs = [];
    files.forEach((f, i) => {
      const p = paths[i];
      const ext = extname(f.name);
      if (IMAGE_EXT.has(ext)) images.push({ file: f, path: p });
      else if (p) docs.push(p);
    });
    if (docs.length) await openPaths(docs);
    const d = app.active;
    if (images.length && d && d.editor) {
      // posiziona il cursore dove è caduto il file
      if (d.mode !== "source") {
        const v = d.editor.view;
        const pos = v.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos.pos))));
      }
      for (const im of images) {
        const src = im.path ? await importImagePath(d, im.path) : await uploadImage(d, im.file);
        if (src) d.editor.insertMarkdown(`![${stripExt(im.file.name)}](${src})\n`);
      }
    }
  }, true);
}

/* ---------- immagini incollate dagli appunti ---------- */
function installPaste() {
  document.addEventListener("paste", async (e) => {
    const d = app.active;
    if (!d || !d.editor || !d.host.contains(e.target)) return;
    const items = [...(e.clipboardData && e.clipboardData.items || [])];
    const imgs = items.filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!imgs.length) return;
    // se negli appunti c'è anche testo (es. una cella di Excel) vince il testo
    if (items.some((it) => it.type === "text/plain") && !items.some((it) => it.type === "text/html" && /<img/i.test(e.clipboardData.getData("text/html")))) return;
    e.preventDefault();
    e.stopPropagation();
    for (const it of imgs) {
      const file = it.getAsFile();
      if (!file) continue;
      const src = await uploadImage(d, file);
      if (src) d.editor.insertMarkdown(`![](${src})\n`);
    }
  }, true);
}

window.addEventListener("error", (e) => console.error(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error(e.reason));
document.addEventListener("contextmenu", (e) => {
  // fuori dall'editor niente menu del browser
  if (!e.target.closest(".editor-host, input, textarea, .fm-text")) e.preventDefault();
});

window.__mdflash = { app, run, commands, host, openPath, openPaths };

start().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:24px;color:#b00">${t("Errore all'avvio di MDFlash:")}\n${String(e && e.stack || e)}</pre>`;
});

export { commands, setSidebar, isMarkdownPath };
