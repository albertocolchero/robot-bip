// Juegos de Bip. Pensados para un robot con cara, voz, pantalla táctil y cámara:
//  - Duelo de miradas: gana quien no parpadea (Bip ve tus parpadeos con MediaPipe).
//  - Imita mi cara: Bip pone una cara y tú la copias.
//  - Simón: repite la secuencia de colores y pitidos tocando la pantalla.
//  - Piedra, papel o tijera: con la mano delante de la cámara (o diciéndolo).
//  - Adivina el número: del 1 al 100, Bip te dice si es más alto o más bajo.
//  - Adivinanzas: las de toda la vida.
import type { EmotionName, FaceEngine } from '../face/engine';
import { padRects } from '../face/padRects';
import type { Perception, ExprLabel } from './perception';
import { readJSON, writeJSON } from './store';
import { normalize } from './talk';

export type GameName = 'miradas' | 'caras' | 'simon' | 'ppt' | 'numero' | 'adivinanzas';

export type GameIO = {
  engine: FaceEngine;
  perception: Perception;
  speak: (emo: EmotionName, text: string) => void;
  /** Varias frases seguidas. */
  chain: (lines: string[], emo: EmotionName) => void;
  tone: (freq: number, ms: number) => void;
  listenFor: (ms: number) => void;
  fastVision: (on: boolean) => void;
  now: () => number;
  /** Ancho de la pantalla en unidades lógicas (para las teclas de Simón). */
  width: () => number;
};

type Best = Partial<Record<GameName, number>>;
const BEST_FILE = 'juegos.json';

export const GAME_LIST: { name: GameName; title: string; re: RegExp }[] = [
  { name: 'miradas', title: 'duelo de miradas', re: /\b(duelo|miradas|mirada|no parpadear|parpadear)\b/ },
  { name: 'caras', title: 'imita mi cara', re: /\b(imita|imitar|caras|muecas|mi cara)\b/ },
  { name: 'simon', title: 'Simón', re: /\b(simon|colores|memoria|secuencia)\b/ },
  { name: 'ppt', title: 'piedra, papel o tijera', re: /\b(piedra|papel|tijeras?)\b/ },
  { name: 'numero', title: 'adivina el número', re: /\b(adivina el numero|numero|numeros)\b/ },
  { name: 'adivinanzas', title: 'adivinanzas', re: /\b(adivinanzas?|acertijos?)\b/ },
];

/** 1.6 → "1,6" (en castellano, coma decimal). */
const decimal = (n: number) => n.toFixed(1).replace('.', ',');

// ------------------------------------------------------------------ base
abstract class Game {
  abstract readonly name: GameName;
  private timers: ReturnType<typeof setTimeout>[] = [];
  protected over = false;

  constructor(
    protected io: GameIO,
    private finish: (emo: EmotionName, text: string, score?: number) => void,
  ) {}

  abstract start(): void;
  hear(_text: string): boolean {
    return false;
  }
  touch(_x: number, _y: number): boolean {
    return false;
  }
  see(): void {}
  tick(): void {}

  protected after(ms: number, fn: () => void) {
    this.timers.push(
      setTimeout(() => {
        if (!this.over) fn();
      }, ms),
    );
  }

  protected end(emo: EmotionName, text: string, score?: number) {
    if (this.over) return;
    this.over = true;
    this.cleanup();
    this.finish(emo, text, score);
  }

  stop() {
    this.over = true;
    this.cleanup();
  }

  protected cleanup() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.io.fastVision(false);
    this.io.engine.holdEyesOpen = false;
    this.io.engine.overlay = null;
    this.io.engine.clearGaze();
  }
}

// ------------------------------------------------------------------ duelo de miradas
class Staring extends Game {
  readonly name = 'miradas';
  private phase: 'cuenta' | 'duelo' | 'fin' = 'cuenta';
  private startAt = 0;
  private bipLimit = 0;
  private blinks = 0;
  private lostFaceAt = 0;

  start() {
    const { io } = this;
    io.fastVision(true);
    io.engine.holdEyesOpen = true;
    io.engine.overlay = { title: 'DUELO DE MIRADAS', hint: 'Mírame a los ojos y no parpadees' };
    io.speak('emocionado', '¡Duelo de miradas! Mírame a los ojos y no parpadees.');
    ['3', '2', '1'].forEach((n, i) => this.after(3400 + i * 900, () => (io.engine.overlay = { ...io.engine.overlay, big: n })));
    this.after(3400 + 3 * 900, () => {
      io.engine.overlay = { title: 'DUELO DE MIRADAS', big: '¡YA!' };
      io.engine.setEmotion('enfadado', 0);
      this.phase = 'duelo';
      this.startAt = io.now() + 400; // un respiro para empezar
      this.bipLimit = 7000 + Math.random() * 18000;
    });
  }

  see() {
    if (this.phase !== 'duelo') return;
    const { io } = this;
    const now = io.now();
    if (now < this.startAt) return;
    const t = (now - this.startAt) / 1000;
    io.engine.overlay = { title: 'DUELO DE MIRADAS', big: `${decimal(t)} s` };
    if (io.perception.exprAge(now) > 1500) {
      if (!this.lostFaceAt) this.lostFaceAt = now;
      if (now - this.lostFaceAt > 1500) this.end('confundido', '¡Eh, no te vayas! Así no vale. Lo dejamos en tablas.');
      return;
    }
    this.lostFaceAt = 0;
    this.blinks = io.perception.blinking() ? this.blinks + 1 : 0;
    if (this.blinks >= 2) {
      this.phase = 'fin';
      io.engine.holdEyesOpen = false;
      io.engine.setEmotion('feliz', 3000);
      io.engine.burst('sparkle', 8);
      this.end('feliz', `¡Has parpadeado! Gano yo. Aguantaste ${decimal(t)} segundos.`, t);
    }
  }

  tick() {
    if (this.phase !== 'duelo') return;
    const { io } = this;
    const elapsed = io.now() - this.startAt;
    if (elapsed > this.bipLimit - 1500 && elapsed < this.bipLimit) io.engine.setEmotion('asustado', 0); // ¡le pican los ojos!
    if (elapsed >= this.bipLimit) {
      this.phase = 'fin';
      io.engine.holdEyesOpen = false;
      io.engine.burst('drop', 4);
      io.engine.setEmotion('triste', 3000);
      this.end('triste', `¡Ay, no aguanto más! Has ganado tú: ${decimal(elapsed / 1000)} segundos sin parpadear.`, elapsed / 1000);
    }
  }
}

// ------------------------------------------------------------------ imita mi cara
const FACES: { label: ExprLabel; emo: EmotionName; say: string }[] = [
  { label: 'sonrisa', emo: 'feliz', say: '¡Sonríe!' },
  { label: 'sorpresa', emo: 'sorprendido', say: '¡Cara de sorpresa!' },
  { label: 'enfado', emo: 'enfadado', say: '¡Pon cara de enfadado!' },
  { label: 'tristeza', emo: 'triste', say: '¡Pon cara triste!' },
  { label: 'beso', emo: 'enamorado', say: '¡Lánzame un beso!' },
  { label: 'mofletes', emo: 'avergonzado', say: '¡Infla los mofletes!' },
];

class Mimic extends Game {
  readonly name = 'caras';
  private order = [...FACES].sort(() => Math.random() - 0.5).slice(0, 5);
  private round = -1;
  private points = 0;
  private window = 0;
  private holdSince = 0;
  private openUntil = 0;

  start() {
    this.io.fastVision(true);
    this.io.speak('emocionado', '¡Imita mi cara! Pon la misma cara que yo, rápido.');
    this.after(3600, () => this.next());
  }

  private next() {
    this.round++;
    if (this.round >= this.order.length) {
      const n = this.points;
      this.end(n >= 4 ? 'feliz' : n >= 2 ? 'contento' : 'triste', n >= 4 ? `¡Increíble! ${n} de 5. ¡Eres un maestro de las caras!` : `Has acertado ${n} de 5. ¡Buen intento!`, n);
      return;
    }
    const f = this.order[this.round];
    this.io.engine.setEmotion(f.emo, 0);
    this.io.engine.overlay = { title: 'IMITA MI CARA', score: `${this.points}/${this.round}`, timer: 1 };
    this.io.speak(f.emo, f.say);
    this.window = this.io.now() + 1200;
    this.openUntil = this.window + 4500;
    this.holdSince = 0;
  }

  see() {
    const { io } = this;
    const now = io.now();
    if (this.round < 0 || this.round >= this.order.length || now < this.window || now > this.openUntil) return;
    const f = this.order[this.round];
    io.engine.overlay = { ...io.engine.overlay, timer: (this.openUntil - now) / 4500 };
    const c = io.perception.label;
    if (c.label === f.label && c.strength > 0.45) {
      if (!this.holdSince) this.holdSince = now;
      if (now - this.holdSince > 350) {
        this.points++;
        this.openUntil = 0;
        io.engine.burst('sparkle', 6);
        io.speak('feliz', ['¡Perfecto!', '¡Clavado!', '¡Muy bien!'][this.round % 3]);
        this.after(1800, () => this.next());
      }
    } else {
      this.holdSince = 0;
    }
  }

  tick() {
    const now = this.io.now();
    if (this.round >= 0 && this.openUntil && now > this.openUntil) {
      this.openUntil = 0;
      this.io.speak('confundido', '¡Casi! Esa no la he visto.');
      this.after(1800, () => this.next());
    }
  }
}

// ------------------------------------------------------------------ Simón
const PAD_COLORS = ['#FF5C5C', '#5B8CFF', '#62FF7A', '#FFC247'];
const PAD_TONES = [330, 392, 494, 587];
const PAD_NAMES = ['rojo', 'azul', 'verde', 'amarillo'];

class Simon extends Game {
  readonly name = 'simon';
  private seq: number[] = [];
  private pos = 0;
  private phase: 'muestra' | 'tuyo' | 'fin' = 'muestra';
  private lastTapAt = 0;

  start() {
    this.io.speak('emocionado', '¡Simón! Repite los colores en el mismo orden. Toca la pantalla.');
    this.overlay(null);
    this.after(4200, () => this.round());
  }

  private overlay(lit: number | null, hint?: string) {
    this.io.engine.overlay = {
      title: 'SIMÓN',
      score: `Ronda ${Math.max(1, this.seq.length)}`,
      pads: { lit, colors: PAD_COLORS },
      hint,
    };
  }

  private light(i: number, ms: number) {
    const r = padRects(this.io.width())[i];
    const W = this.io.width();
    this.io.engine.setGaze(((r.x + r.w / 2 - W / 2) / (W / 2)) * 22, r.y < 100 ? -10 : 10);
    this.overlay(i, this.phase === 'tuyo' ? 'Tu turno' : undefined);
    this.io.tone(PAD_TONES[i], ms);
    this.after(ms, () => this.overlay(null, this.phase === 'tuyo' ? 'Tu turno' : undefined));
  }

  private round() {
    this.seq.push(Math.floor(Math.random() * 4));
    this.phase = 'muestra';
    this.pos = 0;
    const step = Math.max(300, 620 - this.seq.length * 25);
    this.seq.forEach((p, i) => this.after(i * step, () => this.light(p, step * 0.7)));
    this.after(this.seq.length * step + 200, () => {
      this.phase = 'tuyo';
      this.lastTapAt = this.io.now();
      this.io.engine.clearGaze();
      this.overlay(null, 'Tu turno');
    });
  }

  touch(x: number, y: number) {
    if (this.phase !== 'tuyo') return true;
    const i = padRects(this.io.width()).findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (i < 0) return true;
    this.lastTapAt = this.io.now();
    this.light(i, 260);
    if (i !== this.seq[this.pos]) {
      this.phase = 'fin';
      this.io.tone(150, 600);
      this.io.engine.setEmotion('triste', 2500);
      const n = this.seq.length - 1;
      this.after(700, () => this.end('triste', `¡Oh, no! Era el ${PAD_NAMES[this.seq[this.pos]]}. Llegaste a ${n} ${n === 1 ? 'ronda' : 'rondas'}.`, n));
      return true;
    }
    this.pos++;
    if (this.pos === this.seq.length) {
      this.phase = 'muestra';
      this.io.engine.setEmotion('contento', 1200);
      if (this.seq.length % 5 === 0) this.io.engine.burst('sparkle', 6);
      this.after(900, () => this.round());
    }
    return true;
  }

  tick() {
    if (this.phase === 'tuyo' && this.io.now() - this.lastTapAt > 8000) {
      this.phase = 'fin';
      this.end('aburrido', '¿Te has dormido? Lo dejamos aquí.', this.seq.length - 1);
    }
  }
}

// ------------------------------------------------------------------ piedra, papel o tijera
type Move = 'piedra' | 'papel' | 'tijera';
const ICON: Record<Move, string> = { piedra: '✊', papel: '✋', tijera: '✌️' };
const BEATS: Record<Move, Move> = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' };

function moveFromText(text: string): Move | null {
  const t = normalize(text);
  if (/\bpiedras?\b/.test(t)) return 'piedra';
  if (/\bpapel(es)?\b/.test(t)) return 'papel';
  if (/\btijeras?\b/.test(t)) return 'tijera';
  return null;
}

class RockPaper extends Game {
  readonly name = 'ppt';
  private you = 0;
  private bip = 0;
  private open = false;
  private votes: Record<Move, number> = { piedra: 0, papel: 0, tijera: 0 };
  private said: Move | null = null;

  start() {
    this.io.fastVision(true);
    this.io.speak('emocionado', '¡Piedra, papel o tijera! Enséñame la mano a la cámara cuando diga ya. Al mejor de tres.');
    this.after(5200, () => this.round());
  }

  private board(extra: Partial<NonNullable<FaceEngine['overlay']>> = {}) {
    this.io.engine.overlay = { title: 'PIEDRA, PAPEL O TIJERA', score: `Tú ${this.you} · Bip ${this.bip}`, ...extra };
  }

  private round() {
    this.votes = { piedra: 0, papel: 0, tijera: 0 };
    this.said = null;
    const words = ['Piedra…', 'Papel…', 'Tijera…'];
    words.forEach((w, i) => this.after(i * 750, () => this.board({ big: w })));
    this.after(3 * 750, () => {
      this.board({ big: '¡YA!' });
      this.open = true;
      this.io.listenFor(4000);
    });
    this.after(3 * 750 + 1800, () => this.resolve());
  }

  see() {
    if (!this.open) return;
    const g = this.io.perception.heldGesture(this.io.now(), 150);
    if (g === 'puno') this.votes.piedra++;
    else if (g === 'palma') this.votes.papel++;
    else if (g === 'paz') this.votes.tijera++;
  }

  hear(text: string) {
    const m = moveFromText(text);
    if (m && this.open) this.said = m;
    return !!m;
  }

  private resolve() {
    this.open = false;
    const seen = (Object.entries(this.votes) as [Move, number][]).sort((a, b) => b[1] - a[1])[0];
    const yours: Move | null = this.said ?? (seen[1] > 0 ? seen[0] : null);
    if (!yours) {
      this.board({ big: '?' });
      this.io.speak('confundido', 'No he visto tu jugada. ¡Otra vez!');
      this.after(2600, () => this.round());
      return;
    }
    const mine = (['piedra', 'papel', 'tijera'] as Move[])[Math.floor(Math.random() * 3)];
    this.board({ left: ICON[yours], right: ICON[mine], big: '' });
    let line: string;
    let emo: EmotionName;
    if (yours === mine) {
      line = `¡Empate! Los dos ${mine}.`;
      emo = 'sorprendido';
    } else if (BEATS[yours] === mine) {
      this.you++;
      line = `${cap(yours)} gana a ${mine}. ¡Punto para ti!`;
      emo = 'triste';
    } else {
      this.bip++;
      line = `${cap(mine)} gana a ${yours}. ¡Punto para mí!`;
      emo = 'feliz';
    }
    this.board({ left: ICON[yours], right: ICON[mine] });
    this.io.speak(emo, line);
    if (this.you === 2 || this.bip === 2) {
      const won = this.you === 2;
      this.after(3000, () => this.end(won ? 'triste' : 'feliz', won ? `¡Has ganado ${this.you} a ${this.bip}! Quiero la revancha.` : `¡Gané ${this.bip} a ${this.you}! ¿Revancha?`, this.you));
    } else {
      this.after(3200, () => this.round());
    }
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ adivina el número
const UNITS: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100 };

/** "37", "treinta y siete", "cien", "veintidós"... */
export function parseNumber(text: string): number | null {
  const d = text.match(/\b(\d{1,3})\b/);
  if (d) return Number(d[1]);
  const words = normalize(text).split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      let n = TENS[w];
      if (words[i + 1] === 'y' && words[i + 2] in UNITS) n += UNITS[words[i + 2]];
      return n;
    }
    if (w in UNITS) return UNITS[w];
  }
  return null;
}

class Number100 extends Game {
  readonly name = 'numero';
  private secret = 1 + Math.floor(Math.random() * 100);
  private tries = 0;

  start() {
    this.io.engine.overlay = { title: 'ADIVINA EL NÚMERO', hint: 'Del 1 al 100. Di un número.', score: 'Intentos: 0' };
    this.io.speak('curioso', 'He pensado un número del 1 al 100. ¡Adivínalo! Te diré si es más alto o más bajo.');
    this.io.listenFor(30_000);
  }

  hear(text: string) {
    const t = normalize(text);
    if (/\b(me rindo|no se|dimelo|cual era)\b/.test(t)) {
      this.end('feliz', `¡Era el ${this.secret}! Otra vez será.`);
      return true;
    }
    const n = parseNumber(text);
    if (n === null || n < 1 || n > 100) {
      this.io.speak('confundido', 'Dime un número del 1 al 100.');
      this.io.listenFor(30_000);
      return true;
    }
    this.tries++;
    if (n === this.secret) {
      this.io.engine.overlay = { title: 'ADIVINA EL NÚMERO', big: `${n} ✓`, score: `Intentos: ${this.tries}` };
      this.io.engine.burst('sparkle', 10);
      this.end('emocionado', `¡Sí! Era el ${n}. Lo has adivinado en ${this.tries} ${this.tries === 1 ? 'intento' : 'intentos'}.`, this.tries);
      return true;
    }
    const up = n < this.secret;
    this.io.engine.overlay = { title: 'ADIVINA EL NÚMERO', big: `${n} ${up ? '↑' : '↓'}`, score: `Intentos: ${this.tries}` };
    this.io.engine.setGaze(0, up ? -14 : 14);
    this.after(1500, () => this.io.engine.clearGaze());
    const close = Math.abs(n - this.secret) <= 5;
    this.io.speak(close ? 'emocionado' : 'curioso', `${up ? 'Más alto' : 'Más bajo'}${close ? '. ¡Caliente, caliente!' : '.'}`);
    this.io.listenFor(30_000);
    return true;
  }
}

// ------------------------------------------------------------------ adivinanzas (populares)
const RIDDLES: { q: string[]; a: string[]; hint: string; answer: string }[] = [
  { q: ['Blanco por dentro, verde por fuera.', 'Si quieres que te lo diga, espera.'], a: ['pera'], hint: 'Es una fruta.', answer: 'la pera' },
  { q: ['Oro parece, plata no es.', '¿Qué es?'], a: ['platano'], hint: 'Es amarillo y lo pelas.', answer: 'el plátano' },
  { q: ['Tiene dientes y no come,', 'tiene cabeza y no es hombre.'], a: ['ajo', 'ajos'], hint: 'Se usa en la cocina y pica.', answer: 'el ajo' },
  { q: ['Tengo agujas y no sé coser,', 'tengo números y no sé leer.'], a: ['reloj'], hint: 'Te dice la hora.', answer: 'el reloj' },
  { q: ['Redondo, redondo,', 'barril sin fondo.'], a: ['anillo'], hint: 'Se lleva en el dedo.', answer: 'el anillo' },
  { q: ['Lana sube,', 'lana baja.'], a: ['navaja'], hint: 'Corta.', answer: 'la navaja' },
  { q: ['Una vieja con un diente', 'que llama a toda la gente.'], a: ['campana', 'campanas'], hint: 'Está en lo alto de la iglesia.', answer: 'la campana' },
  { q: ['En lo alto vive, en lo alto mora,', 'en lo alto teje la tejedora.'], a: ['arana'], hint: 'Tiene ocho patas.', answer: 'la araña' },
  { q: ['Paso por el fuego y no me quemo,', 'paso por el agua y no me mojo.'], a: ['sombra'], hint: 'Te sigue a todas partes cuando hay sol.', answer: 'la sombra' },
  { q: ['Te la digo y no me entiendes,', 'te la repito y no me comprendes.'], a: ['tela'], hint: 'Fíjate bien en las primeras palabras.', answer: 'la tela' },
  { q: ['Agua pasa por mi casa,', 'cate de mi corazón.'], a: ['aguacate'], hint: 'Junta las palabras.', answer: 'el aguacate' },
  { q: ['Tiene ojos y no ve, tiene agua y no la bebe,', 'tiene carne y no la come, tiene barba y no es hombre.'], a: ['coco'], hint: 'Es una fruta tropical muy dura.', answer: 'el coco' },
];

class Riddles extends Game {
  readonly name = 'adivinanzas';
  private list = [...RIDDLES].sort(() => Math.random() - 0.5).slice(0, 3);
  private i = -1;
  private tries = 0;
  private points = 0;
  private hinted = false;
  private askedAt = 0;

  start() {
    this.io.speak('emocionado', '¡Adivinanzas! Te digo tres. Puedes pedirme una pista o rendirte.');
    this.after(3800, () => this.next());
  }

  private next() {
    this.i++;
    if (this.i >= this.list.length) {
      this.end(this.points >= 2 ? 'feliz' : 'contento', `¡Has acertado ${this.points} de 3!`, this.points);
      return;
    }
    this.tries = 0;
    this.hinted = false;
    const r = this.list[this.i];
    this.io.engine.overlay = { title: `ADIVINANZA ${this.i + 1}/3`, score: `Aciertos: ${this.points}` };
    this.io.chain(r.q, 'curioso');
    this.askedAt = this.io.now();
    this.io.listenFor(40_000);
  }

  hear(text: string) {
    if (this.i < 0 || this.i >= this.list.length) return false;
    const r = this.list[this.i];
    const t = normalize(text);
    if (/\b(pista|ayuda|ayudame)\b/.test(t)) {
      this.hinted = true;
      this.io.speak('pensando', `Pista: ${r.hint}`);
      this.io.listenFor(30_000);
      return true;
    }
    if (/\b(me rindo|no lo se|no se|dimelo|cual es)\b/.test(t)) {
      this.io.speak('feliz', `¡Era ${r.answer}!`);
      this.after(2600, () => this.next());
      return true;
    }
    if (/\b(otra vez|repite|repitela)\b/.test(t)) {
      this.io.chain(r.q, 'curioso');
      this.io.listenFor(40_000);
      return true;
    }
    if (r.a.some((a) => ` ${t} `.includes(` ${a} `))) {
      this.points++;
      this.io.engine.burst('sparkle', 8);
      this.io.speak('emocionado', `¡Sí! Es ${r.answer}.${this.hinted ? '' : ' ¡Y sin pista!'}`);
      this.after(2800, () => this.next());
      return true;
    }
    this.tries++;
    if (this.tries >= 3) {
      this.io.speak('contento', `¡No! Era ${r.answer}.`);
      this.after(2600, () => this.next());
    } else {
      this.io.speak('confundido', this.tries === 1 ? '¡No! Prueba otra vez.' : 'Tampoco. ¿Quieres una pista?');
      this.io.listenFor(30_000);
    }
    return true;
  }

  tick() {
    if (this.i >= 0 && this.i < this.list.length && this.io.now() - this.askedAt > 60_000) {
      this.askedAt = this.io.now();
      this.io.speak('aburrido', `¿Sigues ahí? Era ${this.list[this.i].answer}.`);
      this.after(2600, () => this.next());
    }
  }
}

// ------------------------------------------------------------------ el que reparte el juego
export class Games {
  active: Game | null = null;
  private last: GameName | null = null;
  private endedAt = 0;
  private choosingUntil = 0;
  private best: Best = readJSON<Best>(BEST_FILE) ?? {};

  constructor(private io: GameIO) {}

  get playing() {
    return !!this.active;
  }

  /** Mira si la frase va de juegos. Devuelve qué decir (o null si no iba de esto). */
  request(raw: string): { emo: EmotionName; text: string } | null {
    const t = normalize(raw);
    const now = this.io.now();
    if (this.active) {
      if (/\b(para|parar|basta|ya no quiero jugar|deja de jugar|salir|terminar|se acabo|fin del juego)\b/.test(t)) {
        this.stop();
        return { emo: 'contento', text: 'Vale, lo dejamos. ¡Ha sido divertido!' };
      }
      return null;
    }
    if (this.last && now - this.endedAt < 60_000 && /\b(otra vez|otra|revancha|de nuevo|repetir|otra partida)\b/.test(t)) {
      return this.start(this.last);
    }
    const wantsToPlay = /\b(jug[a-z]*|jueg[a-z]*|partida)\b/.test(t);
    const choosing = now < this.choosingUntil;
    if (wantsToPlay || choosing) {
      const g = GAME_LIST.find((x) => x.re.test(t));
      if (g) return this.start(g.name);
      if (wantsToPlay) {
        this.choosingUntil = now + 30_000;
        this.io.listenFor(30_000);
        return { emo: 'emocionado', text: 'Sé jugar al duelo de miradas, imita mi cara, Simón, piedra papel o tijera, adivina el número y adivinanzas. ¿A cuál?' };
      }
    }
    return null;
  }

  start(name: GameName): { emo: EmotionName; text: string } | null {
    this.stop();
    this.choosingUntil = 0;
    const needsReader = name === 'miradas' || name === 'caras';
    if (needsReader && !this.io.perception.hasReader) {
      return { emo: 'triste', text: 'Para ese juego necesito mi lector de caras, y aún no está listo. ¡Prueba otro!' };
    }
    const done = (emo: EmotionName, text: string, score?: number) => this.finished(name, emo, text, score);
    const make: Record<GameName, () => Game> = {
      miradas: () => new Staring(this.io, done),
      caras: () => new Mimic(this.io, done),
      simon: () => new Simon(this.io, done),
      ppt: () => new RockPaper(this.io, done),
      numero: () => new Number100(this.io, done),
      adivinanzas: () => new Riddles(this.io, done),
    };
    this.active = make[name]();
    this.last = name;
    this.active.start();
    return null; // el juego ya habla
  }

  private finished(name: GameName, emo: EmotionName, text: string, score?: number) {
    this.active = null;
    this.endedAt = this.io.now();
    let record = '';
    if (score !== undefined) {
      const lowerIsBetter = name === 'numero';
      const prev = this.best[name];
      const better = prev === undefined || (lowerIsBetter ? score < prev : score > prev);
      if (better && score > 0) {
        this.best[name] = score;
        writeJSON(BEST_FILE, this.best);
        if (prev !== undefined) record = ' ¡Y es un nuevo récord!';
      }
    }
    this.io.speak(emo, text + record);
  }

  stop() {
    this.active?.stop();
    this.active = null;
  }

  hear(text: string) {
    return this.active?.hear(text) ?? false;
  }

  touch(x: number, y: number) {
    return this.active?.touch(x, y) ?? false;
  }

  see() {
    this.active?.see();
  }

  tick() {
    this.active?.tick();
  }

  bestOf(name: GameName) {
    return this.best[name];
  }
}
