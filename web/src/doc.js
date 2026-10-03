// Un documento aperto (una scheda): percorso, codifica, front matter e l'editor
// attivo (WYSIWYG o sorgente).
import { createWysiwyg, createSource } from "./editor.js";
import { basename, dirname, el, getPrefs } from "./util.js";
import { t } from "./i18n.js";

let untitledCounter = 0;
let idCounter = 0;

// Il front matter YAML (--- ... --- in testa al file) non è Markdown: lo si
// tiene da parte e lo si mostra in un riquadro modificabile sopra il testo.
export function splitFrontMatter(text) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length).replace(/^\n/, "") };
}

export class Doc {
  constructor({ path = null, text = "", encoding = "utf-8", bom = false, eol, mtime = 0, title } = {}) {
    this.id = ++idCounter;
    this.path = path;
    this.encoding = encoding;
    this.bom = bom;
    this.eol = eol || getPrefs().defaultEol;
    this.mtime = mtime;
    this.untitled = path ? 0 : ++untitledCounter;
    this.customTitle = title || null;
    this.mode = "wysiwyg";
    this.editor = null;
    this.forcedDirty = false;
    this.readonly = false;
    this.pendingText = text;
    this.lastDirty = false;
    this.scrollTop = 0;

    this.el = el("div", { class: "doc-view", "data-doc": this.id });
    this.scroller = el("div", { class: "doc-scroll" });
    this.page = el("div", { class: "doc-page" });
    this.fmBox = el("div", { class: "frontmatter", hidden: true },
      el("div", { class: "fm-label", text: t("Front matter (YAML)") }),
      this.fmArea = el("textarea", { class: "fm-text", spellcheck: "false", rows: 2 }));
    this.host = el("div", { class: "editor-host" });
    this.page.append(this.fmBox, this.host);
    this.scroller.append(this.page);
    this.el.append(this.scroller);
    this.fmArea.addEventListener("input", () => { this.autoSizeFm(); this.onChange && this.onChange(this); });
  }

  get title() {
    if (this.path) return basename(this.path);
    return this.customTitle || (this.untitled > 1 ? t("Senza titolo {0}", this.untitled) : t("Senza titolo"));
  }
  get dir() { return this.path ? dirname(this.path) : null; }

  autoSizeFm() {
    this.fmArea.style.height = "auto";
    this.fmArea.style.height = this.fmArea.scrollHeight + 2 + "px";
  }

  setFrontMatter(fm, clean) {
    this.fm = fm;
    if (clean) this.fmBaseline = fm;
    if (this.mode === "source" || fm == null) {
      this.fmBox.hidden = true;
    } else {
      this.fmBox.hidden = false;
      this.fmArea.value = fm;
      requestAnimationFrame(() => this.autoSizeFm());
    }
  }

  currentFrontMatter() {
    if (this.mode === "source") return null;
    if (this.fmBox.hidden) return null;
    return this.fmArea.value;
  }

  // Avvia l'editor nel modo indicato con il testo completo del file.
  async mount(opts, text = this.pendingText) {
    this.opts = opts;
    this.pendingText = null;
    await this.createEditor(text, true);
  }

  async createEditor(fullText, clean) {
    const o = this.opts;
    const common = {
      scroller: this.scroller,
      onChange: () => o.onChange(this),
      onSelection: () => o.onSelection(this),
      toast: o.toast,
      openLink: (href) => o.openLink(this, href),
      openWikiLink: (raw) => o.openWikiLink(this, raw),
      resolveImage: (url) => o.resolveImage(this, url),
      uploadImage: (file) => o.uploadImage(this, file),
      spellcheck: getPrefs().spellcheck,
      lineNumbers: getPrefs().codeLineNumbers,
    };
    this.host.replaceChildren();
    this.host.className = "editor-host mode-" + this.mode + (this.mode === "source" ? "" : " markdown-body");
    if (this.mode === "source") {
      this.setFrontMatter(null);
      this.fmBox.hidden = true;
      this.editor = createSource(this.host, fullText, common);
    } else {
      const { fm, body } = splitFrontMatter(fullText);
      this.setFrontMatter(fm, clean);
      if (clean) this.fmBaseline = fm;
      this.editor = await createWysiwyg(this.host, body, common);
    }
    this.host.querySelectorAll("[contenteditable]").forEach((n) => n.setAttribute("spellcheck", getPrefs().spellcheck ? "true" : "false"));
  }

  fullText() {
    if (!this.editor) return this.pendingText || "";
    const body = this.editor.getMarkdown();
    if (this.mode === "source") return body;
    const fm = this.currentFrontMatter();
    return fm != null ? `---\n${fm}\n---\n\n${body}` : body;
  }

  isDirty() {
    if (!this.editor) return false;
    if (this.forcedDirty) return true;
    if (this.editor.isDirty()) return true;
    if (this.mode !== "source" && (this.currentFrontMatter() ?? null) !== (this.fmBaseline ?? null)) return true;
    return false;
  }

  markClean() {
    this.forcedDirty = false;
    if (this.editor) this.editor.markClean();
    this.fmBaseline = this.currentFrontMatter();
    this.lastDirty = false;
  }

  async setMode(mode) {
    if (mode === this.mode || !this.editor) return;
    const wasDirty = this.isDirty();
    const text = this.fullText();
    const ratio = this.scroller.scrollHeight > this.scroller.clientHeight
      ? this.scroller.scrollTop / (this.scroller.scrollHeight - this.scroller.clientHeight) : 0;
    const prevMode = this.mode;
    this.editor.destroy();
    this.mode = mode;
    try {
      await this.createEditor(text, false);
    } catch (e) {
      // se il nuovo editor non parte si torna a quello di prima, testo intatto
      this.mode = prevMode;
      await this.createEditor(text, false);
      this.forcedDirty = wasDirty;
      throw e;
    }
    this.editor.markClean();
    this.fmBaseline = this.currentFrontMatter();
    this.forcedDirty = wasDirty;
    requestAnimationFrame(() => {
      this.scroller.scrollTop = ratio * (this.scroller.scrollHeight - this.scroller.clientHeight);
      this.editor.focus();
    });
  }

  // Sostituisce tutto il contenuto (ricarica dal disco, ripristino versione).
  async replaceAll(text, { clean = false } = {}) {
    if (!this.editor) { this.pendingText = text; return; }
    if (this.mode === "source") {
      this.editor.setMarkdown(text, !clean);
    } else {
      const { fm, body } = splitFrontMatter(text);
      this.setFrontMatter(fm, clean);
      this.editor.setMarkdown(body, !clean);
    }
    if (clean) this.markClean();
  }

  destroy() {
    try { this.editor && this.editor.destroy(); } catch { /* già distrutto */ }
    this.el.remove();
  }
}
