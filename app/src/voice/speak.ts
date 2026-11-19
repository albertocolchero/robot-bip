import BipSenses from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { planSpeech, synthesize } from './droidVoice';
import { playWav } from './player';

let resumeTimer: ReturnType<typeof setTimeout> | null = null;

export type SpeakOptions = {
  /** false = pita pero sin subtítulo (para ronroneos y sonidos). */
  subtitle?: boolean;
};

/** Bip dice una frase: pone la cara, pita y muestra el subtítulo a la vez.
 *  Mientras habla deja de escuchar, para no oírse a sí mismo. */
export async function speak(engine: FaceEngine, text: string, emo: EmotionName, opts: SpeakOptions = {}) {
  engine.setEmotion(emo);
  const plan = planSpeech(text, emo);
  BipSenses.setHearingPaused(true);
  let seconds = plan.dur;
  try {
    const d = await playWav(synthesize(plan, emo));
    if (d > 0) seconds = d;
  } catch {
    // si el sonido falla, la cara y el subtítulo siguen funcionando
  }
  const now = performance.now();
  engine.say(opts.subtitle === false ? '' : text, {
    start: now,
    end: now + plan.dur * 1000,
    sylls: plan.notes.map((n) => ({ t: now + n.t * 1000, d: n.d * 1000, v: n.v })),
  });
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => BipSenses.setHearingPaused(false), seconds * 1000 + 500);
}
