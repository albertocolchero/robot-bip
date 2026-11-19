// Lo que Bip recuerda de ti (tu nombre y lo que le pides recordar), guardado dentro del iPhone.
// Si lo que le pides recordar tiene fecha ("mañana tengo dentista"), se convierte en un plan
// del diario y Bip te lo recordará ese día.
import { addDays, dayKey, findDate, spokenDay } from './dates';
import { readJSON, writeJSON } from './store';

export type Memory = {
  name: string | null;
  facts: string[];
};

export type Learned = {
  text: string;
  name?: string;
  fact?: string;
  plan?: { date: Date; what: string };
};

const FILE = 'memoria.json';
const MAX_FACTS = 20;

export function loadMemory(): Memory {
  const m = readJSON<Partial<Memory>>(FILE);
  return {
    name: typeof m?.name === 'string' ? m.name : null,
    facts: Array.isArray(m?.facts) ? m.facts.slice(-MAX_FACTS) : [],
  };
}

export function saveMemory(m: Memory) {
  writeJSON(FILE, m);
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const NAME_WORD = /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+$/;
const FILLER = /^(pues|bueno|vale|hola|bip|vip|pip|oye|mira|ah|eh)$/i;
const NOT_NAMES =
  /^(y|que|pero|bip|vip|pip|el|la|los|las|un|una|soy|es|no|si|sí|hola|vale|bueno|pues|nada|nadie|paso|te|lo|digo|tengo|estoy|muy|bien|mal|yo)$/i;

/** Saca un nombre: "me llamo Luis", "mi nombre es Ana García", "llámame Pepe".
 *  Con loose (cuando Bip acaba de preguntar tu nombre) también vale "soy Ana" o solo "Ana". */
export function nameFrom(raw: string, loose = false): string | null {
  const strict = raw.match(/(?:me llamo|mi nombre es|ll[aá]mame)\s+(.+)/i);
  const soy = loose ? raw.match(/\bsoy\s+(.+)/i) : null;
  let src = strict?.[1] ?? soy?.[1];
  if (!src && loose && raw.trim().split(/\s+/).length <= 3) src = raw;
  if (!src) return null;
  const words = src.replace(/[.!¡¿?,]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length && FILLER.test(words[0])) words.shift();
  const name: string[] = [];
  for (const w of words) {
    if (!NAME_WORD.test(w) || NOT_NAMES.test(w) || name.length === 2) break;
    name.push(w);
  }
  return name.length ? name.map(capitalize).join(' ') : null;
}

/** Si la frase le pide recordar algo, lo guarda y dice qué contestar. Si no, null. */
export function learn(m: Memory, raw: string, now = new Date()): Learned | null {
  // "me llamo Ana", "mi nombre es Ana", "llámame Ana"
  const name = nameFrom(raw);
  if (name) {
    m.name = name;
    saveMemory(m);
    return { text: `¡Encantado, ${name}! Me acordaré.`, name };
  }

  // "recuerda que...", "recuérdame que...", "recuérdame mañana que..."
  const r = raw.match(/recu[eé]rda(?:me|lo)?\s+(?:(.{0,30}?)\s+)?que\s+(.+)/i);
  if (!r) return null;
  const said = `${r[1] ?? ''} ${r[2]}`.replace(/[.!?¿¡]+$/g, '').trim();
  if (said.length < 3) return null;

  const dated = findDate(said, now);
  if (dated && dated.rest.length > 2) {
    const day = dayKey(dated.date);
    const when =
      day === dayKey(now) ? 'hoy' : day === dayKey(addDays(now, 1)) ? 'mañana' : day === dayKey(addDays(now, 2)) ? 'pasado mañana' : spokenDay(dated.date);
    return { text: `¡Apuntado para ${when}! Te lo recordaré.`, plan: { date: dated.date, what: dated.rest } };
  }
  m.facts = [...m.facts, said].slice(-MAX_FACTS);
  saveMemory(m);
  return { text: '¡Apuntado! Me lo guardo en la memoria.', fact: said };
}

export function describe(m: Memory): string {
  const parts: string[] = [];
  parts.push(m.name ? `La persona se llama ${m.name}.` : 'Aún no sabes cómo se llama la persona.');
  if (m.facts.length) parts.push(`Te pidió recordar: ${m.facts.slice(-6).join('; ')}.`);
  return parts.join(' ');
}
