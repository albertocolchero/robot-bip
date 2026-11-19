// Lo del oído Whisper que no depende del iPhone (así se puede probar en el ordenador).

export const WHISPER_FILE = 'ggml-small-q5_1.bin';
export const WHISPER_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin';
export const WHISPER_MB = 190;

/** Una pista para Whisper: que es castellano de charla y que el robot se llama Bip. */
export const WHISPER_PROMPT = 'Hola, Bip. ¿Qué tal estás? Hablamos en castellano.';

// Whisper aprendió con subtítulos de vídeos, y con ruido o silencio a veces se inventa sus coletillas
const INVENTED =
  /(amara\.org|subt[ií]tulos? (?:realizados|por|hechos)|suscr[ií]bete|gracias por ver|no olvides suscribirte|dale (?:a )?like|nos vemos en el pr[oó]ximo|hasta el pr[oó]ximo v[ií]deo|www\.|\.com\b)/i;

/** Lo que devuelve Whisper, limpio: sin [Música], (risas) ni frases inventadas. '' si no queda nada. */
export function cleanWhisper(raw: string): string {
  const t = raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || INVENTED.test(t)) return '';
  if (!/[a-záéíóúüñ0-9]/i.test(t)) return '';
  // repetir la pista que se le dio es otro invento típico
  if (/^hola,? bip\.? ¿?qu[eé] tal est[aá]s\??\.? hablamos en castellano\.?$/i.test(t)) return '';
  return t;
}
