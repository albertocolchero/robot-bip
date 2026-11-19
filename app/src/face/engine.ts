// Motor de la cara de Bip: guarda el estado (emoción, párpados, mirada, parpadeo, voz,
// partículas, tema) y lo hace evolucionar en el tiempo con "muelles", para que todo se
// mueva con inercia y un poquito de rebote. No dibuja nada: eso lo hacen draw.ts y Face.tsx.
import { DEFAULT_THEME, SHAPES, type Theme } from './theme';

export type EmotionName =
  | 'neutral'
  | 'contento'
  | 'feliz'
  | 'curioso'
  | 'sorprendido'
  | 'triste'
  | 'pensando'
  | 'sueno'
  | 'cansado'
  | 'enfadado'
  | 'asustado'
  | 'enamorado'
  | 'mareado'
  | 'confundido'
  | 'aburrido'
  | 'avergonzado'
  | 'emocionado'
  | 'privado';

/** Un ojo: tamaño relativo a la forma del tema, posición y párpados. */
type EyeDef = {
  sx?: number; // ancho (1 = el de la forma)
  sy?: number; // alto
  dy?: number; // subir (-) o bajar (+)
  lid?: number; // párpado de arriba, 0 abierto … 1 cerrado
  tilt?: number; // inclinación del párpado: + enfadado (baja por dentro), - triste (baja por fuera)
  bot?: number; // párpado de abajo
  smile?: number; // ojos en arco "^ ^"
};

type EmotionDef = {
  label: string;
  eye?: EyeDef;
  left?: EyeDef;
  right?: EyeDef;
  look?: [number, number]; // hacia dónde tiende a mirar
  spread?: number; // separación de los ojos (1 = normal)
  tint?: string; // color hacia el que se tiñe (si el tema lo permite)
  tintAmt?: number;
  glow?: number; // brillo extra
  jitter?: number; // temblor
  heart?: number; // ojos de corazón
  spiral?: number; // ojos de espiral
  star?: number; // ojos de estrella
  closed?: number; // ojos cerrados (línea)
  think?: number; // puntos suspensivos
  blush?: number; // coloretes
  particles?: { kind: ParticleKind; every: number }; // ms entre partículas
  blinkRate?: number; // 1 normal, 2 = el doble de parpadeos
  slowBlink?: boolean;
  breath?: number; // amplitud de la respiración (1 normal)
};

export const EMOTIONS: Record<EmotionName, EmotionDef> = {
  neutral: { label: 'Tranquilo' },
  contento: { label: 'Contento', eye: { smile: 0.55, bot: 0.1, sy: 0.95 }, look: [0, -2], tint: '#FFE38A', tintAmt: 0.12 },
  feliz: { label: 'Muy feliz', eye: { smile: 0.95, bot: 0.22, sy: 0.92, sx: 1.06, dy: -3 }, look: [0, -3], glow: 0.25, tint: '#FFE38A', tintAmt: 0.2, breath: 2.2 },
  curioso: { label: 'Curioso', left: { sx: 1.12, sy: 1.14 }, right: { sx: 0.9, sy: 0.86, lid: 0.22, tilt: 0.1 }, look: [10, -4] },
  sorprendido: { label: 'Sorprendido', eye: { sx: 1.12, sy: 1.22, dy: -5 }, glow: 0.35, particles: { kind: 'ex', every: 2400 } },
  triste: { label: 'Triste', eye: { sy: 0.84, sx: 0.94, dy: 11, lid: 0.2, tilt: -0.45 }, look: [0, 7], tint: '#6FA8FF', tintAmt: 0.35, glow: -0.2, particles: { kind: 'drop', every: 3200 }, breath: 0.6 },
  pensando: { label: 'Pensando', eye: { sx: 0.92, sy: 0.84, dy: -5, lid: 0.12 }, right: { lid: 0.3, tilt: 0.06 }, look: [15, -11], think: 1 },
  sueno: { label: 'Dormido', eye: { dy: 9 }, closed: 1, look: [0, 4], glow: -0.35, particles: { kind: 'z', every: 1500 }, breath: 1.8 },
  cansado: { label: 'Cansado', eye: { lid: 0.5, sy: 0.92, dy: 6, tilt: -0.08 }, look: [0, 4], glow: -0.2, slowBlink: true, blinkRate: 1.6, breath: 1.6 },
  enfadado: { label: 'Enfadado', eye: { lid: 0.3, tilt: 0.6, sy: 0.9, dy: 2 }, spread: 0.94, tint: '#FF3B30', tintAmt: 0.85, glow: 0.2, jitter: 0.25 },
  asustado: { label: 'Asustado', eye: { sx: 0.82, sy: 1.08, tilt: -0.12, dy: -2 }, spread: 0.92, tint: '#B9E1FF', tintAmt: 0.25, jitter: 1, particles: { kind: 'sweat', every: 2600 }, blinkRate: 2.2 },
  enamorado: { label: 'Enamorado', heart: 1, tint: '#FF6FB5', tintAmt: 0.75, glow: 0.3, blush: 0.8, particles: { kind: 'heart', every: 700 }, breath: 2 },
  mareado: { label: 'Mareado', spiral: 1, jitter: 0.35, tint: '#C8A2FF', tintAmt: 0.3, particles: { kind: 'star', every: 900 } },
  confundido: { label: 'Confundido', left: { sx: 1.1, sy: 1.12, dy: -3 }, right: { lid: 0.42, tilt: 0.2, sy: 0.85, dy: 3 }, look: [-6, -6], particles: { kind: 'q', every: 2000 } },
  aburrido: { label: 'Aburrido', eye: { lid: 0.48, sy: 0.88, dy: 4, tilt: 0.04 }, look: [-14, 2], glow: -0.25, slowBlink: true, breath: 0.7 },
  avergonzado: { label: 'Avergonzado', eye: { smile: 0.35, sy: 0.82, dy: 6, sx: 0.92 }, look: [-12, 8], blush: 1, tint: '#FF9AC0', tintAmt: 0.3 },
  emocionado: { label: 'Emocionado', star: 1, glow: 0.4, tint: '#FFE38A', tintAmt: 0.3, jitter: 0.15, particles: { kind: 'sparkle', every: 450 }, breath: 2.5 },
  privado: { label: 'Privado', eye: { dy: 4 }, closed: 1, glow: -0.55, breath: 0.5 },
};

/** Emociones que se quedan puestas hasta que alguien las cambie (no vuelven a "neutral"). */
const STICKY: EmotionName[] = ['sueno', 'privado'];

export type ParticleKind = 'heart' | 'sparkle' | 'star' | 'drop' | 'sweat' | 'z' | 'q' | 'ex' | 'note' | 'snow';
export type Particle = { kind: ParticleKind; x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; rot: number; spin: number };

export interface Syllable {
  t: number; // inicio (ms, reloj de performance.now)
  d: number; // duración (ms)
  v: number; // intensidad 0..1
}

export interface Speech {
  start: number;
  end: number;
  sylls: Syllable[];
}

/** Lo que pinta un juego encima de la cara. */
export type Overlay = {
  title?: string;
  big?: string;
  score?: string;
  hint?: string;
  left?: string; // icono o texto a la izquierda (por ejemplo, tu jugada)
  right?: string; // icono o texto a la derecha (la de Bip)
  pads?: { lit: number | null; colors: string[] };
  timer?: number; // 0..1 barra de tiempo
};

// ------------------------------------------------------------------ muelles
type EyeKey = 'sx' | 'sy' | 'dy' | 'lid' | 'tilt' | 'bot' | 'smile';
type FaceKey = 'lookX' | 'lookY' | 'spread' | 'tintAmt' | 'glow' | 'jitter' | 'heart' | 'spiral' | 'star' | 'closed' | 'think' | 'blush' | 'breath';
type EyeVals = Record<EyeKey, number>;
type FaceVals = Record<FaceKey, number>;

const EYE_BASE: EyeVals = { sx: 1, sy: 1, dy: 0, lid: 0, tilt: 0, bot: 0, smile: 0 };
const FACE_BASE: FaceVals = { lookX: 0, lookY: 0, spread: 1, tintAmt: 0, glow: 0, jitter: 0, heart: 0, spiral: 0, star: 0, closed: 0, think: 0, blush: 0, breath: 1 };

function eyeTarget(def: EmotionDef, side: 'left' | 'right'): EyeVals {
  return { ...EYE_BASE, ...def.eye, ...def[side] };
}

function faceTarget(def: EmotionDef): FaceVals {
  return {
    ...FACE_BASE,
    lookX: def.look?.[0] ?? 0,
    lookY: def.look?.[1] ?? 0,
    spread: def.spread ?? 1,
    tintAmt: def.tintAmt ?? 0,
    glow: def.glow ?? 0,
    jitter: def.jitter ?? 0,
    heart: def.heart ?? 0,
    spiral: def.spiral ?? 0,
    star: def.star ?? 0,
    closed: def.closed ?? 0,
    think: def.think ?? 0,
    blush: def.blush ?? 0,
    breath: def.breath ?? 1,
  };
}

/** Muelle amortiguado: va hacia el objetivo con inercia (zeta < 1 rebota un poco). */
class Springs<K extends string> {
  x: Record<K, number>;
  private v: Record<K, number>;
  constructor(
    init: Record<K, number>,
    private k = 160,
    private zeta = 0.72,
  ) {
    this.x = { ...init };
    this.v = Object.fromEntries(Object.keys(init).map((key) => [key, 0])) as Record<K, number>;
  }
  step(target: Record<K, number>, dt: number) {
    const c = 2 * this.zeta * Math.sqrt(this.k);
    for (const key of Object.keys(target) as K[]) {
      const a = this.k * (target[key] - this.x[key]) - c * this.v[key];
      this.v[key] += a * dt;
      this.x[key] += this.v[key] * dt;
    }
  }
  kick(key: K, velocity: number) {
    this.v[key] += velocity;
  }
}

type BlinkKind = 'normal' | 'doble' | 'lento' | 'medio' | 'guiño';

export class FaceEngine {
  emotion: EmotionName = 'neutral';
  private holdUntil = 0;
  private def: EmotionDef = EMOTIONS.neutral;

  left = new Springs<EyeKey>(EYE_BASE);
  right = new Springs<EyeKey>(EYE_BASE);
  face = new Springs<FaceKey>(FACE_BASE, 120, 0.8);
  /** Saltitos y gestos (asentir, negar, botar): desplazamiento de toda la cara. */
  private body = new Springs<'x' | 'y' | 'squash'>({ x: 0, y: 0, squash: 0 }, 220, 0.42);

  // parpadeo: 0 abierto … 1 cerrado, por ojo
  blinkL = 0;
  blinkR = 0;
  private blinkStart = -1;
  private blinkKind: BlinkKind = 'normal';
  private nextBlink = 0;

  // mirada (con saltos rápidos, como los ojos de verdad)
  look: [number, number] = [0, 0];
  private lookV: [number, number] = [0, 0];
  private lookT: [number, number] = [0, 0];
  private nextLook = 0;
  private micro: [number, number] = [0, 0];
  private nextMicro = 0;
  private gaze: [number, number] | null = null;

  // voz y subtítulos
  subtitle = '';
  subUntil = 0;
  speech: Speech | null = null;

  // otras cosas que se ven
  progress: number | null = null;
  listeningUntil = 0;
  heard = '';
  heardUntil = 0;
  badge: string | null = null;
  overlay: Overlay | null = null;
  particles: Particle[] = [];
  private nextParticle = 0;
  /** Partículas de ambiente (por ejemplo, nieve en Navidad). */
  weather: ParticleKind | null = null;
  private nextWeather = 0;

  theme: Theme = { ...DEFAULT_THEME };
  /** En el duelo de miradas Bip no parpadea (hasta que pierde). */
  holdEyesOpen = false;
  /** 0..1: de noche la cara brilla menos y en un tono más cálido. */
  night = 0;
  /** Variación del día: cada día Bip es un pelín distinto (tamaño, ritmo de parpadeo). */
  private quirk = { size: 1, blink: 1, wander: 1 };
  /** Para el tiempo entre fotogramas. */
  time = 0;
  private last = 0;

  constructor(seed = Date.now()) {
    const day = Math.floor(seed / 86_400_000);
    const r = (n: number) => {
      const x = Math.sin(day * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    this.quirk = { size: 0.96 + r(1) * 0.08, blink: 0.8 + r(2) * 0.45, wander: 0.75 + r(3) * 0.6 };
  }

  get base() {
    const s = SHAPES[this.theme.shape];
    return { w: s.w * this.quirk.size, h: s.h * this.quirk.size, round: s.round };
  }

  get label() {
    return EMOTIONS[this.emotion].label;
  }

  setGaze(x: number, y: number) {
    this.gaze = [x, y];
  }

  clearGaze() {
    this.gaze = null;
  }

  markListening() {
    this.listeningUntil = performance.now() + 700;
  }

  showHeard(text: string) {
    this.heard = text;
    this.heardUntil = performance.now() + 3500;
  }

  /** Cambia de emoción. Si holdMs > 0, vuelve a "neutral" pasado ese tiempo. */
  setEmotion(e: EmotionName, holdMs = 0) {
    const changed = e !== this.emotion;
    this.emotion = e;
    this.def = EMOTIONS[e];
    this.holdUntil = holdMs > 0 ? performance.now() + holdMs : 0;
    if (!changed) return;
    // pequeños gestos al cambiar de emoción: le dan vida
    if (e === 'sorprendido' || e === 'asustado') this.hop(-1.2);
    else if (e === 'feliz' || e === 'emocionado') this.hop(-0.8);
    else if (e === 'contento' && Math.random() < 0.15) this.wink();
    if (e === 'sorprendido') this.blinkStart = -1; // los ojos se abren de golpe
  }

  say(text: string, speech: Speech | null) {
    this.subtitle = text;
    this.speech = speech;
    this.subUntil = (speech ? speech.end : performance.now() + 2500) + 2600;
    if (speech) this.holdUntil = Math.max(this.holdUntil, speech.end + 2200);
  }

  /** ¿Está hablando o con una emoción temporal? */
  get busy() {
    const now = performance.now();
    return (this.speech !== null && now < this.speech.end) || now < this.holdUntil;
  }

  // ---------------------------------------------------------------- gestos
  hop(strength = 1) {
    this.body.kick('y', 160 * strength);
    this.body.kick('squash', -3 * strength);
  }

  nod() {
    this.body.kick('y', 120);
  }

  shake() {
    this.body.kick('x', 240);
  }

  wink(side: 'L' | 'R' = Math.random() < 0.5 ? 'L' : 'R') {
    this.startBlink(performance.now(), 'guiño', side);
  }

  burst(kind: ParticleKind, n = 6) {
    for (let i = 0; i < n; i++) this.spawn(kind, true);
  }

  private winkSide: 'L' | 'R' = 'L';

  private startBlink(now: number, kind: BlinkKind, side: 'L' | 'R' = 'L') {
    this.blinkStart = now;
    this.blinkKind = kind;
    this.winkSide = side;
  }

  private blinkCurve(k: number) {
    // cierra rápido, abre un poco más despacio
    if (k < 0.38) return k / 0.38;
    return Math.max(0, 1 - (k - 0.38) / 0.62);
  }

  private updateBlink(now: number) {
    const d = this.def;
    if (this.blinkStart < 0 && now > this.nextBlink && !(d.closed ?? 0) && !this.holdEyesOpen) {
      const r = Math.random();
      const kind: BlinkKind = d.slowBlink ? (r < 0.6 ? 'lento' : 'medio') : r < 0.12 ? 'doble' : r < 0.2 ? 'medio' : 'normal';
      this.startBlink(now, kind);
    }
    let b = 0;
    if (this.blinkStart >= 0) {
      const dur = this.blinkKind === 'lento' ? 520 : this.blinkKind === 'guiño' ? 420 : this.blinkKind === 'doble' ? 380 : 170;
      const k = (now - this.blinkStart) / dur;
      if (this.blinkKind === 'doble') b = this.blinkCurve((k * 2) % 1);
      else b = this.blinkCurve(Math.min(1, k));
      if (this.blinkKind === 'medio') b *= 0.55;
      if (k >= 1) {
        this.blinkStart = -1;
        b = 0;
        const rate = (d.blinkRate ?? 1) * this.quirk.blink;
        this.nextBlink = now + (1600 + Math.random() * 4200) / rate;
      }
    }
    if (this.blinkKind === 'guiño' && this.blinkStart >= 0) {
      this.blinkL = this.winkSide === 'L' ? b : 0;
      this.blinkR = this.winkSide === 'R' ? b : 0;
    } else {
      this.blinkL = b;
      this.blinkR = b;
    }
  }

  private updateLook(now: number, dt: number) {
    if (this.gaze) {
      this.lookT = [this.gaze[0], this.gaze[1]];
    } else if (now > this.nextLook) {
      // mirar por ahí: unas veces cerca del centro, otras de reojo
      const far = Math.random() < 0.25;
      const amp = (far ? 18 : 8) * this.quirk.wander;
      this.lookT = [(Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp * 0.55];
      this.nextLook = now + 700 + Math.random() * (far ? 1200 : 3000);
    }
    if (now > this.nextMicro) {
      this.micro = [(Math.random() * 2 - 1) * 1.1, (Math.random() * 2 - 1) * 0.7];
      this.nextMicro = now + 250 + Math.random() * 600;
    }
    const tx = this.lookT[0] + this.micro[0] + this.face.x.lookX;
    const ty = this.lookT[1] + this.micro[1] + this.face.x.lookY;
    // sacada: muelle rígido, casi sin rebote
    const k = 520;
    const c = 2 * 0.9 * Math.sqrt(k);
    this.lookV[0] += (k * (tx - this.look[0]) - c * this.lookV[0]) * dt;
    this.lookV[1] += (k * (ty - this.look[1]) - c * this.lookV[1]) * dt;
    this.look[0] += this.lookV[0] * dt;
    this.look[1] += this.lookV[1] * dt;
  }

  private spawn(kind: ParticleKind, burst = false) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const p: Particle = { kind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 2.2, size: 1, rot: 0, spin: 0 };
    const r = Math.random();
    switch (kind) {
      case 'heart':
      case 'sparkle':
      case 'star':
        p.x = side * (70 + r * 60);
        p.y = 40 + Math.random() * 40;
        p.vx = side * (6 + Math.random() * 14) * (burst ? 2 : 1);
        p.vy = -(18 + Math.random() * 22) * (burst ? 1.6 : 1);
        p.size = 0.7 + Math.random() * 0.6;
        p.spin = (Math.random() * 2 - 1) * 2;
        p.life = 1.8 + Math.random();
        break;
      case 'drop':
        p.x = side * 40;
        p.y = 18;
        p.vy = 30;
        p.life = 1.4;
        break;
      case 'sweat':
        p.x = 92;
        p.y = -28;
        p.vy = 16;
        p.life = 1.6;
        break;
      case 'z':
        p.x = 95 + Math.random() * 10;
        p.y = -30;
        p.vx = 10;
        p.vy = -16;
        p.life = 2;
        p.size = 0.8 + Math.random() * 0.5;
        break;
      case 'q':
      case 'ex':
        p.x = side * 100;
        p.y = -42;
        p.vy = -6;
        p.life = 1.6;
        break;
      case 'note':
        p.x = side * (90 + r * 30);
        p.y = 10;
        p.vx = side * 8;
        p.vy = -22;
        p.life = 2.2;
        break;
      case 'snow':
        p.x = (Math.random() * 2 - 1) * 320;
        p.y = -140;
        p.vx = (Math.random() * 2 - 1) * 6;
        p.vy = 12 + Math.random() * 10;
        p.life = 14;
        p.size = 0.4 + Math.random() * 0.8;
        break;
    }
    this.particles.push(p);
    if (this.particles.length > 60) this.particles.shift();
  }

  private updateParticles(now: number, dt: number) {
    const pp = this.def.particles;
    if (pp && now > this.nextParticle) {
      this.spawn(pp.kind);
      this.nextParticle = now + pp.every * (0.7 + Math.random() * 0.6);
    }
    if (this.weather && now > this.nextWeather) {
      this.spawn(this.weather);
      this.nextWeather = now + 450 + Math.random() * 500;
    }
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.kind === 'drop' || p.kind === 'sweat') p.vy += 60 * dt;
      if (p.kind === 'snow') p.vx += Math.sin(now / 900 + p.y) * 2 * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  /** Volumen de la voz en este instante (para que los ojos "hablen"). */
  amp(now: number) {
    const s = this.speech;
    if (!s) return 0;
    for (const y of s.sylls) {
      if (now >= y.t && now <= y.t + y.d) {
        const k = (now - y.t) / y.d;
        return Math.sin(Math.PI * k) * (0.55 + 0.45 * y.v);
      }
    }
    return 0;
  }

  update(now: number) {
    const dt = this.last ? Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)) : 0.016;
    this.last = now;
    this.time = now / 1000;
    if (this.holdUntil && now > this.holdUntil && !STICKY.includes(this.emotion)) {
      this.holdUntil = 0;
      this.setEmotion('neutral');
    }
    this.left.step(eyeTarget(this.def, 'left'), dt);
    this.right.step(eyeTarget(this.def, 'right'), dt);
    this.face.step(faceTarget(this.def), dt);
    this.body.step({ x: 0, y: 0, squash: 0 }, dt);
    this.updateBlink(now);
    this.updateLook(now, dt);
    this.updateParticles(now, dt);
    if (this.speech && now > this.speech.end + 50) this.speech = null;
  }

  /** Desplazamiento de toda la cara (gestos + respiración + temblor). */
  offset(now: number) {
    const f = this.face.x;
    const breathe = Math.sin((now / 1000) * ((2 * Math.PI) / 4.2)) * 1.2 * f.breath;
    const j = f.jitter;
    const shakeX = j > 0.01 ? (Math.random() * 2 - 1) * j * 1.6 : 0;
    const shakeY = j > 0.01 ? (Math.random() * 2 - 1) * j * 1.2 : 0;
    return { x: this.body.x.x + shakeX, y: this.body.x.y + breathe + shakeY, squash: this.body.x.squash, breathe };
  }
}
