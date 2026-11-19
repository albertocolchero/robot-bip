// Si Bip se cierra de golpe, que se sepa por qué:
//  - Los errores del código de la app (JavaScript) se apuntan justo antes de cerrarse.
//  - Para los fallos de dentro del iPhone (que no dan tiempo a apuntar nada) se deja una "miga de pan"
//    antes de cada cosa delicada (Whisper escribiendo una frase, la mente pensando) y se borra al
//    terminar. Si al volver a abrir la app la miga sigue ahí, se cerró en mitad de eso.
// Al arrancar, Bip lo apunta en Ajustes › Registro (y, si fue Whisper, vuelve al oído de Apple).
import { readJSON, writeJSON } from './store';

const CRASH_FILE = 'ultimo-fallo.json';
const BUSY_FILE = 'en-curso.json';

export type Crash = { at: number; fatal: boolean; msg: string; stack: string };
export type Busy = { at: number; what: string };

/** Apunta los errores de la app antes de que se cierre (y deja que siga el aviso de siempre). */
export function installCrashCatcher() {
  const eu = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    const e = error as { message?: string; stack?: string } | undefined;
    writeJSON(CRASH_FILE, {
      at: Date.now(),
      fatal: !!isFatal,
      msg: String(e?.message ?? error).slice(0, 300),
      stack: String(e?.stack ?? '').slice(0, 700),
    });
    previous(error, isFatal);
  });
}

/** El error que cerró la app la última vez (y lo olvida). */
export function takeLastCrash(): Crash | null {
  const c = readJSON<Partial<Crash>>(CRASH_FILE);
  if (!c?.at) return null;
  writeJSON(CRASH_FILE, {});
  return { at: c.at, fatal: !!c.fatal, msg: c.msg ?? '', stack: c.stack ?? '' };
}

/** Empieza (what) o termina (null) algo delicado. */
export function markBusy(what: string | null) {
  writeJSON(BUSY_FILE, what ? { at: Date.now(), what } : {});
}

/** Lo que estaba haciendo cuando se cerró de golpe la última vez (y lo olvida). */
export function takeLastBusy(): Busy | null {
  const b = readJSON<Partial<Busy>>(BUSY_FILE);
  if (!b?.at || !b.what) return null;
  writeJSON(BUSY_FILE, {});
  return { at: b.at, what: b.what };
}
