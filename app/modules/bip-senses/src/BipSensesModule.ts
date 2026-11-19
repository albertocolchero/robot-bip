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
}

export default requireNativeModule<BipSensesModule>('BipSenses');
