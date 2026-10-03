// Piccolo server statico per collaudare build/app nel browser.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../build/app");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8", ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff", ".png": "image/png" };
export function serve(port = 5179) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    }).listen(port, () => resolve(s));
  });
}
