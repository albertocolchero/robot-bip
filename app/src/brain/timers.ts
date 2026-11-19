// Temporizadores y avisos a una hora:
//   "avísame en 10 minutos para sacar la pizza", "pon un temporizador de media hora",
//   "recuérdame a las cinco que llame a mi madre", "despiértame mañana a las ocho".
// Se guardan en el iPhone: si cierras la app y la vuelves a abrir, siguen ahí.
import { addDays, dayKey, findDate } from './dates';
import { numberAt } from './numbers';
import { readJSON, writeJSON } from './store';
import { normalize } from './talk';

export type Timer = { id: string; at: number; label: string; kind: 'temporizador' | 'aviso'; set: number };
const FILE = 'avisos.json';

const TRIGGER = /\b(temporizador|cuenta atras|avisame|avisa|despiertame|recuerdame|recuerda|alarma|cronometro)\b/;
const UNIT_MS: Record<string, number> = { segundo: 1000, segundos: 1000, minuto: 60_000, minutos: 60_000, min: 60_000, hora: 3_600_000, horas: 3_600_000 };

/** "10 minutos", "media hora", "una hora y media", "1 hora y 20 minutos"... en milisegundos (o null). */
export function parseDuration(text: string): number | null {
  const t = normalize(text);
  let ms = 0;
  if (/\bmedia hora\b/.test(t)) ms += 30 * 60_000;
  if (/\btres cuartos de hora\b/.test(t)) ms += 45 * 60_000;
  else if (/\bun cuarto de hora\b/.test(t)) ms += 15 * 60_000;
  const words = t.split(' ');
  for (let i = 0; i < words.length; i++) {
    const n = numberAt(words, i);
    if (!n) continue;
    const unit = words[i + n[1]];
    if (unit && unit in UNIT_MS) {
      ms += n[0] * UNIT_MS[unit];
      // "una hora y media"
      if ((unit === 'hora' || unit === 'horas') && words[i + n[1] + 1] === 'y' && words[i + n[1] + 2] === 'media') ms += 30 * 60_000;
      i += n[1];
    }
  }
  return ms > 0 ? ms : null;
}

const HOUR_WORDS: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };

/** "a las cinco", "a las 17:30", "a las ocho y media de la tarde", "a la una menos cuarto". */
export function parseClock(text: string, now: Date): Date | null {
  const t = normalize(text.replace(/(\d{1,2})[:.h](\d{2})/g, '$1 $2'));
  const m = t.match(/\b(?:a|para|sobre|hacia) las? (\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?: (\d{2}))?(?: y (media|cuarto|\d{1,2}))?(?: menos (cuarto|\d{1,2}))?(?: (?:de la|por la) (manana|tarde|noche|madrugada))?/);
  if (!m) return null;
  let h = /^\d+$/.test(m[1]) ? Number(m[1]) : HOUR_WORDS[m[1]];
  let min = m[2] ? Number(m[2]) : 0;
  if (m[3]) min = m[3] === 'media' ? 30 : m[3] === 'cuarto' ? 15 : Number(m[3]);
  if (m[4]) {
    h -= 1;
    min = 60 - (m[4] === 'cuarto' ? 15 : Number(m[4]));
  }
  const part = m[5];
  if ((part === 'tarde' || part === 'noche') && h < 12) h += 12;
  if (part === 'noche' && h === 24) h = 0;
  if (h > 23 || min > 59 || h < 0) return null;
  const dated = findDate(text, now);
  const base = dated ? dated.date : now;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0);
  if (!dated && part && d.getTime() <= now.getTime()) {
    // "a las ocho de la mañana" dicho por la tarde: mañana
    return new Date(addDays(d, 1).setHours(d.getHours(), d.getMinutes(), 0, 0));
  }
  if (!dated && !part && d.getTime() <= now.getTime()) {
    // "a las cinco" dicho a las tres de la tarde = a las 17:00; si ya pasó del todo, mañana
    const pm = new Date(d.getTime() + 12 * 3_600_000);
    if (h < 12 && dayKey(pm) === dayKey(now) && pm.getTime() > now.getTime()) return pm;
    return new Date(addDays(d, 1).setHours(h, min, 0, 0));
  }
  return d;
}

/** Lo que hay que recordar: lo que va después del último "para" o "que". */
function labelOf(raw: string) {
  const m = raw.match(/\b(?:para|que)\s+((?:(?!\b(?:para|que)\b).)+)$/i);
  const label = m ? m[1].replace(/[.!?¿¡]+$/g, '').trim() : '';
  // "para las ocho", "para dentro de 10 minutos" no es lo que hay que recordar, es cuándo
  return /^(las?|dentro|en|el|mañana|manana|esta|este)\b/i.test(label) ? '' : label;
}

export type TimerRequest = { at: number; label: string; kind: Timer['kind'] };

/** Entiende una petición de temporizador o aviso (o null si no lo es). */
export function parseTimer(raw: string, now: Date): TimerRequest | null {
  const t = normalize(raw);
  if (!TRIGGER.test(t)) return null;
  const clock = parseClock(raw, now);
  if (clock && /\b(?:a|para|sobre|hacia) las?\b/.test(t)) return { at: clock.getTime(), label: labelOf(raw), kind: 'aviso' };
  const dur = parseDuration(raw);
  if (dur && /\b(en|dentro de|de|durante)\b/.test(t)) return { at: now.getTime() + dur, label: labelOf(raw), kind: 'temporizador' };
  return null;
}

/** "4 minutos y 10 segundos" */
export function sayDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(h === 1 ? 'una hora' : `${h} horas`);
  if (m) parts.push(m === 1 ? 'un minuto' : `${m} minutos`);
  if (sec && !h && m < 10) parts.push(sec === 1 ? 'un segundo' : `${sec} segundos`);
  return parts.length ? parts.join(' y ') : 'nada';
}

/** "9:58" para la pantalla */
export function clockText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export class Timers {
  list: Timer[] = (readJSON<Timer[]>(FILE) ?? []).filter((t) => typeof t.at === 'number');

  private save() {
    writeJSON(FILE, this.list);
  }

  add(r: TimerRequest, now: number): Timer {
    const t: Timer = { id: `${now}-${Math.round(Math.random() * 1e6)}`, at: r.at, label: r.label, kind: r.kind, set: now };
    this.list = [...this.list, t].sort((a, b) => a.at - b.at);
    this.save();
    return t;
  }

  /** Cancela el más cercano (o todos). Devuelve cuántos ha quitado. */
  cancel(all = false) {
    const n = all ? this.list.length : Math.min(1, this.list.length);
    this.list = all ? [] : this.list.slice(1);
    this.save();
    return n;
  }

  next(): Timer | null {
    return this.list[0] ?? null;
  }

  /** Los que ya han llegado (y los quita de la lista). */
  due(now: number): Timer[] {
    const due = this.list.filter((t) => t.at <= now);
    if (due.length) {
      this.list = this.list.filter((t) => t.at > now);
      this.save();
    }
    return due;
  }
}
