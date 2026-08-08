#!/usr/bin/env node
/* Tiny static server for development (ES modules can't load from file://).
 * No dependencies. `npm run dev`, then open the printed URL.               */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (urlPath.endsWith("/")) file = path.join(file, "index.html");

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`water clock dev server → http://localhost:${port}/`);
  console.log(`built single file      → http://localhost:${port}/dist/water-clock.html`);
});
