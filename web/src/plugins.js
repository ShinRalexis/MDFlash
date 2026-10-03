// Estensioni di Milkdown: evidenziatore ==testo==, modalità concentrazione e
// macchina da scrivere, ricerca, avviso di modifica del documento.
import { $markSchema, $inputRule, $command, $remark, $prose } from "@milkdown/kit/utils";
import { markRule } from "@milkdown/kit/prose";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { search } from "prosemirror-search";

/* ---------- ==evidenziato== ----------
 * Il Markdown standard non lo prevede; Typora e Obsidian sì. Il testo viene
 * spezzato in nodi "highlight" dopo la lettura e riscritto come ==...==. */

function splitHighlights(node) {
  if (!node.children) return;
  const out = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value.includes("==")) {
      const re = /==([^=\n](?:[^\n]*?[^=\n])?)==/g;
      let last = 0, m;
      while ((m = re.exec(child.value))) {
        if (m.index > last) out.push({ type: "text", value: child.value.slice(last, m.index) });
        out.push({ type: "highlight", children: [{ type: "text", value: m[1] }] });
        last = m.index + m[0].length;
      }
      if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) });
    } else {
      if (child.type !== "code" && child.type !== "inlineCode" && child.type !== "math" && child.type !== "inlineMath")
        splitHighlights(child);
      out.push(child);
    }
  }
  node.children = out;
}

export const remarkHighlight = $remark("remarkHighlight", () => function () {
  const data = this.data();
  (data.toMarkdownExtensions ||= []).push({
    handlers: {
      highlight(node, _parent, state, info) {
        const exit = state.enter("emphasis");
        const value = state.containerPhrasing(node, { ...info, before: "=", after: "=" });
        exit();
        return "==" + value + "==";
      },
    },
  });
  return (tree) => { splitHighlights(tree); };
});

export const highlightSchema = $markSchema("highlight", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", 0],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => { state.withMark(mark, "highlight"); },
  },
}));

export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?:==)([^=]+)(?:==)$/, highlightSchema.type(ctx)));

export const toggleHighlightCommand = $command("ToggleHighlight", (ctx) => () =>
  toggleMark(highlightSchema.type(ctx)));

/* ---------- dollari che non sono formule ----------
 * "costa 10$ e 20$" non è una formula: come in Pandoc e Typora, una formula
 * in riga non può iniziare o finire con uno spazio subito dentro i $. */
function unmath(node) {
  if (!node.children) return;
  node.children = node.children.map((c) => {
    if (c.type === "inlineMath" && /^\s|\s$/.test(c.value || "")) return { type: "text", value: "$" + c.value + "$" };
    unmath(c);
    return c;
  });
}
export const remarkMathGuard = $remark("remarkMathGuard", () => () => (tree) => { unmath(tree); });

/* ---------- [[wikilink]] (Obsidian, Foam, Logseq) ----------
 * Senza questa estensione il Markdown riscritto diventerebbe \[\[Nota]].
 * Il testo tra le doppie parentesi resta modificabile; Ctrl+clic apre la nota. */

function splitWikiLinks(node) {
  if (!node.children) return;
  const out = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value.includes("[[")) {
      const re = /\[\[([^\[\]\n]+?)\]\]/g;
      let last = 0, m;
      while ((m = re.exec(child.value))) {
        if (m.index > last) out.push({ type: "text", value: child.value.slice(last, m.index) });
        out.push({ type: "wikiLink", children: [{ type: "text", value: m[1] }] });
        last = m.index + m[0].length;
      }
      if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) });
    } else {
      if (child.type !== "code" && child.type !== "inlineCode" && child.type !== "math" && child.type !== "inlineMath" && child.type !== "link")
        splitWikiLinks(child);
      out.push(child);
    }
  }
  node.children = out;
}

export const remarkWikiLink = $remark("remarkWikiLink", () => function () {
  const data = this.data();
  (data.toMarkdownExtensions ||= []).push({
    handlers: {
      // il contenuto si scrive così com'è: niente caratteri di escape
      wikiLink(node) {
        return "[[" + node.children.map((c) => c.value || "").join("") + "]]";
      },
    },
  });
  return (tree) => { splitWikiLinks(tree); };
});

export const wikiLinkSchema = $markSchema("wikilink", () => ({
  inclusive: false,
  parseDOM: [{ tag: "a.wikilink" }],
  toDOM: () => ["a", { class: "wikilink", title: "Ctrl+clic per aprire la nota" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "wikiLink",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "wikilink",
    runner: (state, mark) => { state.withMark(mark, "wikiLink"); },
  },
}));

export const wikiLinkInputRule = $inputRule((ctx) =>
  markRule(/\[\[([^\[\]]+)\]\]$/, wikiLinkSchema.type(ctx)));

/* ---------- concentrazione e macchina da scrivere ----------
 * Il blocco con il cursore riceve la classe md-focus; il CSS attenua gli altri
 * solo quando la modalità è attiva, così non serve ridisegnare all'attivazione. */
const focusKey = new PluginKey("mdflash-focus");

export const focusPlugin = $prose(() => new Plugin({
  key: focusKey,
  props: {
    decorations(state) {
      const { $from } = state.selection;
      if ($from.depth < 1) return null;
      const pos = $from.before(1);
      const node = state.doc.child($from.index(0));
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "md-focus" })]);
    },
  },
}));

// Tiene la riga del cursore al centro della finestra (macchina da scrivere).
export function centerCaret(view, scroller) {
  if (!document.body.classList.contains("typewriter")) return;
  try {
    const head = view.state.selection.head;
    const c = view.coordsAtPos(head);
    const r = scroller.getBoundingClientRect();
    const delta = c.top - (r.top + r.height / 2);
    if (Math.abs(delta) > 4) scroller.scrollTop += delta;
  } catch { /* posizione non visibile */ }
}

/* ---------- ricerca ---------- */
export const searchPlugin = $prose(() => search());

/* ---------- avviso di modifiche ----------
 * onChange(view, docChanged) a ogni transazione: serve per il segno di
 * documento modificato, la struttura, le statistiche e la macchina da scrivere. */
export function changePlugin(onChange) {
  return $prose(() => new Plugin({
    view: () => ({
      update(view, prev) {
        const docChanged = prev.doc !== view.state.doc;
        const selChanged = docChanged || !prev.selection.eq(view.state.selection);
        if (docChanged || selChanged) onChange(view, docChanged);
      },
    }),
  }));
}
