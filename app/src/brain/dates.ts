// Fechas en español: convierte "hoy", "mañana", "el viernes" o "el 3 de diciembre"
// en un día concreto, para que Bip sepa cuándo recordarte las cosas.
export const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const DAY_RE = 'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo';
const MONTH_RE = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

function plain(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** "2026-11-20": sirve para comparar días. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}

/** "el jueves 20 de noviembre" */
export function spokenDay(d: Date) {
  return `el ${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

/** "09:05" */
export function hhmm(t: number | Date) {
  const d = typeof t === 'number' ? new Date(t) : t;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Found = { date: Date; start: number; end: number; keep?: string };

function weekday(name: string, now: Date) {
  const target = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(plain(name));
  if (target < 0) return null;
  const diff = (target - now.getDay() + 7) % 7;
  return addDays(now, diff === 0 ? 7 : diff); // "el lunes" dicho un lunes = el que viene
}

function monthDay(day: number, month: number, now: Date) {
  if (day < 1 || day > 31) return null;
  const d = new Date(now.getFullYear(), month, day, 12);
  if (d.getMonth() !== month) return null; // 31 de febrero y cosas así
  if (dayKey(d) < dayKey(now)) d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Busca una fecha en la frase. Devuelve el día y la frase sin esas palabras (o null). */
export function findDate(raw: string, now: Date): { date: Date; rest: string } | null {
  const found: Found[] = [];
  const scan = (re: RegExp, make: (m: RegExpExecArray) => Date | null, keep?: (m: RegExpExecArray) => string | undefined) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const date = make(m);
      if (date) found.push({ date, start: m.index, end: m.index + m[0].length, keep: keep?.(m) });
    }
  };

  scan(/\bpasado\s+ma[nñ]ana\b/gi, () => addDays(now, 2));
  scan(new RegExp(`\\b(?:el\\s+)?(?:d[ií]a\\s+)?(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\b`, 'gi'), (m) => {
    const month = plain(m[2]) === 'setiembre' ? 8 : MONTHS.map(plain).indexOf(plain(m[2]));
    return monthDay(Number(m[1]), month, now);
  });
  scan(new RegExp(`\\b(?:el\\s+|este\\s+)?(?:pr[oó]ximo\\s+)?(${DAY_RE})\\b`, 'gi'), (m) => weekday(m[1], now));
  scan(/\bel\s+d[ií]a\s+(\d{1,2})\b/gi, (m) => {
    const day = Number(m[1]);
    const thisMonth = monthDay(day, now.getMonth(), now);
    if (thisMonth && thisMonth.getFullYear() === now.getFullYear()) return thisMonth;
    const next = addDays(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12), 0);
    return monthDay(day, next.getMonth(), next);
  });
  // "mañana", pero no "esta mañana" ni "por la mañana" (eso es una hora del día)
  scan(/(\b(?:la|esta)\s+)?\bma[nñ]ana\b/gi, (m) => (m[1] ? null : addDays(now, 1)));
  scan(/\bhoy\b/gi, () => addDays(now, 0));
  scan(/\besta\s+(tarde|noche|ma[nñ]ana)\b/gi, () => addDays(now, 0), (m) => `por la ${m[1].toLowerCase()}`);

  if (!found.length) return null;
  // la más temprana en la frase; si se solapan, la más larga ("pasado mañana" gana a "mañana")
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const f = found[0];
  if (found.some((o) => o !== f && o.start < f.end && o.end > f.end)) return null;
  const rest = (raw.slice(0, f.start) + (f.keep ? ` ${f.keep} ` : ' ') + raw.slice(f.end))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,]+|[\s,.]+$/g, '')
    .replace(/^que\s+/i, '');
  return { date: f.date, rest };
}
