// El diario de Bip: lo que pasa cada día, las fichas de personas, animales y cosas
// de tu vida, los planes que le cuentas y tus costumbres. Todo se guarda dentro del iPhone.
import { addDays, dayKey, DAYS, hhmm } from './dates';
import { readJSON, writeJSON } from './store';
import { normalize } from './talk';

export type EntryKind = 'visita' | 'charla' | 'iniciativa' | 'aprendido' | 'cuerpo';
/** t: cuándo (ms) · k: tipo · x: texto · m: minutos (en las visitas) */
export type Entry = { t: number; k: EntryKind; x: string; m?: number };
export type CardKind = 'persona' | 'animal' | 'cosa' | 'lugar';
export type Card = { name: string; kind: CardKind; facts: string[]; t: number };
/** Algo que tienes un día concreto ("tengo dentista"), con lo que Bip ya ha hecho al respecto. */
export type Plan = { day: string; what: string; t: number; reminded?: boolean; eve?: boolean; followed?: boolean };
/** Resumen de un día: x lo hacen las reglas; bip lo escribe Bip con sus palabras. */
export type DayNote = { day: string; x: string; bip?: string };

export type Journal = {
  v: 1;
  /** Cuándo os conocisteis. */
  since: number;
  entries: Entry[];
  days: DayNote[];
  cards: Card[];
  plans: Plan[];
  /** Primera llegada de cada día (para aprender tus costumbres). */
  arrivals: { day: string; t: number }[];
  /** Cosas que ya ha hecho hoy, para no repetirse. */
  done: { day: string; keys: string[] };
  asked: string[];
  settings: { quietFrom: number; quietTo: number };
  lastDay: string;
};

const FILE = 'diario.json';
const KEEP_DAYS = 7;
const MAX_ENTRIES = 600;
const MAX_CARDS = 40;
const MAX_FACTS = 6;

export function emptyJournal(now: number): Journal {
  return {
    v: 1,
    since: now,
    entries: [],
    days: [],
    cards: [],
    plans: [],
    arrivals: [],
    done: { day: dayKey(new Date(now)), keys: [] },
    asked: [],
    settings: { quietFrom: 23, quietTo: 8 },
    lastDay: dayKey(new Date(now)),
  };
}

export function loadJournal(now: number): Journal {
  const j = readJSON<Partial<Journal>>(FILE);
  const base = emptyJournal(now);
  if (!j || j.v !== 1) return base;
  return {
    ...base,
    ...j,
    settings: { ...base.settings, ...(j.settings ?? {}) },
    done: j.done ?? base.done,
  } as Journal;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Guarda al cabo de un momento (si pasan varias cosas seguidas, una sola escritura). */
export function saveJournal(j: Journal) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJSON(FILE, j);
  }, 2000);
}

export function flushJournal(j: Journal) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  writeJSON(FILE, j);
}

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function note(j: Journal, now: number, k: EntryKind, x: string, m?: number) {
  j.entries.push(m === undefined ? { t: now, k, x: short(x) } : { t: now, k, x: short(x), m });
  const oldest = now - KEEP_DAYS * 86_400_000;
  if (j.entries.length > MAX_ENTRIES || j.entries[0].t < oldest) {
    j.entries = j.entries.filter((e) => e.t >= oldest).slice(-MAX_ENTRIES);
  }
  saveJournal(j);
}

export function entriesOf(j: Journal, day: string) {
  return j.entries.filter((e) => dayKey(new Date(e.t)) === day);
}

// ------------------------------------------------------------------ planes
export function addPlan(j: Journal, now: number, date: Date, what: string): Plan {
  const p: Plan = { day: dayKey(date), what: short(what, 90), t: now };
  j.plans.push(p);
  const yesterday = dayKey(addDays(new Date(now), -2));
  j.plans = j.plans.filter((x) => x.day >= yesterday).slice(-30);
  saveJournal(j);
  return p;
}

export function plansOn(j: Journal, day: string) {
  return j.plans.filter((p) => p.day === day);
}

// ------------------------------------------------------------------ fichas
/** Apunta un dato sobre alguien o algo. Devuelve true si era nuevo. */
export function addCard(j: Journal, now: number, name: string, kind: CardKind, fact: string) {
  const key = normalize(name);
  const f = short(fact.trim(), 90);
  if (!key || !f) return false;
  let c = j.cards.find((x) => normalize(x.name) === key);
  if (!c) {
    c = { name: name.trim(), kind, facts: [], t: now };
    j.cards.push(c);
  }
  c.t = now;
  if (c.facts.some((x) => normalize(x) === normalize(f))) return false;
  c.facts = [...c.facts, f].slice(-MAX_FACTS);
  if (j.cards.length > MAX_CARDS) {
    j.cards.sort((a, b) => b.t - a.t);
    j.cards = j.cards.slice(0, MAX_CARDS);
  }
  saveJournal(j);
  return true;
}

/** Las fichas que vienen a cuento: las que se nombran en la frase y las más recientes. */
export function relevantCards(j: Journal, text = '', n = 3) {
  const t = ` ${normalize(text)} `;
  const named = j.cards.filter((c) => t.includes(` ${normalize(c.name)} `));
  const recent = [...j.cards].sort((a, b) => b.t - a.t);
  const out: Card[] = [];
  for (const c of [...named, ...recent]) if (!out.includes(c) && out.length < n) out.push(c);
  return out;
}

// ------------------------------------------------------------------ lo que ya ha hecho hoy
export function isDone(j: Journal, day: string, key: string) {
  return j.done.day === day && j.done.keys.includes(key);
}

export function markDone(j: Journal, day: string, key: string) {
  if (j.done.day !== day) j.done = { day, keys: [] };
  if (!j.done.keys.includes(key)) j.done.keys.push(key);
  saveJournal(j);
}

// ------------------------------------------------------------------ costumbres
/** Apunta la primera llegada del día. Devuelve true si es la primera de hoy. */
export function noteArrival(j: Journal, now: number) {
  const day = dayKey(new Date(now));
  if (j.arrivals.some((a) => a.day === day)) return false;
  j.arrivals = [...j.arrivals, { day, t: now }].slice(-21);
  saveJournal(j);
  return true;
}

/** A qué hora sueles llegar (minutos desde medianoche), si ya lo sabe (hacen falta 4 días). */
export function usualArrival(j: Journal, today: string): number | null {
  const mins = j.arrivals
    .filter((a) => a.day !== today)
    .slice(-14)
    .map((a) => {
      const d = new Date(a.t);
      return d.getHours() * 60 + d.getMinutes();
    })
    .sort((a, b) => a - b);
  if (mins.length < 4) return null;
  return mins[Math.floor(mins.length / 2)];
}

export function daysTogether(j: Journal) {
  return new Set(j.arrivals.map((a) => a.day)).size;
}

// ------------------------------------------------------------------ resúmenes
function duration(min: number) {
  if (min < 1.5) return 'un ratito';
  if (min < 60) return `${Math.round(min)} minutos`;
  const h = Math.round(min / 60);
  return h === 1 ? 'una hora' : `unas ${h} horas`;
}

/** Cuenta un día en frases cortas (cada una cabe en un subtítulo). */
export function summarize(j: Journal, day: string, ongoingMin = 0): string[] {
  const es = entriesOf(j, day);
  const visits = es.filter((e) => e.k === 'visita');
  const minutes = visits.reduce((a, e) => a + (e.m ?? 0), 0) + ongoingMin;
  const talks = es.filter((e) => e.k === 'charla').length;
  const mine = es.filter((e) => e.k === 'iniciativa');
  const learned = es.filter((e) => e.k === 'aprendido');
  const naps = es.filter((e) => e.k === 'cuerpo' && /siesta/.test(e.x)).length;
  const lines: string[] = [];
  if (minutes > 0) {
    const n = visits.length + (ongoingMin > 0 ? 1 : 0);
    lines.push(`Hemos estado juntos ${duration(minutes)}${n > 1 ? `, en ${n} ratos` : ''}.`);
  }
  if (talks) lines.push(`Hemos hablado ${talks === 1 ? 'una vez' : `${talks} veces`}.`);
  if (mine.length) {
    lines.push(`Por mi cuenta he dicho ${mine.length === 1 ? 'una cosa' : `${mine.length} cosas`}.`);
    lines.push(`La última: «${short(mine[mine.length - 1].x, 70)}»`);
  }
  for (const e of learned.slice(-2)) lines.push(`Apunté: ${short(e.x, 90)}.`);
  if (naps) lines.push(naps === 1 ? 'Y me he echado una siestecita.' : `Y me he echado ${naps} siestas.`);
  if (!lines.length) lines.push('Ha sido un día tranquilo: aún no ha pasado gran cosa.');
  return lines;
}

/** Cierra un día: guarda su resumen para recordarlo después. */
export function closeDay(j: Journal, day: string) {
  if (j.days.some((d) => d.day === day)) return;
  const es = entriesOf(j, day);
  if (!es.length) return;
  j.days = [...j.days, { day, x: summarize(j, day).join(' ') }].slice(-30);
  saveJournal(j);
}

/** Lo que la mente necesita saber del diario para contestar con sentido (corto: cabe poco). */
export function describeJournal(j: Journal, now: number, heard = '') {
  const d = new Date(now);
  const today = dayKey(d);
  const bits: string[] = [];
  const quote = (ps: Plan[]) => ps.map((p) => `«${p.what}»`).join(' y ');
  const hoy = plansOn(j, today);
  const manana = plansOn(j, dayKey(addDays(d, 1)));
  const ayer = plansOn(j, dayKey(addDays(d, -1)));
  if (hoy.length) bits.push(`Para hoy te contó: ${quote(hoy)}.`);
  if (manana.length) bits.push(`Para mañana te contó: ${quote(manana)}.`);
  if (ayer.length) bits.push(`Ayer tenía: ${quote(ayer)}.`);
  const cards = relevantCards(j, heard, 3);
  if (cards.length) {
    bits.push(`Sabes esto: ${cards.map((c) => `${c.name} (${c.kind}): ${c.facts.slice(-2).join(', ')}`).join('; ')}.`);
  }
  const prev = j.days.find((x) => x.day === dayKey(addDays(d, -1)));
  if (prev) bits.push(`Ayer: ${short(prev.bip ?? prev.x, 140)}`);
  const talks = entriesOf(j, today).filter((e) => e.k === 'charla').length;
  if (talks) bits.push(`Hoy habéis hablado ${talks} veces.`);
  const n = daysTogether(j);
  if (n > 1) bits.push(`Os conocéis desde hace ${n} días.`);
  return bits.join(' ');
}

/** "¿Qué sabes de mí?": frases cortas, en orden. */
export function whatIKnow(j: Journal, name: string | null, facts: string[]) {
  const lines: string[] = [name ? `Sé que te llamas ${name}.` : 'Aún no sé cómo te llamas.'];
  for (const f of facts.slice(-2)) lines.push(`Me pediste recordar: «${short(f, 80)}».`);
  const now = new Date();
  const soon = j.plans
    .filter((p) => p.day >= dayKey(now))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(0, 2);
  for (const p of soon) {
    const when = p.day === dayKey(now) ? 'Hoy' : p.day === dayKey(addDays(now, 1)) ? 'Mañana' : `El día ${Number(p.day.slice(8))}`;
    lines.push(`${when} tienes: «${short(p.what, 70)}».`);
  }
  for (const c of [...j.cards].sort((a, b) => b.t - a.t).slice(0, 3)) {
    lines.push(`${c.name}: ${short(c.facts[c.facts.length - 1] ?? '', 80)}.`);
  }
  const usual = usualArrival(j, dayKey(new Date()));
  if (usual !== null) {
    const h = Math.floor(usual / 60);
    lines.push(`Y sueles llegar sobre las ${hhmm(new Date(2000, 0, 1, h, usual % 60))}.`);
  }
  if (lines.length === 1) lines.push('Todavía no sé mucho más. ¡Cuéntame cosas!');
  return lines;
}

export function forgetAll(j: Journal, now: number) {
  const fresh = emptyJournal(now);
  Object.assign(j, fresh, { settings: j.settings });
  flushJournal(j);
}

export function forgetDay(j: Journal, day: string) {
  j.entries = j.entries.filter((e) => dayKey(new Date(e.t)) !== day);
  j.days = j.days.filter((d) => d.day !== day);
  flushJournal(j);
}

export function weekdayName(now: number) {
  return DAYS[new Date(now).getDay()];
}
