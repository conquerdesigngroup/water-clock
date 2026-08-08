# Water Clock

A clock made of water. The digital time continuously feeds a Gray–Scott
reaction–diffusion system, so liquid condenses out of the digits, buds into
droplets, and crawls — while a small Navier–Stokes solver makes it slosh and
lets you stir it with the pointer. A refraction shader (n = 1.33, actual
water) renders the field as glass over an analog face: three giant
lens-circles — hour, minute, second — orbiting the center, each refracting
the layers behind it, drifting on parallax from your mouse or device tilt.

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
| `1` `2` `3` `4` | themes: ember · cosmos black · sticky pink · cozy blue |
| `space` | pause |
| `d` | debug views: thickness field → velocity → background |

## URL parameters

`?feed=0.1&kill=0.054&iteration=15&color1=ff3007&bgcolor=ffeeff…`

`color`, `color1`–`color3`, `bgcolor` (hex) · `shadow`, `bright` (0–1) ·
`feed`, `kill` (the Gray–Scott personality knobs) · `iteration` (sim steps
per frame). `feed≈0.054, kill≈0.0616` crawls like coral; `feed≈0.1,
kill≈0.054` goes fat and blobby.

## How it works

Three coupled systems, stepped ~10× per frame at roughly half resolution:

1. **Reaction–diffusion** — the time is rasterized to a hidden canvas each
   frame and used as the feed mask of a three-chemical Gray–Scott system.
   The digits are a perpetual spring of liquid; the field's `1 − x` is the
   liquid thickness everything else reads.
2. **Fluid** — the thickness gradient accelerates a velocity field, a
   divergence-relaxation pass keeps it near incompressible, and velocity and
   chemicals are advected semi-Lagrangian. Pointer movement stamps velocity
   through a fading flowmap trail.
3. **Glass** — thickness → surface normal → refraction into and out of the
   surface with per-channel offsets (chromatic fringe), a thresholded
   specular streak, and a Fresnel edge, 2×2 supersampled, composited over
   the lens-circle background.

See `CLAUDE.md` for the full pipeline, invariants, and editing notes.

## License

MIT for the code in this repository. The concept and visual design belong
to chiuhans111's Fluid Glass; this project exists as an homage and a study
of its motion.
