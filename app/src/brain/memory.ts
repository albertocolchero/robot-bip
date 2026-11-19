// Lo que Bip recuerda de ti, guardado dentro del iPhone (no sale de él).
import BipSenses from '../../modules/bip-senses';
import { normalize } from './talk';

export type Memory = {
  name: string | null;
  facts: string[];
};

const FILE = 'memoria.json';
const MAX_FACTS = 20;

export function loadMemory(): Memory {
  try {
    const raw = BipSenses.readText(FILE);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Memory>;
      return { name: typeof m.name === 'string' ? m.name : null, facts: Array.isArray(m.facts) ? m.facts.slice(-MAX_FACTS) : [] };
    }
  } catch {
    // memoria vacía o dañada: empezamos de cero
  }
  return { name: null, facts: [] };
}

export function saveMemory(m: Memory) {
  try {
    BipSenses.writeText(FILE, JSON.stringify(m));
  } catch {
    // si no se puede guardar, lo recordará hasta que se cierre la app
  }
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Si la frase le pide recordar algo, lo guarda y devuelve qué contestar. Si no, null. */
export function learn(m: Memory, raw: string): string | null {
  const t = normalize(raw);

  if (/\b(olvida|olvidate de) todo\b/.test(t)) {
    m.name = null;
    m.facts = [];
    saveMemory(m);
    return 'Hecho. He olvidado todo lo que sabía de ti.';
  }

  // "me llamo Ana", "mi nombre es Ana", "llámame Ana"
  const nameMatch = raw.match(/(?:me llamo|mi nombre es|ll[aá]mame)\s+([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+(?:\s+[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)?)/i);
  if (nameMatch) {
    const words = nameMatch[1].split(/\s+/).filter((w) => !/^(y|que|pero|bip)$/i.test(w));
    if (words.length) {
      m.name = words.map(capitalize).join(' ');
      saveMemory(m);
      return `¡Encantado, ${m.name}! Me acordaré.`;
    }
  }

  // "recuerda que mañana tengo médico"
  const factMatch = raw.match(/recuerda\s+que\s+(.+)/i);
  if (factMatch) {
    const fact = factMatch[1].replace(/[.!?¿¡]+$/g, '').trim();
    if (fact.length > 2) {
      m.facts = [...m.facts, fact].slice(-MAX_FACTS);
      saveMemory(m);
      return '¡Apuntado! Me lo guardo en la memoria.';
    }
  }
  return null;
}

export function describe(m: Memory): string {
  const parts: string[] = [];
  parts.push(m.name ? `La persona se llama ${m.name}.` : 'Aún no sabes cómo se llama la persona.');
  if (m.facts.length) parts.push(`Te pidió recordar: ${m.facts.join('; ')}.`);
  return parts.join(' ');
}
