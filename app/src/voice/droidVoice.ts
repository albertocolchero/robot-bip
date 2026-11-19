// El idioma de pitidos de Bip.
// Cada palabra se convierte siempre en la misma melodía (se calcula a partir de sus letras),
// y la emoción cambia el tono, la velocidad y el final de la frase.
import type { EmotionName } from '../face/engine';

interface VoiceStyle {
  base: number; // frecuencia base (Hz)
  spread: number; // cuánto sube y baja
  tempo: number; // ms por sílaba
  wave: 'square' | 'triangle';
  glide: number; // probabilidad de deslizar el tono
  vib: number; // vibrato (Hz)
  end: number; // cómo acaba la frase (+ sube, - baja)
}

const VOICE: Record<EmotionName, VoiceStyle> = {
  neutral: { base: 640, spread: 1.0, tempo: 92, wave: 'square', glide: 0.35, vib: 0, end: 0 },
  contento: { base: 860, spread: 1.35, tempo: 78, wave: 'square', glide: 0.55, vib: 0, end: 0.2 },
  curioso: { base: 720, spread: 1.1, tempo: 98, wave: 'square', glide: 0.4, vib: 0, end: 0.6 },
  sorprendido: { base: 980, spread: 1.5, tempo: 84, wave: 'square', glide: 0.7, vib: 0, end: 0.4 },
  triste: { base: 400, spread: 0.7, tempo: 150, wave: 'triangle', glide: 0.6, vib: 6, end: -0.5 },
  pensando: { base: 560, spread: 0.8, tempo: 120, wave: 'triangle', glide: 0.3, vib: 9, end: 0 },
  sueno: { base: 300, spread: 0.5, tempo: 185, wave: 'triangle', glide: 0.5, vib: 4, end: -0.6 },
};

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

export interface Note {
  t: number; // inicio (s)
  d: number; // duración (s)
  f: number; // frecuencia inicial (Hz)
  f2: number; // frecuencia final (Hz)
  v: number; // intensidad 0..1
}

export interface SpeechPlan {
  notes: Note[];
  dur: number; // s
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function syllables(word: string) {
  const m = word.match(/[aeiouü]+/g);
  return Math.max(1, m ? m.length : 1);
}

export function planSpeech(text: string, emo: EmotionName): SpeechPlan {
  const v = VOICE[emo] ?? VOICE.neutral;
  const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tokens = clean.match(/[a-zñ0-9]+|[?!.,;:]/g) ?? [];
  const notes: Note[] = [];
  let t = 0.04;
  const isQ = /\?\s*$/.test(text.trim());
  const isEx = /!\s*$/.test(text.trim());
  for (const tok of tokens) {
    if (/[?!.,;:]/.test(tok)) {
      t += tok === ',' ? 0.12 : 0.2;
      continue;
    }
    const n = syllables(tok);
    for (let i = 0; i < n; i++) {
      const h = hash(`${tok}#${i}`);
      const step = SCALE[h % SCALE.length];
      const f = v.base * Math.pow(2, (step * v.spread) / 12);
      const d = (v.tempo * (0.75 + ((h >> 4) % 6) / 10)) / 1000;
      const shape = (h >> 8) % 3;
      const doGlide = ((h >> 11) % 100) / 100 < v.glide;
      const glide = doGlide ? (shape === 1 ? 1.32 : shape === 2 ? 0.72 : 1) : 1;
      notes.push({ t, d, f, f2: f * glide, v: ((h >> 14) % 100) / 100 });
      t += d + 0.025;
    }
    t += 0.07;
  }
  if (notes.length) {
    const last = notes[notes.length - 1];
    if (isQ) {
      last.f2 = last.f * 1.6;
      last.d *= 1.4;
    } else if (v.end) {
      last.f2 = last.f * (1 + v.end * 0.5);
      last.d *= 1.3;
    }
    if (isEx) for (const n of notes) {
      n.f *= 1.12;
      n.f2 *= 1.12;
    }
  }
  return { notes, dur: t };
}

const SR = 22050;

/** Convierte el plan de pitidos en un archivo WAV (16 bits, mono) en memoria. */
export function synthesize(plan: SpeechPlan, emo: EmotionName): Uint8Array {
  const v = VOICE[emo] ?? VOICE.neutral;
  const total = Math.ceil((plan.dur + 0.2) * SR);
  const buf = new Float32Array(total);
  for (const note of plan.notes) {
    const s0 = Math.floor(note.t * SR);
    const len = Math.floor(note.d * SR);
    const ratio = note.f2 / note.f;
    let phase = 0;
    for (let i = 0; i < len && s0 + i < total; i++) {
      const k = i / len;
      let f = note.f * Math.pow(ratio, k);
      if (v.vib) f += note.f * 0.04 * Math.sin((2 * Math.PI * v.vib * i) / SR);
      phase += f / SR;
      phase -= Math.floor(phase);
      const x = v.wave === 'square' ? (phase < 0.5 ? 1 : -1) : phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
      const tt = i / SR;
      const dd = len / SR;
      const env = Math.min(1, tt / 0.008) * Math.max(0, Math.min(1, (dd - tt) / 0.02));
      buf[s0 + i] += x * env;
    }
  }
  // filtro paso bajo suave (quita aspereza) y volumen
  const a = 1 - Math.exp((-2 * Math.PI * 3200) / SR);
  const gain = emo === 'sueno' ? 0.32 : 0.45;
  const pcm = new Int16Array(total);
  let y = 0;
  for (let i = 0; i < total; i++) {
    y += a * (buf[i] - y);
    pcm[i] = Math.max(-32767, Math.min(32767, Math.round(y * gain * 32767)));
  }
  return wav(pcm, SR);
}

function wav(pcm: Int16Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}
