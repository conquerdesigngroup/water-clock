# Water Clock — project notes for Claude

A liquid-glass clock: the digital time — or any words the user types — feeds
a Gray–Scott reaction–diffusion system (liquid condenses out of the glyphs),
a compact Navier–Stokes solver makes it slosh and lets the pointer stir it,
and a refraction shader renders it as water over one of eight backgrounds.
The core is a faithful from-scratch recreation of chiuhans111's "Fluid Glass"
(same algorithms and constants, none of the original code); the extra
backgrounds and the text mode are additions on top of it.

Ships as ONE self-contained HTML file with zero runtime dependencies.
`src/` is the source of truth; `dist/water-clock.html` is generated.

## Commands

- `npm run dev` — static server at http://localhost:5173/ (ES-module source; needed because modules can't load from file://)
- `npm run build` — regenerate `dist/water-clock.html`
- `npm test` — build, then headless smoke test (jsdom + instrumented WebGL2 stub; no GPU needed)
- `npm run validate` — compile every shader with glslangValidator (skips politely if not installed: `apt install glslang-tools`)
- `npm run check` — validate + test. **Run this after any change to `src/`.**

There is no framework, no bundler, no transpiler. Keep it that way.

## File map

- `index.html` — markup shell shared by dev and dist (veil/hint/fail/say/ui/toast/btnType/btnBg elements are referenced by JS — keep ids)
- `src/main.js` — GL setup, render targets, frame loop, resize, input, parallax, keyboard
- `src/shaders.js` — ALL GLSL as template-literal exports, each wrapped in `/*GLSL:name*/ … /*END*/` markers
- `src/params.js` — parameter set `P`, URL parsing, the four presets
- `src/style.css` — page styles
- `scripts/build.js` — naive module concatenator → single file (see build contract below)
- `scripts/validate-shaders.js` — reconstructs each shader (HEAD + body) from the markers, compiles as GLSL ES 1.00
- `test/smoke.test.js` — runs the BUILT file in jsdom; cross-checks every `gl.uniform*` call in JS against the uniforms parsed from the bound program's GLSL
- `dist/water-clock.html` — generated; committed for double-click convenience. **Never edit by hand.** The build writes the same bytes to `dist/index.html` so a static host (Vercel, per `vercel.json`) serves it at `/`.

## The frame pipeline (order is load-bearing)

Per `frame()` in `src/main.js`, at sim resolution (~0.4–0.8× CSS px, ×4-aligned, capped at 1152 on the long side):

1. `stepFlowmap` — stamp pointer velocity into a fading 512² trail (ping-pong flowA/flowB), then zero the accumulated pointer velocity
2. `drawMask` — rasterize HH:MM:SS (colon blinks each half-second; portrait stacks HH/MM/SS) **or** `P.text` (binary-searched font size, greedy word wrap, over-long words chopped) to the 2D canvas at sim resolution, upload as `maskTex`. Keyed on content + canvas size, so it only re-rasterizes and re-uploads when something actually changed — twice a second for the clock, per keystroke for words.
3. `fluidVel` → `velTemp` — thickness gradient accelerates fluid; viscosity; flowmap stirring; speed clamp 10
4. ×`P.iter` (default 10): `divergence(velTemp)→divTex`, `correction(divTex,velTemp)→vel`, `advect vel→velTemp`, `advect chem→chemTemp`, `rd(chemTemp,mask)→chem`
5. copy `velTemp→vel`
6. `bgClock → bg` — `uBgMode` selects one of eight worlds (see `BACKGROUNDS` in params.js). Mode 0 is the original: three lens-circles orbit at continuous (ms-included) hand fractions, with inter-layer refraction + parallax at depths ×2/×10/×20. Modes 1–7 are noise/pattern fields in aspect-corrected `q` space, all painted from `bgcolor` + `circlecolor1..3` so themes and backgrounds stay orthogonal.
7. `glass → screen` — thickness → normal → double refraction (n=1.33) → chromatic background fetch (×1.0/1.05/1.1 per channel) → specular streak → Fresnel mix (or `debug → screen` when debugMode > 0)

Textures: `chem`/`chemTemp` (rgb chemicals, **a = liquid thickness**), `vel`/`velTemp`, `divTex`, `bg` at sim res; `flowA`/`flowB` fixed 512²; `maskTex` from the 2D canvas. All RGBA16F.

Resize preserves sim state: copy chem/vel into the still-old-size temps, resize primaries, stretch-copy back, then resize temps. Don't "simplify" this.

## Invariants — check before committing

- **Uniform names must match** between `gl.uniform*` calls in main.js and the GLSL declarations. `npm test` fails on any mismatch or any uniform set while the wrong program is bound.
- **Keep the `/*GLSL:name*/ … /*END*/` markers** around every fragment shader in shaders.js — the validator parses them. New shaders get markers too.
- Shaders are **GLSL ES 1.00 on a WebGL2 context** (`texture2D`, `gl_FragColor`, attribute/varying). Don't introduce `#version 300 es` piecemeal.
- RGBA16F render targets require `EXT_color_buffer_float`; the capability gate and `#fail` panel must stay.
- The simulation is numerically touchy: `feed`/`kill`/`dt 0.3`/diffusion `(0.4,0.1,0.1)*8`/laplacian weights (0.2 edge, 0.05 corner) are the original's constants. Changing them changes the art — fine if intended, but do it via `P`/presets, not by editing shader literals.
- Accessibility: `prefers-reduced-motion` starts the piece paused behind the `#veil` opt-in (click or Enter). The smoke test asserts zero draw calls while gated.

## Build contract (why the bundler can be 30 lines)

`scripts/build.js` concatenates `shaders.js → params.js → main.js`, strips
`import` lines, rewrites `export const/function` → `const/function`, and
inlines the result plus `style.css` into `index.html`. This only works if:

1. imports are plain single-statement `import { … } from "./x.js";` between local modules only;
2. exports are only `export const …` / `export function …` (no default exports, no re-exports);
3. top-level names are unique across all src modules;
4. no top-level code in shaders.js/params.js depends on DOM state that main.js sets up.

Follow those rules when adding modules and the build stays trivial.

## Parameters

URL params (all optional): `color`, `color1..3`, `bgcolor` (6-digit hex, `#` optional) · `shadow`, `bright`, `feed`, `kill` (floats) · `iteration` (int) · `background` (name from `BACKGROUNDS` or index) · `text` (words to display, capped at 140 chars; empty = clock). Invalid values fall back to defaults.

Keyboard: `1`–`4` presets (ember / cosmos black / sticky pink / cozy blue) · `b`/`B` next/previous background · `t` focus the word field (`esc` clears it, `enter` dismisses it) · `space` pause · `d` cycles debug views (off → thickness field → velocity → raw background).

Presets deliberately do **not** touch `P.bgMode` or `P.text`: themes are colour, backgrounds are pattern, words are content, and switching one must never reset the others. The word input calls `stopPropagation` on keydown so shortcuts can't eat typing — keep that if you add more keys.

Tuning intuition: `feed`≈0.054/`kill`≈0.0616 gives crawling coral; feed→0.1, kill→0.054 gives fat blobs (that's the whole "sticky pink" difference). `iteration` trades smoothness for GPU time.

## Verification history

The recreation was validated against the original repo before this project
was assembled: all shaders compile under glslangValidator; every numeric
constant was diffed against the original GLSL (only dead-code removal
differs); the RD regime and the full composite were reproduced in a numpy
port of the pipeline; and the smoke harness ran the app for 60+ frames with
zero uniform mismatches. Treat `src/shaders.js` constants as ground truth.
