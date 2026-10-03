// Barra delle schede, barra di stato e barra di ricerca.
import * as host from "./host.js";
import { app, on, emit, activate, closeDoc, newDoc, moveTab, toast, updateTitle } from "./app.js";
import { el, $, textStats, getPrefs, setPref, debounce } from "./util.js";
import { contextMenu, ICONS } from "./ui-base.js";
import { t, num } from "./i18n.js";

/* =====================================================================
 *  Schede
 * ===================================================================== */
export function initTabs(run) {
  const bar = $("#tabbar");
  const list = el("div", { class: "tabs", role: "tablist" });
  const add = el("button", { class: "icon-btn tab-add", title: t("Nuovo documento") + " (Ctrl+N)", "aria-label": t("Nuovo documento"), html: ICONS.plus, onclick: () => newDoc() });
  bar.append(list, add);
  let dragIndex = -1;

  function render() {
    if (list.contains(document.activeElement) && document.activeElement.classList.contains("tab-close")) document.activeElement.blur();
    list.replaceChildren();
    app.docs.forEach((d, i) => {
      const dirty = d.isDirty();
      const tab = el("div", {
        class: "tab" + (d === app.active ? " active" : "") + (dirty ? " dirty" : ""),
        role: "tab", "aria-selected": d === app.active ? "true" : "false",
        title: d.path || d.title, draggable: "true", "data-id": d.id,
      },
        el("span", { class: "tab-title", text: d.title }),
        el("button", {
          class: "tab-close", title: t("Chiudi") + " (Ctrl+W)", "aria-label": t("Chiudi") + " " + d.title,
          onclick: (e) => { e.stopPropagation(); closeDoc(d); },
          html: `<span class="dot"></span>${ICONS.close}`,
        }));
      tab.addEventListener("mousedown", (e) => {
        // sul pulsante × non si attiva la scheda: ridisegnare la barra adesso
        // toglierebbe il pulsante prima che arrivi il clic
        if (e.target.closest(".tab-close")) return;
        if (e.button === 1) { e.preventDefault(); closeDoc(d); }
        else if (e.button === 0) activate(d);
      });
      tab.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const idx = app.docs.indexOf(d);
        contextMenu([
          { label: t("Chiudi"), accel: "Ctrl+W", action: () => closeDoc(d) },
          { label: t("Chiudi le altre"), disabled: app.docs.length < 2, action: async () => { for (const o of app.docs.filter((x) => x !== d)) if (!(await closeDoc(o))) break; } },
          { label: t("Chiudi quelle a destra"), disabled: idx === app.docs.length - 1, action: async () => { for (const o of app.docs.slice(idx + 1)) if (!(await closeDoc(o))) break; } },
          "-",
          { label: t("Copia percorso"), disabled: !d.path, action: () => { host.call("clipboardWrite", { text: d.path }); toast(t("Percorso copiato")); } },
          { label: t("Mostra in Esplora risorse"), disabled: !d.path, action: () => host.call("showInFolder", { path: d.path }) },
          { label: t("Apri in una nuova finestra"), disabled: !d.path, action: () => host.call("newWindow", { path: d.path }) },
          "-",
          { label: t("Cronologia delle versioni…"), disabled: !d.path, action: () => { activate(d); run("file.history"); } },
        ], e.clientX, e.clientY);
      });
      tab.addEventListener("dragstart", (e) => { dragIndex = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-mdflash-tab", String(i)); });
      tab.addEventListener("dragover", (e) => { if (dragIndex >= 0) { e.preventDefault(); tab.classList.add("drop"); } });
      tab.addEventListener("dragleave", () => tab.classList.remove("drop"));
      tab.addEventListener("drop", (e) => { e.preventDefault(); tab.classList.remove("drop"); if (dragIndex >= 0 && dragIndex !== i) moveTab(dragIndex, i); dragIndex = -1; });
      tab.addEventListener("dragend", () => { dragIndex = -1; });
      list.append(tab);
    });
    const act = list.querySelector(".tab.active");
    act && act.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  list.addEventListener("dblclick", (e) => { if (e.target === list) newDoc(); });
  list.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

  on("tabs", render);
  on("active", render);
  on("dirty", render);
  render();
}

/* =====================================================================
 *  Barra di stato
 * ===================================================================== */
export function initStatusBar(run) {
  const bar = $("#statusbar");
  const btnSidebar = el("button", { class: "sb-btn", title: t("Barra laterale") + " (Ctrl+Shift+L)", "aria-label": t("Barra laterale"), html: ICONS.sidebar, onclick: () => run("view.sidebar") });
  const btnSource = el("button", { class: "sb-btn", title: t("Modalità sorgente") + " (Ctrl+U)", "aria-label": t("Modalità sorgente"), html: ICONS.code, onclick: () => run("view.source") });
  const btnFocus = el("button", { class: "sb-btn", title: t("Modalità concentrazione") + " (F8)", "aria-label": t("Modalità concentrazione"), html: ICONS.focus, onclick: () => run("view.focus") });
  const msg = el("span", { class: "sb-msg" });
  const goal = el("span", { class: "sb-goal", hidden: true }, el("span", { class: "goal-bar" }, el("span", { class: "goal-fill" })), el("span", { class: "goal-text" }));
  const stats = el("button", { class: "sb-text", title: t("Statistiche del documento") });
  const enc = el("button", { class: "sb-text", title: t("Codifica e fine riga") });
  bar.append(btnSidebar, btnSource, btnFocus, msg, el("span", { class: "sb-spacer" }), goal, stats, enc);

  const update = debounce(() => {
    const d = app.active;
    if (!d || !d.editor) { stats.textContent = ""; enc.textContent = ""; goal.hidden = true; return; }
    const md = d.fullText();
    const s = textStats(md);
    let selInfo = "";
    const sel = d.editor.selectedText && d.editor.selectedText();
    if (sel) {
      const ss = textStats(sel);
      selInfo = t("{0} di ", num(ss.words));
    }
    stats.textContent = selInfo + t("{0} parole", num(s.words));
    stats.title = [t("{0} parole", num(s.words)), t("{0} caratteri ({1} senza spazi)", num(s.charsAll), num(s.chars)), t("{0} righe", num(s.lines)), t("Circa {0} min di lettura", s.minutes)].join("\n");
    const encName = { "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", ansi: "ANSI" }[d.encoding] || d.encoding;
    enc.textContent = `${encName}${d.bom && d.encoding === "utf-8" ? " BOM" : ""} · ${d.eol === "crlf" ? "CRLF" : "LF"}`;
    const g = getPrefs().wordGoal;
    goal.hidden = !g;
    if (g) {
      const pct = Math.min(100, Math.round((s.words / g) * 100));
      goal.querySelector(".goal-fill").style.width = pct + "%";
      goal.querySelector(".goal-text").textContent = t("{0}% di {1}", pct, num(g));
      goal.classList.toggle("done", pct >= 100);
    }
    btnSource.classList.toggle("on", d.mode === "source");
  }, 150);

  stats.addEventListener("click", (e) => {
    const d = app.active;
    if (!d) return;
    const s = textStats(d.fullText());
    contextMenu([
      { label: t("{0} parole", num(s.words)), disabled: true },
      { label: t("{0} caratteri", num(s.charsAll)), disabled: true },
      { label: t("{0} caratteri senza spazi", num(s.chars)), disabled: true },
      { label: t("{0} righe", num(s.lines)), disabled: true },
      { label: t("Circa {0} min di lettura", s.minutes), disabled: true },
      "-",
      { label: t("Imposta un obiettivo di parole…"), action: () => run("view.wordGoal") },
    ], e.clientX, e.clientY - 200);
  });
  enc.addEventListener("click", (e) => {
    const d = app.active;
    if (!d) return;
    const set = (k, v) => { d[k] = v; d.forcedDirty = true; d.lastDirty = true; emit("dirty", d); update(); toast(t("Verrà applicato al prossimo salvataggio")); };
    contextMenu([
      { label: "UTF-8", action: () => { set("encoding", "utf-8"); d.bom = false; } },
      { label: t("UTF-8 con BOM"), action: () => { set("encoding", "utf-8"); d.bom = true; } },
      { label: "UTF-16 LE", action: () => set("encoding", "utf-16le") },
      { label: "ANSI (Windows-1252)", action: () => set("encoding", "ansi") },
      "-",
      { label: t("Fine riga LF (Unix, consigliato)"), action: () => set("eol", "lf") },
      { label: t("Fine riga CRLF (Windows)"), action: () => set("eol", "crlf") },
    ], e.clientX, e.clientY - 230);
  });

  on("docchange", update);
  on("selection", update);
  on("active", update);
  on("saved", update);
  on("prefs", update);
  update();
  return { message(t) { msg.textContent = t; clearTimeout(msg._t); msg._t = setTimeout(() => (msg.textContent = ""), 4000); } };
}

/* =====================================================================
 *  Trova e sostituisci
 * ===================================================================== */
export function initFindBar() {
  const bar = $("#findbar");
  const input = el("input", { class: "input find-input", type: "text", placeholder: t("Trova"), spellcheck: "false", "aria-label": t("Trova") });
  const count = el("span", { class: "find-count" });
  const opt = (label, title) => el("button", { class: "find-opt", title, "aria-pressed": "false", text: label });
  const optCase = opt("Aa", t("Maiuscole/minuscole"));
  const optWord = opt("ab", t("Parola intera"));
  const optRe = opt(".*", t("Espressione regolare"));
  const prev = el("button", { class: "icon-btn", title: t("Precedente") + " (Shift+F3)", "aria-label": t("Precedente"), html: ICONS.up });
  const next = el("button", { class: "icon-btn", title: t("Successivo") + " (F3)", "aria-label": t("Successivo"), html: ICONS.down });
  const toggleRep = el("button", { class: "icon-btn", title: t("Sostituisci") + " (Ctrl+H)", "aria-label": t("Mostra sostituzione"), html: ICONS.replace });
  const close = el("button", { class: "icon-btn", title: t("Chiudi (Esc)"), "aria-label": t("Chiudi"), html: ICONS.close });
  const repInput = el("input", { class: "input find-input", type: "text", placeholder: t("Sostituisci con"), spellcheck: "false", "aria-label": t("Sostituisci con") });
  const repOne = el("button", { class: "btn small", text: t("Sostituisci") });
  const repAll = el("button", { class: "btn small", text: t("Tutti") });
  const row1 = el("div", { class: "find-row" }, input, count, optCase, optWord, optRe, prev, next, toggleRep, close);
  const row2 = el("div", { class: "find-row replace-row" }, repInput, repOne, repAll);
  bar.append(row1, row2);

  const state = { caseSensitive: false, wholeWord: false, regexp: false };
  const showCount = (r) => {
    if (!input.value) { count.textContent = ""; return; }
    count.textContent = r && r.total ? t("{0} di {1}", r.index || "?", r.total) : t("Nessun risultato");
    bar.classList.toggle("no-match", !!input.value && !(r && r.total));
  };
  const ed = () => app.active && app.active.editor;
  const apply = () => {
    if (!ed()) return;
    const r = ed().find({ search: input.value, replace: repInput.value, ...state });
    showCount(r);
  };
  const applyD = debounce(apply, 120);
  input.addEventListener("input", () => {
    applyD();
    // salta subito alla prima corrispondenza dopo il cursore
    clearTimeout(input._t);
    input._t = setTimeout(() => { if (ed() && input.value) showCount(ed().findNext()); }, 200);
  });
  repInput.addEventListener("input", applyD);
  for (const [b, k] of [[optCase, "caseSensitive"], [optWord, "wholeWord"], [optRe, "regexp"]]) {
    b.addEventListener("click", () => { state[k] = !state[k]; b.setAttribute("aria-pressed", String(state[k])); apply(); });
  }
  const goNext = () => { if (ed()) { apply(); showCount(ed().findNext()); } };
  const goPrev = () => { if (ed()) { apply(); showCount(ed().findPrev()); } };
  next.addEventListener("click", goNext);
  prev.addEventListener("click", goPrev);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });
  repInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (e.ctrlKey) repAll.click(); else repOne.click(); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });
  repOne.addEventListener("click", () => { if (ed()) { apply(); showCount(ed().replaceNext()); } });
  repAll.addEventListener("click", () => {
    if (!ed()) return;
    apply();
    const before = ed().find({ search: input.value, replace: repInput.value, ...state });
    ed().replaceAll();
    toast(before.total ? t("Sostituite {0} occorrenze", before.total) : t("Nessuna occorrenza"));
    apply();
  });
  toggleRep.addEventListener("click", () => bar.classList.toggle("with-replace"));
  close.addEventListener("click", () => hide());

  function show(withReplace) {
    bar.hidden = false;
    bar.classList.toggle("with-replace", !!withReplace);
    const sel = ed() && ed().selectedText();
    if (sel && !sel.includes("\n") && sel.length < 200) input.value = sel;
    input.focus();
    input.select();
    apply();
  }
  function hide() {
    bar.hidden = true;
    if (ed()) { ed().clearFind(); ed().focus(); }
  }
  on("active", () => { if (!bar.hidden) apply(); });
  return { show, hide, next: () => (bar.hidden ? show(false) : goNext()), prev: () => (bar.hidden ? show(false) : goPrev()), isOpen: () => !bar.hidden };
}

export { updateTitle, setPref };
