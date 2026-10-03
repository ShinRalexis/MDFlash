// Collaudo del programma vero (MDFlash.exe) tramite la porta di debug di WebView2.
// Avviare prima:  set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
//                 build\MDFlash.exe
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright.mjs";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright(require, ROOT);

const T = "C:\\tmp\\mdflash-e2e";
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(path.join(T, "sotto"), { recursive: true });
const fixture = fs.readFileSync(path.join(ROOT, "tools/fixtures/roundtrip.md"), "utf8");
fs.writeFileSync(path.join(T, "prova.md"), fixture.replace(/\n/g, "\r\n")); // CRLF: deve restare CRLF
fs.writeFileSync(path.join(T, "sotto", "Altra nota.md"), "# Altra nota\n\nTesto della nota collegata.\n");
fs.writeFileSync(path.join(T, "seconda.md"), "# Seconda\n\nAperta da una seconda istanza.\n");
// immagine PNG 2x2 rossa
fs.mkdirSync(path.join(T, "assets"));
fs.writeFileSync(path.join(T, "assets", "mare.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDKjL3ZQAAAABJRU5ErkJggg==", "base64"));

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://localhost:9333");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.reload();
await page.waitForSelector("body.ready");
const ev = (fn, arg) => page.evaluate(fn, arg);

console.log("\n[apertura]");
await ev(async (p) => { await window.__mdflash.openPath(p); }, T + "\\prova.md");
await sleep(800);
let st = await ev(() => { const d = window.__mdflash.app.active; return { title: d.title, eol: d.eol, dirty: d.isDirty(), wiki: !!document.querySelector(".doc-view.active a.wikilink"), img: document.querySelector(".doc-view.active .milkdown-image-block img")?.src || "" }; });
ok(st.title === "prova.md", "titolo della scheda: " + st.title);
ok(st.eol === "crlf", "fine riga CRLF riconosciuto");
ok(!st.dirty, "appena aperto non risulta modificato");
ok(st.wiki, "il wikilink [[Altra nota]] è un collegamento");
ok(st.img.startsWith("https://c.drive.mdflash.example/tmp/mdflash-e2e/assets/mare.png"), "immagine relativa risolta: " + st.img);
const imgLoaded = await ev(() => { const i = document.querySelector(".doc-view.active .milkdown-image-block img"); return i && i.complete && i.naturalWidth; });
ok(imgLoaded === 2, "l'immagine locale si vede davvero (larghezza " + imgLoaded + ")");

console.log("\n[modifica e salvataggio]");
await page.click(".doc-view.active .ProseMirror h1");
await page.keyboard.press("End");
await page.keyboard.type(" modificato");
await sleep(300);
st = await ev(() => ({ dirty: window.__mdflash.app.active.isDirty(), tab: document.querySelector(".tab.active").className }));
ok(st.dirty && st.tab.includes("dirty"), "dopo la modifica la scheda mostra il pallino");
await page.keyboard.press("Control+s");
await sleep(800);
const saved = fs.readFileSync(path.join(T, "prova.md"), "utf8");
ok(saved.includes("# Titolo principale modificato"), "Ctrl+S scrive il file");
ok(saved.includes("\r\n") && !/[^\r]\n/.test(saved), "il file resta con fine riga CRLF");
ok(saved.includes("[[Altra nota]]") && saved.includes("![Foto del mare](assets/mare.png)"), "wikilink e testo alternativo intatti");
ok(saved.startsWith("---\r\ntitle: Prova di fedeltà"), "front matter intatto");
const verDir = path.join(process.env.APPDATA, "MDFlash", "versions");
const verFound = fs.existsSync(verDir) && fs.readdirSync(verDir).some((d) => fs.readFileSync(path.join(verDir, d, "source.txt"), "utf8").toLowerCase() === (T + "\\prova.md").toLowerCase());
ok(verFound, "copia nella cronologia delle versioni");
st = await ev(() => window.__mdflash.app.active.isDirty());
ok(!st, "dopo il salvataggio non risulta più modificato");

console.log("\n[modifica esterna]");
fs.writeFileSync(path.join(T, "prova.md"), saved.replace("modificato", "cambiato fuori"));
await ev(() => window.__mdflash.host.emit ? 0 : 0);
await sleep(5000); // controllo periodico ogni 4 s
st = await ev(() => document.querySelector(".doc-view.active .ProseMirror h1").textContent);
ok(st.includes("cambiato fuori"), "ricaricato dopo la modifica esterna: " + st);

console.log("\n[modalità sorgente]");
await page.keyboard.press("Control+u");
await sleep(500);
st = await ev(() => ({ mode: window.__mdflash.app.active.mode, cm: !!document.querySelector(".doc-view.active .mode-source .cm-content"), dirty: window.__mdflash.app.active.isDirty() }));
ok(st.mode === "source" && st.cm, "Ctrl+U passa al Markdown grezzo");
ok(!st.dirty, "il cambio di modalità non segna modifiche");
await page.keyboard.press("Control+u");
await sleep(500);

console.log("\n[ricerca]");
await page.keyboard.press("Control+f");
await page.keyboard.type("annidato");
await sleep(600);
st = await ev(() => document.querySelector(".find-count").textContent);
ok(/di 2/.test(st), "Trova conta le corrispondenze: " + st);
await page.keyboard.press("Escape");

console.log("\n[esportazioni]");
await ev((dir) => {
  window.__mdflashTestAnswers = {
    saveDialog: [{ path: dir + "\\out.pdf" }, { path: dir + "\\out.html" }, { path: dir + "\\out.docx" }],
    confirm: [{ index: 1 }],
  };
}, T);
await ev(() => window.__mdflash.run("file.exportPdf"));
await sleep(4000);
await ev(() => window.__mdflash.run("file.exportHtml"));
await sleep(2500);
await ev(() => window.__mdflash.run("file.exportDocx"));
await sleep(2500);
const sz = (f) => (fs.existsSync(path.join(T, f)) ? fs.statSync(path.join(T, f)).size : 0);
ok(sz("out.pdf") > 5000, "PDF creato (" + sz("out.pdf") + " byte)");
ok(fs.existsSync(path.join(T, "out.pdf")) && fs.readFileSync(path.join(T, "out.pdf")).slice(0, 4).toString() === "%PDF", "il PDF è un PDF valido");
const html = fs.existsSync(path.join(T, "out.html")) ? fs.readFileSync(path.join(T, "out.html"), "utf8") : "";
ok(html.includes("<h1") && html.includes("katex") && html.includes("<table"), "HTML con titoli, formule e tabelle");
ok(html.includes('src="assets/mare.png"'), "HTML con l'immagine in percorso relativo");
ok(sz("out.docx") > 1000 && fs.readFileSync(path.join(T, "out.docx")).slice(0, 2).toString() === "PK", "Word (.docx) creato senza Pandoc (" + sz("out.docx") + " byte)");

console.log("\n[wikilink]");
await page.click(".doc-view.active a.wikilink", { modifiers: ["Control"] });
await sleep(1200);
st = await ev(() => window.__mdflash.app.active.title);
ok(st === "Altra nota.md", "Ctrl+clic sul wikilink apre la nota nella sottocartella: " + st);

console.log("\n[seconda istanza]");
const before = await ev(() => window.__mdflash.app.docs.length);
spawn(path.join(ROOT, "build/MDFlash.exe"), [T + "\\seconda.md"], { detached: true, stdio: "ignore" }).unref();
await sleep(2500);
st = await ev(() => ({ n: window.__mdflash.app.docs.length, t: window.__mdflash.app.active.title }));
ok(st.n === before + 1 && st.t === "seconda.md", "doppio clic su un altro .md lo apre come nuova scheda (" + st.n + " schede)");

console.log("\n[tema scuro]");
await ev(() => window.__mdflash.run("theme.notte"));
await sleep(500);
st = await ev(() => getComputedStyle(document.body).backgroundColor);
ok(st === "rgb(29, 31, 35)", "tema Notte applicato: " + st);

// pulizia: il collaudo non deve lasciare tracce nelle impostazioni dell'utente
await ev(async () => {
  const { app, run } = window.__mdflash;
  run("theme.github");
  for (const d of [...app.docs]) if (d.path && d.path.toLowerCase().includes("mdflash-e2e")) { d.markClean(); app.active = d; await run("file.close"); }
  app.recent = app.recent.filter((p) => !p.toLowerCase().includes("mdflash-e2e"));
  localStorage.setItem("mdflash.recent", JSON.stringify(app.recent));
});
const verRoot = path.join(process.env.APPDATA, "MDFlash", "versions");
for (const d of fs.existsSync(verRoot) ? fs.readdirSync(verRoot) : []) {
  const s = path.join(verRoot, d, "source.txt");
  if (fs.existsSync(s) && fs.readFileSync(s, "utf8").toLowerCase().includes("mdflash-e2e")) fs.rmSync(path.join(verRoot, d), { recursive: true });
}

console.log("\nErrori nella pagina: " + (errors.filter((e) => !e.includes("ERR_FILE_NOT_FOUND")).join(" | ") || "nessuno"));
console.log(`\nRisultato: ${pass} superati, ${fail} falliti`);
await browser.close();
process.exit(fail ? 1 : 0);
