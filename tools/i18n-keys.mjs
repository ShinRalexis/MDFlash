// Elenca i testi da tradurre (t("...") nel codice) e controlla i dizionari.
//   node tools/i18n-keys.mjs          stampa le chiavi mancanti per ogni lingua
//   node tools/i18n-keys.mjs --list   scrive build/i18n-keys.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web/src");
const keys = new Set();
const unq = (s) => JSON.parse('"' + s + '"');

for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith(".js") && x !== "i18n.js")) {
  const code = fs.readFileSync(path.join(SRC, f), "utf8");
  for (const m of code.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(unq(m[1]));
  // testi tradotti indirettamente: t(th.name), t(a.label), t(f.name)
  if (f === "themes.js" || f === "export.js") for (const m of code.matchAll(/\bname: "((?:[^"\\]|\\.)*)"/g)) keys.add(unq(m[1]));
  if (f === "ai.js") for (const m of code.matchAll(/\blabel: "((?:[^"\\]|\\.)*)"/g)) keys.add(unq(m[1]));
}
const list = [...keys].sort((a, b) => a.localeCompare(b, "it"));

if (process.argv.includes("--list")) {
  fs.writeFileSync(path.join(ROOT, "build/i18n-keys.json"), JSON.stringify(list, null, 1));
  console.log(list.length + " testi");
} else {
  let bad = 0;
  for (const lang of ["en", "es", "fr", "de", "ja", "ko", "zh", "ru"]) {
    const dict = (await import(pathToFileURL(path.join(SRC, "locales", lang + ".js")).href)).default;
    const missing = list.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !keys.has(k));
    const placeholders = list.filter((k) => k in dict && (k.match(/\{\d\}/g) || []).sort().join() !== (dict[k].match(/\{\d\}/g) || []).sort().join());
    console.log(`${lang}: ${Object.keys(dict).length} voci, mancanti ${missing.length}, in più ${extra.length}, segnaposto errati ${placeholders.length}`);
    for (const k of missing.slice(0, 15)) console.log("   manca: " + k);
    for (const k of placeholders) console.log("   segnaposto: " + k);
    bad += missing.length + placeholders.length;
  }
  process.exit(bad ? 1 : 0);
}
