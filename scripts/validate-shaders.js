#!/usr/bin/env node
/* Validate every shader in src/shaders.js with glslangValidator (Khronos
 * reference compiler). Shaders are reconstructed exactly as the JS builds
 * them (HEAD + body) using the GLSL markers, then compiled as GLSL ES 1.00.
 *
 *   sudo apt install glslang-tools     # Debian/Ubuntu
 *   brew install glslang               # macOS
 *
 * If the validator isn't installed the script SKIPs (exit 0) so `npm test`
 * still works everywhere; install it to get real shader compilation checks.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "shaders.js"), "utf8");

const probe = spawnSync("glslangValidator", ["--version"], { encoding: "utf8" });
if (probe.error) {
  console.log("SKIP: glslangValidator not found on PATH (apt install glslang-tools).");
  process.exit(0);
}

const head = src.match(/const HEAD = `([^`]*)`;/)[1];
const vert = src.match(/const VERT = `([^`]*)`;/)[1];

const blocks = [...src.matchAll(/\/\*GLSL:(\w+)\*\/([\s\S]*?)\/\*END\*\//g)].map(m => {
  const body = m[2].match(/const \w+ = HEAD \+ `([\s\S]*)`;\s*$/);
  return { name: m[1], glsl: body && "#version 100\n" + head + body[1] };
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wc-glsl-"));
let ok = true;

function check(name, ext, glsl) {
  const file = path.join(tmp, name + ext);
  fs.writeFileSync(file, glsl);
  const r = spawnSync("glslangValidator", [file], { encoding: "utf8" });
  const pass = r.status === 0;
  console.log(`[${name}] ${pass ? "OK" : "FAIL"}`);
  if (!pass) { console.log(r.stdout, r.stderr); ok = false; }
}

check("vertex", ".vert", "#version 100\n" + vert);
for (const b of blocks) {
  if (!b.glsl) { console.log(`[${b.name}] FAIL — could not extract body`); ok = false; continue; }
  check(b.name, ".frag", b.glsl);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? `\nall ${blocks.length + 1} shaders compile clean` : "\nshader validation FAILED");
process.exit(ok ? 0 : 1);
