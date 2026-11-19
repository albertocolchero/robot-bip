// Números dichos en voz alta: "37", "treinta y siete", "cien", "veintidós", "una"...
import { normalize } from './talk';

export const UNITS: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
export const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100 };

/** Lee un número de una lista de palabras ya normalizadas, empezando en i. Devuelve [número, palabras usadas]. */
export function numberAt(words: string[], i: number): [number, number] | null {
  const w = words[i];
  if (w === undefined) return null;
  if (/^\d+$/.test(w)) return [Number(w), 1];
  if (w in TENS) {
    if (words[i + 1] === 'y' && words[i + 2] in UNITS) return [TENS[w] + UNITS[words[i + 2]], 3];
    return [TENS[w], 1];
  }
  if (w in UNITS) return [UNITS[w], 1];
  return null;
}

/** El primer número de una frase (o null). */
export function parseNumber(text: string): number | null {
  const d = text.match(/\b(\d{1,3})\b/);
  if (d) return Number(d[1]);
  const words = normalize(text).split(' ');
  for (let i = 0; i < words.length; i++) {
    const n = numberAt(words, i);
    if (n) return n[0];
  }
  return null;
}
