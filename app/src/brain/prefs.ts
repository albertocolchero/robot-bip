// Ajustes que se eligen en el panel (ajustes.json): volumen y mini Bip fuera de la app.
import { readJSON, writeJSON } from './store';

const FILE = 'ajustes.json';

export type Prefs = {
  /** Volumen de la voz, de 0,2 a 1. */
  volume: number;
  /** Mini Bip en la Isla Dinámica y en la pantalla de bloqueo. */
  island: boolean;
  /** Se le puede interrumpir mientras habla (sigue escuchando mientras pita). */
  interrupt: boolean;
};

export function loadPrefs(): Prefs {
  const p = readJSON<Partial<Prefs>>(FILE);
  const v = typeof p?.volume === 'number' ? p.volume : 1;
  return {
    volume: Math.max(0.2, Math.min(1, v)),
    island: typeof p?.island === 'boolean' ? p.island : true,
    interrupt: typeof p?.interrupt === 'boolean' ? p.interrupt : true,
  };
}

export function savePrefs(change: Partial<Prefs>) {
  writeJSON(FILE, { ...loadPrefs(), ...change });
}
