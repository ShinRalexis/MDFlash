// Finestre: apertura rapida, tavolozza dei comandi, preferenze, cronologia
// delle versioni, scorciatoie, informazioni.
import * as host from "./host.js";
import { app, openPath, toast, confirmBox, emit } from "./app.js";
import { el, basename, dirname, stripExt, getPrefs, setPref, formatDate, escapeHtml, samePath, relativePath } from "./util.js";
import { modal, ICONS } from "./ui-base.js";
import { THEMES } from "./themes.js";
import { t, LANGUAGES } from "./i18n.js";
import { changeLanguage } from "./commands.js";

/* ---------- elenco filtrabile (usato da apertura rapida e comandi) ---------- */
function fuzzyScore(text, q) {
  if (!q) return 1;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx - t.length * 0.01;
  // tutte le lettere nell'ordine giusto
  let ti = 0, score = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    score += f === ti ? 3 : 1;
    ti = f + 1;
  }
  return score;
}

function picker({ title, placeholder, load, onPick }) {
  const input = el("input", { class: "input picker-input", type: "text", placeholder, spellcheck: "false", "aria-label": placeholder });
  const list = el("div", { class: "picker-list", role: "listbox" });
  const body = el("div", { class: "picker" }, input, list);
  let items = [], shown = [], sel = 0;
  const m = modal({ title, body, width: "620px", className: "picker-modal" });

  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.map((it) => ({ it, s: fuzzyScore(it.search || it.label, q) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.it.order ?? 0) - (b.it.order ?? 0)).slice(0, 200).map((x) => x.it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => el("div", {
      class: "picker-item" + (i === sel ? " sel" : ""), role: "option", "aria-selected": String(i === sel),
      onmousedown: (e) => { e.preventDefault(); pick(it); },
    }, el("span", { class: "pi-label", text: it.label }), it.detail ? el("span", { class: "pi-detail", text: it.detail }) : null,
      it.accel ? el("kbd", { text: it.accel }) : null)));
    if (!shown.length) list.append(el("div", { class: "picker-empty", text: t("Nessun risultato") }));
    const s = list.querySelector(".sel");
    s && s.scrollIntoView({ block: "nearest" });
  };
  const pick = (it) => { m.close(); setTimeout(() => onPick(it), 0); };
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) pick(shown[sel]); }
  });
  Promise.resolve(load()).then((r) => { items = r; render(); });
  setTimeout(() => input.focus(), 0);
}

let treeCache = { folder: null, files: [], time: 0 };
export function quickOpen() {
  picker({
    title: t("Apertura rapida"),
    placeholder: t("Nome del documento…"),
    async load() {
      const out = [], seen = new Set();
      const add = (path, detail, order) => {
        const k = path.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ label: stripExt(basename(path)), detail, path, search: basename(path) + " " + path, order });
      };
      app.docs.filter((d) => d.path).forEach((d) => add(d.path, t("Aperto") + " · " + dirname(d.path), 0));
      app.recent.forEach((p, i) => add(p, t("Recente") + " · " + dirname(p), 1 + i * 0.01));
      if (app.folder) {
        if (treeCache.folder !== app.folder || Date.now() - treeCache.time > 15000) {
          const r = await host.call("listTree", { path: app.folder, max: 5000 });
          treeCache = { folder: app.folder, files: r.files || [], time: Date.now() };
        }
        treeCache.files.forEach((f) => add(f.path, f.rel, 2));
      }
      return out;
    },
    onPick: (it) => openPath(it.path),
  });
}

export function commandPalette(commands, run) {
  picker({
    title: t("Comandi"),
    placeholder: t("Cerca un comando…"),
    load: () => Object.entries(commands)
      .filter(([, c]) => c.label && !c.hidden)
      .map(([id, c]) => ({ label: (c.group ? c.group + ": " : "") + c.label, accel: c.keys && c.keys[0], id, search: (c.group || "") + " " + c.label })),
    onPick: (it) => run(it.id),
  });
}

/* ---------- preferenze ---------- */
export function preferences({ userThemes, applyTheme }) {
  const p = getPrefs();
  const field = (label, control, hint) => el("label", { class: "field" }, el("span", { text: label }), control, hint ? el("small", { text: hint }) : null);
  const check = (key, label, hint) => {
    const c = el("input", { type: "checkbox", checked: !!p[key], onchange: () => { setPref(key, c.checked); emit("prefs", key); } });
    return el("label", { class: "check field-check" }, c, el("span", {}, label, hint ? el("small", { text: hint }) : null));
  };
  const select = (key, options, onchange) => {
    const s = el("select", { class: "input", onchange: () => { const v = isNaN(Number(s.value)) || s.value === "" ? s.value : Number(s.value); setPref(key, v); emit("prefs", key); onchange && onchange(v); } },
      ...options.map(([v, l]) => el("option", { value: v, selected: String(p[key]) === String(v), text: l })));
    return s;
  };
  const number = (key, min, max, step = 1) => {
    const n = el("input", { class: "input", type: "number", min, max, step, value: p[key], onchange: () => { const v = Math.min(max, Math.max(min, Number(n.value) || min)); n.value = v; setPref(key, v); emit("prefs", key); } });
    return n;
  };
  const text = (key, placeholder) => {
    const inp = el("input", { class: "input", type: "text", value: p[key] || "", placeholder, spellcheck: "false", onchange: () => { setPref(key, inp.value.trim()); emit("prefs", key); } });
    return inp;
  };
  // la lingua si applica ricaricando l'interfaccia (i testi aperti restano)
  const langSelect = el("select", { class: "input", onchange: () => { m.close(); changeLanguage(langSelect.value); } },
    el("option", { value: "auto", selected: p.language === "auto", text: t("Automatica (lingua di Windows)") }),
    ...LANGUAGES.map((l) => el("option", { value: l.code, selected: p.language === l.code, text: l.name })));

  const themeOptions = [...THEMES.map((th) => [th.id, t(th.name)]), ...userThemes.map((ut) => ["user:" + ut.name, ut.name + " " + t("(personale)")])];
  const sections = [
    [t("Aspetto"), [
      field(t("Lingua / Language"), langSelect),
      field(t("Tema"), select("theme", themeOptions, (v) => applyTheme(v))),
      check("followSystem", t("Segui il tema chiaro/scuro di Windows"), t("Quando Windows è scuro si usa il tema scuro scelto qui sotto.")),
      field(t("Tema scuro"), select("darkTheme", THEMES.filter((th) => th.dark).map((th) => [th.id, t(th.name)]), () => applyTheme())),
      field(t("Dimensione del testo (px)"), number("fontSize", 11, 28)),
      field(t("Larghezza massima del testo (px)"), number("lineWidth", 500, 2000, 20), t("Con 2000 il testo occupa tutta la finestra.")),
      field(t("Interlinea"), number("lineHeight", 1.2, 2.4, 0.05)),
      field(t("Carattere del testo"), text("editorFont", t("predefinito del tema (es. Georgia, Segoe UI)"))),
      field(t("Carattere del codice"), text("codeFont", t("predefinito (Cascadia Code, Consolas)"))),
      check("showStatusBar", t("Mostra la barra di stato")),
      check("codeLineNumbers", t("Numeri di riga nei blocchi di codice")),
    ]],
    [t("Editor"), [
      check("spellcheck", t("Controllo ortografico"), t("Usa le lingue installate in Windows (Impostazioni > Ora e lingua).")),
      check("autosave", t("Salvataggio automatico"), t("I documenti già salvati su disco si salvano da soli dopo 2 secondi di pausa.")),
      check("restoreSession", t("Riapri i documenti dell'ultima sessione")),
      field(t("Fine riga per i nuovi documenti"), select("defaultEol", [["lf", t("LF (consigliato, compatibile ovunque)")], ["crlf", "CRLF (Windows)"]])),
      field(t("Obiettivo di parole (0 = nessuno)"), number("wordGoal", 0, 1000000, 100)),
    ]],
    [t("Immagini"), [
      field(t("Quando incolli o trascini un'immagine"), select("imageMode", [
        ["assets", t("Copiala nella cartella indicata qui sotto")],
        ["docname", t("Copiala in una cartella col nome del documento (nome.assets)")],
        ["keep", t("Lasciala dov'è e usa il suo percorso")],
        ["absolute", t("Copiala e usa percorsi assoluti")],
      ])),
      field(t("Cartella delle immagini (relativa al documento)"), text("imageFolder", "assets")),
    ]],
    [t("Versioni"), [
      check("versionsEnabled", t("Conserva una copia a ogni salvataggio"), t("Le copie stanno in {0} e si recuperano da File > Cronologia delle versioni.", "%APPDATA%\\MDFlash\\versions")),
      field(t("Copie da conservare per documento"), number("versionsKeep", 5, 500)),
    ]],
    ["PDF", [
      field(t("Formato della pagina"), select("pdfPage", [["A4", "A4"], ["A5", "A5"], ["Letter", t("Lettera (USA)")], ["Legal", t("Legale (USA)")]])),
      field(t("Margini (pollici)"), number("pdfMargin", 0, 2, 0.1)),
      check("pdfLandscape", t("Orientamento orizzontale")),
    ]],
    [t("Assistente"), [
      field(t("Indirizzo di Ollama"), text("ollamaUrl", "http://localhost:11434")),
      field(t("Modello predefinito"), text("ollamaModel", t("si sceglie anche dal pannello (Ctrl+J)"))),
      field(t("Lingua delle traduzioni"), text("aiLanguage", t("inglese"))),
    ]],
  ];
  const nav = el("nav", { class: "prefs-nav" });
  const pane = el("div", { class: "prefs-pane" });
  const show = (i) => {
    [...nav.children].forEach((b, k) => b.classList.toggle("active", k === i));
    pane.replaceChildren(el("h3", { text: sections[i][0] }), ...sections[i][1]);
  };
  sections.forEach(([name], i) => nav.append(el("button", { class: "prefs-tab", text: name, onclick: () => show(i) })));
  show(0);
  const m = modal({ title: t("Preferenze"), body: el("div", { class: "prefs" }, nav, pane), width: "760px", className: "prefs-modal" });
}

/* ---------- cronologia delle versioni ---------- */
// Differenze riga per riga (LCS), sufficienti per testi di qualche migliaio di righe.
function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 4_000_000) return null;
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push([" ", A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["-", A[i++]]);
    else out.push(["+", B[j++]]);
  }
  while (i < n) out.push(["-", A[i++]]);
  while (j < m) out.push(["+", B[j++]]);
  return out;
}

export async function versionHistory(doc) {
  if (!doc || !doc.path) return toast(t("Salva il documento per avere la cronologia delle versioni"));
  const r = await host.call("listSnapshots", { path: doc.path });
  const versions = r.versions || [];
  const list = el("div", { class: "hist-list" });
  const view = el("div", { class: "hist-view" });
  const info = el("div", { class: "hist-info" });
  let current = null;
  const body = el("div", { class: "history" }, list, el("div", { class: "hist-right" }, info, view));
  const m = modal({
    title: t("Cronologia delle versioni") + ": " + doc.title, body, width: "min(1100px, 94vw)", className: "history-modal",
    buttons: [
      { label: t("Chiudi"), value: null },
      { label: t("Copia il testo"), action: () => { if (current) { host.call("clipboardWrite", { text: current }); toast(t("Testo copiato")); } return false; } },
      { label: t("Ripristina questa versione"), primary: true, action: () => { if (!current) return false; restore(); } },
    ],
  });
  async function restore() {
    const i = await confirmBox(t("Ripristinare questa versione?"), t("Il testo attuale verrà sostituito; potrai annullare con Ctrl+Z o tornare indietro dalla cronologia."), [t("Ripristina"), t("Annulla")], { icon: "info" });
    if (i !== 0) return;
    await doc.replaceAll(current);
    doc.forcedDirty = true;
    emit("dirty", doc);
    emit("docchange", doc);
    toast(t("Versione ripristinata: salva per confermarla"));
  }
  if (!versions.length) {
    list.append(el("div", { class: "side-empty", text: t("Nessuna versione salvata finora. Le copie si creano a ogni salvataggio.") }));
    return;
  }
  const nowText = doc.fullText();
  versions.forEach((v, i) => {
    const b = el("button", { class: "hist-item", onclick: () => select(v, b) },
      el("span", { class: "when", text: formatDate(v.mtime) }),
      el("span", { class: "size", text: i === 0 ? t("ultima salvata") : `${Math.max(1, Math.round((v.size || 0) / 1024))} KB` }));
    list.append(b);
  });
  async function select(v, b) {
    for (const x of list.children) x.classList.toggle("active", x === b);
    const fr = await host.call("readFile", { path: v.path });
    current = fr.text || "";
    const diff = lineDiff(current, nowText);
    view.replaceChildren();
    if (!diff) { view.append(el("pre", { class: "hist-plain", text: current })); info.textContent = t("Testo della versione"); return; }
    let add = 0, del = 0;
    const frag = document.createDocumentFragment();
    for (const [k, line] of diff) {
      if (k === "+") add++; else if (k === "-") del++;
      frag.append(el("div", { class: "dl " + (k === "+" ? "add" : k === "-" ? "del" : "same") }, el("span", { class: "sig", text: k === " " ? "" : k }), el("span", { text: line || " " })));
    }
    view.append(frag);
    info.innerHTML = add || del
      ? `${escapeHtml(t("Rispetto al testo attuale:"))} <span class="del">${escapeHtml(t("{0} righe solo in questa versione", del))}</span> · <span class="add">${escapeHtml(t("{0} righe aggiunte dopo", add))}</span>`
      : escapeHtml(t("Identica al testo attuale"));
    const first = view.querySelector(".add,.del");
    first && first.scrollIntoView({ block: "center" });
  }
  select(versions[0], list.children[0]);
  return m;
}

/* ---------- informazioni e scorciatoie ---------- */
export function about() {
  const body = el("div", { class: "about" },
    el("div", { class: "about-logo", html: `<img src="icon.svg" alt="" width="72" height="72">` }),
    el("h3", { text: "MDFlash " + (app.info.version || "") }),
    el("p", { text: t("Editor Markdown per Windows: si scrive e si vede subito il risultato, senza simboli in mezzo.") }),
    el("p", { class: "author" }, "© 2026 Elecktra Studio · " + t("Autore:") + " ShinRalexis"),
    el("div", { class: "about-links" },
      el("button", { class: "btn link-github", html: ICONS.github + "<span>GitHub</span>", title: "https://github.com/ShinRalexis", onclick: () => host.call("openExternal", { url: "https://github.com/ShinRalexis" }) }),
      el("button", { class: "btn link-liberapay", html: ICONS.liberapay + "<span>Liberapay</span>", title: "https://liberapay.com/MetaDarko", onclick: () => host.call("openExternal", { url: "https://liberapay.com/MetaDarko" }) })),
    el("p", { class: "muted small", text: t("Se MDFlash ti è utile, puoi sostenerne lo sviluppo su Liberapay.") }),
    el("p", { class: "muted", text: t("Programma in C (Win32) con il motore WebView2 di Microsoft Edge. Editor basato su Milkdown e CodeMirror; formule con KaTeX; diagrammi con Mermaid.") }),
    el("p", { class: "muted", text: app.info.pandoc ? t("Pandoc trovato: {0}", app.info.pandoc) : t("Pandoc non installato (serve solo per ODT, EPUB, LaTeX e importazioni).") }),
    el("p", { class: "muted", text: t("Licenza MIT.") }));
  modal({ title: t("Informazioni"), body, width: "480px", buttons: [{ label: t("Chiudi"), value: null }] });
}

export function shortcuts(commands) {
  const groups = {};
  for (const c of Object.values(commands)) {
    if (!c.keys || !c.label || c.hidden) continue;
    (groups[c.group || t("Generale")] ||= []).push(c);
  }
  const body = el("div", { class: "shortcuts" }, ...Object.entries(groups).map(([g, cs]) => el("section", {},
    el("h4", { text: g }),
    el("table", {}, ...cs.map((c) => el("tr", {}, el("td", { text: c.label }), el("td", {}, ...c.keys.slice(0, 1).map((k) => el("kbd", { text: k })))))))));
  modal({ title: t("Scorciatoie da tastiera"), body, width: "min(900px, 94vw)", className: "shortcuts-modal" });
}

export function tableDialog(run) {
  const rows = el("input", { class: "input", type: "number", min: 1, max: 100, value: 3 });
  const cols = el("input", { class: "input", type: "number", min: 1, max: 30, value: 3 });
  const body = el("div", { class: "grid2" },
    el("label", { class: "field" }, el("span", { text: t("Righe (senza intestazione)") }), rows),
    el("label", { class: "field" }, el("span", { text: t("Colonne") }), cols));
  const go = () => run("insert.table", { rows: Number(rows.value) + 1, cols: Number(cols.value) });
  const m = modal({ title: t("Inserisci tabella"), body, width: "380px", buttons: [{ label: t("Annulla"), value: null }, { label: t("Inserisci"), primary: true, action: go }] });
  body.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); m.close(); } });
}

export { escapeHtml, samePath, relativePath, ICONS };
