// Stato dell'applicazione: schede aperte, file, salvataggio, sessione.
import * as host from "./host.js";
import { Doc } from "./doc.js";
import { t } from "./i18n.js";
import {
  basename, dirname, extname, joinPath, samePath, stripExt, relativePath, resolvePath, isAbsolute,
  displayUrl, getPrefs, setPref, loadJSON, saveJSON, debounce, timestampName, el,
} from "./util.js";

export const app = {
  docs: [],
  active: null,
  info: {},
  folder: null,
  recent: loadJSON("mdflash.recent", []),
  closedTabs: [],
  listeners: new Map(),
};

export function on(ev, fn) {
  if (!app.listeners.has(ev)) app.listeners.set(ev, new Set());
  app.listeners.get(ev).add(fn);
}
export function emit(ev, ...args) {
  const s = app.listeners.get(ev);
  if (s) for (const fn of s) { try { fn(...args); } catch (e) { console.error(e); } }
}

/* ---------- avvisi ---------- */
let toastTimer;
export function toast(msg, kind = "") {
  const box = document.getElementById("toast");
  box.textContent = msg;
  box.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = "toast"), kind === "error" ? 5000 : 2600);
}

export async function confirmBox(text, detail, buttons, opts = {}) {
  const r = await host.call("confirm", {
    title: "MDFlash", text, detail: detail || "", buttons,
    icon: opts.icon || "warning", defaultIndex: opts.defaultIndex || 0,
    cancelIndex: opts.cancelIndex ?? buttons.length - 1,
  });
  return r.index;
}

/* ---------- opzioni comuni passate a ogni documento ---------- */
const docOpts = {
  onChange(doc) { scheduleDirtyCheck(doc); emit("docchange", doc); },
  onSelection(doc) { emit("selection", doc); },
  toast,
  openLink,
  openWikiLink: (doc, raw) => openWikiLink(doc, raw),
  resolveImage(doc, url) { return displayUrl(url, doc.dir); },
  uploadImage,
};

const dirtyChecks = new Map();
function scheduleDirtyCheck(doc) {
  clearTimeout(dirtyChecks.get(doc.id));
  dirtyChecks.set(doc.id, setTimeout(() => {
    const d = doc.isDirty();
    if (d !== doc.lastDirty) {
      doc.lastDirty = d;
      emit("dirty", doc);
    }
    if (d) { scheduleRecovery(); scheduleAutosave(); }
  }, 120));
}

/* ---------- schede ---------- */
export function findDoc(path) {
  return app.docs.find((d) => samePath(d.path, path));
}

async function addDoc(doc, { activate = true, mode } = {}) {
  app.docs.push(doc);
  document.getElementById("docs").append(doc.el);
  if (mode) doc.mode = mode;
  await doc.mount(docOpts);
  emit("tabs");
  if (activate) activate_(doc);
  saveSession();
  return doc;
}

function activate_(doc) {
  if (app.active && app.active !== doc) {
    app.active.scrollTop = app.active.scroller.scrollTop;
    app.active.el.classList.remove("active");
  }
  app.active = doc;
  doc.el.classList.add("active");
  requestAnimationFrame(() => {
    if (doc.scrollTop) doc.scroller.scrollTop = doc.scrollTop;
    doc.editor && doc.editor.focus();
  });
  document.body.classList.toggle("no-docs", false);
  emit("active", doc);
  updateTitle();
  saveSession();
}
export const activate = activate_;

export function updateTitle() {
  const d = app.active;
  const title = d ? `${d.isDirty() ? "● " : ""}${d.title} - MDFlash` : "MDFlash";
  host.call("setTitle", { title });
}
on("dirty", (d) => { if (d === app.active) updateTitle(); });

export async function newDoc(text = "", opts = {}) {
  // un documento con contenuto (guida, importazione) prende il posto di quello vuoto e intatto
  const blank = text && app.active && !app.active.path && !app.active.isDirty() && !app.active.fullText().trim() ? app.active : null;
  const doc = await addDoc(new Doc({ text, title: opts.title }), opts);
  if (blank) closeDoc(blank, { force: true });
  return doc;
}

const MD_EXT = new Set(["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt", "text"]);
export const isMarkdownPath = (p) => MD_EXT.has(extname(p));

export async function openPath(path, { activate = true, reveal } = {}) {
  const existing = findDoc(path);
  if (existing) {
    if (activate) activate_(existing);
    if (reveal) revealIn(existing, reveal);
    return existing;
  }
  const r = await host.call("readFile", { path });
  if (r.error) {
    toast(t("Impossibile aprire {0}: {1}", basename(path), r.error), "error");
    removeRecent(path);
    return null;
  }
  // Un documento vuoto e intatto lasciato aperto viene sostituito
  const blank = app.active && !app.active.path && !app.active.isDirty() && !app.active.fullText().trim() ? app.active : null;
  const doc = new Doc({ path, text: r.text, encoding: r.encoding, bom: r.bom, eol: r.eol, mtime: r.mtime });
  const big = r.text.length > 1500000;
  await addDoc(doc, { activate, mode: big ? "source" : undefined });
  if (big) toast(t("File molto grande: aperto in modalità sorgente"));
  if (blank) closeDoc(blank, { force: true });
  addRecent(path);
  if (reveal) revealIn(doc, reveal);
  return doc;
}

function revealIn(doc, reveal) {
  setTimeout(() => {
    if (reveal.line && doc.mode === "source" && doc.editor.revealLine) doc.editor.revealLine(reveal.line);
    else if (reveal.text) doc.editor.revealText(reveal.text);
  }, 60);
}

export async function openPaths(paths) {
  let last = null;
  for (const p of paths) {
    const st = await host.call("stat", { path: p });
    if (st.exists && st.dir) { openFolder(p); continue; }
    if (!st.exists) { toast(t("File non trovato: {0}", p), "error"); continue; }
    last = (await openPath(p, { activate: false })) || last;
  }
  if (last) activate_(last);
}

export async function openDialog() {
  const r = await host.call("openDialog", {
    title: t("Apri documento"),
    folder: app.active && app.active.dir || app.folder || getPrefs().lastFolder || app.info.documents,
    multi: true,
    filters: [
      { name: t("Documenti Markdown"), ext: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"] },
      { name: t("Testo"), ext: ["txt"] },
      { name: t("Tutti i file"), ext: ["*"] },
    ],
  });
  if (r.paths && r.paths.length) {
    setPref("lastFolder", dirname(r.paths[0]));
    await openPaths(r.paths);
  }
}

export async function closeDoc(doc = app.active, { force = false } = {}) {
  if (!doc) return true;
  if (!force && doc.isDirty()) {
    activate_(doc);
    const i = await confirmBox(t("Salvare le modifiche a \"{0}\"?", doc.title),
      t("Se non le salvi andranno perse."), [t("Salva"), t("Non salvare"), t("Annulla")]);
    if (i === 2) return false;
    if (i === 0 && !(await saveDoc(doc))) return false;
  }
  const idx = app.docs.indexOf(doc);
  if (doc.path) app.closedTabs.push(doc.path);
  app.docs.splice(idx, 1);
  doc.destroy();
  if (app.active === doc) {
    app.active = null;
    const next = app.docs[Math.min(idx, app.docs.length - 1)];
    if (next) activate_(next);
    else {
      document.body.classList.add("no-docs");
      emit("active", null);
      updateTitle();
    }
  }
  emit("tabs");
  saveSession();
  return true;
}

export async function reopenClosed() {
  const p = app.closedTabs.pop();
  if (p) await openPath(p);
}

export function moveTab(from, to) {
  const [d] = app.docs.splice(from, 1);
  app.docs.splice(to, 0, d);
  emit("tabs");
  saveSession();
}

export function cycleTab(dir) {
  if (app.docs.length < 2) return;
  const i = app.docs.indexOf(app.active);
  activate_(app.docs[(i + dir + app.docs.length) % app.docs.length]);
}

/* ---------- salvataggio ---------- */
export async function saveDoc(doc = app.active, { as = false } = {}) {
  if (!doc) return false;
  let path = doc.path;
  if (!path || as) {
    const r = await host.call("saveDialog", {
      title: as ? t("Salva con nome") : t("Salva documento"),
      folder: doc.dir || app.folder || getPrefs().lastFolder || app.info.documents,
      name: doc.path ? basename(doc.path) : suggestName(doc) + ".md",
      defaultExt: "md",
      filters: [{ name: t("Documento Markdown"), ext: ["md"] }, { name: t("Testo"), ext: ["txt"] }, { name: t("Tutti i file"), ext: ["*"] }],
    });
    if (!r.path) return false;
    path = r.path;
    setPref("lastFolder", dirname(path));
  }
  if (!as && doc.path && !doc.isDirty()) return true; // niente da scrivere: il file resta identico

  // Immagini incollate quando il documento non aveva ancora una cartella
  if (!doc.path || !samePath(dirname(path), doc.dir)) await relocateImages(doc, path);

  const text = doc.fullText();
  const r = await host.call("writeFile", { path, text, encoding: doc.encoding, bom: doc.bom, eol: doc.eol });
  if (r.error) {
    toast(t("Salvataggio non riuscito: {0}", r.error), "error");
    return false;
  }
  const renamed = !samePath(path, doc.path);
  doc.path = path;
  doc.mtime = r.mtime;
  doc.markClean();
  emit("dirty", doc);
  if (renamed) emit("tabs");
  updateTitle();
  addRecent(path);
  saveSession();
  if (getPrefs().versionsEnabled) host.call("snapshot", { path, text, keep: getPrefs().versionsKeep });
  emit("saved", doc);
  return true;
}

function suggestName(doc) {
  // Primo titolo del documento, ripulito per diventare un nome di file
  const h = doc.editor && doc.editor.outline()[0];
  const base = (h && h.text) || doc.title;
  return base.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || t("Senza titolo");
}

export async function saveAll() {
  for (const d of app.docs) if (d.isDirty()) {
    if (!(await saveDoc(d))) return false;
  }
  return true;
}

const scheduleAutosave = debounce(async () => {
  if (!getPrefs().autosave) return;
  for (const d of app.docs) if (d.path && d.isDirty()) await saveDoc(d);
}, 2000);
on("prefs-autosave", () => scheduleAutosave());

export async function renameActive(newName) {
  const d = app.active;
  if (!d || !d.path) return;
  const dest = joinPath(d.dir, newName);
  const r = await host.call("rename", { path: d.path, dest });
  if (r.error) return toast(t("Impossibile rinominare: {0}", r.error), "error");
  d.path = dest;
  emit("tabs");
  updateTitle();
  saveSession();
}

/* ---------- immagini ---------- */
function imageDir(doc) {
  const p = getPrefs();
  if (!doc.path) return joinPath(app.info.dataDir || "C:\\", "immagini-non-salvate");
  if (p.imageMode === "docname") return joinPath(doc.dir, stripExt(basename(doc.path)) + ".assets");
  return joinPath(doc.dir, p.imageFolder || "assets");
}

function srcFor(doc, abs) {
  if (!doc.path || getPrefs().imageMode === "absolute") return abs.replace(/\\/g, "/");
  return relativePath(doc.dir, abs).split("/").map((s) => (s === ".." ? s : encodeURI(s))).join("/");
}

async function uniquePath(dir, name) {
  let candidate = joinPath(dir, name);
  const stem = stripExt(name), ext = name.slice(stem.length);
  for (let i = 1; i < 500; i++) {
    const st = await host.call("stat", { path: candidate });
    if (!st.exists) return candidate;
    candidate = joinPath(dir, `${stem}-${i}${ext}`);
  }
  return candidate;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Riceve un File (incollato o scelto) e restituisce il src da scrivere nel Markdown.
export async function uploadImage(doc, file) {
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  const name = file.name && file.name !== "image.png" ? file.name.replace(/[\\/:*?"<>|]+/g, "_") : `immagine-${timestampName()}.${ext}`;
  const dir = imageDir(doc);
  const dest = await uniquePath(dir, name);
  const data = await fileToBase64(file);
  const r = await host.call("writeBinary", { path: dest, data });
  if (r.error) { toast(t("Immagine non salvata: {0}", r.error), "error"); return ""; }
  return srcFor(doc, dest);
}

// Immagine già su disco (trascinata da Esplora risorse)
export async function importImagePath(doc, srcPath) {
  if (getPrefs().imageMode === "keep" && doc.path) return srcFor(doc, srcPath);
  const dest = await uniquePath(imageDir(doc), basename(srcPath));
  const r = await host.call("copy", { path: srcPath, dest });
  if (r.error) { toast(t("Immagine non copiata: {0}", r.error), "error"); return ""; }
  return srcFor(doc, dest);
}

// Al primo salvataggio, le immagini incollate in un documento senza nome
// vengono spostate accanto al file e i percorsi diventano relativi.
async function relocateImages(doc, newPath) {
  const text = doc.fullText();
  const tmpDir = joinPath(app.info.dataDir || "C:\\", "immagini-non-salvate").replace(/\\/g, "/");
  if (!text.includes(tmpDir) && doc.path === null) return;
  const re = /!\[([^\]]*)\]\(<?([^)\s>]+)>?(\s+"[^"]*")?\)/g;
  const oldDir = doc.dir;
  const newDir = dirname(newPath);
  const p = getPrefs();
  const targetDir = p.imageMode === "docname" ? joinPath(newDir, stripExt(basename(newPath)) + ".assets") : joinPath(newDir, p.imageFolder || "assets");
  let changed = false;
  const replacements = [];
  for (const m of text.matchAll(re)) {
    let src = m[2];
    if (/^(https?:|data:)/i.test(src)) continue;
    let abs;
    try { abs = decodeURI(src); } catch { abs = src; }
    abs = isAbsolute(abs) ? abs.replace(/\//g, "\\") : oldDir ? resolvePath(oldDir, abs) : null;
    if (!abs) continue;
    let finalAbs = abs;
    if (abs.replace(/\\/g, "/").toLowerCase().startsWith(tmpDir.toLowerCase())) {
      const dest = await uniquePath(targetDir, basename(abs));
      const r = await host.call("rename", { path: abs, dest });
      if (!r.error) finalAbs = dest;
    }
    const newSrc = relativePath(newDir, finalAbs).split("/").map((s) => (s === ".." ? s : encodeURI(s))).join("/");
    if (newSrc !== src) { replacements.push([m[0], m[0].replace(m[2], newSrc)]); changed = true; }
  }
  if (changed) {
    let t = text;
    for (const [a, b] of replacements) t = t.split(a).join(b);
    await doc.replaceAll(t);
  }
}

/* ---------- collegamenti ---------- */
export async function openLink(doc, href) {
  if (!href) return;
  if (href.startsWith("#")) {
    const target = decodeURIComponent(href.slice(1)).toLowerCase();
    const h = doc.editor.outline().find((o) => slugify(o.text) === target || o.text.toLowerCase() === target);
    if (h) doc.editor.scrollToPos(h.pos);
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href) && !/^file:/i.test(href)) {
    host.call("openExternal", { url: href });
    return;
  }
  let p = href.replace(/^file:\/\/\/?/i, "");
  const hash = p.indexOf("#");
  if (hash >= 0) p = p.slice(0, hash);
  try { p = decodeURI(p); } catch { /* lascia */ }
  const abs = isAbsolute(p) ? p.replace(/\//g, "\\") : doc.dir ? resolvePath(doc.dir, p) : p;
  if (isMarkdownPath(abs) || !extname(abs)) {
    const target = extname(abs) ? abs : abs + ".md";
    const st = await host.call("stat", { path: target });
    if (st.exists) return openPath(target);
    const i = await confirmBox(t("Il documento \"{0}\" non esiste.", basename(target)), t("Vuoi crearlo?"), [t("Crea"), t("Annulla")], { icon: "info" });
    if (i === 0) {
      await host.call("writeFile", { path: target, text: `# ${stripExt(basename(target))}\n\n` });
      openPath(target);
    }
    return;
  }
  host.call("openExternal", { url: abs });
}

// [[Nota]], [[Nota|testo]] o [[Nota#Titolo]]: si cerca Nota.md accanto al
// documento e poi in tutta la cartella aperta; se manca si propone di crearla.
export async function openWikiLink(doc, raw) {
  const target = raw.split("|")[0].split("#")[0].trim();
  if (!target) return;
  const name = /\.[a-z0-9]{1,8}$/i.test(target) ? target : target + ".md";
  const wanted = basename(name.replace(/\//g, "\\")).toLowerCase();
  if (doc.dir) {
    const p = resolvePath(doc.dir, name.replace(/\//g, "\\"));
    if ((await host.call("stat", { path: p })).exists) return openPath(p);
  }
  for (const root of [app.folder, doc.dir].filter(Boolean)) {
    const r = await host.call("listTree", { path: root, max: 20000 });
    const hit = (r.files || []).find((f) => basename(f.path).toLowerCase() === wanted);
    if (hit) return openPath(hit.path);
  }
  const dir = doc.dir || app.folder;
  if (!dir) return toast(t("Nota \"{0}\" non trovata: salva prima il documento", target));
  const i = await confirmBox(t("La nota \"{0}\" non esiste.", target), t("Vuoi crearla accanto a questo documento?"), [t("Crea"), t("Annulla")], { icon: "info" });
  if (i !== 0) return;
  const p = joinPath(dir, basename(name.replace(/\//g, "\\")));
  await host.call("writeFile", { path: p, text: `# ${stripExt(basename(p))}\n\n` });
  openPath(p);
}

export const slugify = (t) => t.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");

/* ---------- file recenti ---------- */
export function addRecent(path) {
  app.recent = [path, ...app.recent.filter((p) => !samePath(p, path))].slice(0, 20);
  saveJSON("mdflash.recent", app.recent);
  host.call("addRecentDoc", { path });
  emit("recent");
}
export function removeRecent(path) {
  app.recent = app.recent.filter((p) => !samePath(p, path));
  saveJSON("mdflash.recent", app.recent);
  emit("recent");
}
export function clearRecent() {
  app.recent = [];
  saveJSON("mdflash.recent", app.recent);
  emit("recent");
}

/* ---------- cartella di lavoro ---------- */
export async function openFolder(path) {
  if (!path) {
    const r = await host.call("folderDialog", { title: t("Apri cartella"), folder: app.folder || getPrefs().lastFolder || app.info.documents });
    if (!r.path) return;
    path = r.path;
  }
  app.folder = path;
  setPref("lastFolder", path);
  emit("folder", path);
  saveSession();
}

/* ---------- sessione e recupero ----------
 * Le schede aperte si ripresentano al riavvio; il testo non salvato (anche dei
 * documenti senza nome) viene copiato ogni pochi secondi, così un blocco o
 * uno spegnimento improvviso non lo fanno perdere. */
const SESSION_KEY = "mdflash.session.v2";

export const saveSession = debounce(() => {
  if (app.info.secondary) return; // le finestre aggiuntive non toccano la sessione principale
  const tabs = app.docs.map((d) => {
    const t = { path: d.path, mode: d.mode, title: d.customTitle };
    if (d.isDirty() || !d.path) {
      const text = d.fullText();
      if (text.length < 2_000_000 && (d.path || text.trim())) { t.text = text; t.dirty = d.isDirty(); }
    }
    return t;
  }).filter((t) => t.path || t.text);
  saveJSON(SESSION_KEY, { tabs, active: app.docs.indexOf(app.active), folder: app.folder, time: Date.now() });
}, 800);

const scheduleRecovery = debounce(() => saveSession.flush(), 3000);

export async function restoreSession() {
  if (app.info.secondary) return false;
  const s = loadJSON(SESSION_KEY, null);
  if (!s || !s.tabs) return false;
  const restore = getPrefs().restoreSession;
  let recovered = 0;
  for (const t of s.tabs) {
    if (!restore && !t.dirty && !(t.text && !t.path)) continue;
    if (t.path) {
      const doc = await openPath(t.path, { activate: false });
      if (doc && t.text && t.dirty && t.text !== doc.fullText()) {
        await doc.replaceAll(t.text);
        doc.forcedDirty = true;
        doc.lastDirty = true;
        emit("dirty", doc);
        recovered++;
      }
      if (doc && t.mode === "source" && doc.mode !== "source") await doc.setMode("source");
    } else if (t.text) {
      const doc = await newDoc(t.text, { activate: false, title: t.title });
      if (t.dirty !== false) { doc.forcedDirty = true; doc.lastDirty = true; emit("dirty", doc); }
      recovered++;
    }
  }
  if (restore && s.folder) openFolder(s.folder);
  const act = app.docs[s.active] || app.docs[app.docs.length - 1];
  if (act) activate_(act);
  if (recovered) toast(recovered === 1 ? t("Recuperato 1 documento non salvato") : t("Recuperati {0} documenti non salvati", recovered));
  return app.docs.length > 0;
}

/* ---------- modifiche fatte da altri programmi ---------- */
let checking = false;
export async function checkExternalChanges() {
  if (checking) return;
  const docs = app.docs.filter((d) => d.path);
  if (!docs.length) return;
  checking = true;
  try {
    const r = await host.call("statMany", { paths: docs.map((d) => d.path) });
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i], st = r.stats[i];
      if (!st || !st.exists) {
        if (!d.missingWarned) { d.missingWarned = true; toast(t("\"{0}\" non esiste più sul disco", d.title), "error"); }
        continue;
      }
      d.missingWarned = false;
      if (!st.mtime || !d.mtime || Math.abs(st.mtime - d.mtime) < 2) continue;
      const fr = await host.call("readFile", { path: d.path });
      if (fr.error) continue;
      d.mtime = fr.mtime;
      if (fr.text === d.fullText()) continue;
      if (d.isDirty()) {
        const i2 = await confirmBox(t("\"{0}\" è stato modificato da un altro programma.", d.title),
          t("Ricaricarlo? Le modifiche fatte qui andranno perse."), [t("Ricarica"), t("Tieni le mie modifiche")], { defaultIndex: 1 });
        if (i2 !== 0) continue;
      }
      const top = d.scroller.scrollTop;
      await d.replaceAll(fr.text, { clean: true });
      d.encoding = fr.encoding; d.bom = fr.bom; d.eol = fr.eol;
      d.scroller.scrollTop = top;
      emit("dirty", d);
      emit("docchange", d);
      toast(t("Ricaricato \"{0}\" (modificato fuori da MDFlash)", d.title));
    }
  } finally {
    checking = false;
  }
}

/* ---------- chiusura dell'applicazione ---------- */
export async function requestQuit() {
  const dirty = app.docs.filter((d) => d.isDirty());
  if (dirty.length > 1) {
    const i = await confirmBox(t("Ci sono {0} documenti con modifiche non salvate.", dirty.length),
      dirty.map((d) => "• " + d.title).join("\n"), [t("Salva tutto"), t("Esci senza salvare"), t("Annulla")]);
    if (i === 2) return host.call("closeCanceled");
    if (i === 0 && !(await saveAll())) return host.call("closeCanceled");
  } else if (dirty.length === 1) {
    const d = dirty[0];
    activate_(d);
    const i = await confirmBox(t("Salvare le modifiche a \"{0}\"?", d.title), t("Se non le salvi andranno perse."), [t("Salva"), t("Non salvare"), t("Annulla")]);
    if (i === 2) return host.call("closeCanceled");
    if (i === 0 && !(await saveDoc(d))) return host.call("closeCanceled");
  }
  // Uscita volontaria: i testi scartati non vanno "recuperati" al riavvio
  for (const d of app.docs) if (d.isDirty()) { d.markClean(); }
  saveSession.cancel();
  const tabs = app.docs.filter((d) => d.path).map((d) => ({ path: d.path, mode: d.mode }));
  if (!app.info.secondary) saveJSON(SESSION_KEY, { tabs, active: Math.max(0, app.docs.filter((d) => d.path).indexOf(app.active)), folder: app.folder, time: Date.now() });
  host.call("quit");
}

export { el };
