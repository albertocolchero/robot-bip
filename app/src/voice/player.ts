// Reproduce un WAV a través del módulo de sentidos de Bip (en el iPhone usa el altavoz
// configurado para hablar y escuchar a la vez; en el navegador, el reproductor normal).
import BipSenses from '../../modules/bip-senses';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + CHARS[n & 63]);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    parts.push(CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + '==');
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    parts.push(CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + '=');
  }
  return parts.join('');
}

/** Devuelve la duración en segundos (o -1 si no ha sonado). */
export function playWav(bytes: Uint8Array): Promise<number> {
  return BipSenses.playWav(toBase64(bytes));
}
