// Dibuja la cara de Bip con Skia en una sola "foto" por fotograma.
// Los ojos se recortan con párpados de verdad (no con parches negros), brillan con un halo
// y llevan luz interior y un reflejo. Los efectos de pantalla son shaders (pequeños programas
// que corren en la tarjeta gráfica): líneas de tele antigua, grano, holograma y plasma.
import {
  BlendMode,
  BlurStyle,
  ClipOp,
  PaintStyle,
  PathOp,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkPaint,
  type SkPath,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { EMOTIONS, type FaceEngine, type Particle } from './engine';
import { padRects } from './padRects';
import { COLORS } from './theme';

// ------------------------------------------------------------------ colores
type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mixRGB = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgba = (c: RGB, a = 1) => Skia.Color(`rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a))})`);
const WHITE: RGB = [1, 1, 1];
const WARM: RGB = hex('#FFB070');

const TINTS: Record<string, RGB> = {};

/** El color de los ojos ahora mismo: el del tema, teñido por la emoción y suavizado de noche. */
export function eyeColor(e: FaceEngine): RGB {
  let c = hex(COLORS[e.theme.color]);
  if (e.theme.dynamic) {
    const t = EMOTIONS[e.emotion].tint;
    if (t) c = mixRGB(c, (TINTS[t] ??= hex(t)), Math.min(0.85, e.face.x.tintAmt));
    if (e.night > 0) c = mixRGB(c, WARM, 0.25 * e.night);
  }
  return c;
}

// ------------------------------------------------------------------ shaders
const SRC = {
  scan: `
uniform float t;
uniform float strength;
half4 main(float2 p) {
  float line = 0.5 + 0.5 * sin(p.y * 2.0943951);
  float roll = 0.5 + 0.5 * sin(p.y * 0.035 - t * 2.2);
  float a = strength * (0.62 * line + 0.22 * roll);
  return half4(0.0, 0.0, 0.0, half(a));
}`,
  grain: `
uniform float t;
uniform float strength;
half4 main(float2 p) {
  float n = fract(sin(dot(floor(p * 0.7) + floor(t * 24.0), float2(12.9898, 78.233))) * 43758.5453);
  float a = strength * n;
  return half4(half(a), half(a), half(a), half(a));
}`,
  plasma: `
uniform float t;
uniform float3 c1;
uniform float3 c2;
half4 main(float2 p) {
  float v = sin(p.x * 0.09 + t * 1.7) + sin(p.y * 0.08 - t * 1.3) + sin((p.x + p.y) * 0.05 + t);
  float k = 0.5 + 0.5 * sin(v * 1.6);
  return half4(half3(mix(c1, c2, k)), 1.0);
}`,
};

const effects: Partial<Record<keyof typeof SRC, SkRuntimeEffect | null>> = {};
function effect(name: keyof typeof SRC) {
  if (!(name in effects)) {
    try {
      effects[name] = Skia.RuntimeEffect.Make(SRC[name]);
    } catch {
      effects[name] = null;
    }
  }
  return effects[name] ?? null;
}

const blurs = new Map<number, ReturnType<typeof Skia.MaskFilter.MakeBlur>>();
function blur(sigma: number) {
  const key = Math.round(sigma * 2) / 2;
  let b = blurs.get(key);
  if (!b) {
    b = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, key, true);
    blurs.set(key, b);
  }
  return b;
}

function paint(color: RGB, alpha = 1, opts: { blur?: number; stroke?: number; blend?: BlendMode } = {}): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(rgba(color, alpha));
  if (opts.blur) p.setMaskFilter(blur(opts.blur));
  if (opts.stroke) {
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(opts.stroke);
    p.setStrokeCap(StrokeCap.Round);
  }
  if (opts.blend !== undefined) p.setBlendMode(opts.blend);
  return p;
}

// ------------------------------------------------------------------ formas
function rect(x: number, y: number, w: number, h: number) {
  return Skia.XYWHRect(x, y, w, h);
}

/** Ojo recortado por los párpados. Devuelve null si está del todo cerrado. */
function eyePath(cx: number, cy: number, w: number, h: number, round: number, lid: number, tilt: number, bot: number, smile: number, side: number): SkPath | null {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const rr = (Math.min(w, h) / 2) * round;
  let p: SkPath | null = Skia.Path.RRect(Skia.RRectXY(rect(x0, y0, w, h), rr, rr));
  const inner = side < 0 ? 1 : -1; // el lado de dentro del ojo izquierdo está a su derecha
  if (lid > 0.002 || Math.abs(tilt) > 0.002) {
    const yTop = y0 + lid * h;
    const k = tilt * h * 0.5;
    const yAt = (x: number) => yTop + (k * inner * (x - cx)) / (w / 2);
    const upper = Skia.PathBuilder.Make()
      .moveTo(cx - w, y0 - h)
      .lineTo(cx + w, y0 - h)
      .lineTo(cx + w, yAt(cx + w))
      .lineTo(cx - w, yAt(cx - w))
      .close()
      .build();
    p = Skia.Path.MakeFromOp(p, upper, PathOp.Difference);
    if (!p) return null;
  }
  if (bot > 0.002 || smile > 0.002) {
    // borde del párpado de abajo: recto si solo sube, en arco ("^ ^") si sonríe
    const yEnd = y0 + h * (1 - bot - 0.22 * smile);
    const yPeak = y0 + h * (1 - bot - 0.66 * smile);
    const yCtrl = 2 * yPeak - yEnd;
    const lower = Skia.PathBuilder.Make()
      .moveTo(cx - w * 0.6, yEnd)
      .quadTo(cx, yCtrl, cx + w * 0.6, yEnd)
      .lineTo(cx + w, y0 + 2 * h)
      .lineTo(cx - w, y0 + 2 * h)
      .close()
      .build();
    p = Skia.Path.MakeFromOp(p, lower, PathOp.Difference);
  }
  return p && !p.isEmpty() ? p : null;
}

function heartPath(cx: number, cy: number, s: number) {
  return Skia.PathBuilder.Make()
    .moveTo(cx, cy + s * 0.9)
    .cubicTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.9, cy - s * 1.25, cx, cy - s * 0.45)
    .cubicTo(cx + s * 0.9, cy - s * 1.25, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9)
    .close()
    .build();
}

function starPath(cx: number, cy: number, s: number, rot: number, points = 4, inner = 0.32) {
  const b = Skia.PathBuilder.Make();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? s : s * inner;
    const a = rot + (i * Math.PI) / points - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  return b.close().build();
}

function spiralPath(cx: number, cy: number, s: number, rot: number) {
  const b = Skia.PathBuilder.Make();
  const turns = 2.6;
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const a = rot + k * turns * 2 * Math.PI;
    const r = 2 + k * s;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  return b.build();
}

function dropPath(cx: number, cy: number, s: number) {
  return Skia.PathBuilder.Make()
    .moveTo(cx, cy - s * 1.4)
    .quadTo(cx + s, cy - s * 0.1, cx + s * 0.8, cy + s * 0.45)
    .quadTo(cx, cy + s * 1.35, cx - s * 0.8, cy + s * 0.45)
    .quadTo(cx - s, cy - s * 0.1, cx, cy - s * 1.4)
    .close()
    .build();
}

// ------------------------------------------------------------------ dibujo
type Look = { glow: number; wide: number; ghost: boolean; scan: number; grain: number; vignette: number; plasma: boolean };

function lookOf(effectName: string): Look {
  switch (effectName) {
    case 'neon':
      return { glow: 11, wide: 26, ghost: false, scan: 0, grain: 0, vignette: 0.25, plasma: false };
    case 'retro':
      return { glow: 7, wide: 18, ghost: false, scan: 0.42, grain: 0.07, vignette: 0.6, plasma: false };
    case 'holograma':
      return { glow: 9, wide: 22, ghost: true, scan: 0.26, grain: 0.03, vignette: 0.3, plasma: false };
    case 'plasma':
      return { glow: 10, wide: 24, ghost: false, scan: 0, grain: 0, vignette: 0.3, plasma: true };
    default:
      return { glow: 6, wide: 0, ghost: false, scan: 0, grain: 0, vignette: 0, plasma: false };
  }
}

function drawShape(c: SkCanvas, path: SkPath, color: RGB, alpha: number, look: Look, t: number, cx: number, cy: number, w: number, h: number, glowBoost: number) {
  const g = 1 + glowBoost;
  if (look.wide) c.drawPath(path, paint(color, 0.32 * alpha * g, { blur: look.wide }));
  c.drawPath(path, paint(color, 0.75 * alpha * g, { blur: look.glow }));
  if (look.ghost) {
    const off = 1.6 + Math.sin(t * 7) * 0.8;
    c.save();
    c.translate(off, 0);
    c.drawPath(path, paint([1, 0.2, 0.75], 0.32 * alpha, { blend: BlendMode.Plus }));
    c.translate(-2 * off, 0);
    c.drawPath(path, paint([0.2, 0.9, 1], 0.32 * alpha, { blend: BlendMode.Plus }));
    c.restore();
  }
  // relleno
  const fill = paint(color, alpha);
  const fx = look.plasma ? effect('plasma') : null;
  if (fx) {
    const dark = mixRGB(color, [0, 0, 0], 0.25);
    const light = mixRGB(color, WHITE, 0.55);
    fill.setShader(fx.makeShader([t, ...dark, ...light]));
    fill.setAlphaf(alpha);
  }
  c.drawPath(path, fill);
  // luz interior: más clara arriba, como una burbuja
  const shade = Skia.Paint();
  shade.setAntiAlias(true);
  shade.setShader(
    Skia.Shader.MakeRadialGradient({ x: cx - w * 0.12, y: cy - h * 0.22 }, Math.max(w, h) * 0.75, [rgba(WHITE, 0.32 * alpha), rgba(WHITE, 0)], [0, 1], TileMode.Clamp),
  );
  c.drawPath(path, shade);
}

function drawParticle(c: SkCanvas, p: Particle, ox: number, oy: number, color: RGB, look: Look) {
  const k = p.age / p.life;
  const a = Math.min(1, p.age * 4) * (1 - k);
  const x = ox + p.x;
  const y = oy + p.y;
  switch (p.kind) {
    case 'heart': {
      const path = heartPath(x, y, 7 * p.size * (1 + 0.1 * Math.sin(p.age * 9)));
      const pink = hex('#FF6FB5');
      c.drawPath(path, paint(pink, 0.6 * a, { blur: 5 }));
      c.drawPath(path, paint(pink, a));
      break;
    }
    case 'sparkle':
    case 'star': {
      const gold = p.kind === 'star' ? mixRGB(color, WHITE, 0.4) : hex('#FFE38A');
      const path = starPath(x, y, 7 * p.size, p.rot, p.kind === 'star' ? 5 : 4, p.kind === 'star' ? 0.45 : 0.28);
      c.drawPath(path, paint(gold, 0.6 * a, { blur: 4 }));
      c.drawPath(path, paint(gold, a));
      break;
    }
    case 'drop':
    case 'sweat': {
      const blue = hex('#7CC4FF');
      const path = dropPath(x, y, p.kind === 'drop' ? 4 : 5);
      c.drawPath(path, paint(blue, 0.5 * a, { blur: 3 }));
      c.drawPath(path, paint(blue, 0.95 * a));
      break;
    }
    case 'snow':
      c.drawCircle(x, y, 2.2 * p.size, paint(WHITE, 0.35 * a, { blur: 2 }));
      c.drawCircle(x, y, 1.4 * p.size, paint(WHITE, 0.8 * a));
      break;
    default:
      break; // las de texto (z, ?, !, notas) las pinta Face.tsx
  }
  void look;
}

/** Dibuja la cara entera y devuelve la "foto" del fotograma. */
export function drawFace(e: FaceEngine, W: number, H: number, now: number): SkPicture {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(rect(0, 0, W, H));
  const s = H / 240;
  const LW = W / s;
  const MX = LW / 2;
  const t = now / 1000;
  const f = e.face.x;
  const off = e.offset(now);
  const a = e.amp(now);
  const look = lookOf(e.theme.effect);
  const color = eyeColor(e);
  const bright = 1 - 0.3 * e.night;
  const flicker = look.ghost ? 0.9 + 0.1 * Math.sin(t * 37) * Math.sin(t * 13) : 1;
  const alpha = bright * flicker;

  c.drawColor(Skia.Color('black'));
  c.save();
  c.scale(s, s);

  // fondo: un halo muy suave del color de los ojos, para dar profundidad
  const bg = Skia.Paint();
  bg.setShader(Skia.Shader.MakeRadialGradient({ x: MX, y: 105 }, LW * 0.55, [rgba(color, 0.09 * alpha), rgba(color, 0)], [0, 1], TileMode.Clamp));
  c.drawRect(rect(0, 0, LW, 240), bg);

  const base = e.base;
  const gap = Math.min(96, 54 * Math.max(1, LW / 320)) * f.spread;
  const overlayPads = e.overlay?.pads;
  const shrink = overlayPads ? 0.62 : 1;

  ([-1, 1] as const).forEach((side) => {
    const ev = side < 0 ? e.left.x : e.right.x;
    const blink = side < 0 ? e.blinkL : e.blinkR;
    const w = base.w * ev.sx * (1 + a * 0.05) * shrink * (1 - off.squash * 0.02);
    const h = base.h * ev.sy * shrink * (1 + off.squash * 0.03) * (1 + off.breathe * 0.006);
    const cx = MX + side * gap * shrink + e.look[0] * 1.5 + off.x;
    const cy = 100 + ev.dy + e.look[1] * 0.9 + off.y - a * 3;
    const special = Math.max(f.heart, f.spiral, f.star);
    const normal = 1 - special;

    if (normal > 0.03) {
      const closed = f.closed;
      const lid = Math.min(1, Math.max(ev.lid, closed * 0.6) + (1 - ev.lid) * blink * 0.58);
      const bot = Math.min(1, Math.max(ev.bot, closed * 0.4) + (1 - ev.bot) * blink * 0.42);
      const ww = w * (0.4 + 0.6 * normal);
      const hh = h * (0.4 + 0.6 * normal);
      const visible = hh * (1 - lid - bot);
      const path = visible > 3.5 ? eyePath(cx, cy, ww, hh, base.round, lid, ev.tilt, bot, ev.smile, side) : null;
      if (path) {
        drawShape(c, path, color, alpha * normal, look, t, cx, cy, ww, hh, f.glow);
        // reflejo: un brillito que se mueve un poco al revés que la mirada
        c.save();
        c.clipPath(path, ClipOp.Intersect, true);
        const hx = cx - ww * 0.24 - e.look[0] * 0.12;
        const hy = cy - hh * 0.27 - e.look[1] * 0.1;
        const hw = ww * 0.17;
        const hh2 = hh * 0.11;
        c.drawRRect(Skia.RRectXY(rect(hx - hw / 2, hy - hh2 / 2, hw, hh2), hh2 / 2, hh2 / 2), paint(WHITE, 0.5 * alpha * normal));
        c.drawCircle(hx + hw * 0.75, hy + hh2 * 0.9, hh2 * 0.32, paint(WHITE, 0.35 * alpha * normal));
        c.restore();
      } else {
        // cerrado: una rayita curvada (dormido) o recta (parpadeo)
        const yLine = cy - hh / 2 + hh * Math.min(1, lid);
        const curve = closed > 0.5 ? 5 : 1.5;
        const line = Skia.PathBuilder.Make()
          .moveTo(cx - ww * 0.42, yLine)
          .quadTo(cx, yLine + curve, cx + ww * 0.42, yLine)
          .build();
        c.drawPath(line, paint(color, 0.6 * alpha, { stroke: 5, blur: look.glow * 0.8 }));
        c.drawPath(line, paint(color, alpha, { stroke: 4.2 }));
      }
    }
    if (f.heart > 0.03) {
      const sz = 27 * f.heart * (1 + 0.07 * Math.sin(t * 7.5)) * shrink;
      const path = heartPath(cx, cy - 2, sz);
      drawShape(c, path, color, alpha * f.heart, look, t, cx, cy, sz * 2.4, sz * 2.2, f.glow);
    }
    if (f.star > 0.03) {
      const sz = 36 * f.star * (1 + 0.1 * Math.sin(t * 9)) * shrink;
      const path = starPath(cx, cy, sz, t * 0.8 * side, 4, 0.36);
      drawShape(c, path, color, alpha * f.star, look, t, cx, cy, sz * 2, sz * 2, f.glow);
    }
    if (f.spiral > 0.03) {
      const path = spiralPath(cx, cy, 30 * f.spiral * shrink, t * 5 * side);
      c.drawPath(path, paint(color, 0.6 * alpha * f.spiral, { stroke: 5, blur: look.glow }));
      c.drawPath(path, paint(color, alpha * f.spiral, { stroke: 4 }));
    }
    if (f.blush > 0.03) {
      const bw = 30;
      const bh = 11;
      const bx = cx + side * 6 - bw / 2;
      const by = cy + h * 0.5 + 4;
      c.drawOval(rect(bx, by, bw, bh), paint(hex('#FF6F9E'), 0.42 * f.blush * alpha, { blur: 5 }));
    }
  });

  // puntos suspensivos cuando piensa
  if (f.think > 0.5) {
    for (let i = 0; i < 3; i++) {
      const o = 0.35 + 0.65 * Math.max(0, Math.sin(now / 380 - i * 0.7));
      c.drawCircle(MX - 14 + i * 14, 178, 3.4, paint(color, o * alpha));
    }
  }

  // la voz: una onda luminosa, como un osciloscopio
  if (a > 0.01) {
    const L = 150;
    const x0 = MX - L / 2;
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i <= 60; i++) {
      const x = x0 + (i / 60) * L;
      const env = Math.sin((Math.PI * i) / 60);
      const y = 194 + (Math.sin(x * 0.27 + t * 19) * 0.7 + Math.sin(x * 0.11 - t * 8) * 0.45) * a * 10 * env;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    const wave = b.build();
    c.drawPath(wave, paint(color, 0.7 * alpha, { stroke: 4, blur: 5 }));
    c.drawPath(wave, paint(mixRGB(color, WHITE, 0.3), alpha, { stroke: 2.2 }));
  }

  // partículas
  for (const p of e.particles) drawParticle(c, p, MX, 100, color, look);

  // lucecita de "te escucho"
  if (now < e.listeningUntil) {
    const o = 0.5 + 0.5 * Math.abs(Math.sin(now / 160));
    c.drawCircle(MX, 18, 4.5, paint(color, 0.6 * o, { blur: 4 }));
    c.drawCircle(MX, 18, 3.2, paint(color, o));
  }

  // barra de progreso (descarga del cerebro)
  if (e.progress !== null) {
    const bw = 140;
    c.drawRRect(Skia.RRectXY(rect(MX - bw / 2, 230, bw, 3), 1.5, 1.5), paint(mixRGB(color, [0, 0, 0], 0.75), 1));
    c.drawRRect(Skia.RRectXY(rect(MX - bw / 2, 230, bw * Math.max(0.02, e.progress), 3), 1.5, 1.5), paint(color, 1));
  }

  // juego de Simón: cuatro teclas de colores
  if (overlayPads) {
    padRects(LW).forEach((r, i) => {
      const col = hex(overlayPads.colors[i] ?? '#FFFFFF');
      const lit = overlayPads.lit === i;
      const rr = Skia.RRectXY(rect(r.x, r.y, r.w, r.h), 18, 18);
      if (lit) c.drawRRect(rr, paint(col, 0.8, { blur: 14 }));
      c.drawRRect(rr, paint(col, lit ? 1 : 0.22));
      c.drawRRect(rr, paint(col, lit ? 1 : 0.5, { stroke: 2 }));
    });
  }
  // barra de tiempo de los juegos
  if (e.overlay?.timer !== undefined) {
    const bw = LW * 0.5;
    c.drawRRect(Skia.RRectXY(rect(MX - bw / 2, 8, bw * Math.max(0, Math.min(1, e.overlay.timer)), 3), 1.5, 1.5), paint(color, 0.9));
  }

  // efectos de pantalla
  const scan = look.scan ? effect('scan') : null;
  if (scan) {
    const p = Skia.Paint();
    p.setShader(scan.makeShader([t, look.scan]));
    c.drawRect(rect(0, 0, LW, 240), p);
  }
  const grain = look.grain ? effect('grain') : null;
  if (grain) {
    const p = Skia.Paint();
    p.setShader(grain.makeShader([t, look.grain]));
    p.setBlendMode(BlendMode.Plus);
    c.drawRect(rect(0, 0, LW, 240), p);
  }
  if (look.vignette) {
    const v = Skia.Paint();
    v.setShader(
      Skia.Shader.MakeRadialGradient({ x: MX, y: 120 }, Math.max(LW, 240) * 0.62, [rgba([0, 0, 0], 0), rgba([0, 0, 0], look.vignette)], [0.55, 1], TileMode.Clamp),
    );
    c.drawRect(rect(0, 0, LW, 240), v);
  }

  c.restore();
  return rec.finishRecordingAsPicture();
}
