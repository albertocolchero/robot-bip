// Reproduce un WAV en el iPhone: lo guarda en la caché y lo toca con expo-audio.
// (En el navegador se usa player.web.ts.)
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

let player: AudioPlayer | null = null;
let ready: Promise<void> | null = null;
let n = 0;

/** Que suene aunque el interruptor de silencio del iPhone esté puesto. */
export function initAudio() {
  ready ??= setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  return ready;
}

export async function playWav(bytes: Uint8Array) {
  await initAudio();
  const file = new File(Paths.cache, `bip-voz-${n++ % 4}.wav`);
  file.create({ overwrite: true });
  await file.write(bytes);
  if (!player) player = createAudioPlayer({ uri: file.uri });
  else player.replace({ uri: file.uri });
  player.play();
}
