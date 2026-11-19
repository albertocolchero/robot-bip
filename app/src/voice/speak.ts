import type { EmotionName, FaceEngine } from '../face/engine';
import { planSpeech, synthesize } from './droidVoice';
import { playWav } from './player';

/** Bip dice una frase: pone la cara, pita y muestra el subtítulo a la vez. */
export async function speak(engine: FaceEngine, text: string, emo: EmotionName) {
  engine.setEmotion(emo);
  const plan = planSpeech(text, emo);
  try {
    await playWav(synthesize(plan, emo));
  } catch {
    // si el sonido falla, la cara y el subtítulo siguen funcionando
  }
  const now = performance.now();
  engine.say(text, {
    start: now,
    end: now + plan.dur * 1000,
    sylls: plan.notes.map((n) => ({ t: now + n.t * 1000, d: n.d * 1000, v: n.v })),
  });
}
