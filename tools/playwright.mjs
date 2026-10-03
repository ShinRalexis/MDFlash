// Playwright per i collaudi: quello installato con `npm install` nella radice
// del progetto, oppure quello indicato da PLAYWRIGHT_PATH.
import path from "node:path";

export function loadPlaywright(require, root) {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", path.join(root, "node_modules/playwright"), path.join(root, "_archivio_electron/node_modules/playwright")].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* si prova il successivo */ }
  }
  throw new Error("Playwright non trovato: eseguire `npm install` nella cartella del progetto");
}
