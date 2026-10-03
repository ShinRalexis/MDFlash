// I due modi di scrivere un documento:
//  - WYSIWYG (come Typora): Milkdown Crepe, il Markdown si trasforma mentre si scrive;
//  - sorgente: CodeMirror sul testo Markdown grezzo.
// Entrambi espongono la stessa interfaccia (getMarkdown, setMarkdown, run, find...).
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, serializerCtx, commandsCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { insert } from "@milkdown/kit/utils";
import {
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand,
  wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand, insertHrCommand,
  turnIntoTextCommand, wrapInBlockTypeCommand, addBlockTypeCommand, clearTextInCurrentBlockCommand,
  setBlockTypeCommand, listItemSchema, codeBlockSchema, sinkListItemCommand, liftListItemCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand, createTable, remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { DOMSerializer, DOMParser as PMDOMParser, Fragment } from "@milkdown/kit/prose/model";
import { TextSelection, AllSelection } from "@milkdown/kit/prose/state";
import {
  SearchQuery, setSearchState, getSearchState, findNext, findPrev, replaceNext, replaceAll as pmReplaceAll,
} from "prosemirror-search";

import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, rectangularSelection, crosshairCursor, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, indentOnInput, foldGutter } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  SearchQuery as CMSearchQuery, setSearchQuery, findNext as cmFindNext, findPrevious as cmFindPrev,
  replaceNext as cmReplaceNext, replaceAll as cmReplaceAll, search as cmSearch, getSearchQuery,
} from "@codemirror/search";

import {
  remarkHighlight, highlightSchema, highlightInputRule, toggleHighlightCommand,
  remarkWikiLink, wikiLinkSchema, wikiLinkInputRule, remarkMathGuard,
  focusPlugin, searchPlugin, changePlugin, centerCaret,
} from "./plugins.js";
import { codeTheme, renderMermaid } from "./render.js";
import { t } from "./i18n.js";

/* ---------- testi dell'editor (tradotti) ---------- */
const IT = () => ({
  [Crepe.Feature.CodeMirror]: {
    searchPlaceholder: t("Cerca linguaggio"),
    noResultText: t("Nessun risultato"),
    copyText: t("Copia"),
    previewLabel: t("Anteprima"),
    previewToggleText: (previewOnly) => (previewOnly ? t("Modifica") : t("Nascondi")),
    previewLoading: t("Disegno in corso…"),
    previewOnlyByDefault: true,
  },
  [Crepe.Feature.Placeholder]: { text: t("Scrivi qui, oppure premi / per inserire titoli, tabelle, formule…"), mode: "block" },
  [Crepe.Feature.LinkTooltip]: { inputPlaceholder: t("Incolla o scrivi un indirizzo…") },
  [Crepe.Feature.ImageBlock]: {
    blockUploadButton: t("Scegli immagine"),
    blockUploadPlaceholderText: t("oppure incolla un indirizzo"),
    blockCaptionPlaceholderText: t("Scrivi una didascalia"),
    inlineUploadButton: t("Scegli"),
    inlineUploadPlaceholderText: t("oppure incolla un indirizzo"),
  },
  [Crepe.Feature.Toolbar]: {
    boldLabel: t("Grassetto"), italicLabel: t("Corsivo"), strikethroughLabel: t("Barrato"),
    codeLabel: t("Codice"), linkLabel: t("Collegamento"), latexLabel: t("Formula"),
  },
  [Crepe.Feature.BlockEdit]: {
    textGroup: {
      label: t("Testo"), text: { label: t("Paragrafo") }, h1: { label: t("Titolo 1") }, h2: { label: t("Titolo 2") },
      h3: { label: t("Titolo 3") }, h4: { label: t("Titolo 4") }, h5: { label: t("Titolo 5") }, h6: { label: t("Titolo 6") },
      quote: { label: t("Citazione") }, divider: { label: t("Linea orizzontale") },
    },
    listGroup: {
      label: t("Elenchi"), bulletList: { label: t("Elenco puntato") }, orderedList: { label: t("Elenco numerato") },
      taskList: { label: t("Elenco di attività") },
    },
    advancedGroup: {
      label: t("Inserisci"), image: { label: t("Immagine") }, codeBlock: { label: t("Blocco di codice") },
      table: { label: t("Tabella") }, math: { label: t("Formula (LaTeX)") },
    },
  },
});

const mermaidSample = () => `graph TD\n  A[${t("Idea")}] --> B{${t("Funziona?")}}\n  B -- ${t("Sì")} --> C[${t("Pubblica")}]\n  B -- ${t("No")} --> D[${t("Rivedi")}]\n  D --> B`;
const MERMAID_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><path d="M6.5 8v5.5h11V16M17.5 8v5.5"/></svg>`;
const FOOTNOTE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h10M4 11h10M4 16h6"/><path d="M17 4h3v6"/><path d="M17 10h4"/></svg>`;
const HIGHLIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;

/* Crepe, per le immagini a sé stanti, scrive nel testo alternativo le
 * proporzioni (![1.00](foto.png)) e perde la descrizione originale. Qui lo
 * schema viene corretto: il testo alternativo resta tale; le proporzioni si
 * scrivono solo se l'immagine non ha descrizione ed è stata ridimensionata. */
function fixImageAlt(ctx) {
  ctx.update(imageBlockSchema.key, (prev) => (c) => {
    const spec = prev(c);
    return {
      ...spec,
      attrs: { ...spec.attrs, alt: { default: "", validate: "string" } },
      parseMarkdown: {
        match: spec.parseMarkdown.match,
        runner: (state, node, type) => {
          const alt = node.alt || "";
          const isRatio = /^\d+\.\d{2}$/.test(alt);
          let ratio = isRatio ? Number(alt) : 1;
          if (!ratio || Number.isNaN(ratio)) ratio = 1;
          state.addNode(type, { src: node.url || "", caption: node.title || "", ratio, alt: isRatio ? "" : alt });
        },
      },
      toMarkdown: {
        match: spec.toMarkdown.match,
        runner: (state, node) => {
          const r = Number.parseFloat(node.attrs.ratio);
          const alt = node.attrs.alt || (r && Math.abs(r - 1) > 0.005 ? r.toFixed(2) : "");
          state.openNode("paragraph");
          state.addNode("image", undefined, undefined, { title: node.attrs.caption || null, url: node.attrs.src, alt });
          state.closeNode();
        },
      },
    };
  });
  return () => {};
}

function codePreview(language, content, apply) {
  const lang = (language || "").toLowerCase();
  if (lang === "mermaid" && content.trim()) {
    renderMermaid(content).then(apply);
    return undefined; // asincrono
  }
  return null;
}

/* =====================================================================
 *  Editor WYSIWYG
 * ===================================================================== */
export async function createWysiwyg(root, markdown, opts) {
  const IT_ = IT();
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: { [Crepe.Feature.TopBar]: false, [Crepe.Feature.AI]: false },
    featureConfigs: {
      ...IT_,
      [Crepe.Feature.CodeMirror]: {
        ...IT_[Crepe.Feature.CodeMirror],
        theme: codeTheme,
        renderPreview: codePreview,
        onCopy: () => opts.toast && opts.toast(t("Codice copiato")),
      },
      [Crepe.Feature.ImageBlock]: {
        ...IT_[Crepe.Feature.ImageBlock],
        proxyDomURL: (url) => opts.resolveImage(url),
        onUpload: (file) => opts.uploadImage(file),
        inlineOnUpload: (file) => opts.uploadImage(file),
        blockOnUpload: (file) => opts.uploadImage(file),
      },
      [Crepe.Feature.LinkTooltip]: {
        ...IT_[Crepe.Feature.LinkTooltip],
        onCopyLink: () => opts.toast && opts.toast(t("Indirizzo copiato")),
      },
      [Crepe.Feature.Latex]: { katexOptions: { throwOnError: false, strict: "ignore" } },
      [Crepe.Feature.BlockEdit]: {
        ...IT_[Crepe.Feature.BlockEdit],
        buildMenu: (builder) => {
          builder.getGroup("advanced")
            .addItem("mermaid", {
              label: t("Diagramma Mermaid"), icon: MERMAID_ICON,
              onRun: (ctx) => {
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                insertCodeBlock(ctx.get(editorViewCtx), "mermaid", mermaidSample());
              },
            })
            .addItem("footnote", {
              label: t("Nota a piè di pagina"), icon: FOOTNOTE_ICON,
              onRun: (ctx) => insertFootnote(ctx.get(editorViewCtx)),
            });
          builder.getGroup("text").addItem("highlight", {
            label: t("Evidenziato"), icon: HIGHLIGHT_ICON,
            onRun: (ctx) => ctx.get(commandsCtx).call(toggleHighlightCommand.key),
          });
        },
      },
    },
  });

  crepe.editor
    .config((ctx) => {
      // Markdown scritto come lo scriverebbe una persona: trattini per elenchi
      // e linee, tabelle senza spazi di allineamento, a capo con due spazi
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-",
        rule: "-",
        listItemIndent: "one",
        handlers: { ...prev.handlers, break: () => "  \n" },
      }));
      ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: false });
    })
    .use(fixImageAlt)
    .use(remarkWikiLink).use(wikiLinkSchema).use(wikiLinkInputRule).use(remarkMathGuard)
    .use(remarkHighlight).use(highlightSchema).use(highlightInputRule).use(toggleHighlightCommand)
    .use(focusPlugin).use(searchPlugin)
    .use(changePlugin((view, docChanged) => {
      if (docChanged) opts.onChange && opts.onChange();
      opts.onSelection && opts.onSelection();
      centerCaret(view, opts.scroller);
    }));

  await crepe.create();
  const editor = crepe.editor;
  const view = () => editor.ctx.get(editorViewCtx);
  const cmd = (key, payload) => editor.ctx.get(commandsCtx).call(key, payload);

  // Il documento "di riferimento" per capire se ci sono modifiche non salvate
  let baseline = view().state.doc;

  // Ctrl+clic su un collegamento lo apre (come in Typora)
  root.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href], a.wikilink");
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (a.classList.contains("wikilink")) opts.openWikiLink && opts.openWikiLink(a.textContent);
      else opts.openLink && opts.openLink(a.getAttribute("href"));
    }
  }, true);

  const api = {
    kind: "wysiwyg",
    crepe,
    get view() { return view(); },
    getMarkdown: () => tidyMarkdown(crepe.getMarkdown()),
    setMarkdown(md, keepBaseline) {
      const v = view();
      const doc = editor.ctx.get(parserCtx)(md);
      if (!doc) return;
      const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content);
      v.dispatch(tr.setMeta("addToHistory", !!keepBaseline));
      if (!keepBaseline) baseline = v.state.doc;
    },
    markClean() { baseline = view().state.doc; },
    isDirty: () => !view().state.doc.eq(baseline),
    focus() { try { view().focus(); } catch { /* non ancora montato */ } },
    destroy: () => crepe.destroy(),
    setReadonly: (ro) => crepe.setReadonly(ro),

    outline() {
      const out = [];
      view().state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") out.push({ level: node.attrs.level, text: node.textContent, pos: offset });
      });
      return out;
    },
    // Indice del titolo che contiene il cursore (per evidenziarlo nella struttura)
    currentHeadingPos() {
      const v = view();
      const sel = v.state.selection.from;
      let found = -1;
      v.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading" && offset <= sel) found = offset;
      });
      return found;
    },
    scrollToPos(pos) {
      const v = view();
      const dom = v.nodeDOM(pos);
      if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: "start", behavior: "smooth" });
      const sel = TextSelection.near(v.state.doc.resolve(Math.min(pos + 1, v.state.doc.content.size)));
      v.dispatch(v.state.tr.setSelection(sel));
      v.focus();
    },
    // Va alla riga N del Markdown (usato dalla ricerca nella cartella): si
    // cerca il testo della riga nel documento.
    revealText(text) {
      if (!text) return;
      const needle = text.replace(/[#>*_`~\-[\]()!]/g, "").trim().slice(0, 40);
      if (!needle) return;
      api.find({ search: needle });
      api.findNext();
    },

    selectedText() {
      const { state } = view();
      return state.doc.textBetween(state.selection.from, state.selection.to, "\n\n");
    },
    selectedMarkdown() {
      const { state } = view();
      if (state.selection.empty) return "";
      const slice = state.selection.content();
      const doc = state.schema.topNodeType.createAndFill(null, slice.content);
      return doc ? editor.ctx.get(serializerCtx)(doc).trim() : "";
    },
    selectedHtml() {
      const { state } = view();
      if (state.selection.empty) return "";
      const frag = DOMSerializer.fromSchema(state.schema).serializeFragment(state.selection.content().content);
      const div = document.createElement("div");
      div.appendChild(frag);
      return div.innerHTML;
    },
    // Testo del blocco con il cursore, se non c'è una selezione (per l'assistente)
    selectOrBlock() {
      const v = view();
      const { state } = v;
      if (!state.selection.empty) return api.selectedMarkdown();
      const $from = state.selection.$from;
      if ($from.depth < 1) return "";
      const start = $from.before(1), end = $from.after(1);
      v.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + 1, end - 1)));
      return api.selectedMarkdown();
    },
    insertMarkdown(md) {
      editor.action(insert(md));
    },
    // HTML (incollato o importato) -> Markdown, con lo stesso schema dell'editor
    htmlToMarkdown(html) {
      const v = view();
      const dom = new DOMParser().parseFromString(html, "text/html");
      const doc = PMDOMParser.fromSchema(v.state.schema).parse(dom.body);
      return editor.ctx.get(serializerCtx)(doc);
    },
    // Documento intero come elementi HTML (per esportare e stampare)
    renderFragment() {
      const v = view();
      return DOMSerializer.fromSchema(v.state.schema).serializeFragment(v.state.doc.content);
    },
    insertText(text) {
      const v = view();
      v.dispatch(v.state.tr.insertText(text));
    },

    run(name, arg) { return runWysiwyg(api, name, arg, cmd); },

    /* ricerca (prosemirror-search) */
    find(q) {
      const v = view();
      const query = new SearchQuery({
        search: q.search || "", caseSensitive: !!q.caseSensitive, regexp: !!q.regexp,
        wholeWord: !!q.wholeWord, replace: q.replace || "",
      });
      v.dispatch(setSearchState(v.state.tr, query));
      return countMatches(v.state, query);
    },
    findNext() { const v = view(); findNext(v.state, v.dispatch); scrollSelection(v); return matchIndex(v.state); },
    findPrev() { const v = view(); findPrev(v.state, v.dispatch); scrollSelection(v); return matchIndex(v.state); },
    replaceNext() { const v = view(); replaceNext(v.state, v.dispatch); return matchIndex(v.state); },
    replaceAll() { const v = view(); pmReplaceAll(v.state, v.dispatch); },
    clearFind() { const v = view(); v.dispatch(setSearchState(v.state.tr, new SearchQuery({ search: "" }))); },
  };
  return api;
}

// Righe di allineamento delle tabelle leggibili (| :--- | :---: |) invece
// della forma minima (| :- | :-: |), senza toccare i blocchi di codice.
function tidyMarkdown(md) {
  let fence = null;
  return md.split("\n").map((line) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line; }
    if (fence || !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(line)) return line;
    return line.replace(/(:?)(-+)(:?)/g, (m, a, d, b) => a + "-".repeat(Math.max(3, d.length)) + b);
  }).join("\n");
}

function scrollSelection(v) {
  try {
    const dom = v.domAtPos(v.state.selection.from);
    const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
    el && el.scrollIntoView({ block: "center" });
  } catch { /* niente da mostrare */ }
}

function countMatches(state, query) {
  if (!query.valid || !query.search) return { total: 0, index: 0 };
  let total = 0, index = 0;
  const sel = state.selection;
  let res = query.findNext(state, 0);
  while (res && total < 5000) {
    total++;
    if (res.from === sel.from && res.to === sel.to) index = total;
    res = query.findNext(state, res.to > res.from ? res.to : res.to + 1);
  }
  return { total, index };
}

function matchIndex(state) {
  const s = getSearchState(state);
  return s ? countMatches(state, s.query) : { total: 0, index: 0 };
}

function insertCodeBlock(view, language, text) {
  const { state } = view;
  const type = state.schema.nodes.code_block;
  const node = type.create({ language }, text ? state.schema.text(text) : null);
  const tr = state.tr.replaceSelectionWith(node);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function insertFootnote(view) {
  const { state } = view;
  const s = state.schema;
  if (!s.nodes.footnote_reference || !s.nodes.footnote_definition) return;
  // primo numero libero
  const used = new Set();
  state.doc.descendants((n) => {
    if (n.type.name === "footnote_reference" || n.type.name === "footnote_definition") used.add(String(n.attrs.label));
  });
  let n = 1;
  while (used.has(String(n))) n++;
  const label = String(n);
  let tr = state.tr.replaceSelectionWith(s.nodes.footnote_reference.create({ label }), false);
  const def = s.nodes.footnote_definition.create({ label }, s.nodes.paragraph.create());
  const end = tr.doc.content.size;
  tr = tr.insert(end, def);
  tr = tr.setSelection(TextSelection.create(tr.doc, end + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function currentHeadingLevel(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "heading") return n.attrs.level;
  }
  return 0;
}

function runWysiwyg(api, name, arg, cmd) {
  const v = api.view;
  const { state } = v;
  switch (name) {
    case "undo": return cmd(undoCommand.key);
    case "redo": return cmd(redoCommand.key);
    case "selectAll": v.dispatch(state.tr.setSelection(new AllSelection(state.doc))); return true;
    case "bold": return cmd(toggleStrongCommand.key);
    case "italic": return cmd(toggleEmphasisCommand.key);
    case "strike": return cmd(toggleStrikethroughCommand.key);
    case "code": return cmd(toggleInlineCodeCommand.key);
    case "highlight": return cmd(toggleHighlightCommand.key);
    case "link": {
      if (state.selection.empty) {
        const text = t("collegamento");
        const from = state.selection.from;
        const tr = state.tr.insertText(text);
        v.dispatch(tr.setSelection(TextSelection.create(tr.doc, from, from + text.length)));
      }
      return cmd(toggleLinkCommand.key);
    }
    case "image":
      cmd(clearTextInCurrentBlockCommand.key);
      return cmd(addBlockTypeCommand.key, { nodeType: imageBlockSchema.type(api.crepe.editor.ctx) });
    case "clearFormat": {
      const { from, to } = state.selection;
      v.dispatch(state.tr.removeMark(from, to));
      return true;
    }
    case "heading": {
      const level = Number(arg);
      if (!level) return cmd(turnIntoTextCommand.key);
      if (currentHeadingLevel(state) === level) return cmd(turnIntoTextCommand.key);
      return cmd(wrapInHeadingCommand.key, level);
    }
    case "paragraph": return cmd(turnIntoTextCommand.key);
    case "headingUp": {
      const l = currentHeadingLevel(state);
      if (l === 1) return true;
      return cmd(wrapInHeadingCommand.key, l ? l - 1 : 6);
    }
    case "headingDown": {
      const l = currentHeadingLevel(state);
      if (!l) return true;
      if (l === 6) return cmd(turnIntoTextCommand.key);
      return cmd(wrapInHeadingCommand.key, l + 1);
    }
    case "quote": return cmd(wrapInBlockquoteCommand.key);
    case "bulletList": return cmd(wrapInBulletListCommand.key);
    case "orderedList": return cmd(wrapInOrderedListCommand.key);
    case "taskList":
      return cmd(wrapInBlockTypeCommand.key, { nodeType: listItemSchema.type(api.crepe.editor.ctx), attrs: { checked: false } });
    case "indent": return cmd(sinkListItemCommand.key);
    case "outdent": return cmd(liftListItemCommand.key);
    case "codeBlock":
      return cmd(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(api.crepe.editor.ctx) });
    case "mathBlock":
      return cmd(addBlockTypeCommand.key, { nodeType: codeBlockSchema.type(api.crepe.editor.ctx), attrs: { language: "LaTeX" } });
    case "mermaid": insertCodeBlock(v, "mermaid", mermaidSample()); return true;
    case "table": {
      const ctx = api.crepe.editor.ctx;
      return cmd(addBlockTypeCommand.key, { nodeType: createTable(ctx, Number(arg && arg.rows) || 3, Number(arg && arg.cols) || 3) });
    }
    case "hr": return cmd(insertHrCommand.key);
    case "footnote": insertFootnote(v); return true;
    case "inlineMath": {
      const type = state.schema.nodes.math_inline;
      if (!type) return false;
      const text = state.doc.textBetween(state.selection.from, state.selection.to) || "x^2";
      v.dispatch(state.tr.replaceSelectionWith(type.create({ value: text })));
      return true;
    }
    case "insertToc": {
      // Indice dei titoli come elenco di collegamenti interni
      const items = api.outline();
      if (!items.length) return false;
      const min = Math.min(...items.map((i) => i.level));
      const md = items.map((i) => "  ".repeat(i.level - min) + "- [" + i.text.replace(/[[\]]/g, "") + "](#" + slug(i.text) + ")").join("\n");
      api.insertMarkdown(md + "\n");
      return true;
    }
    default: return false;
  }
}

export function slug(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}

/* =====================================================================
 *  Modalità sorgente (CodeMirror)
 * ===================================================================== */
export function createSource(root, initialText, opts) {
  const wrap = new Compartment();
  const numbers = new Compartment();
  let baseline = initialText;
  const view = new EditorView({
    parent: root,
    state: EditorState.create({
      doc: initialText,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        numbers.of(opts.lineNumbers ? lineNumbers() : []),
        wrap.of(EditorView.lineWrapping),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        cmSearch({ top: true, createPanel: () => ({ dom: document.createElement("span") }) }),
        codeTheme,
        EditorView.contentAttributes.of({ spellcheck: opts.spellcheck ? "true" : "false" }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange && opts.onChange();
          if (u.docChanged || u.selectionSet) {
            opts.onSelection && opts.onSelection();
            if (document.body.classList.contains("typewriter")) {
              view.dispatch({ effects: EditorView.scrollIntoView(u.state.selection.main.head, { y: "center" }) });
            }
          }
        }),
      ],
    }),
  });

  const sel = () => view.state.selection.main;
  const replaceSel = (text, selectInside) => {
    const { from, to } = sel();
    view.dispatch({
      changes: { from, to, insert: text },
      selection: selectInside ? EditorSelection.range(from + selectInside[0], from + selectInside[1]) : EditorSelection.cursor(from + text.length),
      scrollIntoView: true,
    });
    view.focus();
  };
  // Avvolge la selezione con dei segni (es. **): se ci sono già li toglie
  const wrapSel = (before, after = before) => {
    const { from, to } = sel();
    const doc = view.state.doc;
    const text = doc.sliceString(from, to);
    if (doc.sliceString(from - before.length, from) === before && doc.sliceString(to, to + after.length) === after) {
      view.dispatch({ changes: [{ from: from - before.length, to: from }, { from: to, to: to + after.length }] });
      return;
    }
    replaceSel(before + (text || "") + after, [before.length, before.length + (text || "").length]);
  };
  const linePrefix = (prefix, toggleRe) => {
    const { from, to } = sel();
    const doc = view.state.doc;
    const changes = [];
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const m = toggleRe && toggleRe.exec(line.text);
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: prefix });
      else changes.push({ from: line.from, insert: prefix });
      pos = line.to + 1;
    }
    view.dispatch({ changes });
    view.focus();
  };

  const api = {
    kind: "source",
    view,
    getMarkdown: () => view.state.doc.toString(),
    setMarkdown(md, keepBaseline) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
      if (!keepBaseline) baseline = md;
    },
    markClean() { baseline = view.state.doc.toString(); },
    isDirty: () => view.state.doc.toString() !== baseline,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    setReadonly: () => {},
    setLineNumbers: (on) => view.dispatch({ effects: numbers.reconfigure(on ? lineNumbers() : []) }),
    outline() {
      const out = [];
      let inFence = false;
      for (let i = 1; i <= view.state.doc.lines; i++) {
        const line = view.state.doc.line(i);
        if (/^\s*(```|~~~)/.test(line.text)) inFence = !inFence;
        const m = !inFence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line.text);
        if (m) out.push({ level: m[1].length, text: m[2], pos: line.from });
      }
      return out;
    },
    currentHeadingPos() {
      const head = sel().head;
      let found = -1;
      for (const h of api.outline()) if (h.pos <= head) found = h.pos;
      return found;
    },
    scrollToPos(pos) {
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }) });
      view.focus();
    },
    revealLine(line) {
      const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
      view.dispatch({ selection: EditorSelection.range(l.from, l.to), effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
      view.focus();
    },
    revealText(text) {
      const idx = view.state.doc.toString().indexOf(text);
      if (idx >= 0) api.scrollToPos(idx);
    },
    selectedText: () => view.state.sliceDoc(sel().from, sel().to),
    selectedMarkdown: () => view.state.sliceDoc(sel().from, sel().to),
    selectedHtml: () => "",
    selectOrBlock() {
      if (!sel().empty) return api.selectedText();
      // paragrafo attorno al cursore (fino alle righe vuote)
      const doc = view.state.doc;
      let a = doc.lineAt(sel().head).number, b = a;
      while (a > 1 && doc.line(a - 1).text.trim()) a--;
      while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
      view.dispatch({ selection: EditorSelection.range(doc.line(a).from, doc.line(b).to) });
      return api.selectedText();
    },
    insertMarkdown: (md) => replaceSel(md),
    insertText: (t) => replaceSel(t),

    run(name, arg) {
      switch (name) {
        case "undo": return undo(view);
        case "redo": return redo(view);
        case "selectAll": return selectAll(view);
        case "bold": wrapSel("**"); return true;
        case "italic": wrapSel("*"); return true;
        case "strike": wrapSel("~~"); return true;
        case "code": wrapSel("`"); return true;
        case "highlight": wrapSel("=="); return true;
        case "link": {
          const sel = api.selectedText() || t("testo");
          replaceSel(`[${sel}](https://)`, [sel.length + 3, sel.length + 11]);
          return true;
        }
        case "image": replaceSel("![](immagine.png)", [4, 16]); return true;
        case "heading": linePrefix(Number(arg) ? "#".repeat(Number(arg)) + " " : "", /^#{1,6}\s+/); return true;
        case "paragraph": linePrefix("", /^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/); return true;
        case "headingUp":
        case "headingDown": {
          const line = view.state.doc.lineAt(sel().head);
          const m = /^(#{1,6})\s+/.exec(line.text);
          const l = m ? m[1].length : 0;
          const nl = name === "headingUp" ? (l ? Math.max(1, l - 1) : 6) : (l ? l + 1 : 0);
          linePrefix(nl && nl <= 6 ? "#".repeat(nl) + " " : "", /^#{1,6}\s+/);
          return true;
        }
        case "quote": linePrefix("> ", /^>\s?/); return true;
        case "bulletList": linePrefix("- ", /^[-*+]\s+/); return true;
        case "orderedList": linePrefix("1. ", /^\d+[.)]\s+/); return true;
        case "taskList": linePrefix("- [ ] ", /^[-*+]\s+(\[[ xX]\]\s+)?/); return true;
        case "codeBlock": replaceSel("\n```\n" + api.selectedText() + "\n```\n", [5, 5]); return true;
        case "mathBlock": replaceSel("\n$$\n" + (api.selectedText() || "E = mc^2") + "\n$$\n"); return true;
        case "mermaid": replaceSel("\n```mermaid\n" + mermaidSample() + "\n```\n"); return true;
        case "inlineMath": wrapSel("$"); return true;
        case "table": { const c = t("Colonna"); replaceSel(`\n| ${c} 1 | ${c} 2 | ${c} 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n`); return true; }
        case "hr": replaceSel("\n---\n"); return true;
        case "footnote": {
          const text = view.state.doc.toString();
          let n = 1;
          while (text.includes(`[^${n}]`)) n++;
          const { from } = sel();
          view.dispatch({ changes: [{ from, insert: `[^${n}]` }, { from: view.state.doc.length, insert: `\n\n[^${n}]: ` }] });
          view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
          view.focus();
          return true;
        }
        case "clearFormat": {
          const plain = api.selectedText().replace(/(\*\*|__|\*|_|~~|==|`)/g, "");
          replaceSel(plain);
          return true;
        }
        case "insertToc": {
          const items = api.outline();
          const min = Math.min(...items.map((i) => i.level));
          replaceSel(items.map((i) => "  ".repeat(i.level - min) + "- [" + i.text + "](#" + slug(i.text) + ")").join("\n") + "\n");
          return true;
        }
        default: return false;
      }
    },

    find(q) {
      const query = new CMSearchQuery({
        search: q.search || "", caseSensitive: !!q.caseSensitive, regexp: !!q.regexp,
        wholeWord: !!q.wholeWord, replace: q.replace || "",
      });
      view.dispatch({ effects: setSearchQuery.of(query) });
      return cmCount(view);
    },
    findNext() { cmFindNext(view); return cmCount(view); },
    findPrev() { cmFindPrev(view); return cmCount(view); },
    replaceNext() { cmReplaceNext(view); return cmCount(view); },
    replaceAll() { cmReplaceAll(view); },
    clearFind() { view.dispatch({ effects: setSearchQuery.of(new CMSearchQuery({ search: "" })) }); },
  };
  return api;
}

function cmCount(view) {
  const q = getSearchQuery(view.state);
  if (!q || !q.search || !q.valid) return { total: 0, index: 0 };
  const cur = q.getCursor(view.state);
  const main = view.state.selection.main;
  let total = 0, index = 0;
  for (let r = cur.next(); !r.done && total < 5000; r = cur.next()) {
    total++;
    if (r.value.from === main.from && r.value.to === main.to) index = total;
  }
  return { total, index };
}

export { Fragment };
