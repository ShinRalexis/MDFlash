// Ponte verso il programma C (WebView2: window.chrome.webview).
// Ogni chiamata è una promessa: si invia { t, id, ...args } e il C risponde
// con { re: id, data }. Gli avvisi spontanei del C arrivano come { ev, data }.
//
// Fuori da WebView2 (collaudo nel browser) si usa un finto host in memoria.

const wv = window.chrome && window.chrome.webview;
let nextId = 1;
const pending = new Map();
const listeners = new Map();

export const isNative = !!wv;

function dispatch(msg) {
  if (msg && typeof msg.re === "number") {
    const p = pending.get(msg.re);
    if (p) {
      pending.delete(msg.re);
      p(msg.data || {});
    }
    return;
  }
  if (msg && msg.ev) {
    const set = listeners.get(msg.ev);
    if (set) for (const fn of set) {
      try { fn(msg.data || {}); } catch (e) { console.error(e); }
    }
  }
}

if (wv) wv.addEventListener("message", (e) => dispatch(e.data));

export function call(t, args = {}, transfer) {
  // Collaudo automatico: risposte preimpostate per dialoghi e conferme, che
  // altrimenti fermerebbero il test aspettando un clic.
  const q = window.__mdflashTestAnswers;
  if (q && q[t] && q[t].length) return Promise.resolve(q[t].shift());
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const msg = { t, id, ...args };
    if (wv) {
      if (transfer && transfer.length && wv.postMessageWithAdditionalObjects)
        wv.postMessageWithAdditionalObjects(msg, transfer);
      else wv.postMessage(msg);
    } else {
      mock(msg).then((data) => dispatch({ re: id, data }));
    }
  });
}

export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev).delete(fn);
}

// Solo per i test nel browser: simula un evento proveniente dal C.
export function emit(ev, data) {
  dispatch({ ev, data });
}

/* ---------- finto host per il collaudo nel browser ---------- */
const memFs = new Map(); // percorso -> { text, mtime }
window.__mdflashMock = { memFs, emit, calls: [] };

async function mock(msg) {
  window.__mdflashMock.calls.push(msg);
  const p = msg.path;
  switch (msg.t) {
    case "ready":
      return { version: "dev", files: [], pandoc: null, documents: "C:\\Users\\Prova\\Documenti", dataDir: "C:\\mock", temp: "C:\\Temp\\", zoom: 1, locale: "it-IT", systemDark: false };
    case "readFile": {
      const f = memFs.get(p);
      return f ? { text: f.text, encoding: "utf-8", bom: false, eol: "lf", mtime: f.mtime } : { error: "File non trovato" };
    }
    case "writeFile":
      memFs.set(p, { text: msg.text, mtime: Date.now() });
      return { mtime: Date.now() };
    case "writeBinary":
      memFs.set(p, { text: "(binario)", mtime: Date.now() });
      return { mtime: Date.now() };
    case "stat": {
      const f = memFs.get(p);
      return f ? { exists: true, dir: false, mtime: f.mtime } : { exists: false };
    }
    case "statMany":
      return { stats: msg.paths.map((x) => (memFs.has(x) ? { exists: true, mtime: memFs.get(x).mtime } : { exists: false })) };
    case "listDir": {
      const pre = p.replace(/\\?$/, "\\");
      const names = new Map();
      for (const k of memFs.keys()) if (k.startsWith(pre)) {
        const rest = k.slice(pre.length).split("\\");
        names.set(rest[0], rest.length > 1);
      }
      return { entries: [...names].map(([name, dir]) => ({ name, dir, mtime: 0, size: 0 })) };
    }
    case "listTree": {
      const pre = p.replace(/\\?$/, "\\");
      return { files: [...memFs.keys()].filter((k) => k.startsWith(pre)).map((k) => ({ path: k, rel: k.slice(pre.length), mtime: memFs.get(k).mtime })) };
    }
    case "search": {
      const pre = p.replace(/\\?$/, "\\");
      const q = (msg.query || "").toLowerCase();
      const results = [];
      for (const [k, f] of memFs) if (k.startsWith(pre)) {
        const lines = f.text.split("\n");
        const matches = [];
        lines.forEach((l, i) => { const c = l.toLowerCase().indexOf(q); if (q && c >= 0) matches.push({ line: i + 1, text: l, col: c, len: q.length }); });
        if (matches.length) results.push({ path: k, rel: k.slice(pre.length), matches });
      }
      return { results };
    }
    case "listSnapshots":
      return { versions: [] };
    case "openDialog":
    case "saveDialog":
    case "folderDialog":
      return window.__mdflashMock.dialogResult || { canceled: true };
    case "confirm":
      return { index: window.__mdflashMock.confirmIndex ?? 0 };
    case "clipboardRead":
      return { text: "" };
    case "listThemes":
      return { dir: "C:\\mock\\themes", themes: [] };
    case "native":
      return { ok: true, fullscreen: false, topmost: false, zoom: 1 };
    default:
      return { ok: true };
  }
}
