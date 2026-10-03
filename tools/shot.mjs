// Uso: node tools/shot.mjs <nome> "<codice JS da eseguire nella pagina>" [attesa ms] [tema]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright.mjs";
import { serve } from "./serve.mjs";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright(require, ROOT);
const [name = "shot", code = "", wait = "1500"] = process.argv.slice(2);
const server = await serve(5179);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
await page.goto("http://localhost:5179/index.html");
await page.waitForSelector("body.ready", { timeout: 15000 });
if (code) { const r = await page.evaluate(`(async () => { ${code} })()`); if (r !== undefined) console.log("risultato:", JSON.stringify(r)); }
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: path.join(ROOT, `build/${name}.png`) });
console.log(errors.join("\n") || "nessun errore");
await browser.close(); server.close();
