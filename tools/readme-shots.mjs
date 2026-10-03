// Schermate per il README: node tools/readme-shots.mjs  ->  docs/screenshots/*.png
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright.mjs";
import { serve } from "./serve.mjs";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright(require, ROOT);
const OUT = path.join(ROOT, "docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const server = await serve(5179);
const browser = await chromium.launch();

async function shot(name, { lang = "en", theme = "github", setup }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: lang });
  await ctx.addInitScript(([l, th]) => {
    localStorage.setItem("mdflash.prefs.v2", JSON.stringify({ language: l, theme: th, sidebarPanel: "outline" }));
  }, [lang, theme]);
  const page = await ctx.newPage();
  await page.goto("http://localhost:5179/index.html");
  await page.waitForSelector("body.ready");
  await page.evaluate(setup);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, name + ".png") });
  await ctx.close();
  console.log("  " + name);
}

const openGuide = `(async () => {
  const { app, run } = window.__mdflash;
  run("help.guide");
  await new Promise((r) => setTimeout(r, 1200));
  for (const d of [...app.docs]) if (d !== app.active && !d.isDirty()) { app.docs.splice(app.docs.indexOf(d), 1); d.destroy(); }
  window.__mdflash.app.active && document.dispatchEvent(new Event("x"));
})()`;
const scrollTo = (heading) => `(async () => {
  await ${openGuide};
  await new Promise((r) => setTimeout(r, 600));
  const h = [...document.querySelectorAll(".doc-view.active .ProseMirror h2")].find((x) => x.textContent.includes("${heading}"));
  if (h) document.querySelector(".doc-view.active .doc-scroll").scrollTop = h.offsetTop - 30;
})()`;

await shot("editor-light", { setup: openGuide });
await shot("editor-dark", { theme: "notte", setup: scrollTo("Math") });
await shot("source-mode", { theme: "nord", setup: `(async () => { await ${openGuide}; await new Promise((r) => setTimeout(r, 600)); window.__mdflash.run("view.source"); })()` });
await shot("japanese", { lang: "ja", theme: "carta", setup: scrollTo("表") });
await browser.close();
server.close();
