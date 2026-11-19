// El ánimo de Bip: tres "depósitos" entre 0 y 1 que cambian solos con el tiempo
// y con lo que pasa. Deciden la cara que pone cuando está tranquilo y lo que le apetece hacer.
import type { EmotionName } from '../face/engine';
import { readJSON, writeJSON } from './store';

export type Mood = {
  /** 1 = lleno de energía, 0 = agotado. Sigue el ritmo del día y se recarga durmiendo. */
  energia: number;
  /** Ganas de descubrir cosas: suben si no pasa nada nuevo y bajan al aprender. */
  curiosidad: number;
  /** Ganas de compañía: suben cuando está solo y bajan cuando le haces caso. */
  compania: number;
  /** Última actualización (ms). */
  t: number;
};

export type MoodEvent = 'charla' | 'caricia' | 'llegada' | 'aprendido' | 'pregunta' | 'iniciativa' | 'susto';

const FILE = 'animo.json';
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** La energía "natural" de cada hora: alta por la mañana, bajón después de comer, baja de noche. */
export function circadian(hour: number) {
  if (hour < 7) return 0.15;
  if (hour < 10) return 0.75;
  if (hour < 14) return 0.9;
  if (hour < 16.5) return 0.6;
  if (hour < 20) return 0.8;
  if (hour < 23) return 0.45;
  return 0.2;
}

export function newMood(now: number): Mood {
  return { energia: circadian(new Date(now).getHours()), curiosidad: 0.5, compania: 0.5, t: now };
}

export function loadMood(now: number): Mood {
  const m = readJSON<Partial<Mood>>(FILE);
  if (!m || typeof m.t !== 'number') return newMood(now);
  return {
    energia: clamp(m.energia ?? 0.6),
    curiosidad: clamp(m.curiosidad ?? 0.5),
    compania: clamp(m.compania ?? 0.5),
    t: m.t,
  };
}

export function saveMood(m: Mood) {
  writeJSON(FILE, m);
}

/** Hace pasar el tiempo: se llama cada pocos segundos (y al abrir la app, con el rato que estuvo cerrada). */
export function updateMood(m: Mood, now: number, i: { sleeping: boolean; seesSomeone: boolean; attending: boolean }) {
  const hours = Math.min(16, Math.max(0, (now - m.t) / 3_600_000));
  m.t = now;
  if (hours <= 0) return;
  const d = new Date(now);
  const target = i.sleeping ? 1 : circadian(d.getHours() + d.getMinutes() / 60);
  const rate = i.sleeping ? 0.45 : 0.25;
  m.energia = clamp(m.energia + (target - m.energia) * (1 - Math.exp(-rate * hours)));
  if (i.sleeping) return; // dormido, lo demás se queda como estaba
  m.curiosidad = clamp(m.curiosidad + 0.1 * hours);
  if (i.attending) m.compania = clamp(m.compania - 0.6 * hours);
  else if (i.seesSomeone) m.compania = clamp(m.compania - 0.2 * hours);
  else m.compania = clamp(m.compania + 0.12 * hours);
}

export function moodEvent(m: Mood, e: MoodEvent) {
  switch (e) {
    case 'charla':
      m.compania -= 0.1;
      m.curiosidad -= 0.04;
      m.energia -= 0.004;
      break;
    case 'caricia':
      m.compania -= 0.06;
      break;
    case 'llegada':
      m.curiosidad -= 0.05;
      m.compania -= 0.05;
      break;
    case 'aprendido':
      m.curiosidad -= 0.15;
      break;
    case 'pregunta':
      m.curiosidad -= 0.2;
      break;
    case 'iniciativa':
      m.compania -= 0.04;
      break;
    case 'susto':
      m.energia += 0.05; // ¡despierta a cualquiera!
      break;
  }
  m.energia = clamp(m.energia);
  m.curiosidad = clamp(m.curiosidad);
  m.compania = clamp(m.compania);
}

/** Para que la mente sepa cómo se siente. */
export function describeMood(m: Mood) {
  const e = m.energia < 0.3 ? 'cansado' : m.energia > 0.7 ? 'con mucha energía' : 'normal de energía';
  const c = m.curiosidad > 0.65 ? 'muy curioso' : m.curiosidad < 0.3 ? 'tranquilo' : 'algo curioso';
  const s = m.compania > 0.65 ? 'con ganas de compañía' : m.compania < 0.3 ? 'muy a gusto acompañado' : '';
  return `Tu ánimo ahora: ${[e, c, s].filter(Boolean).join(', ')}.`;
}

/** Respuesta a "¿cómo estás?" según cómo se siente de verdad. */
export function howAreYou(m: Mood): { emo: EmotionName; text: string } {
  if (m.energia < 0.3) return { emo: 'cansado', text: 'Un poco cansadito, la verdad. Pero contento de verte.' };
  if (m.compania > 0.7) return { emo: 'contento', text: '¡Ahora mejor! Te echaba de menos.' };
  if (m.curiosidad > 0.7) return { emo: 'curioso', text: '¡Con muchas ganas de aprender cosas! Cuéntame algo.' };
  if (m.energia > 0.7) return { emo: 'contento', text: '¡Genial! Lleno de energía.' };
  return { emo: 'contento', text: 'Muy bien, tranquilo y a gusto contigo.' };
}

/** Cara para cuando no pasa nada: depende del ánimo (y un poco del azar). */
export function idleFace(m: Mood, alone: boolean, rnd = Math.random()): EmotionName {
  const w: [EmotionName, number][] = [
    ['neutral', 1],
    ['curioso', 0.4 + 1.6 * m.curiosidad],
    ['contento', alone ? 0.3 : 0.5 + 1.2 * (1 - m.compania)],
    ['pensando', 0.5],
    ['cansado', m.energia < 0.35 ? 3 * (0.35 - m.energia) / 0.35 + 0.3 : 0],
    ['triste', alone && m.compania > 0.75 ? 0.6 : 0],
  ];
  const total = w.reduce((a, [, x]) => a + x, 0);
  let r = rnd * total;
  for (const [e, x] of w) {
    r -= x;
    if (r <= 0) return e;
  }
  return 'neutral';
}
