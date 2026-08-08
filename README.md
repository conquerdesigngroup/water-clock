# Water Clock

A clock made of water. The digital time continuously feeds a Gray–Scott
reaction–diffusion system, so liquid condenses out of the digits, buds into
droplets, and crawls — while a small Navier–Stokes solver makes it slosh and
lets you stir it with the pointer. A refraction shader (n = 1.33, actual
water) renders the field as glass over one of eight backgrounds, drifting on
parallax from your mouse or device tilt.

**Or type your own words** and they condense out of the water instead of the
time — same mask, same reaction–diffusion, same physics. The old words
dissolve while the new ones bud into place.

Everything ships as **one dependency-free HTML file**: `dist/water-clock.html`.
Double-click it, or serve it from anywhere.

This is a from-scratch recreation of
[Fluid Glass](https://chiuhans111.github.io/fluidglass/) by
[chiuhans111](https://github.com/chiuhans111/fluidglass) — same algorithms and
constants, independently reimplemented and verified. Go look at the original;
it's wonderful.

## Quick start

```bash
npm install        # dev tooling only (jsdom for the headless test)
npm run dev        # http://localhost:5173/  — live ES-module source
npm run build      # regenerates dist/water-clock.html
npm run check      # shader validation + headless smoke test
```

No framework, no bundler. The "build" is a 50-line script that inlines
`src/` into the single file.

## Controls

| input | effect |
|---|---|
| move mouse / touch | stir the liquid |
| tilt (mobile) | shift light, refraction, and parallax layers |
| `t` / the **type** button | write your own words — empty puts the clock back |
| `b` / the **background** button | cycle backgrounds (`shift`+`b` goes back) |
| `1` `2` `3` `4` | themes: ember · cosmos black · sticky pink · cozy blue |
| `space` | pause |
| `d` | debug views: thickness field → velocity → background |

While the word field is focused it swallows every shortcut, so you can type
`b` and `space` without cycling backgrounds or pausing. `esc` clears it.

## Backgrounds

Eight worlds for the water to refract, all painted from the four theme
colours — so backgrounds and themes compose instead of fighting, and
switching one never resets the other.

| | | |
|---|---|---|
| `lens` | the original analog face | three giant hour/minute/second lens-circles orbiting the center, each refracting the layers behind it |
| `solid` | near-flat | black-on-black embossed liquid; the quietest option |
| `aurora` | drifting bands | soft domain-warped noise, slow |
| `grid` | blueprint | the grid bends through the glass — the clearest read on the refraction |
| `rings` | concentric | ripples breathing outward from the center |
| `plasma` | molten | double-warped fbm; the liquid looks poured |
| `stars` | nebula + starfield | twinkling, sparse, very dark |
| `stripes` | wide diagonals | the loudest; classic liquid-glass distortion |

## URL parameters

`?text=hello+world&background=plasma&feed=0.1&kill=0.054&color1=ff3007…`

`text` (words to display; omit for the clock) · `background` (name from the
table above, or `0`–`7`) · `color`, `color1`–`color3`, `bgcolor` (hex) ·
`shadow`, `bright` (0–1) · `feed`, `kill` (the Gray–Scott personality knobs) ·
`iteration` (sim steps per frame). `feed≈0.054, kill≈0.0616` crawls like
coral; `feed≈0.1, kill≈0.054` goes fat and blobby.

## How it works

Three coupled systems, stepped ~10× per frame at roughly half resolution:

1. **Reaction–diffusion** — the time (or your words, auto-fitted and
   wrapped) is rasterized to a hidden canvas and used as the feed mask of a
   three-chemical Gray–Scott system. The glyphs are a perpetual spring of
   liquid; the field's `1 − x` is the liquid thickness everything else
   reads. Change the mask and the old liquid has to dissolve before the new
   shape finishes growing — that lag is the whole charm.
2. **Fluid** — the thickness gradient accelerates a velocity field, a
   divergence-relaxation pass keeps it near incompressible, and velocity and
   chemicals are advected semi-Lagrangian. Pointer movement stamps velocity
   through a fading flowmap trail.
3. **Glass** — thickness → surface normal → refraction into and out of the
   surface with per-channel offsets (chromatic fringe), a thresholded
   specular streak, and a Fresnel edge, 2×2 supersampled, composited over
   whichever background is selected.

See `CLAUDE.md` for the full pipeline, invariants, and editing notes.

## Deploying

`vercel.json` runs `npm run build` and serves `dist/`, where the build writes
both `water-clock.html` and an identical `index.html` for the site root. Any
static host works — it is one file with no runtime dependencies.

## License

MIT for the code in this repository. The concept and visual design belong
to chiuhans111's Fluid Glass; this project exists as an homage and a study
of its motion.
