// Motor de la cara de Bip: guarda el estado (emoción, parpadeo, mirada, voz)
// y lo hace evolucionar en el tiempo. No dibuja nada: eso lo hace Face.tsx.

export type EmotionName =
  | 'neutral'
  | 'contento'
  | 'curioso'
  | 'sorprendido'
  | 'triste'
  | 'pensando'
  | 'sueno';

export interface EyeParams {
  w: number; // ancho del ojo (unidades lógicas: la pantalla mide 240 de alto)
  h: number; // alto del ojo
  r: number; // redondeo
  dy: number; // desplazamiento vertical
  happy: number; // 0..1 ojos en arco
  sad: number; // 0..1 párpado caído hacia fuera
  asym: number; // 0..1 un ojo más grande que el otro
  lx: number; // hacia dónde mira (x)
  ly: number; // hacia dónde mira (y)
  sleep: number; // 0..1 dormido
  think: number; // 0..1 puntos suspensivos
}

export const EMOTIONS: Record<EmotionName, EyeParams & { label: string }> = {
  neutral: { label: 'Tranquilo', w: 60, h: 74, r: 20, dy: 0, happy: 0, sad: 0, asym: 0, lx: 0, ly: 0, sleep: 0, think: 0 },
  contento: { label: 'Contento', w: 66, h: 66, r: 24, dy: -2, happy: 1, sad: 0, asym: 0, lx: 0, ly: -2, sleep: 0, think: 0 },
  curioso: { label: 'Curioso', w: 60, h: 74, r: 20, dy: 0, happy: 0, sad: 0, asym: 1, lx: 12, ly: -4, sleep: 0, think: 0 },
  sorprendido: { label: 'Sorprendido', w: 68, h: 90, r: 34, dy: -4, happy: 0, sad: 0, asym: 0, lx: 0, ly: 0, sleep: 0, think: 0 },
  triste: { label: 'Triste', w: 58, h: 62, r: 18, dy: 12, happy: 0, sad: 1, asym: 0, lx: 0, ly: 8, sleep: 0, think: 0 },
  pensando: { label: 'Pensando', w: 56, h: 60, r: 18, dy: -6, happy: 0, sad: 0, asym: 0.4, lx: 16, ly: -12, sleep: 0, think: 1 },
  sueno: { label: 'Con sueño', w: 62, h: 6, r: 3, dy: 10, happy: 0, sad: 0, asym: 0, lx: 0, ly: 0, sleep: 1, think: 0 },
};

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

const KEYS = ['w', 'h', 'r', 'dy', 'happy', 'sad', 'asym', 'lx', 'ly', 'sleep', 'think'] as const;

export class FaceEngine {
  p: EyeParams = { ...EMOTIONS.neutral };
  emotion: EmotionName = 'neutral';
  private target: EyeParams = EMOTIONS.neutral;
  private holdUntil = 0;

  blink = 1;
  private blinkT = -1;
  private nextBlink = 0;

  look: [number, number] = [0, 0];
  private lookT: [number, number] = [0, 0];
  private nextLook = 0;

  subtitle = '';
  subUntil = 0;
  speech: Speech | null = null;

  /** Si hay alguien delante, los ojos miran ahí en vez de vagar. */
  private gaze: [number, number] | null = null;
  /** Lucecita de "te estoy escuchando". */
  /** 0..1 mientras descarga su cerebro; null si no hay descarga. */
  progress: number | null = null;
  listeningUntil = 0;
  /** Lo último que ha oído (se muestra arriba, pequeño). */
  heard = '';
  heardUntil = 0;

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
    this.emotion = e;
    this.target = EMOTIONS[e];
    this.holdUntil = holdMs > 0 ? performance.now() + holdMs : 0;
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

  update(now: number, calm = false) {
    if (this.holdUntil && now > this.holdUntil && this.emotion !== 'sueno') {
      this.holdUntil = 0;
      this.setEmotion('neutral');
    }
    for (const k of KEYS) this.p[k] += (this.target[k] - this.p[k]) * 0.16;

    if (this.blinkT < 0 && now > this.nextBlink && this.p.sleep < 0.5) this.blinkT = now;
    if (this.blinkT >= 0) {
      const k = (now - this.blinkT) / 170;
      this.blink = k < 0.5 ? 1 - k * 1.85 : Math.min(1, 0.075 + (k - 0.5) * 1.85);
      if (k >= 1) {
        this.blinkT = -1;
        this.blink = 1;
        this.nextBlink = now + 1800 + Math.random() * 3600;
      }
    }

    let follow = 0.08;
    if (this.gaze) {
      this.lookT = [this.gaze[0], this.gaze[1]];
      follow = 0.18;
    } else if (now > this.nextLook) {
      this.lookT = calm ? [0, 0] : [(Math.random() * 2 - 1) * 9, (Math.random() * 2 - 1) * 5];
      this.nextLook = now + 1200 + Math.random() * 2800;
    }
    this.look[0] += (this.lookT[0] - this.look[0]) * follow;
    this.look[1] += (this.lookT[1] - this.look[1]) * follow;

    if (this.speech && now > this.speech.end + 50) this.speech = null;
  }
}
