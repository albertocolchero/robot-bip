// Versión para el navegador (solo para probar la cara en el PC).
let audio: HTMLAudioElement | null = null;
let lastUrl: string | null = null;

export function initAudio() {
  return Promise.resolve();
}

export async function playWav(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'audio/wav' }));
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = url;
  audio?.pause();
  audio = new Audio(url);
  await audio.play().catch(() => undefined);
}
