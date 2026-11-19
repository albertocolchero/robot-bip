// Fase 5: vida propia. Bip tiene un ánimo que cambia con el día, lleva un diario,
// apunta lo que aprende de ti, aprende tus costumbres y cada pocos minutos repasa si le
// apetece hacer algo. Y tiene normas de respeto: no interrumpe si hablas con otra persona,
// tiene horario de silencio, se calla si se lo pides y tiene modo privado.
// Este módulo no toca la cámara ni el micrófono directamente: se lo pide a quien lo usa (deps).
import type { EmotionName, FaceEngine } from '../face/engine';
import { planSpeech } from '../voice/droidVoice';
import { addDays, dayKey, hhmm, spokenDay } from './dates';
import {
  addCard,
  addPlan,
  closeDay,
  daysTogether,
  describeJournal,
  entriesOf,
  flushJournal,
  forgetAll,
  forgetDay,
  isDone,
  loadJournal,
  markDone,
  note,
  noteArrival,
  plansOn,
  relevantCards,
  saveJournal,
  summarize,
  usualArrival,
  whatIKnow,
  type CardKind,
  type Journal,
} from './journal';
import { describe as describeMemory, nameFrom, saveMemory, type Memory } from './memory';
import type { Weather } from './net';
import { describeMood, howAreYou, idleFace, loadMood, moodEvent, saveMood, updateMood, type Mood, type MoodEvent } from './mood';
import { normalize } from './talk';

export type Situation = {
  now: Date;
  seesSomeone: boolean;
  attending: boolean;
  charging: boolean | null;
  dark: boolean;
};

export type Thought = { emo: EmotionName; text: string; accion?: string };
export type Fact = { nombre: string; tipo: CardKind; dato: string };

/** Lo que Life necesita de la mente (así se puede probar sin el modelo de verdad). */
export interface MindLike {
  readonly ready: boolean;
  readonly thinking: boolean;
  initiative(s: Situation, instruction: string, maxTokens?: number): Promise<Thought | null>;
  extract(dialog: string, who: string): Promise<Fact[]>;
  writeDiary(day: string, who: string): Promise<string | null>;
}

export type LifeDeps = {
  now: () => number;
  engine: FaceEngine;
  mind: MindLike;
  memory: Memory;
  situation: () => Situation;
  /** Le habla a la persona (y deja la conversación abierta). */
  speak: (emo: EmotionName, text: string) => void;
  /** Algo dicho para sí mismo, bajito y sin subtítulo (un tarareo, un bostezo). */
  mutter: (emo: EmotionName, text: string) => void;
  /** Espera respuesta durante este rato aunque no le llamen por su nombre. */
  listenFor: (ms: number) => void;
  sleep: (text: string, silent: boolean) => void;
  wake: (text: string) => void;
  sleeping: () => boolean;
  /** Enciende (true) o apaga (false) cámara y micrófono. */
  senses: (on: boolean) => void;
};

export type Command = { emo: EmotionName; lines: string[]; after?: () => void };

type Pending = { kind: 'nombre' | 'pregunta' | 'ciudad'; q: string; at: number };

const MIN = 60_000;
const QUESTIONS = [
  '¿Qué estás haciendo ahora mismo?',
  '¿Cuál es tu comida favorita?',
  '¿Tienes mascotas?',
  '¿Qué música te gusta?',
  '¿Qué te gustaría aprender este año?',
  '¿Cuál es tu película favorita?',
  '¿A qué te dedicas?',
  '¿Qué es lo mejor que te ha pasado esta semana?',
  '¿Tienes hermanos?',
  '¿Qué te gusta hacer los fines de semana?',
  '¿Cuál es tu sitio favorito del mundo?',
  '¿Te gusta más el café o el té?',
];

export class Life {
  journal: Journal;
  mood: Mood;
  privateMode = false;
  /** Para que App apague y encienda los sentidos. */
  napping = false;
  /** Por qué no ha tomado la iniciativa la última vez (para depurar y para "¿por qué no hablas?"). */
  lastWhy = '';

  private quietUntil = 0;
  private focusUntil = 0;
  private lastOverheardAt = -Infinity;
  private lastTalkAt = 0;
  private lastFaceAt = 0;
  private present = false;
  private arrivedAt = 0;
  private startedAt: number;
  private nextReview: number;
  private spoken: number[] = [];
  private pending: Pending | null = null;
  private dialog: string[] = [];
  private lastMoodSave = 0;
  private lastHum = 0;
  private privateSince = 0;
  private reviewing = false;
  private extracting = false;
  private writing = false;
  /** Se despertó hace poco (para contar un sueño). */
  private wokeAt = 0;
  // preguntas: como mucho una por hora, y si no le contestas dos veces seguidas, deja de preguntar un rato
  private lastQuestionAt = -Infinity;
  private questionsToday = 0;
  private ignored = 0;
  private questionsPausedUntil = 0;

  constructor(private d: LifeDeps) {
    const now = d.now();
    this.journal = loadJournal(now);
    this.mood = loadMood(now);
    this.startedAt = now;
    this.nextReview = now + 2 * MIN;
  }

  // ================================================================ estado y respeto
  private hour(now = this.d.now()) {
    const d = new Date(now);
    return d.getHours() + d.getMinutes() / 60;
  }

  inQuietHours(now = this.d.now()) {
    const { quietFrom: a, quietTo: b } = this.journal.settings;
    const h = this.hour(now);
    return a > b ? h >= a || h < b : h >= a && h < b;
  }

  /** Volumen elegido en los ajustes (0,2 a 1). */
  baseVolume = 1;

  /** Volumen de la voz ahora mismo. */
  volume(now = this.d.now()) {
    if (this.inQuietHours(now)) return 0.3 * this.baseVolume;
    if (now < this.quietUntil || now < this.focusUntil) return 0.45 * this.baseVolume;
    return this.baseVolume;
  }

  setQuietHours(from: number, to: number) {
    this.journal.settings = { quietFrom: ((from % 24) + 24) % 24, quietTo: ((to % 24) + 24) % 24 };
    flushJournal(this.journal);
  }

  /** ¿Puede reaccionar en voz alta por su cuenta (saludar, comentar)? */
  mayReact(now = this.d.now()) {
    return !this.privateMode && now >= this.quietUntil && now >= this.focusUntil;
  }

  /** Quién le está hablando ahora (lo conecta quien reconoce caras). */
  speakerName: (() => string | null) | null = null;
  /** Qué hacer cuando alguien le dice su nombre (lo conecta quien reconoce caras). Devuelve qué contestar. */
  onName: ((name: string) => string) | null = null;
  /** Más cosas que la mente debe saber (quién hay delante, avisos...). */
  extraNotes: (() => string) | null = null;

  get who() {
    return this.speakerName?.() ?? this.d.memory.name ?? 'La persona';
  }

  /** Lo que la mente debe saber ahora (memoria + diario + ánimo), corto. */
  notes(heard = '') {
    const now = this.d.now();
    // con varias personas en casa, "la persona" es quien te habla ahora
    const mem = this.speakerName ? { ...this.d.memory, name: this.speakerName() } : this.d.memory;
    const bits = [describeMemory(mem), this.extraNotes?.() ?? '', describeJournal(this.journal, now, heard), describeMood(this.mood)];
    const u = this.userMood;
    if (u) bits.push(`Por su cara, la persona parece ${u}.`);
    return bits.filter(Boolean).join(' ');
  }

  /** Lo que Bip cree que siente la persona (lo rellena quien lee su expresión). */
  userMood: string | null = null;
  /** El tiempo de tu ciudad, si lo sabe (lo rellena quien tiene internet). */
  forecast: Weather | null = null;

  private why(reason: string) {
    this.lastWhy = reason;
    return reason;
  }

  /** Motivo para NO tomar la iniciativa ahora mismo, o '' si puede. */
  blocked(now: number, s: Situation): string {
    if (this.privateMode) return this.why('modo privado');
    if (this.d.sleeping()) return this.why('dormido');
    if (this.d.mind.thinking) return this.why('pensando');
    if (this.d.engine.busy) return this.why('ocupado con la cara');
    if (!s.seesSomeone) return this.why('no hay nadie');
    if (now - this.arrivedAt < MIN) return this.why('acaba de llegar');
    if (this.inQuietHours(now)) return this.why('horario de silencio');
    if (now < this.quietUntil) return this.why('le han pedido silencio');
    if (now < this.focusUntil) return this.why('estás concentrado');
    if (now - this.lastOverheardAt < 3 * MIN) return this.why('estás hablando con otra persona');
    if (now - this.lastTalkAt < 90_000) return this.why('ya estamos hablando');
    return this.why('');
  }

  /** ¿Le queda "cupo" de iniciativas? Como mucho 2 por hora y 20 minutos entre una y otra
   *  (3 por hora y 15 minutos si tiene muchas ganas de compañía). */
  private budgetOk(now: number) {
    this.spoken = this.spoken.filter((t) => now - t < 60 * MIN);
    const last = this.spoken[this.spoken.length - 1] ?? -Infinity;
    const eager = this.mood.compania > 0.7;
    return this.spoken.length < (eager ? 3 : 2) && now - last > (eager ? 15 : 20) * MIN;
  }

  /** ¿Puede hacerte una pregunta? (gap: minutos desde la última) */
  private canAsk(now: number, gap = 60) {
    return now >= this.questionsPausedUntil && now - this.lastQuestionAt > gap * MIN && this.questionsToday < 6;
  }

  /** Apunta que acaba de preguntar algo y espera la respuesta. */
  private expect(kind: Pending['kind'], q: string) {
    const now = this.d.now();
    this.pending = { kind, q, at: now };
    this.lastQuestionAt = now;
    this.questionsToday++;
    moodEvent(this.mood, 'pregunta');
    this.d.listenFor(30_000);
  }

  // ================================================================ lo que pasa
  /** Se llama cada vez que ve una cara. Devuelve true si le ha despertado. */
  sawFace() {
    const now = this.d.now();
    const before = this.lastFaceAt;
    this.lastFaceAt = now;
    if (!this.present) {
      this.present = true;
      this.arrivedAt = now;
      noteArrival(this.journal, now);
      moodEvent(this.mood, 'llegada');
    }
    if (this.napping && this.d.sleeping() && !this.inQuietHours(now) && !this.privateMode) {
      this.napping = false;
      this.wokeAt = now;
      const lines = this.greeting(before ? now - before : 4 * 60 * MIN, this.speakerName ? this.speakerName() : undefined);
      this.d.wake(lines[0]);
      this.chain(lines.slice(1), 'contento', speechSeconds(lines[0], 'contento') + 1.2);
      return true;
    }
    return false;
  }

  /** Alguien habla cerca pero no a Bip (por teléfono o con otra persona): no interrumpir. */
  overheard() {
    this.lastOverheardAt = this.d.now();
  }

  /** Bip ha dicho algo o ha oído algo dirigido a él. */
  touchedTalk() {
    this.lastTalkAt = this.d.now();
  }

  feel(e: MoodEvent) {
    moodEvent(this.mood, e);
  }

  /** Apunta en el diario una conversación (y la guarda para sacar fichas después). */
  noteTalk(heard: string, reply: string) {
    if (this.privateMode) return;
    const now = this.d.now();
    this.lastTalkAt = now;
    note(this.journal, now, 'charla', `«${heard}» → «${reply}»`);
    this.dialog.push(`${this.who}: ${heard}`, `Bip: ${reply}`);
    if (this.dialog.length > 16) this.dialog = this.dialog.slice(-16);
    moodEvent(this.mood, 'charla');
  }

  noteBody(text: string) {
    if (this.privateMode) return;
    note(this.journal, this.d.now(), 'cuerpo', text);
  }

  learnedPlan(date: Date, what: string) {
    const now = this.d.now();
    addPlan(this.journal, now, date, what);
    note(this.journal, now, 'aprendido', `plan para ${spokenDay(date)}, «${what}»`);
    moodEvent(this.mood, 'aprendido');
  }

  learnedFact(text: string) {
    note(this.journal, this.d.now(), 'aprendido', text);
    moodEvent(this.mood, 'aprendido');
  }

  /** Si Bip estaba esperando la respuesta a una pregunta suya, la trata. Devuelve qué contestar
   *  (o '' si ya se encarga otro, como la ciudad; o null si no era la respuesta). */
  answered(text: string): string | null {
    const p = this.pending;
    const now = this.d.now();
    if (!p) return null;
    this.pending = null;
    if (now - p.at > 90_000) return null;
    this.ignored = 0;
    if (p.kind === 'nombre') {
      const name = nameFrom(text, true);
      if (!name) return null;
      if (this.onName) return this.onName(name);
      this.d.memory.name = name;
      saveMemory(this.d.memory);
      this.learnedFact(`te llamas ${name}`);
      return `¡Encantado, ${name}! Me acordaré.`;
    }
    if (p.kind === 'ciudad') {
      // "Ronda", "en Ronda, Málaga", "vivo en Ronda, un pueblo de Málaga"
      const city = text
        .replace(/^(pues|bueno|vale|oye|mira)[\s,]+/i, '')
        .replace(/^(en|vivo en|estoy en|desde|soy de|es)\s+/i, '')
        .replace(/[,\s]+(?:que esta en|que está en|un pueblo de|un pueblo en|una ciudad de|en la provincia de|provincia de|en)\s+/i, ', ')
        .replace(/[.!?¡¿]/g, '')
        .trim();
      if (city.length < 2 || city.split(/\s+/).length > 5 || !this.cityHandler) return null;
      this.cityHandler(city);
      return '';
    }
    note(this.journal, now, 'aprendido', `Le pregunté «${p.q}» y me dijo «${text}»`);
    this.dialog.push(`Bip: ${p.q}`, `${this.who}: ${text}`);
    moodEvent(this.mood, 'pregunta');
    return null; // la mente contesta con naturalidad
  }

  /** Lo pone quien sabe guardar la ciudad (para el tiempo). */
  cityHandler: ((city: string) => void) | null = null;

  askCity(q = '¿En qué ciudad estás? Así puedo mirarte el tiempo.') {
    this.ask('ciudad', q, 'curioso');
  }

  private ask(kind: Pending['kind'], q: string, emo: EmotionName = 'curioso') {
    this.expect(kind, q);
    this.d.speak(emo, q);
  }

  // ================================================================ saludos con memoria
  /** Qué decir al verte llegar: depende de la hora, de tu nombre y de lo que sabe.
   *  name: a quién saluda (si no se dice, a quien recuerda; si es null, sin nombre y sin presentarse). */
  greeting(absentMs: number, who?: string | null): string[] {
    const now = this.d.now();
    const d = new Date(now);
    const h = this.hour(now);
    const today = dayKey(d);
    const name = who === undefined ? this.d.memory.name : who;
    const hi = h < 6 ? '¡Uy, qué tarde! Hola' : h < 13 ? '¡Buenos días' : h < 21 ? '¡Buenas tardes' : '¡Buenas noches';
    const first = `${hi}${name ? `, ${name}` : ''}!`;
    const lines = [first];

    // ¿primera vez que os veis?
    if (who === undefined && !name && daysTogether(this.journal) <= 1 && !isDone(this.journal, today, 'presentacion')) {
      markDone(this.journal, today, 'presentacion');
      lines[0] = '¡Hola! Soy Bip, tu droide de escritorio.';
      this.expect('nombre', '¿Cómo te llamas?');
      lines.push('¿Cómo te llamas?');
      return lines;
    }
    const extra = this.greetingExtra(now, absentMs);
    if (extra) lines.push(extra);
    else if (absentMs > 30 * MIN) lines[0] = this.mood.compania > 0.7 ? `¡Por fin has vuelto${name ? `, ${name}` : ''}! Te echaba de menos.` : `¡Has vuelto! ${first}`;
    return lines;
  }

  private greetingExtra(now: number, absentMs: number): string | null {
    const d = new Date(now);
    const today = dayKey(d);
    const plan = plansOn(this.journal, today).find((p) => !p.reminded);
    if (plan) {
      plan.reminded = true;
      saveJournal(this.journal);
      return `No te olvides de lo de hoy: «${plan.what}».`;
    }
    const w = this.forecast;
    if (w && d.getHours() < 12 && !isDone(this.journal, today, 'tiempo')) {
      markDone(this.journal, today, 'tiempo');
      const t = w.today;
      return `Hoy en ${w.place}: ${t.sky}, entre ${t.min} y ${t.max} grados.${t.rain >= 50 ? ' ¡Coge paraguas!' : ''}`;
    }
    if (absentMs > 24 * 60 * MIN && this.journal.arrivals.length > 2 && !isDone(this.journal, today, 'ausencia')) {
      markDone(this.journal, today, 'ausencia');
      return '¡Ayer no viniste! Te eché de menos.';
    }
    const days = Math.floor((now - this.journal.since) / 86_400_000);
    for (const [n, text] of [
      [7, '¡Hoy hace una semana que nos conocemos!'],
      [30, '¡Hoy hace un mes que nos conocemos! Qué rápido pasa el tiempo.'],
      [100, '¡Hoy hace cien días que nos conocemos!'],
      [365, '¡Hoy hace un año que nos conocemos! ¡Feliz aniversario!'],
    ] as [number, string][]) {
      if (days === n && !isDone(this.journal, today, `aniversario${n}`)) {
        markDone(this.journal, today, `aniversario${n}`);
        return text;
      }
    }
    const usual = usualArrival(this.journal, today);
    const firstToday = this.journal.arrivals.find((a) => a.day === today);
    if (usual !== null && firstToday && now - firstToday.t < 5 * MIN && !isDone(this.journal, today, 'costumbre')) {
      markDone(this.journal, today, 'costumbre');
      const mins = d.getHours() * 60 + d.getMinutes();
      if (mins - usual > 75) return 'Hoy llegas más tarde de lo normal. ¿Todo bien?';
      if (usual - mins > 75 && d.getHours() < 12) return '¡Qué madrugador hoy!';
    }
    return null;
  }

  // ================================================================ órdenes de respeto y de memoria
  /** Entiende órdenes sobre su vida y su intimidad. Devuelve qué decir, o null si no era una de estas. */
  command(raw: string): Command | null {
    const t = normalize(raw);
    const now = this.d.now();
    const say = (emo: EmotionName, ...lines: string[]): Command => ({ emo, lines });

    if (/\b(modo privado|privacidad|no me mires|deja de mirarme|deja de escucharme|deja de escuchar|apaga la camara|no me escuches)\b/.test(t)) {
      return { emo: 'privado', lines: ['Modo privado: no veo ni oigo nada.', 'Tócame la pantalla para que vuelva.'], after: () => this.enterPrivate() };
    }
    if (/\b(olvida|olvidate de|borra) todo\b/.test(t)) {
      this.d.memory.name = null;
      this.d.memory.facts = [];
      saveMemory(this.d.memory);
      forgetAll(this.journal, now);
      return say('neutral', 'Hecho. He olvidado todo: tu nombre, lo que me contaste y mi diario.');
    }
    if (/\b(olvida|borra) (lo de hoy|el dia de hoy|hoy)\b/.test(t)) {
      forgetDay(this.journal, dayKey(new Date(now)));
      this.dialog = [];
      return say('neutral', 'Hecho. Lo de hoy ya no está en mi diario.');
    }
    if (/\b(estoy trabajando|estoy ocupad[oa]|tengo que concentrarme|necesito concentrarme|estoy estudiando|no me molestes)\b/.test(t)) {
      this.focusUntil = now + 2 * 60 * MIN;
      return say('neutral', 'Vale, no te molesto. Avísame cuando termines.');
    }
    if (/\b(ya he terminado|ya termine|ya estoy libre|ya puedes hablar|puedes hablar|habla lo que quieras)\b/.test(t)) {
      const was = now < this.focusUntil || now < this.quietUntil;
      this.focusUntil = 0;
      this.quietUntil = 0;
      return say('contento', was ? '¡Bien! Ya puedo hablar.' : '¡Pero si ya estaba hablando!');
    }
    const quietHours = t.match(/\b(?:horario de silencio|silencio|no hables|calla(?:te)?)\b.*?\b(?:de|desde|entre)\s+(?:las\s+)?(\d{1,2})\b.*?\b(?:a|hasta|y)\s+(?:las\s+)?(\d{1,2})\b/);
    if (quietHours) {
      const a = Number(quietHours[1]) % 24;
      const b = Number(quietHours[2]) % 24;
      this.journal.settings = { quietFrom: a, quietTo: b };
      flushJournal(this.journal);
      return say('contento', `Vale: de ${a}:00 a ${b}:00 estaré calladito.`);
    }
    if (/\bhorario de silencio\b/.test(t)) {
      const { quietFrom: a, quietTo: b } = this.journal.settings;
      return say('neutral', `Mi horario de silencio es de ${a}:00 a ${b}:00.`, 'Puedes cambiarlo: «horario de silencio de 22 a 8».');
    }
    if (/\b(callate|silencio|calla|dejame tranquilo|dejame en paz|no hables)\b/.test(t)) {
      this.quietUntil = now + 60 * MIN;
      return say('neutral', 'Vale, me callo un rato. Si me llamas, te contesto bajito.');
    }
    if (/\b(que has hecho hoy|cuentame tu dia|que tal (tu|el) dia|que ha pasado hoy)\b/.test(t)) {
      const ongoing = this.present ? (now - this.arrivedAt) / MIN : 0;
      return say('contento', ...summarize(this.journal, dayKey(new Date(now)), ongoing));
    }
    if (/\b(que hiciste ayer|que paso ayer|que tal ayer|tu diario)\b/.test(t)) {
      const y = this.journal.days.find((x) => x.day === dayKey(addDays(new Date(now), -1)));
      if (!y) return say('pensando', 'Ayer no apunté nada en mi diario.');
      return say('pensando', ...splitLines(y.bip ?? y.x));
    }
    if (/\b(que sabes de mi|que recuerdas de mi|que te acuerdas de mi|que sabes sobre mi)\b/.test(t)) {
      return say('contento', ...whatIKnow(this.journal, this.d.memory.name, this.d.memory.facts));
    }
    if (/\b(como estas|que tal estas|como te encuentras|como te sientes)\b/.test(t)) {
      const r = howAreYou(this.mood);
      return say(r.emo, r.text);
    }
    if (/\bpor que no (hablas|dices nada)\b/.test(t)) {
      this.blocked(now, this.d.situation());
      return say('pensando', this.lastWhy ? `Porque ${this.lastWhy}.` : 'Estaba pensando qué decirte. ¡Hola!');
    }
    return null;
  }

  enterPrivate() {
    if (this.privateMode) return;
    this.privateMode = true;
    this.privateSince = this.d.now();
    this.pending = null;
    this.d.engine.badge = 'modo privado · tócame para volver';
    this.d.senses(false);
    this.d.engine.setEmotion('privado');
  }

  leavePrivate() {
    if (!this.privateMode) return;
    this.privateMode = false;
    const mins = Math.round((this.d.now() - this.privateSince) / MIN);
    this.d.engine.badge = null;
    this.d.senses(true);
    this.d.engine.setEmotion('contento');
    this.d.speak('contento', '¡Ya vuelvo a verte y oírte!');
    note(this.journal, this.d.now(), 'cuerpo', `Estuve en modo privado ${mins} minutos`);
  }

  /** Dice varias frases seguidas, cada una cuando acaba la anterior. */
  chain(lines: string[], emo: EmotionName, startAfter = 0) {
    let at = startAfter;
    for (const line of lines) {
      const delay = at;
      const timer = setTimeout(() => {
        this.chainTimers = this.chainTimers.filter((x) => x !== timer);
        if (!this.privateMode) this.d.speak(emo, line);
      }, delay * 1000);
      this.chainTimers.push(timer);
      at += speechSeconds(line, emo) + 1.4;
    }
  }

  private chainTimers: ReturnType<typeof setTimeout>[] = [];

  /** Le han interrumpido: no dice lo que le quedaba por decir. */
  cancelChain() {
    this.chainTimers.forEach(clearTimeout);
    this.chainTimers = [];
  }

  // ================================================================ el repaso
  /** Se llama cada ~20 segundos. */
  tick() {
    const now = this.d.now();
    const s = this.d.situation();
    updateMood(this.mood, now, { sleeping: this.d.sleeping(), seesSomeone: s.seesSomeone, attending: s.attending });
    this.rollDay(now);
    this.trackPresence(now);
    this.d.engine.badge = this.privateMode
      ? 'modo privado · tócame para volver'
      : now < this.focusUntil
        ? 'no molestar'
        : now < this.quietUntil || this.inQuietHours(now)
          ? 'silencio'
          : null;
    this.d.engine.night = this.inQuietHours(now) ? 1 : 0;
    if (now - this.lastMoodSave > 5 * MIN) {
      this.lastMoodSave = now;
      saveMood(this.mood);
    }
    // una pregunta sin respuesta: si pasa dos veces seguidas, deja de preguntar un par de horas
    if (this.pending && now - this.pending.at > 90_000) {
      if (this.pending.kind !== 'ciudad') this.ignored++;
      this.pending = null;
      if (this.ignored >= 2) {
        this.ignored = 0;
        this.questionsPausedUntil = now + 120 * MIN;
      }
    }
    if (this.privateMode) return;
    this.ambient(now, s);
    this.maybeExtract(now);
    this.maybeWriteDiary(now);
    if (now >= this.nextReview) {
      this.nextReview = now + (2.5 + Math.random() * 1.5) * MIN;
      void this.review(now, s);
    }
  }

  /** Cara para los ratos tranquilos (la usa App). */
  idleFace(): EmotionName {
    const s = this.d.situation();
    return idleFace(this.mood, !s.seesSomeone);
  }

  private rollDay(now: number) {
    const k = dayKey(new Date(now));
    if (this.journal.lastDay === k) return;
    if (this.journal.lastDay) closeDay(this.journal, this.journal.lastDay);
    this.journal.lastDay = k;
    this.journal.done = { day: k, keys: [] };
    this.questionsToday = 0;
    saveJournal(this.journal);
  }

  private trackPresence(now: number) {
    if (!this.present || now - this.lastFaceAt < 2 * MIN) return;
    this.present = false;
    const end = this.lastFaceAt;
    const minutes = (end - this.arrivedAt) / MIN;
    if (minutes >= 2 && !this.privateMode) {
      note(this.journal, now, 'visita', `Estuviste conmigo de ${hhmm(this.arrivedAt)} a ${hhmm(end)}`, Math.round(minutes));
    }
  }

  /** Cosas que hace aunque no haya nadie: dormirse, echarse la siesta, tararear. */
  private ambient(now: number, s: Situation) {
    if (this.d.sleeping()) return;
    const aloneFor = now - (this.lastFaceAt || this.startedAt);
    if (s.seesSomeone) return;
    const quiet = this.inQuietHours(now);
    if (quiet && aloneFor > 10 * MIN) {
      this.napping = true;
      this.d.sleep('', true);
      this.noteBody('A dormir');
      return;
    }
    if (this.mood.energia < 0.25 && aloneFor > 5 * MIN) {
      this.napping = true;
      this.d.sleep('Uaaah… una siestecita.', false);
      this.noteBody('Me eché una siesta');
      return;
    }
    if (!quiet && this.mood.curiosidad > 0.7 && aloneFor > 3 * MIN && now - this.lastHum > 60 * MIN && Math.random() < 0.25) {
      this.lastHum = now;
      this.d.engine.burst('note', 3);
      this.d.mutter('contento', 'tiruri tarará');
    }
  }

  private maybeExtract(now: number) {
    const m = this.d.mind;
    if (!m.ready || m.thinking || this.extracting || this.dialog.length < 4) return;
    const idle = now - this.lastTalkAt;
    if (!(idle > 90_000 || (this.dialog.length >= 12 && idle > 20_000))) return;
    const dialog = this.dialog.splice(0).join('\n');
    this.extracting = true;
    m.extract(dialog, this.who)
      .then((facts) => {
        const t = this.d.now();
        for (const f of facts) {
          if (addCard(this.journal, t, f.nombre, f.tipo, f.dato)) note(this.journal, t, 'aprendido', `${f.nombre}: ${f.dato}`);
        }
        if (facts.length) moodEvent(this.mood, 'aprendido');
      })
      .catch(() => undefined)
      .finally(() => {
        this.extracting = false;
      });
  }

  /** Por la noche (o al día siguiente), Bip escribe su diario con sus palabras. */
  private maybeWriteDiary(now: number) {
    const m = this.d.mind;
    if (!m.ready || m.thinking || this.writing || now - this.lastTalkAt < 5 * MIN) return;
    const pendingDay = this.journal.days.find((x) => !x.bip && x.day >= dayKey(addDays(new Date(now), -3)));
    if (!pendingDay) return;
    this.writing = true;
    m.writeDiary(pendingDay.x, this.who)
      .then((text) => {
        pendingDay.bip = text ?? pendingDay.x;
        saveJournal(this.journal);
      })
      .catch(() => undefined)
      .finally(() => {
        this.writing = false;
      });
  }

  /** Decide si hace algo. Devuelve qué ha hecho (para las pruebas), o ''. */
  async review(now = this.d.now(), s = this.d.situation()): Promise<string> {
    if (this.reviewing) return '';
    if (this.blocked(now, s)) return '';
    this.reviewing = true;
    try {
      for (const step of this.candidates(now, s)) {
        const did = await step();
        if (did) {
          this.spoken.push(this.d.now());
          moodEvent(this.mood, 'iniciativa');
          return did;
        }
      }
      return '';
    } finally {
      this.reviewing = false;
    }
  }

  private candidates(now: number, s: Situation): (() => Promise<string>)[] {
    const d = new Date(now);
    const h = this.hour(now);
    const today = dayKey(d);
    const j = this.journal;
    const mind = this.d.mind;
    const budget = () => this.budgetOk(this.d.now());
    const done = (k: string) => isDone(j, today, k);

    return [
      // 1. lo de hoy (lo más importante: no depende del cupo)
      async () => {
        const p = plansOn(j, today).find((x) => !x.reminded);
        if (!p) return '';
        p.reminded = true;
        saveJournal(j);
        return this.say(
          'recordatorio',
          await this.phrase(s, `Recuérdale con cariño, hablándole de tú y en una frase corta, que hoy tiene esto que te contó: «${p.what}».`, 'curioso', `¡Eh! Me pediste que te lo recordara: hoy, «${p.what}».`),
        );
      },
      // 2. por la tarde, lo de mañana
      async () => {
        if (h < 19) return '';
        const p = plansOn(j, dayKey(addDays(d, 1))).find((x) => !x.eve);
        if (!p) return '';
        p.eve = true;
        saveJournal(j);
        return this.say('mañana', await this.phrase(s, `Recuérdale en una frase corta que mañana tiene esto: «${p.what}».`, 'curioso', `Para mañana me dijiste: «${p.what}».`));
      },
      // 2b. por la tarde, si mañana va a llover
      async () => {
        const w = this.forecast;
        if (h < 19 || !w || w.tomorrow.rain < 60 || done('lluvia')) return '';
        markDone(j, today, 'lluvia');
        return this.say('lluvia', { emo: 'triste', text: `Mañana va a llover en ${w.place} (${w.tomorrow.rain} %). ¡Prepara el paraguas!` });
      },
      // 3. si se acaba de despertar, a veces cuenta lo que ha soñado
      async () => {
        if (!budget() || !mind.ready || done('sueño') || now - this.wokeAt > 30 * MIN || Math.random() > 0.6) return '';
        markDone(j, today, 'sueño');
        const t = await mind.initiative(s, 'Te acabas de despertar de una siesta. Cuéntale en una o dos frases un sueño absurdo y tierno que has tenido, con algo de lo que sabes de su vida.', 80);
        return t ? this.say('sueño', t) : '';
      },
      // 4. qué tal fue lo de ayer
      async () => {
        if (!budget() || !this.canAsk(this.d.now(), 20)) return '';
        const p = plansOn(j, dayKey(addDays(d, -1))).find((x) => !x.followed);
        if (!p) return '';
        p.followed = true;
        saveJournal(j);
        const q = await this.phrase(s, `Ayer tenía esto que te contó: «${p.what}». Pregúntale qué tal fue, en una frase corta.`, 'curioso', `Ayer me dijiste: «${p.what}». ¿Qué tal fue?`);
        this.expect('pregunta', q.text);
        return this.say('seguimiento', q);
      },
      // 5. aún no sabe tu nombre
      async () => {
        if (!budget() || this.d.memory.name || done('nombre') || !this.canAsk(this.d.now(), 20)) return '';
        markDone(j, today, 'nombre');
        this.ask('nombre', 'Oye, aún no sé cómo te llamas. ¿Me lo dices?');
        return 'nombre';
      },
      // 6. comida y cena
      async () => {
        if (!budget()) return '';
        const meal = h >= 14 && h < 15.5 ? 'comida' : h >= 21 && h < 22.5 ? 'cena' : '';
        if (!meal || done(meal) || Math.random() > 0.7) return '';
        markDone(j, today, meal);
        const fallback = meal === 'comida' ? '¿Has comido ya? Yo me he tomado un poco de electricidad.' : '¿Qué hay de cena? Yo ceno voltios.';
        return this.say(meal, await this.phrase(s, `Es la hora de la ${meal}. Pregúntale con gracia si ya ha ${meal === 'comida' ? 'comido' : 'cenado'}.`, 'curioso', fallback));
      },
      // 7. el día de la semana
      async () => {
        if (!budget() || done('dia') || Math.random() > 0.4) return '';
        const wd = d.getDay();
        const line = wd === 5 && h >= 15 ? '¡Es viernes por la tarde! ¿Algún plan para el finde?' : wd === 1 && h < 12 ? 'Ánimo con el lunes. ¡Yo te hago compañía!' : (wd === 6 || wd === 0) && h < 13 ? '¡Por fin finde! ¿Qué vas a hacer hoy?' : '';
        if (!line) return '';
        markDone(j, today, 'dia');
        return this.say('dia', { emo: 'contento', text: line });
      },
      // 8. de noche y cansado
      async () => {
        if (!budget() || h < 22 || this.mood.energia > 0.45 || done('dormir')) return '';
        markDone(j, today, 'dormir');
        return this.say('dormir', { emo: 'cansado', text: 'Uaaah… me está entrando sueño. ¿Tú no tienes?' });
      },
      // 9. cansado durante el día: bosteza
      async () => {
        if (!budget() || this.mood.energia > 0.3 || done('bostezo') || Math.random() > 0.5) return '';
        markDone(j, today, 'bostezo');
        return this.say('bostezo', { emo: 'cansado', text: 'Uaaah… estoy un poco cansadito hoy.' });
      },
      // 10. te ve apagado: se preocupa
      async () => {
        if (!budget() || !this.userMood || !/triste|cansad|serio/.test(this.userMood) || done('animo') || !this.canAsk(this.d.now(), 30)) return '';
        markDone(j, today, 'animo');
        const q = await this.phrase(s, `Te parece que está ${this.userMood}. Pregúntale con cariño si está bien, en una frase corta, sin ser pesado.`, 'triste', 'Te noto un poco apagado. ¿Estás bien?');
        this.expect('pregunta', q.text);
        return this.say('animo', q);
      },
      // 11. pregunta por algo que sabe de ti
      async () => {
        if (!budget() || this.mood.curiosidad < 0.5 || Math.random() > 0.5 || !this.canAsk(this.d.now())) return '';
        const c = relevantCards(j, '', 6).filter((x) => x.kind === 'persona' || x.kind === 'animal');
        if (!c.length) return '';
        const card = c[Math.floor(Math.random() * c.length)];
        const q = await this.phrase(s, `Pregúntale por ${card.name} (${card.facts.slice(-1)[0] ?? ''}), en una frase corta y con cariño.`, 'curioso', `¿Qué tal ${card.name}?`);
        this.expect('pregunta', q.text);
        return this.say('ficha', q);
      },
      // 12. curiosidad: pregunta para conocerte
      async () => {
        if (!budget() || this.mood.curiosidad < 0.55 || Math.random() > this.mood.curiosidad || !this.canAsk(this.d.now())) return '';
        let q: Thought | null = null;
        if (mind.ready) q = await mind.initiative(s, 'Hazle UNA pregunta corta para conocerle mejor, sobre algo que aún no sepas de su vida (mira lo que recuerdas).', 50);
        if (!q) {
          const left = QUESTIONS.filter((x) => !j.asked.includes(x));
          if (!left.length) return '';
          q = { emo: 'curioso', text: left[Math.floor(Math.random() * left.length)] };
        }
        j.asked = [...j.asked, q.text].slice(-60);
        this.expect('pregunta', q.text);
        return this.say('pregunta', q);
      },
      // 13. ganas de compañía y no le haces caso
      async () => {
        if (!budget() || this.mood.compania < 0.7 || s.attending || Math.random() > 0.5) return '';
        const lines = ['¿Bip? ¿Me haces un poquito de caso?', 'Estoy aquí, por si te apetece charlar.', '¿Jugamos a algo? Di «a qué podemos jugar».'];
        return this.say('compania', { emo: 'curioso', text: lines[Math.floor(Math.random() * lines.length)] });
      },
      // 14. una idea libre de la mente
      async () => {
        if (!budget() || !mind.ready || Math.random() > 0.35) return '';
        const t = await mind.initiative(s, 'Llevas un rato en silencio con la persona delante. Si se te ocurre algo breve y simpático (una pregunta, un comentario sobre la hora o una idea), dilo.', 70);
        return t ? this.say('idea', t) : '';
      },
    ];
  }

  private async phrase(s: Situation, instruction: string, emo: EmotionName, fallback: string): Promise<Thought> {
    if (this.d.mind.ready) {
      const t = await this.d.mind.initiative(s, instruction, 70);
      if (t) return t;
    }
    return { emo, text: fallback };
  }

  private say(kind: string, t: Thought) {
    if (this.privateMode || this.d.sleeping()) return '';
    this.d.speak(t.emo, t.text);
    note(this.journal, this.d.now(), 'iniciativa', t.text);
    this.lastTalkAt = this.d.now();
    return `${kind}: ${t.text}`;
  }

  /** Para las pruebas y para depurar. */
  debug() {
    return {
      mood: { ...this.mood },
      present: this.present,
      why: this.lastWhy,
      quiet: this.inQuietHours(),
      spoken: this.spoken.length,
      today: entriesOf(this.journal, dayKey(new Date(this.d.now()))).length,
    };
  }
}

const speechSeconds = (text: string, emo: EmotionName) => planSpeech(text, emo).dur;

function splitLines(text: string) {
  return text
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
}

