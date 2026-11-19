import BipSenses from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { planSpeech, synthesize, type SpeechPlan } from './droidVoice';
import { playWav } from './player';

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
/** true = sigue escuchando mientras pita (para que puedas interrumpirle). */
let listenWhileSpeaking = false;

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

// ---------------------------------------------------------------- la cola de la voz
// Bip dice las respuestas a trozos (mientras la mente aún escribe), parte las frases largas en líneas y
// a veces reacciona por su cuenta. Antes cada trozo sonaba en cuanto estaba listo y cortaba al anterior:
// los turnos se calculaban con duraciones estimadas y, con el procesador ocupado (el iPhone 14), el
// sonido empezaba más tarde de lo previsto y el trozo siguiente lo pisaba. Ahora van en cola: cada uno
// espera a que el anterior termine de sonar de verdad, y su sonido se prepara mientras suena el anterior.
const GAP_MS = 150; // respiro entre trozo y trozo
let queue: Promise<void> = Promise.resolve();
/** Cambia al cortarle: lo que estaba en cola de antes ya no se dice. */
let generation = 0;
/** Cuándo termina de sonar lo que está sonando (performance.now()). */
let playingUntil = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bip dice una frase: pone la cara, pita y muestra el subtítulo a la vez, cuando acabe lo que esté diciendo.
 *  Mientras habla sigue escuchando (para que le puedas interrumpir); si eso se apaga, deja de
 *  escuchar mientras habla, para no oírse a sí mismo. Devuelve cuántos segundos dura (al empezar a sonar). */
export function speak(engine: FaceEngine, text: string, emo: EmotionName, opts: SpeakOptions = {}): Promise<number> {
  const gen = generation;
  const plan = planSpeech(text, emo);
  const volume = opts.volume ?? 1;
  // el sonido se prepara ya, mientras suena lo anterior
  let wav: Uint8Array | null = null;
  try {
    wav = volume > 0 ? synthesize(plan, emo, volume) : null;
  } catch {
    wav = null; // sin sonido: la cara y el subtítulo siguen funcionando
  }
  let started: (secs: number) => void = () => undefined;
  const result = new Promise<number>((r) => {
    started = r;
  });
  queue = queue
    .then(async () => {
      if (gen !== generation) return started(0);
      const wait = playingUntil - performance.now();
      if (wait > 0) await sleep(wait);
      if (gen !== generation) return started(0);
      const secs = await playNow(engine, text, emo, plan, wav, volume, opts);
      playingUntil = performance.now() + secs * 1000 + GAP_MS;
      started(secs);
    })
    .catch(() => started(0));
  return result;
}

/** Corta lo que está diciendo y todo lo que tenía en cola (cuando le interrumpes). */
export function stopSpeaking() {
  generation++;
  playingUntil = 0;
  queue = Promise.resolve();
  if (typeof BipSenses.stopWav === 'function') BipSenses.stopWav();
}

/** Tira lo que tenía en cola sin cortar la frase que está sonando (le has dicho algo nuevo: lo de antes
 *  ya no viene a cuento, pero cortarle a media palabra queda raro). */
export function dropQueuedSpeech() {
  generation++;
  queue = Promise.resolve();
}

/** ¿Está diciendo algo (o lo tiene en cola)? */
export function isSpeaking() {
  return performance.now() < playingUntil;
}

async function playNow(
  engine: FaceEngine,
  text: string,
  emo: EmotionName,
  plan: SpeechPlan,
  wav: Uint8Array | null,
  volume: number,
  opts: SpeakOptions,
): Promise<number> {
  engine.setEmotion(emo);
  let seconds = plan.dur;
  const pause = volume > 0 && !listenWhileSpeaking;
  if (pause) BipSenses.setHearingPaused(true);
  if (wav) {
    try {
      const d = await playWav(wav);
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
