// Lo que Bip percibe de ti, más allá de verte: tu expresión (con MediaPipe), los gestos
// de tu mano y los sonidos (palmadas, música). Convierte medidas sueltas en cosas con
// sentido ("está sonriendo", "me saluda con la mano", "suena música") y calcula, poco a
// poco, cómo pareces estar.
import type { Expression, HandGesture, SeenHand } from '../../modules/bip-senses';

export type ExprLabel = 'sonrisa' | 'sorpresa' | 'enfado' | 'tristeza' | 'beso' | 'mofletes' | 'bostezo' | 'ojos_cerrados' | 'neutral';

/** Qué cara estás poniendo, y con cuánta claridad (0..1). */
export function classify(e: Expression): { label: ExprLabel; strength: number } {
  const blink = (e.blinkL + e.blinkR) / 2;
  const cands: [ExprLabel, number][] = [
    ['bostezo', e.jawOpen > 0.55 ? Math.min(1, e.jawOpen * 0.7 + e.squint * 0.4 + blink * 0.3) : 0],
    ['sorpresa', e.jawOpen > 0.25 ? Math.min(1, e.browUp * 0.6 + e.wide * 0.5 + e.jawOpen * 0.4) : e.browUp * 0.55 + e.wide * 0.3],
    ['sonrisa', e.smile * 1.1],
    ['beso', e.pucker * 1.1],
    ['mofletes', e.puff * 1.2],
    ['enfado', e.browDown * 0.7 + e.sneer * 0.4 + e.press * 0.3],
    ['tristeza', e.frown * 0.9 + (e.browUp > 0.3 && e.smile < 0.15 ? 0.2 : 0)],
    ['ojos_cerrados', blink > 0.75 ? blink : 0],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  const [label, s] = cands[0];
  return s >= 0.42 ? { label, strength: Math.min(1, s) } : { label: 'neutral', strength: 1 - s };
}

export type PerceptionEvent =
  | { kind: 'sonrisa' }
  | { kind: 'sorpresa' }
  | { kind: 'bostezo' }
  | { kind: 'gesto'; gesture: HandGesture }
  | { kind: 'saludo' }
  | { kind: 'palmada' }
  | { kind: 'musica'; on: boolean }
  | { kind: 'golpe' };

/** Media que se mueve despacio (para el ánimo de la persona). */
class Slow {
  v = 0;
  constructor(private halfLifeMs: number) {}
  push(x: number, dtMs: number) {
    const k = 1 - Math.pow(0.5, dtMs / this.halfLifeMs);
    this.v += (x - this.v) * k;
    return this.v;
  }
}

export class Perception {
  expr: Expression | null = null;
  label: { label: ExprLabel; strength: number } = { label: 'neutral', strength: 1 };
  /** ¿Ha llegado alguna vez una expresión? (si no, el lector de caras no está listo) */
  hasReader = false;
  hand: SeenHand | null = null;
  /** Volumen ahora (0..1). */
  level = 0;
  music = false;

  private lastExprAt = 0;
  private labelSince = 0;
  private lastLabel: ExprLabel = 'neutral';
  private fired = new Map<string, number>();
  private happy = new Slow(4 * 60_000);
  private down = new Slow(4 * 60_000);
  private tired = new Slow(4 * 60_000);
  private samples = 0;
  // manos
  private gestureSince = 0;
  private gesture: HandGesture | null = null;
  private palmXs: { t: number; x: number }[] = [];
  // sonido
  private levels: { t: number; l: number }[] = [];
  private floor = 0.15;

  constructor(private emit: (e: PerceptionEvent) => void) {}

  private once(key: string, now: number, cooldownMs: number) {
    const last = this.fired.get(key) ?? -Infinity;
    if (now - last < cooldownMs) return false;
    this.fired.set(key, now);
    return true;
  }

  // ---------------------------------------------------------------- cara
  feedExpr(e: Expression, now: number) {
    const dt = this.lastExprAt ? Math.min(2000, now - this.lastExprAt) : 200;
    this.lastExprAt = now;
    this.expr = e;
    this.hasReader = true;
    const c = classify(e);
    if (c.label !== this.lastLabel) {
      this.lastLabel = c.label;
      this.labelSince = now;
    }
    this.label = c;
    const held = now - this.labelSince;
    if (c.label === 'sonrisa' && held > 600 && this.once('sonrisa', now, 25_000)) this.emit({ kind: 'sonrisa' });
    if (c.label === 'sorpresa' && held > 300 && c.strength > 0.6 && this.once('sorpresa', now, 20_000)) this.emit({ kind: 'sorpresa' });
    if (c.label === 'bostezo' && held > 700 && this.once('bostezo', now, 120_000)) this.emit({ kind: 'bostezo' });
    // ánimo de la persona: medias lentas de unos minutos
    this.samples++;
    this.happy.push(e.smile, dt);
    this.down.push(Math.max(e.frown, e.browDown * 0.6), dt);
    const blink = (e.blinkL + e.blinkR) / 2;
    this.tired.push(Math.max(blink > 0.85 ? 0 : blink, e.squint * 0.5, c.label === 'bostezo' ? 1 : 0), dt);
  }

  /** Cuánto lleva sin llegar una expresión (para saber si sigue viendo la cara de cerca). */
  exprAge(now: number) {
    return this.lastExprAt ? now - this.lastExprAt : Infinity;
  }

  /** ¿Has parpadeado? (los dos ojos cerrados a la vez) */
  blinking() {
    const e = this.expr;
    return !!e && e.blinkL > 0.5 && e.blinkR > 0.5;
  }

  /** Cómo pareces estar en los últimos minutos (o null si aún no lo sabe). */
  userMood(): string | null {
    if (this.samples < 150) return null; // hacen falta unos minutos de verte de cerca
    if (this.happy.v > 0.35) return 'contenta';
    if (this.tired.v > 0.4) return 'cansada';
    if (this.down.v > 0.3) return 'triste o seria';
    return null;
  }

  // ---------------------------------------------------------------- manos
  feedHand(h: SeenHand | undefined, now: number) {
    this.hand = h ?? null;
    const g = h?.gesture ?? null;
    if (g !== this.gesture) {
      this.gesture = g;
      this.gestureSince = now;
    }
    // saludar = palma abierta moviéndose de lado a lado
    if (g === 'palma' && h) {
      this.palmXs.push({ t: now, x: h.x });
      this.palmXs = this.palmXs.filter((p) => now - p.t < 1500);
      const xs = this.palmXs.map((p) => p.x);
      let turns = 0;
      for (let i = 2; i < xs.length; i++) {
        const a = xs[i - 1] - xs[i - 2];
        const b = xs[i] - xs[i - 1];
        if (Math.abs(a) > 0.015 && Math.abs(b) > 0.015 && Math.sign(a) !== Math.sign(b)) turns++;
      }
      if (turns >= 2 && this.once('saludo', now, 20_000)) {
        this.palmXs = [];
        this.emit({ kind: 'saludo' });
        return;
      }
    } else {
      this.palmXs = [];
    }
    if (g && g !== 'otro' && now - this.gestureSince > 600 && this.once(`g-${g}`, now, 15_000)) {
      this.emit({ kind: 'gesto', gesture: g });
    }
  }

  /** El gesto que mantienes ahora mismo (estable al menos ms milisegundos). */
  heldGesture(now: number, ms = 250): HandGesture | null {
    return this.gesture && now - this.gestureSince >= ms ? this.gesture : null;
  }

  // ---------------------------------------------------------------- sonido
  /** speaking: si Bip está pitando (no hay que confundir su voz con una palmada). recentWords: si ha entendido palabras. */
  feedSound(level: number, now: number, speaking: boolean, recentWords: boolean) {
    this.level = level;
    if (speaking) return;
    this.levels.push({ t: now, l: level });
    this.levels = this.levels.filter((x) => now - x.t < 10_000);
    // ruido de fondo: sube despacio, baja rápido
    this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor * 0.995 + level * 0.005;
    const prev = this.levels.length > 3 ? this.levels[this.levels.length - 4].l : this.floor;
    if (level > 0.72 && level - prev > 0.28 && level - this.floor > 0.3 && this.once('palmada', now, 4000)) {
      this.emit({ kind: 'palmada' });
    }
    // música: sonido sostenido durante 8 s, con pulsos, y sin palabras entendidas
    const recent = this.levels.filter((x) => now - x.t < 8000);
    if (recent.length > 60) {
      const loud = recent.filter((x) => x.l > this.floor + 0.12).length / recent.length;
      let pulses = 0;
      for (let i = 1; i < recent.length; i++) if (recent[i].l - recent[i - 1].l > 0.06) pulses++;
      const isMusic = loud > 0.75 && pulses > 12 && !recentWords;
      if (isMusic !== this.music) {
        this.music = isMusic;
        this.emit({ kind: 'musica', on: isMusic });
      }
    }
  }

  /** ¿Hay un golpe de ritmo ahora? (para bailar) */
  beat() {
    const n = this.levels.length;
    if (n < 2) return false;
    return this.levels[n - 1].l - this.levels[n - 2].l > 0.08;
  }
}
