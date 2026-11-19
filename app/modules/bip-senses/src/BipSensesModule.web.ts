// Versión de navegador, solo para probar en el PC:
//  - Ojos: la "cara" es el puntero del ratón.
//  - Oído: se simula escribiendo en la consola  window.bipOye('hola bip')
//  - Voz: reproduce el WAV con el reproductor del navegador.
import { NativeModule, registerWebModule } from 'expo';

import type { BipSensesEvents, HearingStart, PermissionResult } from './BipSenses.types';

declare global {
  interface Window {
    bipOye?: (text: string) => void;
  }
}

class BipSensesModule extends NativeModule<BipSensesEvents> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private mouse: { x: number; y: number; inside: boolean } = { x: 0.5, y: 0.5, inside: false };
  private intervalMs = 125;
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

  startSeeing() {
    if (this.timer) return;
    window.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseleave', this.onLeave);
    this.timer = setInterval(() => {
      const faces = this.mouse.inside ? [{ x: this.mouse.x, y: this.mouse.y, size: 0.3, confidence: 1, yaw: 0 }] : [];
      this.emit('onSee', { faces, light: 4 });
    }, this.intervalMs);
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

  async startHearing(_locale: string): Promise<HearingStart> {
    window.bipOye = (text: string) => this.emit('onHear', { text, final: true });
    return { ok: true, reason: '' };
  }

  stopHearing() {
    window.bipOye = undefined;
  }

  setHearingPaused(_paused: boolean) {}

  async playWav(base64: string): Promise<number> {
    this.audio?.pause();
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    this.audio = audio;
    await audio.play().catch(() => undefined);
    return Number.isFinite(audio.duration) ? audio.duration : -1;
  }

  // Cerebro simulado: la "descarga" tarda unos segundos y no baja nada.
  private fakeDownload: ReturnType<typeof setInterval> | null = null;

  modelPath(fileName: string): string | null {
    return this.readText(`modelo-${fileName}`) ? `web://${fileName}` : null;
  }

  freeDiskBytes(): number {
    return 64e9;
  }

  downloadModel(_url: string, fileName: string) {
    if (this.fakeDownload) return;
    const total = 3.11e9;
    let received = 0;
    this.emit('onModel', { state: 'start' });
    this.fakeDownload = setInterval(() => {
      received = Math.min(total, received + total / 12);
      this.emit('onModel', { state: 'progress', received, total });
      if (received >= total) {
        this.cancelModelDownload();
        this.writeText(`modelo-${fileName}`, 'ok');
        this.emit('onModel', { state: 'done', path: `web://${fileName}` });
      }
    }, 500);
  }

  cancelModelDownload() {
    if (this.fakeDownload) clearInterval(this.fakeDownload);
    this.fakeDownload = null;
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
}

export default registerWebModule(BipSensesModule, 'BipSensesModule');
