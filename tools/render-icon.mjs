// Disegna assets/icon.svg in PNG di varie misure e crea i file .ico.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright.mjs";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright(require, ROOT);

const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const svgApp = fs.readFileSync(path.join(ROOT, "assets/icon.svg"), "utf8");
const svgDoc = fs.readFileSync(path.join(ROOT, "assets/doc-icon.svg"), "utf8");
const out = path.join(ROOT, "build/icons");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// Formato ICO: intestazione, una voce per misura, poi i PNG uno dopo l'altro.
function ico(pngs) {
  const head = Buffer.alloc(6 + pngs.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

for (const [name, svg] of [["mdflash", svgApp], ["mdfile", svgDoc]]) {
  const pngs = [];
  for (const s of sizes) {
    const data = await render(svg, s);
    fs.writeFileSync(path.join(out, `${name}-${s}.png`), data);
    pngs.push({ size: s, data });
  }
  fs.writeFileSync(path.join(ROOT, `assets/${name}.ico`), ico(pngs));
}
await browser.close();
console.log("icone create");
