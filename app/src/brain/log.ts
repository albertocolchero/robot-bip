// El registro de Bip: lo que oye, qué decide hacer con ello, lo que contesta y cuánto tarda.
// Sirve para mejorarle: si algo sale mal ("no me ha hecho caso", "ha saltado a jugar"), en
// Ajustes › Registro se ve qué pasó y se puede compartir (por WhatsApp, correo, Notas...).
// Se queda solo en este iPhone: solo sale si tú lo compartes. Guarda las últimas 800 líneas.
import { readJSON, writeJSON } from './store';

export type LogKind =
  | 'oye' // lo que ha entendido (texto final del dictado)
  | 'ignora' // lo ha oído pero cree que no era para él (o era su propio eco)
  | 'decide' // quién se encarga: juegos, temporizador, el tiempo, la mente...
  | 'dice' // lo que contesta
  | 'mente' // cuánto ha tardado en pensar
  | 'caras' // por qué cree que eres tú (o no)
  | 'tiempo' // el tiempo y los sitios
  | 'casa' // Home Assistant: órdenes de la casa y conexión
  | 'fallo'; // errores (sin internet, el dictado se apaga...)

export type LogEntry = { t: number; k: LogKind; m: string };

const FILE = 'registro.json';
const MAX = 800;

export class Log {
  private entries: LogEntry[] = readJSON<LogEntry[]>(FILE) ?? [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  enabled = true;

  constructor(private now: () => number = () => Date.now()) {}

  add(k: LogKind, m: string) {
    if (!this.enabled) return;
    this.entries.push({ t: this.now(), k, m: m.length > 300 ? `${m.slice(0, 297)}…` : m });
    if (this.entries.length > MAX) this.entries = this.entries.slice(-MAX);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeJSON(FILE, this.entries);
    }, 3000);
  }

  get size() {
    return this.entries.length;
  }

  /** Las últimas n líneas, de la más nueva a la más vieja. */
  latest(n = 60): LogEntry[] {
    return this.entries.slice(-n).reverse();
  }

  clear() {
    this.entries = [];
    writeJSON(FILE, this.entries);
  }

  /** Resumen de las últimas 24 horas, para ver de un vistazo qué falla. */
  summary(): string[] {
    const since = this.now() - 24 * 3600_000;
    const day = this.entries.filter((e) => e.t >= since);
    const count = (k: LogKind) => day.filter((e) => e.k === k).length;
    const by = (re: RegExp) => day.filter((e) => e.k === 'decide' && re.test(e.m)).length;
    const thoughts = day.filter((e) => e.k === 'mente').map((e) => Number(e.m.match(/primera palabra a los ([\d.]+) s/)?.[1])).filter((x) => x > 0);
    const avg = thoughts.length ? (thoughts.reduce((a, b) => a + b, 0) / thoughts.length).toFixed(1) : '–';
    return [
      `Últimas 24 h: ha entendido ${count('oye')} frases y ha dejado pasar ${count('ignora')}.`,
      `Las ha contestado: la mente ${by(/→ mente/)}, respuestas rápidas ${by(/→ (reglas|hora|fecha)/)}, juegos ${by(/→ juego/)}, el tiempo ${by(/→ el tiempo/)}, avisos ${by(/→ aviso/)}.`,
      `La mente tarda de media ${avg} s en empezar a contestar.`,
      `Caras: ${day.filter((e) => e.k === 'caras' && /→ es /.test(e.m)).length} reconocidas, ${day.filter((e) => e.k === 'caras' && /→ dudo/.test(e.m)).length} dudas, ${day.filter((e) => e.k === 'caras' && /no es /.test(e.m)).length} equivocadas.`,
      `Fallos: ${count('fallo')}.`,
    ];
  }

  /** Todo el registro como texto, para compartirlo. */
  text(): string {
    const two = (n: number) => String(n).padStart(2, '0');
    const lines = this.entries.map((e) => {
      const d = new Date(e.t);
      return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}  ${e.k.padEnd(6)} ${e.m}`;
    });
    return ['Registro de Bip', ...this.summary(), '', ...lines].join('\n');
  }
}

/** Una hora corta para la pantalla ("18:02:07"). */
export function clockOf(t: number) {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
