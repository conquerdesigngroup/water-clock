/* All GLSL lives here. The GLSL:name … END markers are parsed
   by scripts/validate-shaders.js — keep them when adding shaders.    */

export const VERT = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }`;

/* -------------------------------- shaders -------------------------------- */
/* Kept intentionally close to the original GLSL so the motion matches.      */

const HEAD = `precision highp float;
varying vec2 vUv;
#define PI 3.14159265358979
`;

/*GLSL:copy*/
export const FRAG_COPY = HEAD + `
uniform sampler2D inputMap;
void main(){ gl_FragColor = texture2D(inputMap, vUv); }
`;/*END*/

/*GLSL:flow*/
/* Pointer flowmap (OGL Flowmap): fading trail of stamped velocity.          */
export const FRAG_FLOW = HEAD + `
uniform sampler2D tMap;
uniform float uFalloff;      // stamp radius in uv units
uniform float uAlpha;        // stamp opacity
uniform float uDissipation;  // trail fade per frame
uniform vec2  uMouse;        // uv, y-up
uniform vec2  uVelocity;     // sim-pixels moved since last frame
void main(){
  vec4 color = texture2D(tMap, vUv) * uDissipation;
  vec2 cursor = vUv - uMouse;
  vec3 stamp = vec3(uVelocity * vec2(1.0, -1.0),
                    1.0 - pow(1.0 - min(1.0, length(uVelocity)), 3.0));
  float falloff = smoothstep(uFalloff, 0.0, length(cursor)) * uAlpha;
  color.rgb = mix(color.rgb, stamp, vec3(falloff));
  gl_FragColor = color;
}
`;/*END*/

/*GLSL:fluidVelocity*/
/* Velocity update: thickness gradient pushes fluid outward, viscosity
   diffuses it, the flowmap stirs it, magnitude clamped at 10 px/step.       */
export const FRAG_FLUID_VELOCITY = HEAD + `
uniform sampler2D pressureMap;   // chemicals; .a = liquid thickness field
uniform sampler2D velocityMap;
uniform sampler2D flowMap;
uniform vec2 uSize;
void main(){
  vec2 delta = 2.0 / uSize;

  vec2 velocity        = texture2D(velocityMap, vUv).rg;
  vec2 velocity_left   = texture2D(velocityMap, vUv + delta * vec2(-1, 0)).rg;
  vec2 velocity_right  = texture2D(velocityMap, vUv + delta * vec2( 1, 0)).rg;
  vec2 velocity_bottom = texture2D(velocityMap, vUv + delta * vec2( 0,-1)).rg;
  vec2 velocity_top    = texture2D(velocityMap, vUv + delta * vec2( 0, 1)).rg;

  vec2 flow = texture2D(flowMap, vUv).rg;

  float center = texture2D(pressureMap, vUv).a;
  float right  = texture2D(pressureMap, vUv + delta * vec2( 1, 0)).a;
  float left   = texture2D(pressureMap, vUv + delta * vec2(-1, 0)).a;
  float top    = texture2D(pressureMap, vUv + delta * vec2( 0, 1)).a;
  float bottom = texture2D(pressureMap, vUv + delta * vec2( 0,-1)).a;
  vec2 gradient = vec2(right - left, top - bottom);

  vec2 diffusion = (velocity_left + velocity_right + velocity_bottom + velocity_top) / 4.0 - velocity;
  vec2 acceleration = -gradient * 0.01;

  velocity = velocity * 0.9995 + acceleration / (center + 0.001) + diffusion + flow * 0.1;

  float magnitude = length(velocity);
  velocity = velocity / max(1e-5, magnitude) * min(10.0, magnitude);

  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;/*END*/

/*GLSL:divergence*/
/* Divergence of velocity, stored biased around 0.5 on a wide stencil.       */
export const FRAG_DIVERGENCE = HEAD + `
uniform sampler2D velocityMap;
uniform vec2 uSize;
void main(){
  vec2 delta = 4.0 / uSize;
  vec2 left   = texture2D(velocityMap, vUv + delta * vec2(-1, 0)).rg;
  vec2 right  = texture2D(velocityMap, vUv + delta * vec2( 1, 0)).rg;
  vec2 bottom = texture2D(velocityMap, vUv + delta * vec2( 0,-1)).rg;
  vec2 top    = texture2D(velocityMap, vUv + delta * vec2( 0, 1)).rg;
  float divergent = (right.x - left.x) + (top.y - bottom.y);
  gl_FragColor = vec4(vec2(divergent / 4.0 * 0.5 + 0.5), 0.0, 1.0);
}
`;/*END*/

/*GLSL:correction*/
/* Relax velocity along the divergence gradient — the original's compact
   stand-in for a pressure projection. Repeated each iteration it keeps
   the field near divergence-free, which is what makes it slosh like water. */
export const FRAG_CORRECTION = HEAD + `
uniform sampler2D pressureMap;   // divergence texture from the pass above
uniform sampler2D velocityMap;
uniform vec2 uSize;
void main(){
  vec2 delta = 4.0 / uSize;
  float left   = texture2D(pressureMap, vUv + delta * vec2(-1, 0)).r;
  float right  = texture2D(pressureMap, vUv + delta * vec2( 1, 0)).r;
  float bottom = texture2D(pressureMap, vUv + delta * vec2( 0,-1)).r;
  float top    = texture2D(pressureMap, vUv + delta * vec2( 0, 1)).r;
  vec2 gradient = vec2(right - left, top - bottom);
  vec2 velocity = texture2D(velocityMap, vUv).rg + gradient * 2.0;
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;/*END*/

/*GLSL:advection*/
/* Semi-Lagrangian advection: look upstream, blend 90% of what you find.    */
export const FRAG_ADVECTION = HEAD + `
uniform sampler2D inputMap;
uniform sampler2D velocityMap;
uniform vec2 uSize;
void main(){
  vec2 delta = 1.0 / uSize;
  vec2 velocity = texture2D(velocityMap, vUv).rg;
  vec2 displacement = -velocity;
  float factor = 0.9;
  vec4 displaced = texture2D(inputMap, vUv + displacement * delta * 0.1);
  gl_FragColor = texture2D(inputMap, vUv) * (1.0 - factor) + displaced * factor;
}
`;/*END*/

/*GLSL:reactionDiffusion*/
/* Gray–Scott with three chemicals. x is the substrate (fed toward 1);
   y and z are the activators, regrown toward mask*0.1 wherever the time's
   glyphs are — so the digits are a perpetual spring of liquid. feed drifts
   across x, kill across y, so pattern character varies over the screen.
   Output .a = 1 − x: the liquid thickness field everything else reads.     */
export const FRAG_REACTION_DIFFUSION = HEAD + `
uniform sampler2D pressureMap;
uniform sampler2D maskTexture;
uniform float feed0;
uniform float kill0;
uniform vec2 uSize;
void main(){
  vec2 delta = 1.0 / uSize;

  vec4 center = texture2D(pressureMap, vUv);
  vec4 maskInput = texture2D(maskTexture, vUv);

  vec4 left    = texture2D(pressureMap, vUv + delta * vec2(-1, 0));
  vec4 right   = texture2D(pressureMap, vUv + delta * vec2( 1, 0));
  vec4 bottom  = texture2D(pressureMap, vUv + delta * vec2( 0,-1));
  vec4 top     = texture2D(pressureMap, vUv + delta * vec2( 0, 1));
  vec4 corner1 = texture2D(pressureMap, vUv + delta * vec2(-1, 1));
  vec4 corner2 = texture2D(pressureMap, vUv + delta * vec2( 1, 1));
  vec4 corner3 = texture2D(pressureMap, vUv + delta * vec2(-1,-1));
  vec4 corner4 = texture2D(pressureMap, vUv + delta * vec2( 1,-1));

  vec4 laplacian = (left + right + bottom + top) * 0.2
                 + (corner1 + corner2 + corner3 + corner4) * 0.05 - center;

  float feed = feed0 + (vUv.x - 0.5) * 0.02;
  float kill_compensated = kill0 - 7.0 * ((feed - 0.065) * (feed - 0.065)
                                        - (feed0 - 0.065) * (feed0 - 0.065));
  float kill = kill_compensated + abs(vUv.y - 0.5) * 0.04;

  float mask = maskInput.r * 0.1;

  vec3 diffusion = vec3(0.4, 0.1, 0.1) * 8.0;
  vec3 reaction  = vec3(-1.0, 1.0, 1.0);
  vec3 balance   = vec3(1.0, mask, mask);
  vec3 damping   = vec3(feed, feed + kill, feed + kill);
  vec3 density   = vec3(1.0, 0.0, 0.0);

  vec3 change = diffusion * laplacian.xyz
              + reaction * center.x * center.y * center.z
              + (balance - center.xyz) * damping;

  vec3 result = center.xyz + change * 0.3;
  gl_FragColor.xyz = result.xyz;
  gl_FragColor.a = 1.0 - dot(density, result);
}
`;/*END*/

/*GLSL:backgroundClock*/
/* The analog face: three lens-circles, one per hand, orbiting the center
   at half the larger screen dimension. Each is a bright rim + faint fill,
   and its interior refracts every layer drawn behind it. Layers sit at
   different parallax depths, so tilting the device separates them.         */
export const FRAG_BACKGROUND_CLOCK = HEAD + `
uniform vec2 uSize;
uniform vec3 clockHands;     // hours, minutes, seconds (fractional)
uniform vec3 bgcolor;
uniform vec3 circlecolor1;
uniform vec3 circlecolor2;
uniform vec3 circlecolor3;
uniform vec2 parallax;

vec3 drawCircle(vec2 coord, float t){
  float radius = max(uSize.x, uSize.y) * 0.5;
  vec2 origin = vec2(sin(t * PI * 2.0), cos(t * PI * 2.0)) * radius;
  coord -= origin;

  float r = length(coord) / radius;
  float f = 1.0 / (abs(r - 1.0) * 100.0 + 1.0);

  vec2 displacement = -coord / (sqrt(max(0.0, 1.0 - r * r)) + 0.01) * f * step(r, 1.0);

  f = 1.0 / (abs(r - 1.0) * 200.0 + 1.0);
  f = f + step(r, 1.0) * 0.05 * (r + 1.0);

  return vec3(displacement, f);
}

void main(){
  vec2 coord = (vUv - 0.5) * uSize + parallax * 2.0;

  vec3 circle3 = drawCircle(coord, clockHands.z / 60.0);   // second
  coord += circle3.xy * 0.1 + parallax * 10.0;
  vec3 circle2 = drawCircle(coord, clockHands.y / 60.0);   // minute
  coord += circle2.xy * 0.1 + parallax * 20.0;
  vec3 circle1 = drawCircle(coord, clockHands.x / 12.0);   // hour

  vec3 color = bgcolor;
  color = mix(color, circlecolor1, circle1.z);
  color = mix(color, circlecolor2, circle2.z);
  color = mix(color, circlecolor3, circle3.z);

  gl_FragColor = vec4(color, 1.0);
}
`;/*END*/

/*GLSL:glass*/
/* Liquid glass composite, 2×2 supersampled:
   thickness → normal → refract in and out of water (n 1.33) → sample the
   background with slight per-channel offsets (chromatic fringe) → add a
   thresholded specular streak and a Fresnel-weighted edge → tint.          */
export const FRAG_GLASS = HEAD + `
uniform sampler2D pressureMap;
uniform sampler2D backgroundMap;
uniform vec3 glassColor;
uniform float shadowFactor;
uniform float brightFactor;
uniform vec2 parallax;
uniform vec2 uSize;

vec3 my_reflection(vec3 normal, vec3 incoming){
  float cos_value = dot(incoming, normal);
  vec3 cos_vec = cos_value * normal;
  vec3 reflected = incoming - cos_vec * 2.0;
  return reflected / length(reflected);
}

vec3 my_refraction(vec3 normal, vec3 incoming, float n2){
  float cos_value = dot(incoming, normal);
  vec3 cos_vec = cos_value * normal;
  vec3 sin_vec = incoming - cos_vec;
  float sin_value = length(sin_vec);
  float cos_value22 = n2 * n2 - sin_value * sin_value;
  if (cos_value22 < 0.0) return my_reflection(normal, incoming);
  float cos_value2 = sqrt(cos_value22);
  vec3 refracted = cos_value2 * normal + sin_vec;
  return refracted / length(refracted);
}

float thickness(vec4 p){
  float t = smoothstep(0.45, 0.95, p.a);
  return sqrt(t);
}

void main(){
  vec2 delta = 1.0 / uSize;
  vec4 final_color = vec4(0.0);

  for (int si = 0; si < 2; si++){
    for (int sj = 0; sj < 2; sj++){
      vec2 uv = vUv + delta * vec2(float(si), float(sj)) * 0.5;

      vec4 center = texture2D(pressureMap, uv);
      vec4 left   = texture2D(pressureMap, uv + delta * vec2(-1, 0));
      vec4 right  = texture2D(pressureMap, uv + delta * vec2( 1, 0));
      vec4 bottom = texture2D(pressureMap, uv + delta * vec2( 0,-1));
      vec4 top    = texture2D(pressureMap, uv + delta * vec2( 0, 1));

      vec2 gradient = vec2(thickness(right) - thickness(left),
                           thickness(top) - thickness(bottom)) * 0.7;

      vec3 normal = vec3(-gradient.x, -gradient.y, 1.0);
      normal = normal / length(normal);

      vec3 incoming = vec3(parallax, 1.0);
      incoming = incoming / length(incoming);

      float n2 = 1.33;
      vec3 refracted = my_refraction(normal, incoming, n2);
      refracted = my_refraction(normal * vec3(-1.0, -1.0, 1.0), refracted, 1.0 / n2);

      vec2 displacement = refracted.xy / refracted.z - parallax;

      float r_r = texture2D(backgroundMap, uv + displacement * 1.0 ).r;
      float r_g = texture2D(backgroundMap, uv + displacement * 1.05).g;
      float r_b = texture2D(backgroundMap, uv + displacement * 1.1 ).b;
      vec4 background_T = vec4(r_r, r_g, r_b, 1.0);

      vec3 incoming_clamped = incoming;
      incoming_clamped.z = clamp(incoming_clamped.z, 0.8, 1.0);
      incoming_clamped.xy /= max(length(incoming_clamped.xy), 0.0001);
      incoming_clamped.xy *= sqrt(1.0 - incoming_clamped.z);
      vec3 reflected_clamped = my_reflection(normal, incoming_clamped);

      float light = abs(dot(reflected_clamped, vec3(-0.1, 0.6, 0.01)));
      light = step(0.1, light) * light * 8.0;

      vec4 background_R = vec4(vec3(light), 0.0) * vec4(glassColor, 1.0);

      float R = pow(1.0 - normal.z, 0.5) * smoothstep(0.0, 0.01, thickness(center));
      float t = thickness(center);

      vec4 color = background_R * R
                 + background_T * (1.0 - R) * (1.0 - shadowFactor * t)
                 + (t * brightFactor);
      color.rgb = color.rgb * mix(vec3(1.0), glassColor, t);
      final_color = final_color + color * 0.25;
    }
  }

  gl_FragColor = vec4(final_color.rgb, 1.0);
}
`;/*END*/

/*GLSL:debugView*/
export const FRAG_DEBUG = HEAD + `
uniform sampler2D inputMap;
uniform float uMode;   // 0 raw, 1 signed rg, 2 alpha
void main(){
  vec4 c = texture2D(inputMap, vUv);
  if (uMode < 0.5)      gl_FragColor = vec4(c.rgb, 1.0);
  else if (uMode < 1.5) gl_FragColor = vec4(c.rg * 0.05 + 0.5, 0.5, 1.0);
  else                  gl_FragColor = vec4(vec3(c.a), 1.0);
}
`;/*END*/
