// Esportazione (HTML, PDF, stampa, Word e formati Pandoc) e importazione.
import * as host from "./host.js";
import { app, toast, confirmBox, newDoc, slugify } from "./app.js";
import { createWysiwyg } from "./editor.js";
import { renderMermaid } from "./render.js";
import { basename, dirname, stripExt, joinPath, displayUrl, resolvePath, isAbsolute, getPrefs, escapeHtml, extname, timestampName } from "./util.js";
import { splitFrontMatter } from "./doc.js";
import { t, getLanguage } from "./i18n.js";
import katex from "katex";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, classHighlighter } from "@lezer/highlight";

/* ---------- dal documento all'HTML ---------- */

// Per un documento in modalità sorgente serve un editor nascosto che legga il Markdown.
async function withRenderer(doc, fn) {
  if (doc.mode !== "source" && doc.editor) return fn(doc.editor);
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden";
  document.body.append(box);
  const { body } = splitFrontMatter(doc.fullText());
  const ed = await createWysiwyg(box, body, {
    scroller: box, resolveImage: (u) => displayUrl(u, doc.dir), uploadImage: async () => "",
  });
  try { return await fn(ed); } finally { ed.destroy(); box.remove(); }
}

async function highlight(code, lang) {
  const desc = lang && LanguageDescription.matchLanguageName(languages, lang, true);
  if (!desc) return escapeHtml(code);
  try {
    const support = desc.support || (await desc.load());
    const tree = support.language.parser.parse(code);
    let out = "";
    highlightCode(code, tree, classHighlighter,
      (text, classes) => { out += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text); },
      () => { out += "\n"; });
    return out;
  } catch {
    return escapeHtml(code);
  }
}

// mode: "display" (immagini visibili nella finestra: PDF e stampa) oppure
// "file" (percorsi originali, per un HTML accanto al documento).
export async function renderDocHtml(doc, { mode = "file" } = {}) {
  return withRenderer(doc, async (ed) => {
    const frag = ed.renderFragment();
    const root = document.createElement("div");
    root.append(frag);

    // titoli con id, così l'indice e i collegamenti interni funzionano
    const used = new Set();
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      let id = slugify(h.textContent) || "titolo";
      let n = id, i = 1;
      while (used.has(n)) n = `${id}-${i++}`;
      used.add(n);
      h.id = n;
    });

    // immagini a sé stanti con didascalia
    root.querySelectorAll('img[data-type="image-block"]').forEach((img) => {
      const fig = document.createElement("figure");
      const im = document.createElement("img");
      im.setAttribute("src", img.getAttribute("src") || "");
      im.setAttribute("alt", img.getAttribute("alt") || img.getAttribute("caption") || "");
      const ratio = Number(img.getAttribute("ratio") || 1);
      if (ratio && Math.abs(ratio - 1) > 0.01) im.style.width = Math.round(ratio * 100) + "%";
      fig.append(im);
      const cap = img.getAttribute("caption");
      if (cap) { const fc = document.createElement("figcaption"); fc.textContent = cap; fig.append(fc); }
      img.replaceWith(fig);
    });
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (mode === "display") img.setAttribute("src", displayUrl(src, doc.dir));
    });

    // blocchi di codice: formule, diagrammi, evidenziazione della sintassi
    for (const pre of [...root.querySelectorAll("pre")]) {
      const lang = (pre.getAttribute("data-language") || "").toLowerCase();
      const code = pre.textContent;
      if (lang === "latex" || lang === "math" || lang === "tex") {
        const div = document.createElement("div");
        div.className = "math-block";
        div.innerHTML = katex.renderToString(code, { displayMode: true, throwOnError: false });
        pre.replaceWith(div);
      } else if (lang === "mermaid") {
        const div = document.createElement("div");
        div.className = "diagram";
        div.innerHTML = await renderMermaid(code);
        pre.replaceWith(div);
      } else {
        const c = document.createElement("code");
        if (lang) c.className = "language-" + lang;
        c.innerHTML = await highlight(code, lang);
        pre.replaceChildren(c);
      }
    }

    // elenchi di attività
    root.querySelectorAll('li[data-item-type="task"]').forEach((li) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      // attributi, non proprietà: devono finire nell'HTML generato
      box.setAttribute("disabled", "");
      if (li.getAttribute("data-checked") === "true") box.setAttribute("checked", "");
      li.classList.add("task");
      li.prepend(box);
    });
    // pulizia degli attributi interni dell'editor
    // HTML scritto nel Markdown: i commenti spariscono, il resto diventa HTML vero
    root.querySelectorAll('[data-type="html"]').forEach((span) => {
      const value = (span.getAttribute("data-value") ?? span.textContent).trim();
      if (/^<!--[\s\S]*-->$/.test(value)) { span.remove(); return; }
      const tpl = document.createElement("template");
      tpl.innerHTML = value;
      tpl.content.querySelectorAll("script, iframe, object, embed").forEach((n) => n.remove());
      const p = span.parentElement;
      // un blocco HTML da solo in un paragrafo prende il posto del paragrafo
      if (p && p.tagName === "P" && p.childNodes.length === 1) p.replaceWith(tpl.content);
      else span.replaceWith(tpl.content);
    });
    root.querySelectorAll("p").forEach((p) => { if (!p.childNodes.length) p.remove(); });

    // note: collegamento dal numero nel testo alla definizione e ritorno
    root.querySelectorAll("sup[data-label]").forEach((s) => {
      const l = s.getAttribute("data-label");
      s.innerHTML = `<a href="#nota-${escapeHtml(l)}" id="rif-${escapeHtml(l)}">${escapeHtml(l)}</a>`;
    });
    root.querySelectorAll("dl[data-label]").forEach((d) => { d.id = "nota-" + d.getAttribute("data-label"); });
    root.querySelectorAll("[data-type],[data-item-type],[data-list-type],[data-spread]").forEach((n) => {
      for (const a of ["data-type", "data-item-type", "data-list-type", "data-spread"]) n.removeAttribute(a);
    });
    return root.innerHTML;
  });
}

let exportCssCache = null;
async function exportCss() {
  if (!exportCssCache) exportCssCache = await (await fetch("export.css")).text();
  return exportCssCache;
}

// KaTeX con i caratteri incorporati, solo se il documento contiene formule.
let katexCssCache = null;
async function katexCss() {
  if (katexCssCache) return katexCssCache;
  let css = await (await fetch("katex.css")).text();
  const urls = [...new Set([...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1].replace(/["']/g, "")))];
  for (const u of urls) {
    try {
      const buf = await (await fetch(u)).arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      css = css.split(u).join("data:font/woff2;base64," + btoa(bin));
    } catch { /* carattere mancante: KaTeX ripiega su quelli di sistema */ }
  }
  // tolti i formati di riserva che puntano a file non inclusi
  css = css.replace(/,\s*url\([^)]+\.(woff|ttf)\)\s*format\("(woff|truetype)"\)/g, "");
  katexCssCache = css;
  return css;
}

function themeVars() {
  // Le variabili del tema attivo, così l'HTML esportato ha lo stesso aspetto
  const cs = getComputedStyle(document.documentElement);
  const names = ["--bg", "--text", "--text-soft", "--text-faint", "--border", "--accent", "--accent-weak", "--code-bg", "--code-fg",
    "--quote-border", "--quote-text", "--table-head", "--table-stripe", "--mark-bg", "--mark-fg", "--font-body", "--font-heading", "--font-code",
    "--h-color", "--link", "--syn-keyword", "--syn-string", "--syn-number", "--syn-comment", "--syn-function", "--syn-type",
    "--syn-property", "--syn-punct", "--syn-meta", "--syn-heading", "--syn-link", "--danger", "--hr"];
  return ":root{" + names.map((n) => `${n}:${cs.getPropertyValue(n).trim()}`).filter((s) => !s.endsWith(":")).join(";") + "}";
}

export async function buildStandaloneHtml(doc, { styled = true } = {}) {
  const body = await renderDocHtml(doc, { mode: "file" });
  const title = stripExt(doc.title);
  const hasMath = body.includes('class="katex');
  let css = "";
  if (styled) {
    css = themeVars() + "\n" + (await exportCss());
    if (hasMath) css += "\n" + (await katexCss());
  } else if (hasMath) {
    css = await katexCss();
  }
  return `<!DOCTYPE html>
<html lang="${getLanguage()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MDFlash">
<title>${escapeHtml(title)}</title>
${css ? `<style>\n${css}\n</style>` : ""}
</head>
<body${styled ? ' class="mdflash-export"' : ""}>
<article class="markdown-body">
${body}
</article>
</body>
</html>
`;
}

/* ---------- salvataggi ---------- */

async function askPath(doc, ext, name) {
  const r = await host.call("saveDialog", {
    title: t("Esporta come {0}", name),
    folder: doc.dir || app.folder || getPrefs().lastFolder || app.info.documents,
    name: stripExt(doc.title) + "." + ext,
    defaultExt: ext,
    filters: [{ name, ext: [ext] }],
  });
  return r.path || null;
}

function done(path) {
  toast(t("Esportato: {0}", basename(path)));
  return path;
}

export async function exportHtml(doc, styled = true) {
  const path = await askPath(doc, "html", styled ? t("Pagina HTML") : t("HTML semplice"));
  if (!path) return;
  const html = await buildStandaloneHtml(doc, { styled });
  const r = await host.call("writeFile", { path, text: html });
  if (r.error) return toast(r.error, "error");
  // le immagini relative devono restare raggiungibili: se l'HTML va in un'altra
  // cartella si usano percorsi assoluti
  if (doc.dir && dirname(path).toLowerCase() !== doc.dir.toLowerCase()) {
    const fixed = html.replace(/(<img[^>]+src=")([^"]+)"/g, (m, a, src) => {
      if (/^(https?:|data:|file:)/i.test(src)) return m;
      let s = src;
      try { s = decodeURI(src); } catch { /* lascia */ }
      const abs = isAbsolute(s) ? s : resolvePath(doc.dir, s);
      return `${a}file:///${abs.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace("%3A", ":")}"`;
    });
    await host.call("writeFile", { path, text: fixed });
  }
  done(path);
}

/* Stampa e PDF: il documento viene impaginato in #print-root e il resto
 * dell'interfaccia sparisce (regole @media print in app.css). */
async function preparePrint(doc) {
  const root = document.getElementById("print-root");
  root.innerHTML = `<article class="markdown-body">${await renderDocHtml(doc, { mode: "display" })}</article>`;
  document.body.classList.add("printing");
  await Promise.all([...root.querySelectorAll("img")].map((img) =>
    img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 4000); })));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function endPrint() {
  document.body.classList.remove("printing");
  document.getElementById("print-root").innerHTML = "";
}

const PAGES = { A4: [8.27, 11.69], A5: [5.83, 8.27], Letter: [8.5, 11], Legal: [8.5, 14] };

export async function exportPdf(doc) {
  const path = await askPath(doc, "pdf", t("Documento PDF"));
  if (!path) return;
  toast(t("Creazione del PDF…"));
  await preparePrint(doc);
  const p = getPrefs();
  const [w, h] = PAGES[p.pdfPage] || PAGES.A4;
  try {
    const r = await host.call("printPdf", { path, pageWidth: w, pageHeight: h, margin: p.pdfMargin, landscape: p.pdfLandscape });
    if (r.error) toast(r.error, "error");
    else done(path);
  } finally {
    endPrint();
  }
}

export async function printDoc(doc) {
  await preparePrint(doc);
  const after = () => { endPrint(); window.removeEventListener("afterprint", after); };
  window.addEventListener("afterprint", after);
  window.print();
  setTimeout(() => { if (document.body.classList.contains("printing")) after(); }, 60000);
}

/* ---------- Word e altri formati ---------- */
const PANDOC_FORMATS = {
  docx: { to: "docx", name: "Documento Word" },
  odt: { to: "odt", name: "Documento OpenDocument" },
  rtf: { to: "rtf", name: "Rich Text Format", extra: ["--standalone"] },
  epub: { to: "epub3", name: "Libro elettronico EPUB" },
  tex: { to: "latex", name: "Documento LaTeX", extra: ["--standalone"] },
  rst: { to: "rst", name: "reStructuredText" },
  wiki: { to: "mediawiki", name: "MediaWiki" },
};

export async function exportPandoc(doc, ext) {
  const f = PANDOC_FORMATS[ext];
  if (!app.info.pandoc) {
    if (ext === "docx") return exportDocxNative(doc);
    return pandocMissing();
  }
  const path = await askPath(doc, ext, t(f.name));
  if (!path) return;
  toast(t("Conversione con Pandoc…"));
  const extra = [...(f.extra || []), "--wrap=none"];
  if (doc.dir) extra.push("--resource-path=" + doc.dir);
  const title = stripExt(doc.title);
  if (ext === "epub" || ext === "tex") extra.push("--metadata=title:" + title);
  const r = await host.call("pandoc", {
    input: doc.fullText(), from: "markdown+mark+tex_math_dollars+pipe_tables+task_lists+footnotes+yaml_metadata_block",
    to: f.to, output: path, cwd: doc.dir || undefined, extra,
  });
  if (r.error) return toast(r.error === "nopandoc" ? t("Pandoc non trovato") : "Pandoc: " + (r.log || r.error).slice(0, 300), "error");
  done(path);
}

async function exportDocxNative(doc) {
  const path = await askPath(doc, "docx", t("Documento Word"));
  if (!path) return;
  const body = await renderDocHtml(doc, { mode: "file" });
  // immagini locali incluse nel file: si sostituisce il percorso con un segnaposto
  const images = [];
  const html = body.replace(/(<img[^>]+src=")([^"]+)"/g, (m, a, src) => {
    if (/^(https?:|data:)/i.test(src)) return m;
    let s = src;
    try { s = decodeURI(src); } catch { /* lascia */ }
    s = s.replace(/^file:\/\/\/?/i, "");
    const abs = isAbsolute(s) ? s.replace(/\//g, "\\") : doc.dir ? resolvePath(doc.dir, s) : s;
    images.push(abs);
    return `${a}file:///C:/mdflash/img${images.length - 1}"`;
  });
  const css = `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}
h1,h2,h3,h4{font-family:'Calibri Light',Calibri,sans-serif;color:#1f3864}
pre{font-family:Consolas,monospace;font-size:9.5pt;background:#f4f4f4;padding:6pt;border:1px solid #ddd}
code{font-family:Consolas,monospace;font-size:10pt;background:#f4f4f4}
blockquote{margin-left:12pt;padding-left:10pt;border-left:3pt solid #b4c6e7;color:#555}
table{border-collapse:collapse}th,td{border:1px solid #999;padding:4pt 6pt}th{background:#e7eef8}
mark{background:#fff3a3}figcaption{font-size:9pt;color:#666;text-align:center}img{max-width:16cm}`;
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(stripExt(doc.title))}</title><style>${css}</style></head><body>${html}</body></html>`;
  const r = await host.call("exportDocx", { path, html: page, images });
  if (r.error) return toast(r.error, "error");
  done(path);
  if (!app.info.pandoc) toast(t("Esportato in Word. Con Pandoc installato la conversione è ancora più fedele."));
}

async function pandocMissing() {
  const i = await confirmBox(t("Per questo formato serve Pandoc, un convertitore gratuito."),
    t("Installalo da pandoc.org e riavvia MDFlash: verrà trovato da solo."), [t("Apri pandoc.org"), t("Annulla")], { icon: "info" });
  if (i === 0) host.call("openExternal", { url: "https://pandoc.org/installing.html" });
}

/* ---------- importazione ---------- */
export async function importFile() {
  const r = await host.call("openDialog", {
    title: t("Importa documento"),
    folder: getPrefs().lastFolder || app.info.documents,
    filters: [
      { name: t("Documenti importabili"), ext: ["docx", "odt", "rtf", "html", "htm", "epub", "tex", "rst", "org", "textile", "csv"] },
      { name: t("Tutti i file"), ext: ["*"] },
    ],
  });
  const path = r.paths && r.paths[0];
  if (!path) return;
  const ext = extname(path);
  if ((ext === "html" || ext === "htm") && !app.info.pandoc) return importHtmlNative(path);
  if (ext === "csv") return importCsv(path);
  if (!app.info.pandoc) return pandocMissing();
  toast(t("Importazione con Pandoc…"));
  const media = joinPath(joinPath(app.info.dataDir, "imported"), timestampName());
  const res = await host.call("pandoc", {
    inputPath: path, to: "gfm+tex_math_dollars+footnotes", readBack: true,
    extra: ["--wrap=none", "--extract-media=" + media], cwd: dirname(path),
  });
  if (res.error) return toast(t("Importazione non riuscita: {0}", (res.log || res.error).slice(0, 300)), "error");
  const d = await newDoc(res.text || "", { title: stripExt(basename(path)) });
  d.forcedDirty = true;
  toast(t("Importato: salvalo per scegliere dove tenerlo"));
}

async function importHtmlNative(path) {
  const r = await host.call("readFile", { path });
  if (r.error) return toast(r.error, "error");
  const d = await newDoc("", { title: stripExt(basename(path)) });
  const md = d.editor.htmlToMarkdown(r.text);
  await d.replaceAll(md);
  d.forcedDirty = true;
}

// Un CSV diventa una tabella Markdown
async function importCsv(path) {
  const r = await host.call("readFile", { path });
  if (r.error) return toast(r.error, "error");
  const md = csvToTable(r.text);
  const d = await newDoc(md, { title: stripExt(basename(path)) });
  d.forcedDirty = true;
}

export function csvToTable(text) {
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const w = Math.max(...rows.map((r) => r.length));
  const fmt = (r) => "| " + Array.from({ length: w }, (_, i) => (r[i] || "").replace(/\|/g, "\\|").trim()).join(" | ") + " |";
  return [fmt(rows[0] || []), "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map(fmt)].join("\n") + "\n";
}

export { PANDOC_FORMATS };
