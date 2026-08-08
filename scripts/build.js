#!/usr/bin/env node
/* Build: inline src/ into a single self-contained dist/water-clock.html.
 *
 * This is deliberately a naive module concatenator, not a real bundler.
 * It works because the source keeps three rules (documented in CLAUDE.md):
 *   1. imports are only between local src modules, written as plain
 *      `import { … } from "./x.js";` statements;
 *   2. exports are only `export const …` / `export function …`;
 *   3. top-level names are unique across all src modules.
 * Concatenating shaders.js → params.js → main.js with the import lines
 * removed and the `export ` keywords stripped is then exactly the original
 * single-script program.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

const ORDER = ["src/shaders.js", "src/params.js", "src/main.js"];

function stripModuleSyntax(code) {
  // Remove import statements (single- or multi-line, ending in `from "…";`).
  code = code.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "");
  // export const X / export function f  →  const X / function f
  code = code.replace(/^export\s+(const|let|var|function|class)\b/gm, "$1");
  return code;
}

const bundle = ORDER.map(f => stripModuleSyntax(read(f)).trim()).join("\n\n");
const css = read("src/style.css").trimEnd();

let html = read("index.html");
html = html.replace(
  /<link rel="stylesheet" href="\.\/src\/style\.css">/,
  `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  `<script>\n"use strict";\n${bundle}\n</script>`
);

if (html.includes("src/main.js") || html.includes("src/style.css"))
  throw new Error("build: template substitution failed — check index.html tags");

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
// water-clock.html is the file you double-click; index.html is the same
// bytes under the name a static host (Vercel) serves at "/".
const outputs = ["water-clock.html", "index.html"];
for (const name of outputs) fs.writeFileSync(path.join(root, "dist", name), html);
console.log(
  `built dist/{${outputs.join(",")}} (${(html.length / 1024).toFixed(1)} kB)`
);
