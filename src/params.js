/* ------------------------------- parameters ------------------------------ */

export const qs = new URLSearchParams(location.search);
export const num = (k, d) => {
  if (!qs.has(k)) return d;
  const v = parseFloat(qs.get(k));
  return Number.isFinite(v) ? v : d;
};
export const hex = (k, d) => {
  if (!qs.has(k)) return d;
  const h = qs.get(k).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return d;
  return [0,2,4].map(i => parseInt(h.slice(i, i+2), 16) / 255);
};
export const str = (k, d) => (qs.has(k) ? qs.get(k) : d);

/* The worlds the water refracts. Index === uBgMode in the background
   shader; the names are what `?background=` accepts and what the toast
   shows. Backgrounds are deliberately orthogonal to the colour themes —
   4 themes × 8 backgrounds, and switching one never resets the other.   */
export const BACKGROUNDS = [
  "lens", "solid", "aurora", "grid", "rings", "plasma", "stars", "stripes",
];
export const bgIndex = (k, d) => {
  if (!qs.has(k)) return d;
  const v = qs.get(k).trim().toLowerCase();
  const byName = BACKGROUNDS.indexOf(v);
  if (byName >= 0) return byName;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 && n < BACKGROUNDS.length ? n : d;
};

export const P = {                          // live parameter set (URL-overridable)
  glassColor : hex("color",  [1,1,1]),
  bg         : hex("bgcolor",[0,0,0]),
  c1         : hex("color1", [0.9686,0.4941,0.1765]),  // hour   #F77E2D
  c2         : hex("color2", [0.1961,0.2157,0.2902]),  // minute #32374A
  c3         : hex("color3", [0.9608,0.9608,0.9608]),  // second #F5F5F5
  shadow     : num("shadow", 0.05),
  bright     : num("bright", 0.05),
  feed       : num("feed",   0.0540),
  kill       : num("kill",   0.0616),
  iter       : Math.round(num("iteration", 10)),
  bgMode     : bgIndex("background", 0),
  // Words to condense out of instead of the time. Empty string = clock.
  text       : str("text", "").slice(0, 140),
};

export const PRESETS = {                    // themes from the original README
  "1": { name:"ember",       color:[1,1,1], bg:[0,0,0], c1:[0.9686,0.4941,0.1765], c2:[0.1961,0.2157,0.2902], c3:[0.9608,0.9608,0.9608], shadow:.05, bright:.05, feed:.054, kill:.0616, iter:10 },
  "2": { name:"cosmos black",color:[1,1,1], bg:[0,0,0], c1:[0.1961,0.2157,0.2902], c2:[0.9686,0.4941,0.1765], c3:[0.9608,0.9608,0.9608], shadow:.05, bright:.05, feed:.054, kill:.0616, iter:10 },
  "3": { name:"sticky pink", color:[1,.933,.933], bg:[1,.933,1], c1:[1,.188,.027], c2:[1,1,1], c3:[.467,.733,.8], shadow:.1, bright:.1, feed:.1,  kill:.054, iter:15 },
  "4": { name:"cozy blue",   color:[.863,.918,.925], bg:[.929,.937,.937], c1:[1,.667,.027], c2:[1,1,1], c3:[.467,.733,.8], shadow:.05, bright:.1, feed:.05, kill:.06,  iter:15 },
};
export function applyPreset(p) {
  P.glassColor = p.color; P.bg = p.bg; P.c1 = p.c1; P.c2 = p.c2; P.c3 = p.c3;
  P.shadow = p.shadow; P.bright = p.bright; P.feed = p.feed; P.kill = p.kill; P.iter = p.iter;
  document.body.style.background =
    `rgb(${p.bg.map(v => Math.round(v*255)).join(",")})`;
}
