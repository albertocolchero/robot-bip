// Versión de navegador, solo para probar en el PC:
//  - Ojos: la "cara" es el puntero del ratón.
//  - Oído: se simula escribiendo en la consola  window.bipOye('hola bip')
//  - Expresión: window.bipCara({ smile: 0.9 })  (se queda puesta hasta window.bipCara(null))
//  - Mano: window.bipMano('palma')  (o null para quitarla)
//  - Sonido: window.bipSuena(0.9)  (un golpe de volumen, como una palmada)
//  - Quién es: window.bipQuien('A') o 'B' (dos personas de mentira), y window.bipPerro(true)
//  - Voz: reproduce el WAV con el reproductor del navegador.
import { NativeModule, registerWebModule } from 'expo';

import type { BipSensesEvents, Expression, HandGesture, HearingStart, IslandState, PermissionResult } from './BipSenses.types';

declare global {
  interface Window {
    bipOye?: (text: string) => void;
    bipCara?: (e: Partial<Expression> | null) => void;
    bipMano?: (g: HandGesture | null) => void;
    bipSuena?: (level: number) => void;
    bipQuien?: (who: string) => void;
    bipPerro?: (on: boolean) => void;
  }
}

/** Una "huella" de mentira para cada persona: siempre parecida, con un poco de ruido. */
function fakePrint(who: string) {
  let seed = 0;
  for (const c of who) seed = (seed * 31 + c.charCodeAt(0)) % 9973;
  const v: number[] = [];
  for (let i = 0; i < 64; i++) {
    const base = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    v.push(base - Math.floor(base) + (Math.random() - 0.5) * 0.08);
  }
  return v;
}

function fakeGeo(who: string) {
  const k = who === 'A' ? 0 : who === 'B' ? 1 : 2;
  return [0.36, 0.55, 0.3, 1.6, 1.25, 0.6, 0.31, 0.31].map((x, i) => x * (1 + (k - 1) * 0.06 * (i % 2 ? 1 : -1)) + (Math.random() - 0.5) * 0.01);
}

const NEUTRAL: Expression = {
  smile: 0.05,
  frown: 0.02,
  browUp: 0.05,
  browDown: 0.05,
  jawOpen: 0.02,
  blinkL: 0.05,
  blinkR: 0.05,
  squint: 0.05,
  wide: 0.05,
  pucker: 0.02,
  puff: 0.01,
  sneer: 0.01,
  press: 0.05,
};

class BipSensesModule extends NativeModule<BipSensesEvents> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private soundTimer: ReturnType<typeof setInterval> | null = null;
  private mouse: { x: number; y: number; inside: boolean } = { x: 0.5, y: 0.5, inside: false };
  private intervalMs = 125;
  private fast = false;
  private expr: Expression | null = null;
  private faceReader = false;
  private hand: HandGesture | null = null;
  private who = 'A';
  private dog = false;
  private lastPrint = 0;
  private soundLevel = 0.1;
  private audio: HTMLAudioElement | null = null;
  private onMove = (e: MouseEvent) => {
    this.mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, inside: true };
  };
  private onLeave = () => {
    this.mouse.inside = false;
  };

  async requestPermissions(): Promise<PermissionResult> {
    return { camera: true, microphone: true, speech: true };
  }

  private beat() {
    const faces: Parameters<BipSensesEvents['onSee']>[0]['faces'] = this.mouse.inside ? [{ x: this.mouse.x, y: this.mouse.y, size: 0.3, confidence: 1, yaw: 0 }] : [];
    const event: Parameters<BipSensesEvents['onSee']>[0] = { faces, light: 4 };
    const now = Date.now();
    if (faces.length && now - this.lastPrint > 1200) {
      this.lastPrint = now;
      faces[0].fp = fakePrint(this.who);
    }
    if (faces.length && this.faceReader) {
      event.expr = { ...NEUTRAL, ...(this.expr ?? {}) };
      event.geo = fakeGeo(this.who);
    }
    if (this.dog) event.animals = [{ kind: 'perro', x: 0.3, y: 0.7, size: 0.25, confidence: 0.9 }];
    if (this.hand) event.hand = { gesture: this.hand, x: 0.5, y: 0.6, confidence: 0.9 };
    this.emit('onSee', event);
  }

  startSeeing() {
    if (this.timer) return;
    window.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseleave', this.onLeave);
    window.bipCara = (e) => {
      this.expr = e ? { ...NEUTRAL, ...e } : null;
    };
    window.bipMano = (g) => {
      this.hand = g;
    };
    window.bipQuien = (who) => {
      this.who = who;
      this.lastPrint = 0;
    };
    window.bipPerro = (on) => {
      this.dog = on;
    };
    this.timer = setInterval(() => this.beat(), this.fast ? 50 : this.intervalMs);
  }

  stopSeeing() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseleave', this.onLeave);
  }

  setSeeingInterval(seconds: number) {
    this.intervalMs = Math.max(50, seconds * 1000);
    if (this.timer) {
      this.stopSeeing();
      this.startSeeing();
    }
  }

  setFastVision(fast: boolean) {
    this.fast = fast;
    if (this.timer) {
      this.stopSeeing();
      this.startSeeing();
    }
  }

  async loadFaceReader(_path: string): Promise<boolean> {
    this.faceReader = true;
    return true;
  }

  async startHearing(_locale: string): Promise<HearingStart> {
    window.bipOye = (text: string) => this.emit('onHear', { text, final: true });
    window.bipSuena = (level: number) => {
      this.soundLevel = level;
      setTimeout(() => {
        this.soundLevel = 0.1;
      }, 150);
    };
    if (!this.soundTimer) {
      this.soundTimer = setInterval(() => this.emit('onSound', { level: this.soundLevel, db: this.soundLevel * 60 - 60 }), 100);
    }
    return { ok: true, reason: '' };
  }

  stopHearing() {
    window.bipOye = undefined;
    if (this.soundTimer) clearInterval(this.soundTimer);
    this.soundTimer = null;
  }

  setHearingPaused(_paused: boolean) {}

  setHearingEngine(_name: string) {}

  async playWav(base64: string): Promise<number> {
    this.audio?.pause();
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    this.audio = audio;
    await audio.play().catch(() => undefined);
    return Number.isFinite(audio.duration) ? audio.duration : -1;
  }

  stopWav() {
    this.audio?.pause();
    this.audio = null;
  }

  // Descargas simuladas: tardan unos segundos y no bajan nada.
  private fakeDownloads = new Map<string, ReturnType<typeof setInterval>>();

  modelPath(fileName: string): string | null {
    return this.readText(`modelo-${fileName}`) ? `web://${fileName}` : null;
  }

  freeDiskBytes(): number {
    return 64e9;
  }

  downloadModel(_url: string, fileName: string) {
    if (this.fakeDownloads.size) return; // como en el iPhone: una descarga cada vez
    const total = fileName.endsWith('.task') ? 3.7e6 : 3.11e9;
    let received = 0;
    this.emit('onModel', { state: 'start', file: fileName });
    const timer = setInterval(() => {
      received = Math.min(total, received + total / 12);
      this.emit('onModel', { state: 'progress', file: fileName, received, total });
      if (received >= total) {
        clearInterval(timer);
        this.fakeDownloads.delete(fileName);
        this.writeText(`modelo-${fileName}`, 'ok');
        this.emit('onModel', { state: 'done', file: fileName, path: `web://${fileName}` });
      }
    }, 500);
    this.fakeDownloads.set(fileName, timer);
  }

  cancelModelDownload() {
    for (const t of this.fakeDownloads.values()) clearInterval(t);
    this.fakeDownloads.clear();
  }

  deleteModel(fileName: string) {
    try {
      localStorage.removeItem(`bip-modelo-${fileName}`);
    } catch {
      // sin almacenamiento en este navegador
    }
  }

  readText(name: string): string | null {
    try {
      return localStorage.getItem(`bip-${name}`);
    } catch {
      return null;
    }
  }

  writeText(name: string, text: string) {
    try {
      localStorage.setItem(`bip-${name}`, text);
    } catch {
      // sin almacenamiento en este navegador
    }
  }

  // El navegador no tiene Isla Dinámica: se guarda lo último para poder mirarlo (window.bipIsla)
  islandShow(state: IslandState): boolean {
    (window as unknown as { bipIsla?: IslandState | null }).bipIsla = state;
    return true;
  }

  islandEnd() {
    (window as unknown as { bipIsla?: IslandState | null }).bipIsla = null;
  }
}

export default registerWebModule(BipSensesModule, 'BipSensesModule');
