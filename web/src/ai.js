// Assistente di scrittura con Ollama (modelli locali): correggi, migliora,
// riassumi, traduci, riscrivi il testo selezionato. Le richieste passano dal
// programma C perché Ollama rifiuta le chiamate dirette da questa pagina.
import * as host from "./host.js";
import { app, toast, on } from "./app.js";
import { el, $, getPrefs, setPref } from "./util.js";
import { ICONS } from "./ui-base.js";
import { t, getLanguage, LANGUAGES } from "./i18n.js";

// Le istruzioni al modello sono in inglese: i modelli le seguono meglio in
// qualunque lingua sia scritto il testo, che resta nella sua lingua.
const KEEP = " Write the answer in the same language as the text. Keep the Markdown formatting. Reply only with the result, no preamble.";
const ACTIONS = [
  { id: "fix", label: "Correggi", prompt: "Fix spelling, grammar and punctuation of the following text without changing its style or meaning." + KEEP },
  { id: "improve", label: "Migliora", prompt: "Rewrite the following text to make it clearer, smoother and more precise, keeping the same tone." + KEEP },
  { id: "shorter", label: "Accorcia", prompt: "Rewrite the following text more concisely (about half the length) without losing important information." + KEEP },
  { id: "longer", label: "Espandi", prompt: "Expand the following text with more details and examples, keeping the same tone." + KEEP },
  { id: "summary", label: "Riassumi", prompt: "Write a short summary of the following text as a Markdown bullet list." + KEEP },
  { id: "translate", label: "Traduci", prompt: (lang) => `Translate the following text into ${lang}. Keep the Markdown formatting, proper names and code unchanged. Reply only with the translation.` },
  { id: "formal", label: "Tono formale", prompt: "Rewrite the following text in a formal, professional tone." + KEEP },
  { id: "simple", label: "Semplifica", prompt: "Rewrite the following text with simple words and short sentences that anyone can understand." + KEEP },
  { id: "title", label: "Proponi titoli", prompt: "Suggest 5 effective titles for the following text as a Markdown bullet list." + KEEP },
  { id: "continue", label: "Continua", prompt: "Continue the following text with one or two paragraphs consistent in style, language and content. Reply only with the text to append." },
];

// Lingua predefinita delle traduzioni: l'inglese, o l'italiano se l'interfaccia è in inglese
const defaultTarget = () => getPrefs().aiLanguage || (getLanguage() === "en" ? "Italian" : "English");

let panel, out, modelSel, status, customInput, langInput, btnStop, actionsBox;
let streamId = 0;
let currentStream = 0;
let lastResult = "";
let sourceDoc = null;

function base() {
  return (getPrefs().ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
}

async function loadModels() {
  status.textContent = t("Collegamento a Ollama…");
  const r = await host.call("http", { url: base() + "/api/tags", method: "GET" });
  if (r.error || r.status !== 200) {
    modelSel.replaceChildren(el("option", { value: "", text: t("Ollama non raggiungibile") }));
    status.innerHTML = "";
    status.append(t("Ollama non risponde su {0}.", base()) + " ",
      el("a", { href: "#", text: t("Scarica Ollama"), onclick: (e) => { e.preventDefault(); host.call("openExternal", { url: "https://ollama.com/download" }); } }),
      " · ", el("a", { href: "#", text: t("Riprova"), onclick: (e) => { e.preventDefault(); loadPromise = loadModels(); } }));
    return;
  }
  let models = [];
  try { models = JSON.parse(r.body).models || []; } catch { /* risposta non valida */ }
  // i modelli per gli "embedding" non sanno scrivere testo
  models = models.filter((m) => !/embed|bge|nomic|minilm/i.test(m.name));
  modelSel.replaceChildren(...models.map((m) => el("option", { value: m.name, text: m.name + (m.remote_host || /cloud/.test(m.name) ? " (cloud)" : "") })));
  if (!models.length) {
    modelSel.append(el("option", { value: "", text: t("Nessun modello installato") }));
    status.textContent = t("Installa un modello, ad esempio: {0}", "ollama pull gemma3");
    return;
  }
  const pref = getPrefs().ollamaModel;
  modelSel.value = models.some((m) => m.name === pref) ? pref : models[0].name;
  status.textContent = t("Seleziona del testo e scegli un'azione (senza selezione si usa il paragrafo del cursore).");
}

async function runAction(prompt) {
  const doc = app.active;
  if (!doc || !doc.editor) return;
  const model = modelSel.value;
  if (!model) return toast(t("Nessun modello Ollama disponibile"), "error");
  const text = doc.editor.selectOrBlock();
  if (!text.trim()) return toast(t("Seleziona del testo o metti il cursore in un paragrafo"));
  sourceDoc = doc;
  setPref("ollamaModel", model);
  lastResult = "";
  out.textContent = "";
  out.classList.add("streaming");
  btnStop.hidden = false;
  panel.classList.add("busy");
  status.textContent = t("Il modello sta scrivendo…");
  const id = ++streamId;
  currentStream = id;
  const body = JSON.stringify({
    model, stream: true,
    messages: [
      { role: "system", content: "You are a precise writing assistant. Follow the instruction exactly and do not add comments, preambles or quotes around the answer." },
      { role: "user", content: `${prompt}\n\n---\n${text}\n---` },
    ],
    options: { temperature: 0.4 },
  });
  const r = await host.call("http", { url: base() + "/api/chat", method: "POST", body, streamId: id });
  if (currentStream !== id) return;
  out.classList.remove("streaming");
  btnStop.hidden = true;
  panel.classList.remove("busy");
  if (r.error) {
    status.textContent = r.error === "noconnect" ? t("Ollama non risponde.") : r.error;
    return;
  }
  if (r.rest) handleLine(r.rest, id);
  lastResult = lastResult.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "").trim();
  out.textContent = lastResult;
  status.textContent = r.aborted ? t("Interrotto.") : lastResult ? t("Fatto. Puoi sostituire il testo, inserirlo sotto o copiarlo.") : t("Nessuna risposta dal modello.");
}

function handleLine(line, id) {
  if (id !== currentStream) return;
  try {
    const j = JSON.parse(line);
    if (j.error) { status.textContent = "Ollama: " + j.error; return; }
    const piece = (j.message && j.message.content) || j.response || "";
    if (piece) {
      lastResult += piece;
      out.textContent = lastResult.replace(/^\s*<think>[\s\S]*?(<\/think>\s*|$)/, "");
      out.scrollTop = out.scrollHeight;
    }
  } catch { /* riga incompleta */ }
}

export function initAi() {
  panel = $("#ai-panel");
  modelSel = el("select", { class: "input", "aria-label": t("Modello Ollama"), onchange: () => setPref("ollamaModel", modelSel.value) });
  status = el("div", { class: "ai-status" });
  out = el("div", { class: "ai-out", "aria-live": "polite" });
  langInput = el("input", { class: "input small", value: defaultTarget(), "aria-label": t("Traduci in"), onchange: () => setPref("aiLanguage", langInput.value) });
  customInput = el("textarea", { class: "input", rows: 2, placeholder: t("Oppure scrivi un'istruzione (es. «trasforma in tabella»)…"), spellcheck: "true" });
  btnStop = el("button", { class: "btn small", hidden: true, html: ICONS.stop + "<span>" + t("Interrompi") + "</span>", onclick: () => { host.call("httpAbort", { streamId: currentStream }); } });
  actionsBox = el("div", { class: "ai-actions" }, ...ACTIONS.map((a) => el("button", {
    class: "chip", text: t(a.label),
    onclick: () => runAction(typeof a.prompt === "function" ? a.prompt(langInput.value || defaultTarget()) : a.prompt),
  })));
  const apply = (how) => {
    if (!lastResult) return;
    const d = sourceDoc && app.docs.includes(sourceDoc) ? sourceDoc : app.active;
    if (!d) return;
    if (how === "copy") { host.call("clipboardWrite", { text: lastResult }); toast(t("Copiato")); return; }
    if (how === "below") {
      // sposta il cursore alla fine della selezione e inserisce lì
      const ed = d.editor;
      if (ed.kind === "source") {
        const to = ed.view.state.selection.main.to;
        ed.view.dispatch({ selection: { anchor: to } });
        ed.insertText("\n\n" + lastResult + "\n");
      } else {
        const v = ed.view;
        const { $to } = v.state.selection;
        const end = $to.depth >= 1 ? $to.after(1) : v.state.selection.to;
        v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(Math.min(end, v.state.doc.content.size)))));
        ed.insertMarkdown(lastResult);
      }
    } else {
      d.editor.insertMarkdown(lastResult);
    }
    d.editor.focus();
  };
  panel.append(
    el("div", { class: "ai-head" },
      el("h2", { html: ICONS.sparkle + "<span>" + t("Assistente") + "</span>" }),
      el("button", { class: "icon-btn", title: t("Chiudi") + " (Ctrl+J)", "aria-label": t("Chiudi"), html: ICONS.close, onclick: () => toggleAi(false) })),
    el("label", { class: "field" }, el("span", { text: t("Modello Ollama") }), el("div", { class: "row" }, modelSel,
      el("button", { class: "icon-btn", title: t("Aggiorna elenco"), "aria-label": t("Aggiorna elenco"), html: ICONS.refresh, onclick: () => { loadPromise = loadModels(); } }))),
    actionsBox,
    el("label", { class: "field inline" }, el("span", { text: t("Traduci in") }), langInput),
    el("div", { class: "ai-custom" }, customInput, el("button", { class: "btn small primary", text: t("Esegui"), onclick: () => customInput.value.trim() && runAction(customInput.value.trim() + "\n\nReply only with the result, in Markdown.") })),
    status, out,
    el("div", { class: "ai-apply" }, btnStop,
      el("button", { class: "btn small primary", text: t("Sostituisci"), title: t("Sostituisce il testo selezionato"), onclick: () => apply("replace") }),
      el("button", { class: "btn small", text: t("Inserisci sotto"), onclick: () => apply("below") }),
      el("button", { class: "btn small", html: ICONS.copy + "<span>" + t("Copia") + "</span>", onclick: () => apply("copy") })),
  );
  customInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); customInput.nextSibling.click(); } });
  host.on("httpChunk", (d) => handleLine(d.line, d.id));
}

let loadPromise = null;
export function toggleAi(force) {
  const show = force ?? panel.hidden;
  panel.hidden = !show;
  document.body.classList.toggle("ai-open", show);
  if (show && !loadPromise) loadPromise = loadModels();
  if (!show && app.active && app.active.editor) app.active.editor.focus();
}

export async function runAiAction(id) {
  toggleAi(true);
  await loadPromise;
  const a = ACTIONS.find((x) => x.id === id);
  if (a) runAction(typeof a.prompt === "function" ? a.prompt(langInput.value || defaultTarget()) : a.prompt);
}

export { ACTIONS, on };
