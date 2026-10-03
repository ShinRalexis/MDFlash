// Aspetto dei blocchi di codice (colori presi dalle variabili del tema) e
// disegno dei diagrammi Mermaid, caricato solo quando serve (è grande 3 MB).
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const codeTheme = [
  EditorView.theme({
    "&": { color: "var(--code-fg)", backgroundColor: "transparent" },
    ".cm-content": { caretColor: "var(--accent)", fontFamily: "var(--font-code)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-faint)", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-soft)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--bg-soft)", border: "none", color: "var(--text-soft)" },
    ".cm-tooltip": { backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent-weak)", color: "var(--text)" },
    ".cm-matchingBracket": { backgroundColor: "var(--accent-weak)", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "var(--search-hit)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--search-current)" },
  }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "var(--syn-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "var(--syn-function)" },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--syn-type)" },
    { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "var(--code-fg)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--syn-punct)" },
    { tag: [t.meta, t.processingInstruction], color: "var(--syn-meta)" },
    { tag: t.heading, color: "var(--syn-heading)", fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--syn-link)" },
    { tag: t.quote, color: "var(--syn-comment)" },
    { tag: t.monospace, color: "var(--syn-string)" },
    { tag: t.invalid, color: "var(--danger)" },
  ])),
];

/* ---------- Mermaid ---------- */
let mermaidLoading = null;
let mermaidTheme = null;
let counter = 0;
const cache = new Map();

function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidLoading) {
    mermaidLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "mermaid.min.js";
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => reject(new Error("mermaid.min.js non trovato"));
      document.head.appendChild(s);
    });
  }
  return mermaidLoading;
}

function isDark() {
  return document.documentElement.dataset.dark === "1";
}

export async function renderMermaid(code) {
  const theme = isDark() ? "dark" : "default";
  const key = theme + "\u0000" + code;
  if (cache.has(key)) return cache.get(key);
  const mermaid = await loadMermaid();
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      fontFamily: "inherit",
      // etichette in SVG puro: l'anteprima passa da un filtro che toglie l'HTML
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    mermaidTheme = theme;
  }
  try {
    const { svg } = await mermaid.render("mdflash-mermaid-" + ++counter, code);
    if (cache.size > 200) cache.clear();
    cache.set(key, svg);
    return svg;
  } catch (e) {
    document.querySelectorAll(`#dmdflash-mermaid-${counter}, #mdflash-mermaid-${counter}`).forEach((n) => n.remove());
    const msg = String((e && e.message) || e).split("\n").slice(0, 3).join("\n");
    return `<div class="diagram-error">Diagramma non valido: ${msg.replace(/[<>&]/g, "")}</div>`;
  }
}

export function clearMermaidCache() {
  cache.clear();
}
