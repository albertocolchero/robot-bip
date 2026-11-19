// Fase 3: conversación sencilla por reglas. En la fase 4 la sustituirá la mente (Gemma, en el iPhone).
import type { EmotionName } from '../face/engine';

export type Reply = {
  emo: EmotionName;
  text: string;
  action?: 'sleep' | 'wake' | 'love';
  /** Respuesta exacta (hora, fecha): mejor que la de la mente. */
  fast?: boolean;
};

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Minúsculas, sin tildes ni signos. */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Le han llamado por su nombre? (el reconocedor a veces escribe "vip", "pip"...) */
export function mentionsName(text: string) {
  return /\b(bip|vip|pip|beep|bib|bit|biip)\b/.test(normalize(text));
}

const CALL = /^(?:(?:bip|vip|pip|oye|pues|eh|mira|hombre)\s+)+/;

/** ¿Dice que sí? ("sí", "vale", "venga", "claro", "vamos"...) */
export function isYes(raw: string) {
  const t = normalize(raw).replace(CALL, '');
  if (isNo(raw)) return false;
  return /^(si|sii|sip|vale|venga|claro|vamos|dale|ok|okay|okey|por supuesto|me apetece|guay|genial|va|de acuerdo|porfa|por favor|exacto|correcto|eso es|afirmativo|soy yo|el mismo|la misma|yes|bueno vale|pues claro|obvio|sin duda|me parece bien|como no)\b/.test(t);
}

/** ¿Dice que no? */
export function isNo(raw: string) {
  const t = normalize(raw).replace(CALL, '');
  return /^(no|nop|nope|ahora no|luego|despues|mas tarde|otro rato|paso|nah|para nada|que va|negativo|mejor no|no gracias|tampoco)\b/.test(t);
}

function has(t: string, re: RegExp) {
  return re.test(t);
}

function timeOfDayGreeting(now: Date) {
  const h = now.getHours();
  if (h < 6) return '¡Uy, qué tarde! Hola.';
  if (h < 13) return '¡Buenos días!';
  if (h < 21) return '¡Buenas tardes!';
  return '¡Buenas noches!';
}

export function greeting(now: Date, absentMs: number): Reply {
  if (absentMs > 30 * 60_000) return { emo: 'contento', text: `¡Has vuelto! ${timeOfDayGreeting(now)}` };
  return { emo: 'contento', text: timeOfDayGreeting(now) };
}

/** Decide qué contestar. Devuelve null si no sabe qué decir. */
export function understand(raw: string, ctx: { sleeping: boolean; now: Date; seesSomeone: boolean }): Reply | null {
  const t = normalize(raw);
  if (!t) return null;

  if (ctx.sleeping) {
    if (has(t, /\b(despierta|despiertate|arriba|buenos dias|hola)\b/)) {
      return { emo: 'contento', text: '¡Ya estoy despierto!', action: 'wake' };
    }
    return null;
  }

  if (has(t, /\b(buenas noches|a dormir|duermete|vete a dormir|a la cama)\b/)) {
    return { emo: 'sueno', text: 'Buenas noches…', action: 'sleep' };
  }
  if (has(t, /\b(adios|hasta luego|hasta manana|me voy|chao|nos vemos)\b/)) {
    return { emo: 'triste', text: '¡Adiós! Vuelve pronto.' };
  }
  if (has(t, /\b(te quiero|guapo|bonito|precioso|buen chico|eres genial|que mono|me gustas)\b/)) {
    return { emo: 'contento', text: '¡Bip bip! Yo también te quiero.', action: 'love' };
  }
  if (has(t, /\b(gracias)\b/)) {
    return { emo: 'contento', text: '¡De nada!' };
  }
  if (has(t, /\b(como te llamas|quien eres|que eres)\b/)) {
    return { emo: 'contento', text: 'Soy Bip, tu droide de escritorio.' };
  }
  if (has(t, /\b(que hora es|que hora tienes|dime la hora)\b/)) {
    const hh = String(ctx.now.getHours()).padStart(2, '0');
    const mm = String(ctx.now.getMinutes()).padStart(2, '0');
    return { emo: 'pensando', text: `Son las ${hh}:${mm}.`, fast: true };
  }
  if (has(t, /\b(que dia es|a que dia estamos|que fecha)\b/)) {
    const d = ctx.now;
    return { emo: 'pensando', text: `Hoy es ${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}.`, fast: true };
  }
  if (has(t, /\b(como estas|que tal estas|que tal)\b/)) {
    return { emo: 'contento', text: '¡Muy bien! Con ganas de aprender cosas.' };
  }
  if (has(t, /\b(mirame|me ves|donde estoy)\b/)) {
    return ctx.seesSomeone
      ? { emo: 'curioso', text: '¡Te estoy viendo!' }
      : { emo: 'triste', text: 'No te veo… ¿dónde estás?' };
  }
  if (has(t, /\b(chiste|algo gracioso)\b/)) {
    return { emo: 'contento', text: '¿Por qué los robots no se asustan? ¡Tienen nervios de acero!' };
  }
  if (has(t, /\b(hola|buenas|buenos dias|hey|ey|que pasa)\b/)) {
    return { emo: 'contento', text: timeOfDayGreeting(ctx.now) };
  }
  return null;
}
