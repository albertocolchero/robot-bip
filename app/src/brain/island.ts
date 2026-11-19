// El mini Bip de la Isla Dinámica (y de la pantalla de bloqueo). Es una "Actividad en directo":
// la app le cuenta a iOS cómo está Bip (cara, color, lo último que ha dicho y el temporizador) y
// iOS lo dibuja aunque estés en otra app. La cuenta atrás la lleva iOS solo, aunque Bip esté cerrado.
// El dibujo está en targets/isla/BipLiveActivity.swift.
import BipSenses, { type IslandState } from '../../modules/bip-senses';
import type { FaceEngine } from '../face/engine';
import { COLORS } from '../face/theme';
import type { Timers } from './timers';

/** Como mucho una actualización cada estos milisegundos (salvo si cambia el temporizador). */
const MIN_GAP_MS = 3000;

export class Island {
  /** false si iOS no lo deja (por ejemplo, las Actividades en directo están desactivadas en Ajustes). */
  ok = true;
  private sent: IslandState | null = null;
  private sentAt = 0;
  private line = '';

  constructor(
    private engine: FaceEngine,
    private timers: Timers,
    public enabled: boolean,
  ) {}

  private state(): IslandState {
    const e = this.engine;
    if (e.subtitle) this.line = e.subtitle; // lo último que dijo (con subtítulo)
    const next = this.timers.next();
    return {
      emotion: e.emotion,
      color: COLORS[e.theme.color],
      line: this.line.slice(0, 120),
      timerEnd: next ? next.at / 1000 : 0,
      timerLabel: next?.label ?? '',
    };
  }

  private send(s: IslandState) {
    this.sent = s;
    this.sentAt = Date.now();
    try {
      this.ok = BipSenses.islandShow(s);
    } catch {
      this.ok = false;
    }
  }

  /** Cada poco: si algo ha cambiado, se lo cuenta a iOS. */
  sync(force = false) {
    if (!this.enabled) return;
    const s = this.state();
    const prev = this.sent;
    const same = !!prev && prev.emotion === s.emotion && prev.color === s.color && prev.line === s.line && prev.timerEnd === s.timerEnd && prev.timerLabel === s.timerLabel;
    if (same && !force) return;
    const timerChanged = !prev || prev.timerEnd !== s.timerEnd;
    if (!force && !timerChanged && Date.now() - this.sentAt < MIN_GAP_MS) return;
    this.send(s);
  }

  /** Al salir de la app: Bip se queda arriba, esperando. */
  away() {
    if (!this.enabled) return;
    this.send({ ...this.state(), emotion: 'contento', line: 'Aquí arriba te espero. Tócame para volver.' });
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) {
      this.sync(true);
    } else {
      this.sent = null;
      try {
        BipSenses.islandEnd();
      } catch {
        // nada que apagar
      }
    }
  }
}
