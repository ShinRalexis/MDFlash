// Barra laterale: Struttura (titoli), File (albero della cartella), Cerca.
import * as host from "./host.js";
import { app, on, openPath, openFolder, toast, confirmBox, isMarkdownPath, findDoc, closeDoc, emit } from "./app.js";
import { el, $, basename, dirname, joinPath, samePath, getPrefs, setPref, debounce, escapeHtml, stripExt } from "./util.js";
import { contextMenu, prompt, ICONS } from "./ui-base.js";
import { t } from "./i18n.js";

export function initSidebar() {
  const side = $("#sidebar");
  const tabs = el("div", { class: "side-tabs", role: "tablist" });
  const panels = el("div", { class: "side-panels" });
  side.append(tabs, panels);

  const defs = [
    ["outline", t("Struttura"), ICONS.outline],
    ["files", t("File"), ICONS.files],
    ["search", t("Cerca"), ICONS.search],
  ];
  const panelEls = {};
  for (const [key, label, icon] of defs) {
    const b = el("button", { class: "side-tab", role: "tab", "data-panel": key, title: label, html: icon + `<span>${label}</span>`, onclick: () => show(key) });
    tabs.append(b);
    panelEls[key] = el("div", { class: "side-panel", "data-panel": key, hidden: true });
    panels.append(panelEls[key]);
  }

  function show(key) {
    setPref("sidebarPanel", key);
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.panel === key));
    for (const [k, p] of Object.entries(panelEls)) p.hidden = k !== key;
    if (key === "files") files.refresh();
    if (key === "search") setTimeout(() => search.focus(), 0);
    if (key === "outline") outline.render();
  }

  const outline = initOutline(panelEls.outline);
  const files = initFiles(panelEls.files);
  const search = initSearch(panelEls.search);

  // larghezza regolabile trascinando il bordo
  const grip = $("#sidebar-grip");
  side.style.width = getPrefs().sidebarWidth + "px";
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = side.offsetWidth;
    document.body.classList.add("resizing");
    const move = (ev) => { side.style.width = Math.min(560, Math.max(180, startW + ev.clientX - startX)) + "px"; };
    const up = () => {
      document.body.classList.remove("resizing");
      setPref("sidebarWidth", side.offsetWidth);
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });
  grip.addEventListener("dblclick", () => { side.style.width = "260px"; setPref("sidebarWidth", 260); });

  show(getPrefs().sidebarPanel || "outline");
  return { show, files, search, outline };
}

/* ---------- struttura ---------- */
function initOutline(panel) {
  const list = el("nav", { class: "outline", "aria-label": t("Struttura del documento") });
  const empty = el("div", { class: "side-empty", text: t("I titoli del documento compariranno qui.") });
  panel.append(list, empty);
  let items = [];

  const render = () => {
    const d = app.active;
    items = d && d.editor ? d.editor.outline() : [];
    list.replaceChildren();
    empty.hidden = items.length > 0;
    list.hidden = !items.length;
    if (!items.length) return;
    const min = Math.min(...items.map((i) => i.level));
    items.forEach((it) => {
      const a = el("a", {
        class: "outline-item", href: "#", "data-pos": it.pos, title: it.text,
        style: { paddingLeft: 12 + (it.level - min) * 14 + "px" },
        onclick: (e) => { e.preventDefault(); app.active.editor.scrollToPos(it.pos); },
      }, el("span", { class: "lvl", text: "H" + it.level }), el("span", { class: "txt", text: it.text || t("(senza testo)") }));
      list.append(a);
    });
    highlight();
  };
  const highlight = () => {
    const d = app.active;
    if (!d || !d.editor || !items.length) return;
    const pos = d.editor.currentHeadingPos();
    for (const a of list.children) a.classList.toggle("current", Number(a.dataset.pos) === pos);
  };
  const renderD = debounce(render, 250);
  on("docchange", renderD);
  on("active", render);
  on("selection", debounce(highlight, 100));
  return { render };
}

/* ---------- albero dei file ---------- */
function initFiles(panel) {
  const head = el("div", { class: "files-head" });
  const title = el("button", { class: "folder-name", title: t("Apri un'altra cartella"), onclick: () => openFolder() });
  const actions = el("div", { class: "files-actions" },
    el("button", { class: "icon-btn", title: t("Nuovo file"), "aria-label": t("Nuovo file"), html: ICONS.fileNew, onclick: () => app.folder && newFileIn(app.folder) }),
    el("button", { class: "icon-btn", title: t("Nuova cartella"), "aria-label": t("Nuova cartella"), html: ICONS.folderNew, onclick: () => app.folder && newFolderIn(app.folder) }),
    el("button", { class: "icon-btn", title: t("Aggiorna"), "aria-label": t("Aggiorna"), html: ICONS.refresh, onclick: () => refresh() }));
  head.append(title, actions);
  const tree = el("div", { class: "tree", role: "tree" });
  const empty = el("div", { class: "side-empty" },
    el("p", { text: t("Apri una cartella per vedere i suoi documenti qui, come in un archivio di note.") }),
    el("button", { class: "btn", html: ICONS.folderOpen + "<span>" + t("Apri cartella…") + "</span>", onclick: () => openFolder() }));
  panel.append(head, tree, empty);
  const expanded = new Set(JSON.parse(localStorage.getItem("mdflash.expanded") || "[]"));
  const saveExpanded = () => localStorage.setItem("mdflash.expanded", JSON.stringify([...expanded].slice(-300)));
  let showAll = false;

  async function listInto(container, dir, depth) {
    const r = await host.call("listDir", { path: dir });
    container.replaceChildren();
    if (r.error) { container.append(el("div", { class: "tree-error", text: r.error })); return; }
    const entries = r.entries
      .filter((e) => !e.hidden && (e.dir || showAll || isMarkdownPath(e.name)))
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, "it", { numeric: true, sensitivity: "base" })));
    for (const e of entries) {
      const full = joinPath(dir, e.name);
      const row = el("div", {
        class: "tree-row" + (e.dir ? " dir" : " file"), role: "treeitem", tabindex: "-1",
        "data-path": full, title: full, style: { paddingLeft: 8 + depth * 14 + "px" },
      },
        el("span", { class: "twisty", html: e.dir ? ICONS.chevron : "" }),
        el("span", { class: "tree-icon", html: e.dir ? ICONS.folder : ICONS.file }),
        el("span", { class: "tree-name", text: e.dir ? e.name : (isMarkdownPath(e.name) ? stripExt(e.name) : e.name) }));
      container.append(row);
      if (e.dir) {
        const kids = el("div", { class: "tree-kids", role: "group" });
        container.append(kids);
        const toggle = async (open) => {
          row.classList.toggle("open", open);
          row.setAttribute("aria-expanded", String(open));
          if (open) { expanded.add(full.toLowerCase()); await listInto(kids, full, depth + 1); }
          else { expanded.delete(full.toLowerCase()); kids.replaceChildren(); }
          saveExpanded();
        };
        row.addEventListener("click", () => toggle(!row.classList.contains("open")));
        if (expanded.has(full.toLowerCase())) toggle(true);
      } else {
        row.addEventListener("click", () => {
          if (isMarkdownPath(e.name)) openPath(full);
          else host.call("openExternal", { url: full });
        });
      }
      row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); rowMenu(full, e.dir, ev); });
    }
    markActive();
  }

  function rowMenu(path, isDir, ev) {
    const parent = isDir ? path : dirname(path);
    contextMenu([
      ...(isDir ? [] : [{ label: t("Apri"), action: () => openPath(path) }, { label: t("Apri in una nuova finestra"), action: () => host.call("newWindow", { path }) }, "-"]),
      { label: t("Nuovo file…"), action: () => newFileIn(parent) },
      { label: t("Nuova cartella…"), action: () => newFolderIn(parent) },
      "-",
      { label: t("Rinomina…"), action: () => renameEntry(path, isDir) },
      { label: t("Duplica"), disabled: isDir, action: () => duplicate(path) },
      { label: t("Sposta nel Cestino"), danger: true, action: () => trashEntry(path, isDir) },
      "-",
      { label: t("Copia percorso"), action: () => { host.call("clipboardWrite", { text: path }); toast(t("Percorso copiato")); } },
      { label: t("Mostra in Esplora risorse"), action: () => host.call("showInFolder", { path }) },
      ...(isDir ? [{ label: t("Apri come cartella principale"), action: () => openFolder(path) }] : []),
    ], ev.clientX, ev.clientY);
  }

  async function newFileIn(dir) {
    const name = await prompt(t("Nuovo documento"), t("Nome del file"), t("Nuovo documento") + ".md", { selectStem: true });
    if (!name) return;
    const file = joinPath(dir, /\.[a-z0-9]+$/i.test(name) ? name : name + ".md");
    const st = await host.call("stat", { path: file });
    if (st.exists) return toast(t("Esiste già un file con questo nome"), "error");
    const r = await host.call("writeFile", { path: file, text: `# ${stripExt(basename(file))}\n\n` });
    if (r.error) return toast(r.error, "error");
    expanded.add(dir.toLowerCase());
    await refresh();
    openPath(file);
  }
  async function newFolderIn(dir) {
    const name = await prompt(t("Nuova cartella"), t("Nome della cartella"), t("Nuova cartella"));
    if (!name) return;
    const r = await host.call("mkdir", { path: joinPath(dir, name) });
    if (r.error) return toast(r.error, "error");
    expanded.add(dir.toLowerCase());
    refresh();
  }
  async function renameEntry(path, isDir) {
    const name = await prompt(t("Rinomina"), t("Nuovo nome"), basename(path), { selectStem: !isDir });
    if (!name || name === basename(path)) return;
    const dest = joinPath(dirname(path), name);
    const r = await host.call("rename", { path, dest });
    if (r.error) return toast(t("Impossibile rinominare: {0}", r.error), "error");
    // aggiorna le schede aperte che puntavano a quel file (o dentro quella cartella)
    for (const d of app.docs) {
      if (!d.path) continue;
      if (samePath(d.path, path)) d.path = dest;
      else if (isDir && d.path.toLowerCase().startsWith(path.toLowerCase() + "\\")) d.path = dest + d.path.slice(path.length);
    }
    emit("tabs");
    refresh();
  }
  async function duplicate(path) {
    const stem = stripExt(basename(path)), ext = basename(path).slice(stem.length);
    let dest = joinPath(dirname(path), `${stem} (${t("copia")})${ext}`);
    for (let i = 2; (await host.call("stat", { path: dest })).exists; i++) dest = joinPath(dirname(path), `${stem} (${t("copia")} ${i})${ext}`);
    const r = await host.call("copy", { path, dest });
    if (r.error) return toast(r.error, "error");
    refresh();
  }
  async function trashEntry(path, isDir) {
    const i = await confirmBox(t("Spostare \"{0}\" nel Cestino?", basename(path)), isDir ? t("Verrà spostato tutto il contenuto della cartella.") : t("Potrai recuperarlo dal Cestino di Windows."), [t("Sposta nel Cestino"), t("Annulla")]);
    if (i !== 0) return;
    const open = app.docs.filter((d) => d.path && (samePath(d.path, path) || (isDir && d.path.toLowerCase().startsWith(path.toLowerCase() + "\\"))));
    for (const d of open) await closeDoc(d, { force: !d.isDirty() });
    const r = await host.call("trash", { path });
    if (r.error) return toast(r.error, "error");
    toast(t("Spostato nel Cestino"));
    refresh();
  }

  function markActive() {
    const p = app.active && app.active.path;
    for (const r of tree.querySelectorAll(".tree-row.file")) r.classList.toggle("active", !!p && samePath(r.dataset.path, p));
  }

  async function refresh() {
    const has = !!app.folder;
    empty.hidden = has;
    head.hidden = !has;
    tree.hidden = !has;
    if (!has) return;
    title.textContent = basename(app.folder) || app.folder;
    title.title = app.folder + "\n" + t("(clic per aprire un'altra cartella)");
    const scroll = tree.scrollTop;
    await listInto(tree, app.folder, 0);
    tree.scrollTop = scroll;
  }

  tree.addEventListener("contextmenu", (ev) => {
    if (ev.target === tree && app.folder) {
      ev.preventDefault();
      contextMenu([
        { label: t("Nuovo file…"), action: () => newFileIn(app.folder) },
        { label: t("Nuova cartella…"), action: () => newFolderIn(app.folder) },
        "-",
        { label: showAll ? t("Mostra solo i documenti") : t("Mostra tutti i file"), action: () => { showAll = !showAll; refresh(); } },
        { label: t("Aggiorna"), action: () => refresh() },
        { label: t("Mostra in Esplora risorse"), action: () => host.call("showInFolder", { path: app.folder }) },
      ], ev.clientX, ev.clientY);
    }
  });

  on("folder", refresh);
  on("active", markActive);
  on("tabs", markActive);
  on("saved", (d) => { if (d.path && app.folder && d.path.toLowerCase().startsWith(app.folder.toLowerCase())) refresh(); });
  on("windowActivate", () => { if (!panel.hidden) refresh(); });
  refresh();
  return { refresh };
}

/* ---------- ricerca nella cartella ---------- */
function initSearch(panel) {
  const input = el("input", { class: "input", type: "search", placeholder: t("Cerca in tutti i documenti…"), spellcheck: "false", "aria-label": t("Cerca nei documenti") });
  const cs = el("label", { class: "check" }, el("input", { type: "checkbox" }), el("span", { text: t("Maiuscole/minuscole") }));
  const info = el("div", { class: "search-info" });
  const results = el("div", { class: "search-results" });
  const noFolder = el("div", { class: "side-empty" },
    el("p", { text: t("La ricerca guarda dentro tutti i documenti della cartella aperta.") }),
    el("button", { class: "btn", html: ICONS.folderOpen + "<span>" + t("Apri cartella…") + "</span>", onclick: () => openFolder() }));
  panel.append(el("div", { class: "search-box" }, input, cs), info, results, noFolder);
  let seq = 0;

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    results.replaceChildren();
    if (!app.folder) { info.textContent = ""; return; }
    if (q.length < 2) { info.textContent = q ? t("Scrivi almeno 2 caratteri") : ""; return; }
    info.textContent = t("Ricerca in corso…");
    const r = await host.call("search", { path: app.folder, query: q, caseSensitive: cs.querySelector("input").checked, max: 500 });
    if (my !== seq) return;
    const res = r.results || [];
    const total = res.reduce((n, f) => n + Math.max(1, f.matches.length), 0);
    info.textContent = res.length ? t("{0} risultati in {1} file", total, res.length) + (r.truncated ? " " + t("(elenco troncato)") : "") : t("Nessun risultato");
    for (const f of res) {
      const group = el("div", { class: "result-file" });
      const head = el("button", { class: "result-head", title: f.path, onclick: () => openPath(f.path) },
        el("span", { class: "tree-icon", html: ICONS.file }), el("span", { class: "name", text: stripExt(basename(f.path)) }),
        el("span", { class: "rel", text: dirname(f.rel) !== f.rel ? dirname(f.rel) : "" }),
        el("span", { class: "badge", text: String(f.matches.length || "") }));
      group.append(head);
      for (const m of f.matches) {
        const t = m.text;
        const html = (m.cut ? "…" : "") + escapeHtml(t.slice(0, m.col)) + "<mark>" + escapeHtml(t.slice(m.col, m.col + m.len)) + "</mark>" + escapeHtml(t.slice(m.col + m.len));
        group.append(el("button", {
          class: "result-line", title: t("Riga {0}", m.line),
          onclick: () => openPath(f.path, { reveal: { line: m.line, text: t.slice(m.col, m.col + m.len) } }),
        }, el("span", { class: "ln", text: String(m.line) }), el("span", { class: "snip", html })));
      }
      results.append(group);
    }
  }
  const runD = debounce(run, 300);
  input.addEventListener("input", runD);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runD.flush(); });
  cs.querySelector("input").addEventListener("change", run);
  const upd = () => { noFolder.hidden = !!app.folder; };
  on("folder", () => { upd(); if (input.value) run(); });
  upd();
  return { focus: () => { input.focus(); input.select(); }, setQuery: (q) => { input.value = q; run(); } };
}
