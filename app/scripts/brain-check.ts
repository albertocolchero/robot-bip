// Comprobaciones rápidas de las piezas de la 1.4 (sin iPhone): npx tsx scripts/brain-check.ts
//  - temporizadores y horas ("avísame en 10 minutos", "a las cinco y media")
//  - nombres ("me llamo Ana", "Ana", pero no "vamos a jugar")
//  - "sí" y "no"
//  - distinguir dos caras de mentira y preguntar a una cara nueva
import { nameFrom } from '../src/brain/memory';
import { People } from '../src/brain/people';
import { parseClock, parseDuration, parseTimer, sayDuration } from '../src/brain/timers';
import { isNo, isYes } from '../src/brain/talk';

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

console.log(fails ? `\n${fails} comprobaciones han fallado.` : '\nTodo bien.');
process.exit(fails ? 1 : 0);
