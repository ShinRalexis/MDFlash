// Componenti di base: menu contestuale, finestra modale, richiesta di testo.
import { el, $ } from "./util.js";
import { t } from "./i18n.js";

/* ---------- menu contestuale ---------- */
let openMenu = null;

export function closeContextMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

// items: [{ label, action, accel, disabled, danger } | "-"]
export function contextMenu(items, x, y) {
  closeContextMenu();
  const m = el("div", { class: "ctx-menu", role: "menu" });
  for (const it of items) {
    if (it === "-") { m.append(el("div", { class: "ctx-sep" })); continue; }
    const b = el("button", {
      class: "ctx-item" + (it.danger ? " danger" : ""), role: "menuitem", disabled: it.disabled,
      onclick: () => { closeContextMenu(); it.action && it.action(); },
    }, el("span", { text: it.label }), it.accel ? el("kbd", { text: it.accel }) : null);
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 6) + "px";
  openMenu = m;
  const first = m.querySelector("button:not([disabled])");
  first && first.focus();
  m.addEventListener("keydown", (e) => {
    const btns = [...m.querySelectorAll("button:not([disabled])")];
    const i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); closeContextMenu(); }
  });
}

document.addEventListener("mousedown", (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeContextMenu();
}, true);
window.addEventListener("blur", closeContextMenu);

/* ---------- finestra modale ---------- */
let modalStack = [];

export function modal({ title, body, buttons = [], width, className = "", onClose }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const box = el("div", { class: "modal " + className, role: "dialog", "aria-modal": "true", "aria-label": title });
  if (width) box.style.width = width;
  const close = (result) => {
    backdrop.remove();
    modalStack = modalStack.filter((m) => m !== api);
    onClose && onClose(result);
    const prev = document.activeElement;
    if (!modalStack.length && prev) setTimeout(() => window.dispatchEvent(new Event("mdflash-refocus")), 0);
  };
  const head = el("div", { class: "modal-head" },
    el("h2", { text: title }),
    el("button", { class: "icon-btn", title: t("Chiudi (Esc)"), "aria-label": t("Chiudi"), onclick: () => close(null), html: ICONS.close }));
  const content = el("div", { class: "modal-body" });
  if (body) content.append(body);
  const foot = el("div", { class: "modal-foot" });
  for (const b of buttons) {
    foot.append(el("button", {
      class: "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""),
      onclick: () => { const r = b.action ? b.action() : b.value; if (r !== false) close(b.value); },
    }, b.label));
  }
  box.append(head, content);
  if (buttons.length) box.append(foot);
  backdrop.append(box);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(null); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(null); }
  });
  document.body.append(backdrop);
  const api = { close, box, content, foot };
  modalStack.push(api);
  setTimeout(() => {
    const f = box.querySelector("[autofocus], input, textarea, select, .btn.primary");
    f && f.focus();
  }, 0);
  return api;
}

export const anyModalOpen = () => modalStack.length > 0;

// Chiede un testo (es. nuovo nome di un file). Restituisce null se annullato.
export function prompt(title, label, value = "", { selectStem = false } = {}) {
  return new Promise((resolve) => {
    const input = el("input", { class: "input", type: "text", value, spellcheck: "false" });
    const body = el("label", { class: "field" }, el("span", { text: label }), input);
    let done = false;
    const m = modal({
      title, body, width: "420px",
      buttons: [
        { label: t("Annulla"), value: null },
        { label: t("OK"), primary: true, action: () => { done = true; resolve(input.value.trim() || null); } },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done = true; resolve(input.value.trim() || null); m.close(); }
    });
    setTimeout(() => {
      input.focus();
      const dot = value.lastIndexOf(".");
      if (selectStem && dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    }, 10);
  });
}

/* ---------- icone (SVG in linea, tratto da 1.6) ---------- */
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  outline: svg('<path d="M4 6h16M7 12h13M10 18h10"/>'),
  files: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  code: svg('<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>'),
  folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19l2.5-8h16L19 19z"/>'),
  fileNew: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>'),
  folderNew: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  replace: svg('<path d="M4 7h11l-3-3M20 17H9l3 3"/>'),
  sparkle: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  focus: svg('<circle cx="12" cy="12" r="3"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5"/>'),
  // marchi pieni (non a tratto)
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
  liberapay: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.6 17.9c-1.3 0-2.3-.2-3-.5-.7-.4-1.2-.9-1.4-1.5-.3-.6-.4-1.4-.3-2.3l2.3-11.3 3.1-.5-2.5 11.9c-.1.4-.1.8 0 1.1 0 .3.2.6.4.8.2.2.5.4.9.5.4.1.9.2 1.5.2l-1 1.6zm10.9-6.5c0 1.1-.2 2-.5 2.9-.3.9-.8 1.7-1.4 2.3-.6.7-1.3 1.2-2.1 1.6-.8.4-1.8.6-2.8.6-.5 0-1 0-1.5-.1l-1 4.6H8.2l3.5-16.2c.6-.2 1.2-.3 1.9-.4.7-.1 1.4-.1 2-.1.7 0 1.4.1 1.9.3.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.5.6.7 1.3.7 2.2zm-7.5 4.6c.3.1.7.1 1.1.1.6 0 1.2-.1 1.7-.4.5-.2.9-.6 1.3-1 .4-.4.6-.9.8-1.5.2-.6.3-1.2.3-1.8 0-.6-.1-1.1-.4-1.5-.3-.4-.8-.6-1.6-.6-.5 0-1 0-1.4.1L13 16z"/></svg>',
};
