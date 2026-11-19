import BipSenses from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { planSpeech, synthesize } from './droidVoice';
import { playWav } from './player';

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
/** true = sigue escuchando mientras pita (para que puedas interrumpirle). */
let listenWhileSpeaking = true;

export function setListenWhileSpeaking(on: boolean) {
  listenWhileSpeaking = on;
  if (on) BipSenses.setHearingPaused(false);
}

export type SpeakOptions = {
  /** false = pita pero sin subtítulo (para ronroneos y sonidos). */
  subtitle?: boolean;
  /** 1 normal; más bajo de noche o si le han pedido silencio; 0 = solo subtítulo, sin sonido. */
  volume?: number;
};

/** Bip dice una frase: pone la cara, pita y muestra el subtítulo a la vez.
 *  Mientras habla sigue escuchando (para que le puedas interrumpir); si eso se apaga, deja de
 *  escuchar mientras habla, para no oírse a sí mismo. Devuelve cuántos segundos dura. */
export async function speak(engine: FaceEngine, text: string, emo: EmotionName, opts: SpeakOptions = {}): Promise<number> {
  engine.setEmotion(emo);
  const plan = planSpeech(text, emo);
  const volume = opts.volume ?? 1;
  let seconds = plan.dur;
  const pause = volume > 0 && !listenWhileSpeaking;
  if (pause) BipSenses.setHearingPaused(true);
  if (volume > 0) {
    try {
      const d = await playWav(synthesize(plan, emo, volume));
      if (d > 0) seconds = d;
    } catch {
      // si el sonido falla, la cara y el subtítulo siguen funcionando
    }
  }
  const now = performance.now();
  engine.say(opts.subtitle === false ? '' : text, {
    start: now,
    end: now + plan.dur * 1000,
    sylls: plan.notes.map((n) => ({ t: now + n.t * 1000, d: n.d * 1000, v: n.v })),
  });
  if (pause) {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => BipSenses.setHearingPaused(false), seconds * 1000 + 500);
  }
  return seconds;
}

/** Cuánto tardará en decir una frase (para encadenar varias). */
export function speechSeconds(text: string, emo: EmotionName) {
  return planSpeech(text, emo).dur;
}
