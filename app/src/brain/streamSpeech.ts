// Hablar a trozos mientras la mente aún está escribiendo la respuesta (como hace Gemini).
// En cuanto tiene un trozo con sentido ("¡Hola!", "Pues mira, ...") lo dice, y sigue con el
// siguiente cuando acaba. Así la primera palabra llega mucho antes que la frase entera.
import type { EmotionName } from '../face/engine';

/** Lo que lleva escrito el modelo de un campo de texto del JSON, aunque aún no lo haya cerrado.
 *  partialField('{"emocion":"feliz","frase":"Hola, qu', 'frase') → { value: 'Hola, qu', done: false } */
export function partialField(json: string, name: string): { value: string; done: boolean } | null {
  const key = `"${name}"`;
  const at = json.indexOf(key);
  if (at < 0) return null;
  const colon = json.indexOf(':', at + key.length);
  if (colon < 0) return null;
  const open = json.indexOf('"', colon + 1);
  if (open < 0) return null;
  let out = '';
  for (let k = open + 1; k < json.length; k++) {
    const c = json[k];
    if (c === '\\') {
      const n = json[k + 1];
      if (n === undefined) return { value: out, done: false };
      if (n === 'u') {
        const hex = json.slice(k + 2, k + 6);
        if (hex.length < 4) return { value: out, done: false };
        out += String.fromCharCode(parseInt(hex, 16));
        k += 5;
        continue;
      }
      out += n === 'n' || n === 't' || n === 'r' ? ' ' : n;
      k++;
      continue;
    }
    if (c === '"') return { value: out, done: true };
    out += c;
  }
  return { value: out, done: false };
}

/** Un trozo de respuesta mientras la escribe (para empezar a hablar antes de terminar de pensar).
 *  part cuenta las frases de una misma respuesta (por ejemplo, "Déjame que lo mire" y luego la respuesta). */
export type PartialThought = { part: number; emo: EmotionName; text: string; done: boolean };

export type SpeakFn = (emo: EmotionName, text: string) => void;
export type DurationFn = (text: string, emo: EmotionName) => number;

/** Dónde cortar lo que ya tiene escrito para decirlo de una vez. Devuelve hasta qué letra, o -1 (esperar).
 *  - Si ya ha terminado de escribir: todo.
 *  - Si no: hasta la última frase completa ("¡Claro! La Luna está lejos. Y además" → hasta "lejos.").
 *  - Solo para empezar (first), vale también una coma tras unas palabras, para no hacerte esperar. */
export function speakableEnd(rest: string, done: boolean, first: boolean): number {
  if (done) return rest.length;
  let end = -1;
  const re = /[.!?…]["»”)]?\s/g;
  for (let m = re.exec(rest); m; m = re.exec(rest)) end = m.index + m[0].length;
  if (end > 1 && rest.slice(0, end).trim().length > 1) return end;
  if (first) {
    const clause = rest.match(/^.*?[,;:]\s/);
    if (clause && clause[0].trim().split(/\s+/).length >= 4) return clause[0].length;
  }
  // una frase muy larga sin puntuación: no esperar eternamente
  const words = rest.split(' ');
  if (words.length > 18) return words.slice(0, 16).join(' ').length + 1;
  return -1;
}

type Part = { text: string; done: boolean; emo: EmotionName; said: number };

export class StreamSpeech {
  /** Cada parte de la respuesta (por ejemplo, "Déjame que lo mire" y luego la respuesta). */
  private parts: Part[] = [];
  private busyUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  constructor(
    private speak: SpeakFn,
    private duration: DurationFn,
    private now: () => number = () => performance.now(),
  ) {}

  /** ¿Le han interrumpido? Entonces ya no hay que decir nada de esta respuesta. */
  get isCancelled() {
    return this.cancelled;
  }

  /** ¿Ha dicho (o va a decir) ya algo? */
  get started() {
    return this.parts.some((p) => p && p.said > 0);
  }

  /** Llega un trozo más de la respuesta que está escribiendo la mente. */
  feed(p: PartialThought) {
    if (this.cancelled) return;
    const cur = this.parts[p.part] ?? { text: '', done: false, emo: p.emo, said: 0 };
    if (p.text.length < cur.said) return;
    Object.assign(cur, { text: p.text, done: p.done, emo: p.emo });
    this.parts[p.part] = cur;
    this.pump();
  }

  /** Ya ha terminado de pensar: dice lo que falte. false si no había empezado a hablar. */
  finish(emo: EmotionName, text: string): boolean {
    if (this.cancelled || !this.started) return false;
    const last = this.parts[this.parts.length - 1];
    if (last && text.startsWith(last.text.slice(0, last.said))) {
      Object.assign(last, { text, done: true, emo });
    } else {
      // la frase final no es la que estaba diciendo (por ejemplo, tras "Déjame que lo mire"): entera
      this.parts.push({ text, done: true, emo, said: 0 });
    }
    this.pump();
    return true;
  }

  /** Le han interrumpido (o va a jugar): no dice lo que le quedaba. */
  cancel() {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Si no está hablando, dice de una vez todo lo que ya tenga listo. */
  private pump() {
    if (this.cancelled) return;
    const now = this.now();
    if (now < this.busyUntil) {
      this.wakeAt(this.busyUntil - now);
      return;
    }
    for (const part of this.parts) {
      if (!part) continue;
      const rest = part.text.slice(part.said);
      if (!rest.trim()) {
        if (part.done) continue;
        return; // esta parte aún no ha terminado: esperar
      }
      const end = speakableEnd(rest, part.done, !this.started);
      if (end <= 0) return;
      part.said += end;
      const chunk = rest.slice(0, end).trim();
      if (!chunk) continue;
      this.busyUntil = now + this.duration(chunk, part.emo) * 1000 + 200;
      this.speak(part.emo, chunk);
      this.wakeAt(this.busyUntil - now);
      return;
    }
  }

  private wakeAt(ms: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, ms));
  }
}
