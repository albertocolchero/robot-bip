import { NativeModule, requireNativeModule } from 'expo';

import type { BipSensesEvents, HearingStart, PermissionResult } from './BipSenses.types';

declare class BipSensesModule extends NativeModule<BipSensesEvents> {
  requestPermissions(): Promise<PermissionResult>;
  startSeeing(): void;
  stopSeeing(): void;
  setSeeingInterval(seconds: number): void;
  startHearing(locale: string): Promise<HearingStart>;
  stopHearing(): void;
  setHearingPaused(paused: boolean): void;
  /** Reproduce un WAV en base64. Devuelve la duración en segundos (-1 si falla). */
  playWav(base64: string): Promise<number>;
  /** Ruta del modelo si ya está descargado; null si no. */
  modelPath(fileName: string): string | null;
  /** Espacio libre en el iPhone, en bytes (-1 si no se sabe). */
  freeDiskBytes(): number;
  /** Empieza (o continúa) la descarga. El progreso llega por el evento onModel. */
  downloadModel(url: string, fileName: string): void;
  cancelModelDownload(): void;
  deleteModel(fileName: string): void;
  readText(name: string): string | null;
  writeText(name: string, text: string): void;
}

export default requireNativeModule<BipSensesModule>('BipSenses');
