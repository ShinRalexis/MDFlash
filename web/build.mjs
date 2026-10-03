// Compila l'interfaccia in ../build/app (caricata da MDFlash.exe tramite WebView2).
//   node build.mjs          compilazione ottimizzata
//   node build.mjs --watch  ricompila a ogni modifica
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../build/app");
const watch = process.argv.includes("--watch");
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.resolve(here, from), path.join(out, to));
function copyDir(from, to) {
  const src = path.resolve(here, from), dst = path.join(out, to);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  legalComments: "none",
};

const app = {
  ...common,
  entryPoints: { app: path.resolve(here, "src/main.js") },
  outdir: out,
  format: "iife",
  target: ["chrome120"],
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  assetNames: "fonts/[name]",
  define: { "process.env.NODE_ENV": '"production"', __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
};

// Stile dei file HTML esportati: senza annidamenti, per ogni browser
const exportCss = {
  ...common,
  entryPoints: { export: path.resolve(here, "styles/export-entry.css") },
  outdir: out,
  target: ["chrome90", "firefox90", "safari14"],
};
fs.writeFileSync(path.resolve(here, "styles/export-entry.css"), '@import "./document.css";\n@import "./export-extra.css";\n');

copy("index.html", "index.html");
for (const f of fs.readdirSync(here).filter((x) => /^guida(-[a-z]{2})?\.md$/.test(x))) copy(f, f);
copy("../assets/icon.svg", "icon.svg");
copy("node_modules/mermaid/dist/mermaid.min.js", "mermaid.min.js");
copy("node_modules/katex/dist/katex.min.css", "katex.css");
copyDir("node_modules/katex/dist/fonts", "fonts");

if (watch) {
  const c1 = await esbuild.context(app);
  const c2 = await esbuild.context(exportCss);
  await Promise.all([c1.watch(), c2.watch()]);
} else {
  await esbuild.build(app);
  await esbuild.build(exportCss);
}
