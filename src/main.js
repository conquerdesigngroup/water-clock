/* ============================================================================
   WATER CLOCK — a faithful recreation of chiuhans111's "Fluid Glass"
   ----------------------------------------------------------------------------
   The motion is three coupled systems, stepped 10× per frame at ~0.5× res:

   1. REACTION–DIFFUSION (Gray–Scott, 3 chemicals). The digital time,
      rasterized to a canvas every frame, feeds chemicals where the glyphs
      are — so liquid continuously condenses out of the digits, buds into
      droplets, and dissolves when the time changes.
   2. NAVIER–STOKES fluid. The liquid's own thickness gradient accelerates
      a velocity field (blobs push outward); a divergence-relaxation step
      keeps it incompressible-ish; both velocity and chemicals are advected
      semi-Lagrangian. The pointer stamps velocity through a flowmap: you
      stir the clock.
   3. GLASS SHADING. Thickness → surface normal → double refraction
      (n = 1.33, water) with per-channel chromatic offsets, a thresholded
      anisotropic specular streak, and a Fresnel edge — composited over an
      analog background: three giant lens-circles (hour / minute / second)
      orbiting the center, each refracting the layers behind it, drifting
      on parallax from pointer or device tilt.
   ==========================================================================*/

import {
  VERT, FRAG_COPY, FRAG_FLOW, FRAG_FLUID_VELOCITY, FRAG_DIVERGENCE,
  FRAG_CORRECTION, FRAG_ADVECTION, FRAG_REACTION_DIFFUSION,
  FRAG_BACKGROUND_CLOCK, FRAG_GLASS, FRAG_DEBUG,
} from "./shaders.js";
import { qs, num, hex, P, PRESETS, BACKGROUNDS, applyPreset } from "./params.js";

/* ------------------------------ WebGL setup ------------------------------ */

const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", {
  alpha: false, antialias: false, depth: false, stencil: false,
  premultipliedAlpha: false, preserveDrawingBuffer: false,
});

function fatal(msg) {
  const el = document.getElementById("fail");
  el.innerHTML = msg;
  el.classList.add("show");
  throw new Error(msg);
}
if (!gl) fatal("This water clock needs WebGL2.<br>Your browser or GPU settings have it turned off.");
if (!gl.getExtension("EXT_color_buffer_float") &&
    !gl.getExtension("EXT_color_buffer_half_float"))
  fatal("This water clock needs float render targets<br>(EXT_color_buffer_float), which this GPU doesn't expose.");

/* Fullscreen triangle: position −1…3 covers the screen, uv 0…2 matches. */
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1, 0,0,   3,-1, 2,0,   -1,3, 0,2,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

function compile(type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    fatal(`Shader "${label}" failed:<br><pre style="text-align:left">${gl.getShaderInfoLog(s)}</pre>`);
  return s;
}
function makeProgram(fragSrc, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT, label + ".vert"));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc, label + ".frag"));
  gl.bindAttribLocation(p, 0, "position");
  gl.bindAttribLocation(p, 1, "uv");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    fatal(`Link "${label}" failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

/* A render target: RGBA16F texture + FBO, linear, clamped. */
function makeTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const t = {
    tex, fbo, w, h,
    setSize(nw, nh) {              // reallocates; contents are lost on purpose
      if (nw === t.w && nh === t.h) return;
      t.w = nw; t.h = nh;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, nw, nh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    },
  };
  return t;
}

/* Run a program into a target (or the screen when target is null). */
let boundTexUnit = 0;
function bindTex(loc, tex) {
  gl.activeTexture(gl.TEXTURE0 + boundTexUnit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc, boundTexUnit);
  boundTexUnit++;
}
function run(prog, target, setUniforms) {
  gl.useProgram(prog.p);
  boundTexUnit = 0;
  if (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  setUniforms(prog.u);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const prog = {
  copy       : makeProgram(FRAG_COPY, "copy"),
  flow       : makeProgram(FRAG_FLOW, "flow"),
  fluidVel   : makeProgram(FRAG_FLUID_VELOCITY, "fluidVelocity"),
  divergence : makeProgram(FRAG_DIVERGENCE, "divergence"),
  correction : makeProgram(FRAG_CORRECTION, "correction"),
  advection  : makeProgram(FRAG_ADVECTION, "advection"),
  rd         : makeProgram(FRAG_REACTION_DIFFUSION, "reactionDiffusion"),
  bgClock    : makeProgram(FRAG_BACKGROUND_CLOCK, "backgroundClock"),
  glass      : makeProgram(FRAG_GLASS, "glass"),
  debug      : makeProgram(FRAG_DEBUG, "debug"),
};

/* ------------------------- targets & the time mask ------------------------ */

let simW = 512, simH = 512;
let chem     = makeTarget(simW, simH);   // rgb chemicals, a = thickness
let chemTemp = makeTarget(simW, simH);
let vel      = makeTarget(simW, simH);
let velTemp  = makeTarget(simW, simH);
let divTex   = makeTarget(simW, simH);
let bg       = makeTarget(simW, simH);
let flowA    = makeTarget(512, 512);     // pointer trail (fixed 512, like OGL)
let flowB    = makeTarget(512, 512);

/* The time — or whatever words you type — drawn to a 2D canvas, becomes
   the RD mask: chemicals are fed wherever the glyphs are, so liquid
   condenses out of them forever.                                          */
const textCanvas = document.createElement("canvas");
const tctx = textCanvas.getContext("2d");
const maskTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, maskTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const MONO = '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LINE_HEIGHT = 1.2;
const measure = (ctx, s) => ctx.measureText(s).width;

/* A word too wide to ever fit (a URL, "aaaaaa…") is chopped instead of
   dragging the whole layout down to 8px.                                  */
function breakLong(ctx, word, maxW) {
  if (measure(ctx, word) <= maxW) return [word];
  const out = [];
  let cur = "";
  for (const ch of word) {
    if (cur && measure(ctx, cur + ch) > maxW) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/* Greedy word wrap at a given font size. Explicit newlines are honored. */
function wrapLines(ctx, paras, size, maxW) {
  ctx.font = `${Math.round(size)}px ${MONO}`;
  const lines = [];
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean).flatMap(w => breakLong(ctx, w, maxW));
    if (!words.length) { lines.push(""); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const merged = line + " " + words[i];
      if (measure(ctx, merged) <= maxW) line = merged;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  return lines;
}

/* Largest size whose wrap fits the box — binary search, so one long word
   and a whole sentence both land at a sensible scale.                     */
function fitText(ctx, text, maxW, maxH) {
  const paras = text.split("\n");
  let lo = 8, hi = Math.max(12, maxH), best = null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const lines = wrapLines(ctx, paras, mid, maxW);
    const fits = lines.every(l => measure(ctx, l) <= maxW) &&
                 lines.length * mid * LINE_HEIGHT <= maxH;
    if (fits) { best = { lines, size: mid }; lo = mid; } else hi = mid;
  }
  return best || { lines: [text], size: 8 };
}

function drawWords(c, ctx, words) {
  const { lines, size } = fitText(ctx, words, c.width * 0.86, c.height * 0.72);
  ctx.font = `${Math.round(size)}px ${MONO}`;
  const lh = size * LINE_HEIGHT;
  const top = c.height / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, c.width / 2, top + i * lh));
}

function drawClock(c, ctx, parts, sep) {
  if (c.width > c.height * 1.5) {
    // Landscape: one line; the colon blinks each half-second.
    const size = c.width / 8;
    ctx.font = `${Math.round(size)}px ${MONO}`;
    ctx.fillText(parts.join(sep), c.width / 2, c.height / 2);
  } else {
    // Portrait: HH / MM / SS stacked.
    const size = c.height / 4;
    ctx.font = `${Math.round(size)}px ${MONO}`;
    ctx.fillText(parts[0], c.width / 2, c.height / 2 - size);
    ctx.fillText(parts[1], c.width / 2, c.height / 2);
    ctx.fillText(parts[2], c.width / 2, c.height / 2 + size);
  }
}

/* Rasterize + upload only when the content actually changes: the clock
   moves twice a second, typed words only when you type.                   */
let lastMaskKey = "";
function drawMask() {
  const c = textCanvas, ctx = tctx;
  const words = P.text.trim();

  let key, parts = null, sep = "";
  if (words) {
    key = `w|${c.width}x${c.height}|${words}`;
  } else {
    const now = new Date();
    const two = v => v.toString().padStart(2, "0");
    sep = now.getMilliseconds() < 500 ? ":" : " ";
    parts = [two(now.getHours()), two(now.getMinutes()), two(now.getSeconds())];
    key = `c|${c.width}x${c.height}|${parts.join(sep)}`;
  }
  if (key === lastMaskKey) return;
  lastMaskKey = key;

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (words) drawWords(c, ctx, words);
  else drawClock(c, ctx, parts, sep);

  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

/* ----------------------------- resize handling ---------------------------- */

let needResize = true;
function requestResize() { needResize = true; }
window.addEventListener("resize", requestResize);

function doResize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth  || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  canvas.width  = Math.max(2, Math.round(cssW * dpr));
  canvas.height = Math.max(2, Math.round(cssH * dpr));

  // The original's sim-resolution rule, capped so phones stay smooth.
  const scale = Math.max(0.4, Math.min(0.8,
    (1024 / Math.min(cssW, cssH)) * (window.devicePixelRatio || 1)));
  let w = Math.round((cssW * scale) / 4) * 4;
  let h = Math.round((cssH * scale) / 4) * 4;
  const cap = 1152 / Math.max(w, h);
  if (cap < 1) { w = Math.round(w * cap / 4) * 4; h = Math.round(h * cap / 4) * 4; }
  w = Math.max(64, w); h = Math.max(64, h);

  // Preserve sim state across the resize: stash into the temps (still old
  // size), resize primaries, stretch-copy back, then resize temps.
  run(prog.copy, chemTemp, u => bindTex(u.inputMap, chem.tex));
  run(prog.copy, velTemp,  u => bindTex(u.inputMap, vel.tex));

  simW = w; simH = h;
  textCanvas.width = w; textCanvas.height = h;   // mask only needs sim res
  chem.setSize(w, h); vel.setSize(w, h); divTex.setSize(w, h); bg.setSize(w, h);

  run(prog.copy, chem, u => bindTex(u.inputMap, chemTemp.tex));
  run(prog.copy, vel,  u => bindTex(u.inputMap, velTemp.tex));

  chemTemp.setSize(w, h); velTemp.setSize(w, h);
}

/* --------------------------- pointer & parallax --------------------------- */

const flow = { mouse: [0.5, 0.5], velocity: [0, 0] };

function pointerMove(x, y, dx, dy) {
  const r = canvas.getBoundingClientRect();
  flow.mouse[0] = (x - r.left) / r.width;
  flow.mouse[1] = (r.bottom - y) / r.height;          // GL space, y-up
  flow.velocity[0] += (dx / r.width) * simW;          // sim-pixel units
  flow.velocity[1] += (dy / r.width) * simH;
}
window.addEventListener("mousemove", e => {
  pointerMove(e.clientX, e.clientY, e.movementX, e.movementY);
  parallaxMotion.x += e.movementX * 0.001;
  parallaxMotion.y -= e.movementY * 0.001;
});
let prevTouch = null;
window.addEventListener("touchmove", e => {
  if (!e.touches.length) return;
  e.preventDefault();
  const t = e.touches[0];
  if (!prevTouch) prevTouch = { x: t.clientX, y: t.clientY };
  pointerMove(t.clientX, t.clientY, t.clientX - prevTouch.x, t.clientY - prevTouch.y);
  prevTouch = { x: t.clientX, y: t.clientY };
}, { passive: false });
window.addEventListener("touchend", () => { prevTouch = null; });

/* Parallax: pointer motion integrates into a spring-damped drift; on
   phones, tilt relative to a slowly-adapting "natural" pose takes over.    */
const parallax = { x: 0, y: 0 };
const parallaxMotion = { x: 0, y: 0 };
let tiltBase = null, tilt = null;
window.addEventListener("deviceorientation", e => {
  if (e.gamma == null || e.beta == null) return;
  if (!tiltBase) tiltBase = { b: e.beta, g: e.gamma };
  tiltBase.b += (e.beta  - tiltBase.b) * 0.01;   // the pose you're settling into
  tiltBase.g += (e.gamma - tiltBase.g) * 0.01;
  tilt = {
    x: Math.sin((e.gamma - tiltBase.g) * Math.PI / 180),
    y: Math.sin((e.beta  - tiltBase.b) * Math.PI / 180),
  };
});
// iOS asks permission for orientation events; request it on first touch.
window.addEventListener("touchstart", function ask() {
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  window.removeEventListener("touchstart", ask);
}, { once: true });

function updateParallax() {
  if (tilt) {
    parallax.x += (tilt.x * 0.6 - parallax.x) * 0.06;
    parallax.y += (tilt.y * 0.6 - parallax.y) * 0.06;
  } else {
    parallax.x += parallaxMotion.x * 0.1;
    parallax.y += parallaxMotion.y * 0.1;
    parallax.x *= 0.99;
    parallax.y *= 0.99;
  }
  parallaxMotion.x *= 0.8;
  parallaxMotion.y *= 0.8;
}

/* --------------------------- controls & keyboard -------------------------- */

let paused = false;
let debugMode = 0;  // 0 off, 1 thickness, 2 velocity, 3 background
const veil = document.getElementById("veil");
function setPaused(v) {
  paused = v;
  veil.classList.toggle("show", paused && veilIsGate);
}
let veilIsGate = false;

/* A one-line toast: whatever you just switched to, named, then gone.       */
const toast = document.getElementById("toast");
let toastTimer = 0;
function say(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
}

function setPreset(p) { applyPreset(p); say(`theme · ${p.name}`); }
function cycleBackground(step) {
  P.bgMode = (P.bgMode + step + BACKGROUNDS.length) % BACKGROUNDS.length;
  say(`background · ${BACKGROUNDS[P.bgMode]}`);
}

/* Type words and the reaction–diffusion feeds off them instead of the
   time — same mask, same physics, so they bud and slosh identically.
   Clearing the field puts the clock back.                                  */
const sayInput = document.getElementById("say");
sayInput.value = P.text;
function openSay() {
  sayInput.classList.add("show");
  sayInput.focus();
  sayInput.select();
}
function closeSay() { sayInput.classList.remove("show"); sayInput.blur(); }

sayInput.addEventListener("input", () => { P.text = sayInput.value; });
sayInput.addEventListener("keydown", e => {
  e.stopPropagation();                       // never let shortcuts eat typing
  if (e.key === "Enter") closeSay();
  else if (e.key === "Escape") {
    sayInput.value = ""; P.text = ""; closeSay(); say("clock");
  }
});

const btn = (id, fn) => document.getElementById(id).addEventListener("click", e => {
  e.currentTarget.blur();                    // so space doesn't re-trigger it
  fn();
});
btn("btnType", openSay);
btn("btnBg", () => cycleBackground(1));

window.addEventListener("keydown", e => {
  if (e.target === sayInput) return;
  if (PRESETS[e.key]) setPreset(PRESETS[e.key]);
  else if (e.key === " " || (e.key === "Enter" && veil.classList.contains("show"))) {
    setPaused(!paused); e.preventDefault();
  }
  else if (e.key === "b") cycleBackground(1);
  else if (e.key === "B") cycleBackground(-1);
  else if (e.key === "t") { openSay(); e.preventDefault(); }
  else if (e.key === "d") debugMode = (debugMode + 1) % 4;
});

/* Reduced motion: the piece is pure motion, so honor the preference by
   starting paused behind an explicit opt-in.                                */
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  veilIsGate = true;
  setPaused(true);
  veil.setAttribute("tabindex", "0");
  veil.focus();
}
veil.addEventListener("click", () => setPaused(false));

/* ------------------------------- frame loop ------------------------------- */

const startTime = Date.now();   // drives the animated backgrounds

function stepFlowmap() {
  // Stamp pointer velocity into the trail, then swap; velocity resets so
  // only fresh movement stirs the fluid.
  run(prog.flow, flowB, u => {
    bindTex(u.tMap, flowA.tex);
    gl.uniform1f(u.uFalloff, 0.12 * 0.5);
    gl.uniform1f(u.uAlpha, 0.8);
    gl.uniform1f(u.uDissipation, 0.7);
    gl.uniform2f(u.uMouse, flow.mouse[0], flow.mouse[1]);
    gl.uniform2f(u.uVelocity, flow.velocity[0], flow.velocity[1]);
  });
  [flowA, flowB] = [flowB, flowA];
  flow.velocity[0] = 0; flow.velocity[1] = 0;
}

function frame() {
  requestAnimationFrame(frame);
  if (paused) return;
  if (needResize) { needResize = false; doResize(); }

  stepFlowmap();
  drawMask();

  // Velocity gains from thickness gradient + stirring.
  run(prog.fluidVel, velTemp, u => {
    bindTex(u.pressureMap, chem.tex);
    bindTex(u.velocityMap, vel.tex);
    bindTex(u.flowMap, flowA.tex);
    gl.uniform2f(u.uSize, simW, simH);
  });

  // The coupled solve: pressure-relax, advect, react — ITER times a frame.
  for (let i = 0; i < P.iter; i++) {
    run(prog.divergence, divTex, u => {
      bindTex(u.velocityMap, velTemp.tex);
      gl.uniform2f(u.uSize, simW, simH);
    });
    run(prog.correction, vel, u => {
      bindTex(u.pressureMap, divTex.tex);
      bindTex(u.velocityMap, velTemp.tex);
      gl.uniform2f(u.uSize, simW, simH);
    });
    run(prog.advection, velTemp, u => {
      bindTex(u.inputMap, vel.tex);
      bindTex(u.velocityMap, vel.tex);
      gl.uniform2f(u.uSize, simW, simH);
    });
    run(prog.advection, chemTemp, u => {
      bindTex(u.inputMap, chem.tex);
      bindTex(u.velocityMap, vel.tex);
      gl.uniform2f(u.uSize, simW, simH);
    });
    run(prog.rd, chem, u => {
      bindTex(u.pressureMap, chemTemp.tex);
      bindTex(u.maskTexture, maskTex);
      gl.uniform1f(u.feed0, P.feed);
      gl.uniform1f(u.kill0, P.kill);
      gl.uniform2f(u.uSize, simW, simH);
    });
  }
  run(prog.copy, vel, u => bindTex(u.inputMap, velTemp.tex));

  // Analog background: hands as continuous fractions so nothing ever ticks.
  const now = new Date();
  const hands = [
    now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600,
    now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000,
    now.getSeconds() + now.getMilliseconds() / 1000,
  ];
  run(prog.bgClock, bg, u => {
    gl.uniform2f(u.uSize, simW, simH);
    gl.uniform3f(u.clockHands, hands[0], hands[1], hands[2]);
    gl.uniform3fv(u.bgcolor, P.bg);
    gl.uniform3fv(u.circlecolor1, P.c1);
    gl.uniform3fv(u.circlecolor2, P.c2);
    gl.uniform3fv(u.circlecolor3, P.c3);
    gl.uniform2f(u.parallax, parallax.x, parallax.y);
    gl.uniform1f(u.uBgMode, P.bgMode);
    gl.uniform1f(u.uTime, (now.getTime() - startTime) / 1000);
  });

  // Final composite to screen.
  if (debugMode === 0) {
    run(prog.glass, null, u => {
      bindTex(u.pressureMap, chem.tex);
      bindTex(u.backgroundMap, bg.tex);
      gl.uniform3fv(u.glassColor, P.glassColor);
      gl.uniform1f(u.shadowFactor, P.shadow);
      gl.uniform1f(u.brightFactor, P.bright);
      gl.uniform2f(u.parallax, parallax.x, parallax.y);
      gl.uniform2f(u.uSize, simW, simH);
    });
  } else {
    const src  = debugMode === 1 ? chem : debugMode === 2 ? vel : bg;
    const mode = debugMode === 1 ? 2 : debugMode === 2 ? 1 : 0;
    run(prog.debug, null, u => {
      bindTex(u.inputMap, src.tex);
      gl.uniform1f(u.uMode, mode);
    });
  }

  updateParallax();
}

applyPreset(PRESETS["1"]);
// URL params override the default preset when present.
if ([...qs.keys()].length) {
  P.glassColor = hex("color", P.glassColor);
  P.bg = hex("bgcolor", P.bg);
  P.c1 = hex("color1", P.c1); P.c2 = hex("color2", P.c2); P.c3 = hex("color3", P.c3);
  P.shadow = num("shadow", P.shadow); P.bright = num("bright", P.bright);
  P.feed = num("feed", P.feed); P.kill = num("kill", P.kill);
  P.iter = Math.round(num("iteration", P.iter));
  document.body.style.background =
    `rgb(${P.bg.map(v => Math.round(v*255)).join(",")})`;
}

// The hint should describe what this device can actually do.
if (matchMedia("(pointer: coarse)").matches) {
  document.getElementById("hint").textContent =
    "touch to stir · tilt to shift the light · tap type / background below";
}

requestAnimationFrame(frame);
