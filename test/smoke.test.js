/* Headless smoke test for dist/water-clock.html.
 *
 * jsdom + an instrumented WebGL2 stub that PARSES UNIFORMS OUT OF THE GLSL,
 * so every gl.uniform* call in JS is cross-checked against the shader that
 * is actually bound. Catches the classic silent killers:
 *   - JS/GLSL uniform name mismatches (getUniformLocation returns null)
 *   - setting a uniform while the wrong program is bound
 *   - init-order crashes, resize crashes, event-handler crashes
 *
 * Two scenarios: a normal 60-frame run with resize / pointer / theme keys /
 * pause / debug cycling, and a prefers-reduced-motion run that must start
 * paused behind the veil until the user opts in.
 *
 * Run `npm test` (builds first). No GPU needed.
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const distFile = path.join(__dirname, "..", "dist", "water-clock.html");
if (!fs.existsSync(distFile)) {
  console.error("dist/water-clock.html missing — run `npm run build` first.");
  process.exit(1);
}
const html = fs.readFileSync(distFile, "utf8");

/* ------------------------- instrumented WebGL2 stub ------------------------ */

const GLc = {};
let cEnum = 1;
["VERTEX_SHADER","FRAGMENT_SHADER","COMPILE_STATUS","LINK_STATUS","ACTIVE_UNIFORMS",
 "ARRAY_BUFFER","STATIC_DRAW","FLOAT","TRIANGLES","TEXTURE_2D","TEXTURE_MIN_FILTER",
 "TEXTURE_MAG_FILTER","TEXTURE_WRAP_S","TEXTURE_WRAP_T","LINEAR","CLAMP_TO_EDGE",
 "RGBA16F","RGBA","HALF_FLOAT","UNSIGNED_BYTE","FRAMEBUFFER","COLOR_ATTACHMENT0",
 "TEXTURE0","UNPACK_FLIP_Y_WEBGL"].forEach(k => (GLc[k] = cEnum++));
GLc.TEXTURE0 = 33984;

function makeGL(canvas) {
  const errors = [];
  let curProgram = null;
  let drawCount = 0;
  const gl = {
    ...GLc, canvas,
    getExtension: name => (name === "EXT_color_buffer_float" ? {} : null),
    createVertexArray: () => ({}), bindVertexArray() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    createShader: t => ({ t, src: "" }),
    shaderSource: (s, src) => { s.src = src; },
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    createProgram: () => ({ shaders: [], uniforms: null }),
    attachShader: (p, s) => p.shaders.push(s),
    bindAttribLocation() {},
    linkProgram: p => {
      const names = new Set();
      for (const s of p.shaders) {
        const re = /uniform\s+\w+\s+(\w+)\s*;/g;
        let m;
        while ((m = re.exec(s.src))) names.add(m[1]);
      }
      p.uniforms = names;
    },
    getProgramParameter: (p, k) => (k === GLc.LINK_STATUS ? true : p.uniforms.size),
    getProgramInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: [...p.uniforms][i] }),
    getUniformLocation: (p, name) =>
      p.uniforms.has(name)
        ? { name, p }
        : (errors.push(`getUniformLocation miss: ${name}`), null),
    useProgram: p => { curProgram = p; },
    createTexture: () => ({}),
    bindTexture() {}, texParameteri() {}, pixelStorei() {}, texImage2D() {},
    createFramebuffer: () => ({}),
    bindFramebuffer() {}, framebufferTexture2D() {},
    viewport() {}, activeTexture() {},
    drawArrays: () => { drawCount++; },
    uniform1i: l => check(l), uniform1f: l => check(l),
    uniform2f: l => check(l), uniform3f: l => check(l),
    uniform2fv: l => check(l), uniform3fv: l => check(l),
  };
  function check(loc) {
    if (loc === undefined)
      errors.push("uniform set with UNDEFINED location (JS/GLSL name mismatch)");
    else if (loc && curProgram && loc.p !== curProgram)
      errors.push(`uniform '${loc.name}' set on wrong program`);
  }
  gl.__errors = errors;
  gl.__draws = () => drawCount;
  return gl;
}

/* ------------------------------ scenario runner ---------------------------- */

function runScenario({ name, reducedMotion, url }) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: url || "https://example.test/",
  });
  const { window } = dom;

  window.matchMedia = q => ({
    matches: reducedMotion && q.includes("prefers-reduced-motion"),
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });

  let rafQueue = [];
  window.requestAnimationFrame = cb => (rafQueue.push(cb), rafQueue.length);
  const pump = n => {
    for (let i = 0; i < n; i++) {
      const q = rafQueue; rafQueue = [];
      for (const cb of q) cb(Date.now());
    }
  };

  const ctx2dCalls = [];
  const make2D = canvas =>
    new Proxy({}, {
      get: (_, k) => (k === "canvas" ? canvas : (...a) => { ctx2dCalls.push([k, a]); }),
      set: () => true,
    });

  let theGL = null;
  window.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind === "webgl2") return (theGL = makeGL(this));
    if (kind === "2d") return make2D(this);
    return null;
  };
  Object.defineProperty(window.HTMLCanvasElement.prototype, "clientWidth",  { get: () => 1280 });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "clientHeight", { get: () => 800 });
  window.devicePixelRatio = 2;

  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  window.eval(script);

  return { window, pump, gl: () => theGL, ctx2dCalls };
}

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

/* Scenario 1: normal run --------------------------------------------------- */
{
  const { window, pump, gl, ctx2dCalls } =
    runScenario({ name: "normal", reducedMotion: false, url: "https://example.test/?feed=0.054" });

  pump(5);
  window.dispatchEvent(new window.Event("resize"));
  const mm = new window.MouseEvent("mousemove", { clientX: 400, clientY: 300 });
  Object.defineProperties(mm, { movementX: { value: 12 }, movementY: { value: -7 } });
  window.dispatchEvent(mm);
  pump(10);

  for (const key of ["2", "3", "4", "1", "d", "d", "d", "d", " ", " "]) {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key }));
    pump(2);
  }
  pump(5);

  const errs = gl().__errors;
  assert(errs.length === 0, `normal: GL stub errors:\n  ${errs.join("\n  ")}`);
  assert(gl().__draws() > 100, `normal: too few draw calls (${gl().__draws()})`);

  const fillTexts = ctx2dCalls.filter(c => c[0] === "fillText").map(c => c[1][0]);
  assert(fillTexts.length > 0, "normal: time was never rasterized (no fillText)");
  assert(
    fillTexts.every(t => /^\d\d[: ]\d\d[: ]\d\d$/.test(t)),
    `normal: unexpected mask text: ${JSON.stringify(fillTexts[0])}`
  );
  const seps = new Set(fillTexts.map(t => t[2]));
  console.log(`normal        OK — ${gl().__draws()} draws, mask "${fillTexts.at(-1)}", separators seen: ${[...seps].map(JSON.stringify).join(" ")}`);
}

/* Scenario 2: prefers-reduced-motion gate ---------------------------------- */
{
  const { window, pump, gl } = runScenario({ name: "reduced", reducedMotion: true });
  const veil = window.document.getElementById("veil");

  pump(10);
  assert(veil.classList.contains("show"), "reduced: veil not shown at start");
  assert(gl().__draws() === 0, `reduced: simulated while paused (${gl().__draws()} draws)`);

  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
  pump(10);
  assert(!veil.classList.contains("show"), "reduced: veil still shown after opt-in");
  assert(gl().__draws() > 0, "reduced: no draws after opt-in");
  console.log(`reduced       OK — paused behind veil, ${gl().__draws()} draws after opt-in`);
}

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error("\nSMOKE TEST FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("\nSMOKE TEST PASSED");
