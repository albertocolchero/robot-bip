// Comprobaciones rápidas de las piezas de la 1.4 (sin iPhone): npx tsx scripts/brain-check.ts
//  - temporizadores y horas ("avísame en 10 minutos", "a las cinco y media")
//  - nombres ("me llamo Ana", "Ana", pero no "vamos a jugar")
//  - "sí" y "no"
//  - distinguir dos caras de mentira y preguntar a una cara nueva
import { nameFrom } from '../src/brain/memory';
import { People } from '../src/brain/people';
import { parseClock, parseDuration, parseTimer, sayDuration } from '../src/brain/timers';
import { isNo, isYes } from '../src/brain/talk';
import { StreamSpeech, partialField, speakableEnd } from '../src/brain/streamSpeech';
import { asksToPlay, offersToPlay } from '../src/brain/games';
import { weatherQuestion } from '../src/brain/net';
import { cleanUrl, looksLikeHome, rephrase } from '../src/brain/home';
import { normalize } from '../src/brain/talk';
import { cleanWhisper } from '../src/brain/whisperText';

let fails = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'OK ' : 'MAL'}  ${what}: ${JSON.stringify(got)}${ok ? '' : `  (esperaba ${JSON.stringify(want)})`}`);
}

// ---------------------------------------------------------------- tiempo
const now = new Date(2026, 10, 20, 15, 10, 0); // viernes 20 de noviembre, 15:10
const min = (ms: number | null) => (ms === null ? null : Math.round(ms / 60_000));
check('10 minutos', min(parseDuration('avísame en 10 minutos')), 10);
check('media hora', min(parseDuration('pon un temporizador de media hora')), 30);
check('una hora y media', min(parseDuration('dentro de una hora y media')), 90);
check('un cuarto de hora', min(parseDuration('en un cuarto de hora')), 15);
check('veinticinco minutos', min(parseDuration('avísame en veinticinco minutos')), 25);
const hm = (d: Date | null) => (d ? `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null);
check('a las cinco (tarde)', hm(parseClock('recuérdame a las cinco', now)), '20 17:00');
check('a las 17:30', hm(parseClock('avísame a las 17:30', now)), '20 17:30');
check('a las ocho y media de la mañana', hm(parseClock('despiértame a las ocho y media de la mañana', now)), '21 8:30');
check('mañana a las diez', hm(parseClock('recuérdame mañana a las diez que tengo dentista', now)), '21 10:00');
check('a la una menos cuarto', hm(parseClock('avísame a la una menos cuarto', now)), '21 0:45');
check('para las ocho', hm(parseClock('pon una alarma para las ocho', now)), '20 20:00');
const t1 = parseTimer('Bip, avísame en 10 minutos para sacar la pizza', now);
check('temporizador con motivo', t1 && { kind: t1.kind, min: min(t1.at - now.getTime()), label: t1.label }, { kind: 'temporizador', min: 10, label: 'sacar la pizza' });
const t2 = parseTimer('recuérdame a las cinco que llame a mi madre', now);
check('aviso con motivo', t2 && { kind: t2.kind, label: t2.label }, { kind: 'aviso', label: 'llame a mi madre' });
const t3 = parseTimer('pon una alarma para las ocho', now);
check('alarma sin motivo', t3 && { kind: t3.kind, label: t3.label }, { kind: 'aviso', label: '' });
check('recuérdame mañana (es un plan, no un aviso)', parseTimer('recuérdame mañana que tengo dentista', now), null);
check('frase normal', parseTimer('qué tal estás', now), null);
check('decir la duración', sayDuration(4 * 60_000 + 10_000), '4 minutos y 10 segundos');

// ---------------------------------------------------------------- nombres
check('me llamo Ana', nameFrom('me llamo Ana'), 'Ana');
check('solo «Ana» (tras preguntar)', nameFrom('Ana', true), 'Ana');
check('«Ana García»', nameFrom('Ana García', true), 'Ana García');
check('«soy Ana, encantada»', nameFrom('soy Ana, encantada', true), 'Ana');
check('«vamos a jugar» no es un nombre', nameFrom('vamos a jugar', true), null);
check('«claro» no es un nombre', nameFrom('claro', true), null);
check('«sí» no es un nombre', nameFrom('sí', true), null);
check('«qué hora es» no es un nombre', nameFrom('qué hora es', true), null);

// ---------------------------------------------------------------- sí y no
for (const s of ['sí', 'Sí, vale', 'venga', 'claro', 'Bip, sí', 'vale, vamos', 'sí, soy yo']) check(`«${s}» es sí`, isYes(s), true);
for (const s of ['no', 'ahora no', 'luego', 'no, gracias', 'que va']) check(`«${s}» es no`, isNo(s), true);
check('«no» no es sí', isYes('no'), false);
check('«si no te importa» no es no', isNo('si no te importa'), false);

// ---------------------------------------------------------------- caras
function fakePrint(who: string) {
  let seed = 0;
  for (const c of who) seed = (seed * 31 + c.charCodeAt(0)) % 9973;
  const v: number[] = [];
  for (let i = 0; i < 64; i++) {
    const base = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    v.push(base - Math.floor(base) + (Math.random() - 0.5) * 0.08);
  }
  return v;
}
let clock = 1_000_000;
const people = new People(null, () => clock);
people.forgetAll();
/** Alguien se pone delante unos segundos. Devuelve lo que Bip decide. */
function show(who: string, seconds = 4) {
  const events: string[] = [];
  for (let s = 0; s < seconds * 8; s++) {
    clock += 125;
    const fp = s % 10 === 0 ? fakePrint(who) : undefined;
    for (const e of people.feed([{ x: 0.5, y: 0.5, size: 0.3, confidence: 1, yaw: 0, fp }], undefined, clock)) {
      events.push(e.kind === 'conocido' || e.kind === 'duda' ? `${e.kind}:${e.person.name}` : e.kind);
    }
  }
  clock += 5000; // se va
  people.feed([], undefined, clock);
  return events;
}
check('cara nueva → pregunta', show('A'), ['nuevo']);
people.confirm(lastTrack(), 'Luis');
function lastTrack() {
  return people.speakerTrack();
}
// confirm necesita la cara delante: repetimos
let ev = show('A');
check('Luis vuelve (aún no está seguro: pregunta «¿eres Luis?»)', ev.length === 1 && (ev[0] === 'duda:Luis' || ev[0] === 'conocido:Luis'), true);
// lo confirma mientras está delante
function showAndConfirm(who: string, name: string) {
  const events: string[] = [];
  for (let s = 0; s < 32; s++) {
    clock += 125;
    const fp = s % 10 === 0 ? fakePrint(who) : undefined;
    for (const e of people.feed([{ x: 0.5, y: 0.5, size: 0.3, confidence: 1, yaw: 0, fp }], undefined, clock)) {
      events.push(e.kind === 'conocido' || e.kind === 'duda' ? `${e.kind}:${e.person.name}` : e.kind);
    }
    if (s === 31) people.confirm(people.speakerTrack(), name);
  }
  clock += 5000;
  people.feed([], undefined, clock);
  return events;
}
showAndConfirm('A', 'Luis');
showAndConfirm('A', 'Luis');
ev = show('A');
check('Luis, ya seguro', ev, ['conocido:Luis']);
ev = show('B');
check('otra persona (Ana) → no la confunde con Luis', ev.includes('conocido:Luis'), false);
showAndConfirm('B', 'Ana');
showAndConfirm('B', 'Ana');
showAndConfirm('B', 'Ana');
check('Ana, ya seguro', show('B'), ['conocido:Ana']);
check('y Luis sigue siendo Luis', show('A'), ['conocido:Luis']);
check('nombres que conoce', people.names(), ['Luis', 'Ana']);
// el perro
let dogEvents: string[] = [];
for (let s = 0; s < 40; s++) {
  clock += 125;
  dogEvents = dogEvents.concat(people.feedAnimals([{ kind: 'perro', x: 0.4, y: 0.7, size: 0.3, confidence: 0.9 }], clock).map((e) => (e.kind === 'mascota' ? `${e.animal}:${e.pet?.name ?? '?'}` : e.kind)));
}
check('ve un perro que no conoce', dogEvents, ['perro:?']);
people.namePet('perro', 'Toby');
clock += 21 * 60_000;
dogEvents = [];
for (let s = 0; s < 40; s++) {
  clock += 125;
  dogEvents = dogEvents.concat(people.feedAnimals([{ kind: 'perro', x: 0.4, y: 0.7, size: 0.3, confidence: 0.9 }], clock).map((e) => (e.kind === 'mascota' ? `${e.animal}:${e.pet?.name ?? '?'}` : e.kind)));
}
check('y luego lo saluda por su nombre', dogEvents, ['perro:Toby']);
people.forgetAll();

// ---------------------------------------------------------------- dos personas a la vez (Luis y Ana)
{
  // huellas parecidas entre sí (dos personas de casa, misma luz): la base común pesa más que lo propio
  const base = fakePrint('casa');
  const mix = (who: string, k = 0.45) => {
    const own = fakePrint(who);
    return base.map((b, i) => b * (1 - k) + own[i] * k);
  };
  /** Varias caras delante a la vez durante unos segundos. pos: dónde está cada una (0 izquierda, 1 derecha). */
  function showMany(people_: { who: string; x: number; size?: number }[], seconds = 5, onStep?: (s: number) => void) {
    const events: string[] = [];
    for (let s = 0; s < seconds * 8; s++) {
      clock += 125;
      const faces = people_.map((p) => ({ x: p.x, y: 0.5, size: p.size ?? 0.3, confidence: 1, yaw: 0, fp: s % 10 === 0 ? mix(p.who) : undefined }));
      for (const e of people.feed(faces, undefined, clock)) {
        events.push(e.kind === 'conocido' || e.kind === 'duda' ? `${e.kind}:${e.person.name}${e.kind === 'conocido' && e.late ? ' (tarde)' : ''}` : e.kind);
      }
      onStep?.(s);
    }
    return events;
  }
  const leave = () => {
    clock += 5000;
    people.feed([], undefined, clock);
  };
  // cada uno se presenta solo, un par de veces
  for (const [who, name] of [
    ['luis', 'Luis'],
    ['ana', 'Ana'],
  ]) {
    for (let k = 0; k < 3; k++) {
      showMany([{ who, x: 0.5 }], 4, (s) => s === 31 && people.confirm(people.speakerTrack(), name));
      leave();
    }
  }
  check('Luis solo: le reconoce', showMany([{ who: 'luis', x: 0.5 }], 4), ['conocido:Luis']);
  leave();
  check('Ana sola: la reconoce', showMany([{ who: 'ana', x: 0.5 }], 4), ['conocido:Ana']);
  leave();
  const both = showMany([
    { who: 'luis', x: 0.3, size: 0.32 },
    { who: 'ana', x: 0.7 },
  ]).sort();
  check('los dos a la vez: a cada uno por su nombre, sin repetir', both, ['conocido:Ana', 'conocido:Luis']);
  check('y sabe que están los dos', people.present().map((p) => p.name).sort(), ['Ana', 'Luis']);
  // os cruzáis: cada uno pasa al sitio del otro de golpe (las caras "cambian de hueco")
  const crossed = showMany([
    { who: 'ana', x: 0.32, size: 0.32 },
    { who: 'luis', x: 0.68 },
  ]);
  check('tras cruzaros, no saluda otra vez', crossed.filter((e) => !e.endsWith('(tarde)')), []);
  check('y quien está más cerca (Ana) es quien le habla', people.speaker()?.name ?? null, 'Ana');
  leave();
  check('Luis sigue siendo Luis (no se le ha pegado la cara de Ana)', showMany([{ who: 'luis', x: 0.5 }], 4), ['conocido:Luis']);
  leave();
  people.forgetAll();
}
check('«es que no lo sé» no es un nombre', nameFrom('es que no lo sé', true), null);
check('«se llama Ana»', nameFrom('se llama Ana', true), 'Ana');

// ---------------------------------------------------------------- hablar a trozos (modo rápido)
check('campo a medias', partialField('{"emocion":"feliz","frase":"Hola, qu', 'frase'), { value: 'Hola, qu', done: false });
check('campo cerrado', partialField('{"emocion":"feliz","frase":"¡Hola!"}', 'frase'), { value: '¡Hola!', done: true });
check('comillas escapadas', partialField('{"frase":"Dijo \\"sí\\" y', 'frase'), { value: 'Dijo "sí" y', done: false });
check('emoción aún sin cerrar', partialField('{"emocion":"fel', 'emocion'), { value: 'fel', done: false });
check('empieza tras «¡Hola!»', speakableEnd('¡Hola! Me alegra', false, true), 7);
check('coge todas las frases completas de una vez', speakableEnd('¡Hola! Me alegra verte. Hoy', false, false), 24);
check('al empezar, vale una coma tras unas palabras', speakableEnd('Pues mira lo que te digo, la Luna', false, true) > 0, true);
check('en medio, una coma no basta: espera', speakableEnd('Pues mira lo que te digo, la Luna', false, false), -1);
check('frase sin terminar: espera', speakableEnd('Hoy hace un día', false, true), -1);
{
  const said: string[] = [];
  let fake = 0;
  const s = new StreamSpeech((_e, text) => said.push(text), () => 1, () => fake);
  const full = '¡Claro que sí! La Luna está a unos 384.000 kilómetros de la Tierra.';
  for (let i = 1; i <= full.length; i++) s.feed({ part: 0, emo: 'contento', text: full.slice(0, i), done: i === full.length });
  check('empieza a hablar con el primer trozo', said[0], '¡Claro que sí!');
  fake = 99_999; // ya ha acabado de decir el primer trozo
  check('dice todo, sin repetir', s.finish('contento', full), true);
  check('el resto, de una vez (no a trocitos)', said, ['¡Claro que sí!', 'La Luna está a unos 384.000 kilómetros de la Tierra.']);
}
{
  const said: string[] = [];
  let fake = 0;
  const s = new StreamSpeech((_e, text) => said.push(text), () => 0, () => fake);
  s.feed({ part: 0, emo: 'pensando', text: 'Déjame que lo busque.', done: true });
  fake = 10_000; // la búsqueda tarda: cuando llega la respuesta, ya ha terminado la frase anterior
  s.finish('contento', 'Es Ariana Grande, una cantante.');
  check('tras «déjame que lo busque», dice la respuesta entera', said, ['Déjame que lo busque.', 'Es Ariana Grande, una cantante.']);
}

// ---------------------------------------------------------------- jugar solo si se lo pides
for (const s of ['vamos a jugar', '¿jugamos?', 'a qué podemos jugar', 'quiero jugar a las adivinanzas', 'Bip, juegos', 'echamos una partida']) {
  check(`«${s}» es querer jugar`, asksToPlay(normalize(s)), true);
}
for (const s of ['el Betis jugó fatal ayer', 'mi sobrino tiene un juego nuevo', 'qué jugador es el mejor', 'esto es un juego de niños', 'juego al pádel los martes']) {
  check(`«${s}» no es querer jugar`, asksToPlay(normalize(s)), false);
}
check('«¿Jugamos a algo?» es proponer', offersToPlay(normalize('¿Jugamos a algo? Di «a qué podemos jugar».')), true);
check('«¿Qué juego te gusta?» no es proponer', offersToPlay(normalize('¿Qué juego te gusta más?')), false);

// ---------------------------------------------------------------- el tiempo
check('¿qué tiempo hace?', weatherQuestion('¿Qué tiempo hace?'), { when: 'hoy', place: null });
check('el tiempo que hace en mi pueblo', weatherQuestion('dime el tiempo que hace en mi pueblo'), { when: 'hoy', place: null });
check('temperatura en Ronda', weatherQuestion('¿Qué temperatura hace en Ronda?'), { when: 'hoy', place: 'Ronda' });
check('en Ronda, Málaga', weatherQuestion('qué tiempo hace en Ronda, Málaga'), { when: 'hoy', place: 'Ronda, Málaga' });
check('mañana en Sevilla', weatherQuestion('¿Va a llover mañana en Sevilla?'), { when: 'mañana', place: 'Sevilla' });
check('en Ronda mañana', weatherQuestion('qué tiempo hará en Ronda mañana'), { when: 'mañana', place: 'Ronda' });
check('¿hace frío en la calle?', weatherQuestion('¿Hace frío en la calle?'), { when: 'hoy', place: null });
check('¿cuántos grados hace?', weatherQuestion('¿A cuántos grados estamos? ¿Cuántos grados hace?'), { when: 'hoy', place: null });
check('un tiempo de perros (no es un sitio)', weatherQuestion('qué tiempo hace hoy, un tiempo de perros'), { when: 'hoy', place: null });
check('«no tengo tiempo» no es el tiempo', weatherQuestion('no tengo tiempo para eso'), null);

// ---------------------------------------------------------------- la casa (Home Assistant)
for (const s of ['enciende la tele', 'pon a limpiar el robot', 'apaga todas las luces', '¿está encendida la tele?', 'sube el volumen de la tele']) {
  check(`«${s}» es de la casa`, looksLikeHome(normalize(s)), true);
}
for (const s of ['el Betis jugó fatal', 'pon música', 'qué tiempo hace', 'para, para', 'cuéntame un chiste']) {
  check(`«${s}» no es de la casa`, looksLikeHome(normalize(s)), false);
}
check('«pon a limpiar el robot» → inicia el robot', rephrase(normalize('pon a limpiar el robot')), 'inicia el robot');
check('«que limpie la aspiradora» → inicia el robot', rephrase(normalize('que limpie la aspiradora')), 'inicia el robot');
check('«para el robot» → a la base', rephrase(normalize('para el robot')), 'manda el robot a la base');
check('«pon el robot a cargar» → a la base', rephrase(normalize('pon el robot a cargar')), 'manda el robot a la base');
check('«apaga la tele» no se toca', rephrase(normalize('apaga la tele')), null);
check('dirección sin http', cleanUrl('homeassistant.local:8123/'), 'http://homeassistant.local:8123');

// ---------------------------------------------------------------- oído Whisper: limpiar lo que escribe
check('frase normal', cleanWhisper(' ¿Qué hora es? '), '¿Qué hora es?');
check('sin [Música]', cleanWhisper('[Música] Hola, Bip.'), 'Hola, Bip.');
check('solo ruido', cleanWhisper('[Música]'), '');
check('coletilla de Amara', cleanWhisper('Subtítulos realizados por la comunidad de Amara.org'), '');
check('coletilla de YouTube', cleanWhisper('¡Gracias por ver el vídeo!'), '');
check('repite la pista', cleanWhisper('Hola, Bip. ¿Qué tal estás? Hablamos en castellano.'), '');
check('solo puntos', cleanWhisper('...'), '');

console.log(fails ? `\n${fails} comprobaciones han fallado.` : '\nTodo bien.');
process.exit(fails ? 1 : 0);
