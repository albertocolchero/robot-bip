// Prueba de la fase 5: un día entero de Bip con un reloj de mentira, sin hablarle (casi).
// Comprueba que hace al menos 3 cosas con sentido por su cuenta y que respeta las normas:
// nada de iniciativas de noche, ni si hablas por teléfono, ni si estás concentrado, ni si no hay nadie.
// Uso:  npx tsx scripts/simulate-day.ts
import type { EmotionName, FaceEngine } from '../src/face/engine';
import { addDays } from '../src/brain/dates';
import { Life, type MindLike, type Situation } from '../src/brain/life';
import type { Memory } from '../src/brain/memory';

const day = new Date(2026, 10, 20, 7, 0, 0); // viernes 20 de noviembre de 2026, 07:00
let clock = day.getTime();
const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m).getTime();
const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);

// tu día: cuándo estás delante, cuándo hablas por teléfono, cuándo trabajas
const present = (t: number) => (t >= at(8, 30) && t < at(13, 30)) || (t >= at(15) && t < at(20)) || (t >= at(21) && t < at(23, 30));
const onThePhone = (t: number) => t >= at(10) && t < at(10, 15);
const FOCUS_AT = at(16);

const log: { t: number; kind: string; text: string }[] = [];
let sleeping = false;
const engine = {
  busy: false,
  badge: null as string | null,
  night: 0,
  setEmotion: () => undefined,
  burst: () => undefined,
} as unknown as FaceEngine;

const memory: Memory = { name: null, facts: [] };
const mind: MindLike = {
  ready: false,
  thinking: false,
  initiative: async () => null,
  extract: async () => [],
  writeDiary: async () => null,
};

const situation = (): Situation => ({
  now: new Date(clock),
  seesSomeone: present(clock),
  attending: present(clock) && Math.floor(clock / 60_000) % 3 !== 0,
  charging: true,
  dark: false,
});

const life = new Life({
  now: () => clock,
  engine,
  mind,
  memory,
  situation,
  speak: (_e: EmotionName, text: string) => log.push({ t: clock, kind: 'dice', text }),
  mutter: (_e: EmotionName, text: string) => log.push({ t: clock, kind: 'murmura', text }),
  listenFor: () => undefined,
  sleep: (text: string) => {
    sleeping = true;
    log.push({ t: clock, kind: 'se duerme', text });
  },
  wake: (text: string) => {
    sleeping = false;
    log.push({ t: clock, kind: 'se despierta', text });
  },
  sleeping: () => sleeping,
  senses: () => undefined,
});

// lo que le contaste ayer: un plan para hoy y otro para ayer
life.learnedPlan(day, 'tengo dentista a las cinco');
life.learnedPlan(addDays(day, -1), 'tenía un examen');

async function run() {
  let wasPresent = false;
  let lastSeen = 0;
  const initiatives: number[] = [];
  for (clock = day.getTime(); clock < at(23, 59); clock += 20_000) {
    const p = present(clock);
    if (p) {
      const woke = life.sawFace();
      if (!wasPresent && !woke && !sleeping) {
        // así saluda el instinto al verte llegar
        const lines = life.greeting(lastSeen ? clock - lastSeen : 10 * 3_600_000);
        for (const l of lines) log.push({ t: clock, kind: 'saluda', text: l });
        life.touchedTalk();
      }
      lastSeen = clock;
    }
    wasPresent = p;
    if (p && onThePhone(clock)) life.overheard();
    if (clock === FOCUS_AT) {
      const c = life.command('Bip, estoy trabajando');
      log.push({ t: clock, kind: 'tú', text: 'Bip, estoy trabajando' });
      if (c) log.push({ t: clock, kind: 'dice', text: c.lines.join(' ') });
    }
    const before = log.length;
    const r = await life.review(clock, situation());
    life.tick();
    await new Promise<void>((res) => setImmediate(() => res()));
    if (r) initiatives.push(clock);
    // contestas a sus preguntas por la mañana; por la tarde, no (para ver si deja de insistir)
    const q = log.slice(before).find((e) => /\?$/.test(e.text));
    if (q && (clock < at(13) || /llamas/.test(q.text))) {
      clock += 20_000;
      const answer = /llamas/.test(q.text) ? 'Alberto' : 'Pues bien, la verdad';
      const reply = life.answered(answer);
      log.push({ t: clock, kind: 'tú', text: answer });
      if (reply) log.push({ t: clock, kind: 'dice', text: reply });
      life.touchedTalk();
    }
  }

  for (const e of log) console.log(`${hhmm(e.t)}  ${e.kind.padEnd(12)} ${e.text}`);

  const fails: string[] = [];
  const own = log.filter((e) => e.kind === 'dice' && initiatives.includes(e.t));
  if (own.length < 3) fails.push(`solo ${own.length} iniciativas (hacen falta 3)`);
  for (const e of own) {
    if (!present(e.t)) fails.push(`${hhmm(e.t)} habló sin nadie delante`);
    if (e.t >= at(23) || e.t < at(8)) fails.push(`${hhmm(e.t)} habló en horario de silencio`);
    if (e.t >= at(10) && e.t < at(10, 18)) fails.push(`${hhmm(e.t)} interrumpió una llamada`);
    if (e.t >= FOCUS_AT && e.t < FOCUS_AT + 2 * 3_600_000) fails.push(`${hhmm(e.t)} molestó mientras trabajabas`);
  }
  const perHour = new Map<number, number>();
  for (const t of initiatives) perHour.set(new Date(t).getHours(), (perHour.get(new Date(t).getHours()) ?? 0) + 1);
  for (const [h, n] of perHour) if (n > 4) fails.push(`${n} iniciativas a las ${h}h (demasiado pesado)`);
  if (!log.some((e) => /dentista/.test(e.text))) fails.push('no recordó el dentista');
  if (!log.some((e) => /examen/.test(e.text))) fails.push('no preguntó por el examen de ayer');
  if (memory.name !== 'Alberto') fails.push('no aprendió el nombre');

  console.log(`\nIniciativas propias: ${own.length}`);
  console.log(fails.length ? `FALLA:\n - ${fails.join('\n - ')}` : 'OK: todo con sentido y respetando las normas.');
  process.exit(fails.length ? 1 : 0);
}

void run();
