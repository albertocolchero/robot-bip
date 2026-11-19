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

/** Cuánto hay que esperar a tener para decir un trozo (y dónde cortar). Devuelve hasta qué letra, o -1. */
export function chunkEnd(rest: string, done: boolean): number {
  if (done) return rest.length;
  // final de frase: "¡Hola! ...", "Claro. ..."
  const sentence = rest.match(/^.*?[.!?…]["»”)]?\s/);
  if (sentence && sentence[0].trim().length > 1) return sentence[0].length;
  // una coma o dos puntos, si ya lleva unas cuantas palabras: "Pues mira, la Luna está ..."
  const clause = rest.match(/^.*?[,;:]\s/);
  if (clause && clause[0].trim().split(/\s+/).length >= 5) return clause[0].length;
  // una frase larga sin puntuación: a las 9 palabras
  const words = rest.split(' ');
  if (words.length > 10) return words.slice(0, 9).join(' ').length + 1;
  return -1;
}

export class StreamSpeech {
  /** Lo que ya se ha mandado a decir de cada parte de la respuesta. */
  private spoken: string[] = [];
  private busyUntil = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
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
    return this.spoken.some((x) => x.trim().length > 0);
  }

  /** Llega un trozo más de la respuesta que está escribiendo la mente. */
  feed(p: PartialThought) {
    if (this.cancelled) return;
    const prev = this.spoken[p.part] ?? '';
    if (!p.text.startsWith(prev)) return;
    const rest = p.text.slice(prev.length);
    const end = chunkEnd(rest, p.done);
    if (end <= 0) return;
    this.spoken[p.part] = prev + rest.slice(0, end);
    const chunk = rest.slice(0, end).trim();
    if (chunk) this.say(p.emo, chunk);
  }

  /** Ya ha terminado de pensar: dice lo que falte de la frase final. false si no había empezado a hablar. */
  finish(emo: EmotionName, text: string): boolean {
    if (this.cancelled || !this.started) return false;
    const prev = this.spoken[this.spoken.length - 1] ?? '';
    // si la frase final no es la que estaba diciendo (por ejemplo, tras "Déjame que lo mire"), la dice entera
    const rest = text.startsWith(prev) ? text.slice(prev.length).trim() : text.trim();
    if (rest) this.say(emo, rest);
    return true;
  }

  /** Le han interrumpido (o va a jugar): no dice lo que le quedaba. */
  cancel() {
    this.cancelled = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private say(emo: EmotionName, chunk: string) {
    const now = this.now();
    const start = Math.max(now, this.busyUntil);
    this.busyUntil = start + this.duration(chunk, emo) * 1000 + 250;
    if (start <= now) {
      this.speak(emo, chunk);
    } else {
      this.timers.push(
        setTimeout(() => {
          if (!this.cancelled) this.speak(emo, chunk);
        }, start - now),
      );
    }
  }
}
