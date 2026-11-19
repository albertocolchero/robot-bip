// El instinto: recibe lo que notan los sentidos y decide qué hacer.
//  - Fase 2: reflejos (seguirte con la mirada, saludar, asustarse, ronronear, dormirse a oscuras).
//  - Fase 3: cuándo contestar a lo que oye.
//  - Fase 4: pasa la conversación a la mente.
//  - Fase 5: vida propia (ánimo, diario, iniciativa, respeto), juegos, internet, y reflejos con
//    tu cara (te devuelve la sonrisa, bosteza contigo), tus manos (saludos, pulgar arriba) y
//    los sonidos (palmadas, música).
//  - 1.4: sabe quién eres (y quién es tu perro), entiende "sí" a lo que propone, pone
//    temporizadores, y distingue cuándo le hablas a él y cuándo a otra persona.
import BipSenses, { type HearEvent, type SeeEvent, type SeenFace, type SoundEvent } from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { saveTheme, themeCommand } from '../face/theme';
import { speechSeconds } from '../voice/speak';
import { dayKey, hhmm, spokenDay } from './dates';
import { GAME_LIST, Games, type GameName } from './games';
import { Life } from './life';
import { learn, nameFrom, saveMemory, type Memory } from './memory';
import type { Mind, Situation } from './mind';
import { geocode, headlines, sayWeather, search, tidy, weather, type Place, type Weather } from './net';
import { People, type Person, type WhoEvent } from './people';
import { Perception, type PerceptionEvent } from './perception';
import { readJSON, writeJSON } from './store';
import { isNo, isYes, mentionsName, normalize, understand } from './talk';
import { clockText, parseTimer, sayDuration, Timers, type Timer } from './timers';

export type Say = (emo: EmotionName, text: string, opts?: { subtitle?: boolean; volume?: number }) => void;
export type Buzz = (kind: 'tick' | 'soft' | 'strong') => void;

export type InstinctDeps = {
  engine: FaceEngine;
  say: Say;
  buzz: Buzz;
  mind: Mind;
  memory: Memory;
  /** Un tono puro (juegos, temporizadores). */
  tone: (freq: number, ms: number) => void;
  /** Enciende o apaga cámara y micrófono (modo privado). */
  senses: (on: boolean) => void;
  /** Ancho de la pantalla en unidades lógicas. */
  width: () => number;
};

// Ajustes (se pueden afinar con una actualización por internet, sin compilar)
const GAZE_X = 24; // cuánto giran los ojos hacia los lados
const GAZE_Y = 12; // y hacia arriba y abajo
const FLIP_X = 1; // pon -1 si los ojos miran al lado contrario
const FLIP_Y = 1;
const LOOKING_YAW = 0.4; // radianes: menos que esto = te está mirando
const DARK = -2.0; // brillo por debajo = oscuro
const BRIGHT = 0.0; // brillo por encima = hay luz
const DARK_SECONDS = 12;
const GREET_AFTER_MS = 90_000; // vuelve a saludar si llevabas este rato sin aparecer
const SHAKE = 3.0; // m/s² de aceleración para asustarse
const CONVERSATION_MS = 7_000; // tras contestar, lo siguiente que oiga en este rato se toma como respuesta
const ASKED_MS = 15_000; // y si lo que dijo era una pregunta, un poco más
const OFFER_MS = 40_000; // cuánto recuerda que te ha propuesto jugar
const ASK_MS = 40_000; // cuánto espera a que le digas tu nombre
const WHO_GAP_MS = 3 * 60_000; // como mucho una pregunta de "¿quién eres?" cada 3 minutos
const RING_MS = 25_000; // cuánto suena un temporizador si nadie lo para
const FACE_FILE = 'face_landmarker.task';
const FACE_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const PLACE_FILE = 'lugar.json';

/** Parte un texto largo en trozos que caben en el subtítulo (dos líneas). */
export function chunks(text: string, max = 105): string[] {
  if (text.length <= max) return [text];
  const sentences = text.replace(/([.!?…])\s+/g, '$1|').split('|');
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (piece.length > max) {
      // una frase muy larga: se corta por comas o espacios
      if (cur) out.push(cur);
      cur = '';
      let rest = piece;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(', ', max);
        if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
        if (cut < 1) cut = max;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
      }
      cur = rest;
    } else if ((cur ? cur.length + 1 : 0) + piece.length <= max) {
      cur = cur ? `${cur} ${piece}` : piece;
    } else {
      out.push(cur);
      cur = piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function largest(faces: SeenFace[]) {
  let best: SeenFace | null = null;
  for (const f of faces) if (!best || f.size > best.size) best = f;
  return best;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** "Luis", "Luis y Ana", "Luis, Ana y Toby" */
function joinNames(names: string[]) {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** El nombre de una mascota: "se llama Toby", "Toby", "le llamamos Toby". */
function petNameFrom(text: string) {
  const m = text.match(/\b(?:se llama|le llamamos|le llaman|le decimos|su nombre es|es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
  return nameFrom(m ? m[1] : text, true);
}

function cap(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

type Asking =
  | { kind: 'nombre'; track: number | null; at: number }
  | { kind: 'eres'; track: number | null; person: Person; other?: Person; at: number }
  | { kind: 'mascota'; animal: 'perro' | 'gato'; at: number };

type Ringing = { tones: number[]; speakAt: number; lines: string[]; until: number };

export class Instinct {
  readonly life: Life;
  readonly games: Games;
  readonly perception: Perception;
  readonly people: People;
  readonly timers = new Timers();
  /** Abre el panel de ajustes (lo conecta App). */
  onSettings: (() => void) | null = null;
  /** El panel de ajustes está abierto: no pregunta nombres ni toma la iniciativa. */
  uiOpen = false;

  private engine: FaceEngine;
  private mind: Mind;
  private memory: Memory;
  private buzz: Buzz;
  private lastFaceAt = 0;
  private lastGreetAt = 0;
  private looking = false;
  private lookingSince = 0;
  private darkSince = 0;
  private brightSince = 0;
  private asleepByDark = false;
  private lastStartle = 0;
  private shakes: number[] = [];
  private battery: number | null = null;
  private caresses = 0;
  private lastTouch = 0;
  private lastReplyAt = 0;
  private listenUntil = 0;
  private lastWordsAt = 0;
  private dancing = false;
  private readerState: 'nada' | 'descargando' | 'cargando' | 'listo' | 'error' = 'nada';
  private place: Place | null = readJSON<Place>(PLACE_FILE);
  private forecast: Weather | null = null;
  private forecastAt = 0;
  private sayRaw: Say;
  /** Acaba de llegar alguien: le saluda en cuanto sepa quién es (o a los 5 segundos, sin nombre). */
  private arrival: { at: number; absent: number; faceAt?: number } | null = null;
  /** Lo que Bip acaba de preguntar sobre quién eres. */
  private asking: Asking | null = null;
  private askedWhoAt = -Infinity;
  private whoIgnored = 0;
  private whoPausedUntil = 0;
  /** Bip acaba de proponer jugar. */
  private offer: { at: number; game: GameName | null } | null = null;
  /** La última pregunta que ha hecho Bip (para entender un "sí" o un "no"). */
  private lastQuestion: { text: string; at: number } | null = null;
  private ringing: Ringing | null = null;
  private missed: Timer[] = [];
  lastLight: number | null = null;

  constructor(private d: InstinctDeps) {
    this.engine = d.engine;
    this.mind = d.mind;
    this.memory = d.memory;
    this.buzz = d.buzz;
    this.sayRaw = d.say;
    this.people = new People(d.memory.name);

    this.life = new Life({
      now: () => Date.now(),
      engine: d.engine,
      mind: d.mind,
      memory: d.memory,
      situation: () => this.situation(),
      speak: (emo, text) => this.answer(emo, text),
      mutter: (emo, text) => this.say(emo, text, { subtitle: false, volume: Math.min(0.35, this.life.volume()) }),
      listenFor: (ms) => this.listenFor(ms),
      sleep: (text, silent) => this.sleep(text, silent),
      wake: (text) => this.wake(text),
      sleeping: () => this.sleeping,
      senses: d.senses,
    });
    this.life.cityHandler = (city) => void this.setCity(city);
    this.life.speakerName = () => this.speakerName();
    this.life.onName = (name) => this.named(name, this.people.speakerTrack());
    this.life.extraNotes = () => [this.people.describe(), this.timersNote()].filter(Boolean).join(' ');

    this.perception = new Perception((e) => this.onPerceive(e));
    this.games = new Games({
      engine: d.engine,
      perception: this.perception,
      speak: (emo, text) => this.answer(emo, text),
      chain: (lines, emo) => this.answerLines(emo, lines),
      tone: d.tone,
      listenFor: (ms) => this.listenFor(ms),
      fastVision: (on) => BipSenses.setFastVision(on),
      now: () => performance.now(),
      width: d.width,
    });

    // la mente sabe lo que sabe la vida propia, y puede buscar en internet
    this.mind.notes = (heard) => this.life.notes(heard);
    this.mind.whoName = () => this.speakerName();
    this.mind.lookup = (q) => search(q);
    this.mind.onSearching = (q) => {
      this.engine.setEmotion('pensando', 30_000);
      this.engine.say(`Buscando «${q}» en internet…`, null);
    };
    BipSenses.addListener('onModel', (e) => {
      if (e.file !== FACE_FILE) return;
      if (e.state === 'done' && e.path) void this.loadReader(e.path);
      if (e.state === 'error') this.readerState = 'error';
    });
  }

  // ================================================================ hablar
  /** Habla con el volumen que toque (bajito de noche) y apunta que ha hablado. */
  private say: Say = (emo, text, opts) => {
    this.life?.touchedTalk();
    if (opts?.subtitle !== false) this.noticeOwnWords(text);
    this.sayRaw(emo, text, { volume: this.life ? this.life.volume() : 1, ...opts });
  };

  /** Para hablar desde fuera (los toques en la pantalla): así recuerda lo que ha propuesto. */
  speakTo(emo: EmotionName, text: string) {
    this.answer(emo, text);
  }

  /** Se fija en lo que él mismo dice: si pregunta algo (o propone jugar), espera la respuesta. */
  private noticeOwnWords(text: string) {
    if (!text.includes('?')) return;
    const now = performance.now();
    this.lastQuestion = { text, at: now };
    const t = normalize(text);
    if (!this.games?.playing && /\b(jugamos|jugar|juego|juegos|juguemos|partida|revancha)\b/.test(t)) {
      const named = GAME_LIST.find((g) => g.re.test(t))?.name ?? null;
      this.offer = { at: now, game: named ?? (/\b(otra|revancha)\b/.test(t) ? this.games.lastGame : null) };
    }
  }

  private answer(emo: EmotionName, text: string) {
    // si no cabe en dos líneas de subtítulo, lo dice en trozos
    const parts = chunks(text);
    if (parts.length > 1) {
      this.answerLines(emo, parts);
      return;
    }
    this.markGreeted();
    this.lastReplyAt = performance.now();
    this.say(emo, text);
    this.openConversation([text], emo);
  }

  /** Varias frases, una detrás de otra. */
  private answerLines(emo: EmotionName, raw: string[]) {
    const lines = raw.flatMap((l) => chunks(l));
    if (!lines.length) return;
    this.markGreeted();
    this.lastReplyAt = performance.now();
    this.say(emo, lines[0]);
    this.life.chain(lines.slice(1), emo, speechSeconds(lines[0], emo) + 1.4);
    for (const l of lines.slice(1)) this.noticeOwnWords(l);
    this.openConversation(lines, emo);
  }

  /** Tras hablar, lo siguiente que oiga en un ratito se toma como respuesta (más rato si ha preguntado). */
  private openConversation(lines: string[], emo: EmotionName) {
    const total = lines.reduce((a, l) => a + speechSeconds(l, emo) + 1.4, 0);
    const asked = lines[lines.length - 1].includes('?');
    this.listenFor(total * 1000 + (asked ? ASKED_MS : CONVERSATION_MS));
  }

  private listenFor(ms: number) {
    this.listenUntil = Math.max(this.listenUntil, performance.now() + ms);
  }

  situation(): Situation {
    return {
      now: new Date(),
      seesSomeone: this.seesSomeone,
      attending: this.attending,
      charging: this.battery === null ? null : this.battery === 2 || this.battery === 3,
      dark: this.lastLight !== null && this.lastLight < DARK,
    };
  }

  get sleeping() {
    return this.engine.emotion === 'sueno';
  }

  /** ¿Hay alguien mirando a Bip ahora mismo? */
  get attending() {
    return this.looking && performance.now() - this.lastFaceAt < 2000;
  }

  get seesSomeone() {
    return performance.now() - this.lastFaceAt < 2000;
  }

  /** Quién le habla: la cara más cercana si la reconoce; si solo conoce a una persona y no hay nadie más, esa. */
  speakerName(): string | null {
    const sp = this.people.speaker();
    if (sp?.name) return sp.name;
    const named = this.people.humans.filter((p) => p.name);
    if (named.length === 1 && this.people.faceCount() <= 1) return named[0].name;
    return named.length ? null : this.memory.name;
  }

  /** Al tocar la pantalla el iPhone se mueve un poco: eso no debe asustarle. */
  touched() {
    this.lastTouch = performance.now();
  }

  markGreeted() {
    this.lastGreetAt = performance.now();
  }

  sleep(text = 'Buenas noches…', silent = false) {
    this.games.stop();
    this.dancing = false;
    if (silent) {
      this.engine.setEmotion('sueno');
    } else {
      this.say('sueno', text);
    }
    BipSenses.setSeeingInterval(1);
    this.life.noteBody('Me dormí');
  }

  wake(text = '¡Ya estoy despierto!') {
    this.asleepByDark = false;
    this.life.napping = false;
    BipSenses.setSeeingInterval(0.125);
    this.say('contento', text);
  }

  /** Cara para los ratos tranquilos (o null si ahora no toca cambiarla). */
  idleFace(): EmotionName | null {
    if (this.games.playing || this.life.privateMode || this.sleeping || this.engine.busy || this.ringing || this.uiOpen) return null;
    if (this.dancing) return Math.random() < 0.6 ? 'feliz' : 'contento';
    return this.life.idleFace();
  }

  /** Un toque en la pantalla (x, y en unidades lógicas). true si lo ha usado. */
  onTap(x: number, y: number) {
    if (this.ringing) {
      this.stopRinging();
      return true;
    }
    if (this.life.privateMode) {
      this.life.leavePrivate();
      return true;
    }
    if (this.games.playing) return this.games.touch(x, y);
    return false;
  }

  // ================================================================ ojos
  onSee(e: SeeEvent) {
    const now = performance.now();
    const faces = e.faces ?? [];
    const face = largest(faces);
    const gameGaze = this.games.active?.name === 'simon' || this.games.active?.name === 'numero';
    if (face) this.life.sawFace(); // puede despertarle de la siesta
    if (face && this.sleeping) {
      this.lastFaceAt = now; // dormido no te sigue con los ojos
      this.engine.clearGaze();
    } else if (face) {
      if (!gameGaze) {
        const gx = FLIP_X * (face.x - 0.5) * 2 * GAZE_X;
        const gy = FLIP_Y * (face.y - 0.5) * 2 * GAZE_Y;
        this.engine.setGaze(Math.max(-GAZE_X, Math.min(GAZE_X, gx)), Math.max(-GAZE_Y, Math.min(GAZE_Y, gy)));
      }
      const looking = Math.abs(face.yaw ?? 0) < LOOKING_YAW;
      if (looking && !this.looking) this.lookingSince = now;
      this.looking = looking;
      const absent = this.lastFaceAt ? now - this.lastFaceAt : Infinity;
      this.lastFaceAt = now;
      if (!this.games.playing && absent > GREET_AFTER_MS && now - this.lastGreetAt > GREET_AFTER_MS && this.life.mayReact()) {
        this.arrival = { at: now, absent };
      }
    } else if (now - this.lastFaceAt > 1500) {
      if (!gameGaze) this.engine.clearGaze();
      this.looking = false;
    }

    // ¿quién es? (personas y mascotas)
    if (!this.life.privateMode && !this.uiOpen) {
      const who = [...this.people.feed(faces, e.geo), ...this.people.feedAnimals(e.animals)];
      if (!this.sleeping && who.length) this.onWho(who, now);
    }
    // ha llegado alguien pero no ha podido saber quién es (lleva 4 segundos y medio delante): saluda igual
    if (face && this.arrival && !this.arrival.faceAt && !this.uiOpen) this.arrival.faceAt = now;
    const a0 = this.arrival;
    if (a0 && !this.uiOpen && ((a0.faceAt && now - a0.faceAt > 4500) || (!a0.faceAt && now - a0.at > 8000))) {
      this.arrival = null;
      if (!this.sleeping && !this.games.playing && this.life.mayReact()) this.greet(a0.absent, this.speakerName());
    }

    if (e.expr) {
      this.perception.feedExpr(e.expr, now);
      this.life.userMood = this.perception.userMood();
    }
    this.perception.feedHand(e.hand, now);
    if (this.games.playing) this.games.see();
    if (typeof e.light === 'number') this.onLight(e.light, now);
  }

  openSettings() {
    this.uiOpen = true;
    this.onSettings?.();
  }

  /** Se cierra el panel de ajustes. La primera vez, después se presenta. */
  settingsClosed(first: boolean) {
    this.uiOpen = false;
    if (first) {
      this.answer('feliz', '¡Me encanta cómo he quedado!');
      this.startGreeting();
    } else {
      if (this.arrival) this.arrival = { ...this.arrival, at: performance.now(), faceAt: undefined };
      this.answer('feliz', '¡Listo! ¿Qué tal estoy?');
    }
  }

  /** Al abrir la app: saluda en cuanto sepa quién tiene delante (o a los pocos segundos, sin nombre). */
  startGreeting() {
    const at = performance.now();
    this.arrival = { at, absent: Infinity };
    setTimeout(() => {
      // sin cámara no llegan fotogramas: saluda igual
      if (this.arrival?.at !== at || this.arrival.faceAt || this.uiOpen) return;
      this.arrival = null;
      if (!this.sleeping && !this.life.privateMode) this.greet(Infinity, this.speakerName());
    }, 8500);
  }

  private greet(absent: number, name: string | null) {
    this.markGreeted();
    this.answerLines('contento', this.life.greeting(absent === Infinity ? 0 : absent, name));
  }

  private mayAskWho(now: number) {
    return now - this.askedWhoAt > WHO_GAP_MS && now >= this.whoPausedUntil && !this.asking;
  }

  /** Ha reconocido (o no) a alguien. */
  private onWho(events: WhoEvent[], now: number) {
    const free = !this.games.playing && this.life.mayReact() && !this.ringing;
    for (const ev of events) if (ev.kind === 'mascota') this.onPet(ev.animal, ev.pet, now);
    if (!free) return;

    // personas que reconoce
    const known = events.filter((e): e is Extract<WhoEvent, { kind: 'conocido' }> => e.kind === 'conocido' && !!e.person.name);
    if (known.length) {
      const names = known.map((e) => e.person.name as string);
      if (this.arrival) {
        const a = this.arrival;
        this.arrival = null;
        this.engine.hop(-0.6);
        this.greet(a.absent, joinNames(names));
      } else {
        const back = known.filter((e) => e.absentMs > GREET_AFTER_MS).map((e) => e.person.name as string);
        if (back.length && now - this.lastGreetAt > 20_000) {
          this.engine.hop(-0.6);
          this.answer('contento', `¡Hola, ${joinNames(back)}!`);
        }
      }
    }
    if (!this.mayAskWho(now)) return;

    // le suena, pero no está seguro
    const doubt = events.find((e): e is Extract<WhoEvent, { kind: 'duda' }> => e.kind === 'duda' && !!e.person.name);
    if (doubt) {
      const hi = this.arrival ? '¡Hola! ' : '';
      this.arrival = null;
      this.askedWhoAt = now;
      this.asking = { kind: 'eres', track: doubt.track, person: doubt.person, other: doubt.other?.name ? doubt.other : undefined, at: now };
      const q = doubt.other?.name ? `¿Eres ${doubt.person.name} o ${doubt.other.name}?` : `¿Eres ${doubt.person.name}?`;
      this.engine.setEmotion('curioso', 2500);
      this.answer('curioso', `${hi}${q}`);
      return;
    }
    // no le conoce de nada
    const fresh = events.find((e) => e.kind === 'nuevo');
    if (fresh && fresh.kind === 'nuevo') {
      const first = !this.people.humans.some((p) => p.name);
      this.arrival = null;
      this.askedWhoAt = now;
      this.asking = { kind: 'nombre', track: fresh.track, at: now };
      if (first) this.answerLines('contento', ['¡Hola! Soy Bip, tu droide de escritorio.', '¿Cómo te llamas?']);
      else this.answer('curioso', '¡Hola! Creo que no nos conocemos. ¿Cómo te llamas?');
    }
  }

  /** Ve a tu perro (o a tu gato). */
  private onPet(animal: 'perro' | 'gato', pet: Person | null, now: number) {
    if (this.games.playing || !this.life.mayReact() || this.ringing) return;
    this.engine.burst('heart', 5);
    this.engine.setEmotion('enamorado', 2600);
    this.engine.hop(-0.8);
    this.buzz('soft');
    if (pet?.name) {
      const n = pet.name;
      const lines =
        animal === 'perro'
          ? [`¡Hola, ${n}! ¿Quién es un perro bueno?`, `¡${n}! ¡Hola, bonito!`, `¡Mira quién está aquí! ¡Hola, ${n}!`, `¡${n}, ${n}! ¿Me traes la pelota?`]
          : [`¡Hola, ${n}! Miau.`, `¡${n}! ¡Qué gato tan bonito!`, `¡Mira quién está aquí! ¡Hola, ${n}!`];
      this.say('enamorado', pick(lines)); // al perro no se le espera respuesta
    } else if (!this.asking) {
      this.asking = { kind: 'mascota', animal, at: now };
      this.answer('emocionado', animal === 'perro' ? '¡Anda, un perrito! ¿Cómo se llama?' : '¡Anda, un gatito! ¿Cómo se llama?');
    }
  }

  /** Ya sabe cómo se llama la cara `track`. Devuelve qué contestar. */
  private named(name: string, track: number | null): string {
    const existed = !!this.people.byName(name);
    const p = this.people.confirm(track, name);
    if (!this.memory.name) {
      this.memory.name = p.name;
      saveMemory(this.memory);
    }
    this.whoIgnored = 0;
    this.askedWhoAt = -Infinity; // le ha contestado: si llega otra persona, puede preguntarle ya
    this.life.learnedFact(`${p.name} me dijo su nombre`);
    this.markGreeted();
    if (track === null) return `¡${existed ? 'Hola' : 'Encantado'}, ${p.name}! Ponte delante de mí para que me quede con tu cara.`;
    return existed ? `¡Ah, eres ${p.name}! Perdona, aún me estoy aprendiendo vuestras caras.` : `¡Encantado, ${p.name}! Ya me quedo con tu cara.`;
  }

  private onLight(light: number, now: number) {
    this.lastLight = light;
    if (light < DARK) {
      this.brightSince = 0;
      if (!this.darkSince) this.darkSince = now;
      if (!this.sleeping && !this.games.playing && !this.ringing && now - this.darkSince > DARK_SECONDS * 1000) {
        this.asleepByDark = true;
        this.sleep('Qué oscuro… a dormir.', this.life.inQuietHours());
      }
    } else if (light > BRIGHT) {
      this.darkSince = 0;
      if (!this.brightSince) this.brightSince = now;
      if (this.asleepByDark && this.sleeping && now - this.brightSince > 2500 && !this.life.inQuietHours()) {
        this.wake('¡Ya hay luz! Buenos días.');
      }
    }
  }

  // ================================================================ lo que nota de ti (cara, manos, sonidos)
  private onPerceive(ev: PerceptionEvent) {
    if (this.life.privateMode) return;
    if (ev.kind === 'musica') {
      this.dancing = ev.on && !this.sleeping;
      if (ev.on && this.life.mayReact() && !this.games.playing) {
        this.engine.burst('note', 4);
        this.engine.setEmotion('feliz', 2500);
      }
      return;
    }
    if (ev.kind === 'palmada') {
      if (this.games.playing) return;
      if (this.sleeping && !this.life.inQuietHours()) {
        this.wake('¡Uy! ¿Qué ha sido eso?');
        return;
      }
      if (!this.sleeping && !this.engine.busy) {
        this.buzz('soft');
        this.engine.setEmotion('sorprendido', 1200);
      }
      return;
    }
    if (this.sleeping || this.games.playing) return;
    const free = !this.engine.busy && !this.mind.thinking;
    const name = this.speakerName();
    switch (ev.kind) {
      case 'sonrisa':
        if (free) {
          this.engine.setEmotion('contento', 2200); // te devuelve la sonrisa
          if (this.life.mayReact() && Math.random() < 0.2) this.say('contento', '¡Qué sonrisa!');
        }
        this.life.feel('charla');
        break;
      case 'sorpresa':
        if (free) this.engine.setEmotion('sorprendido', 1400);
        break;
      case 'bostezo':
        if (free) {
          this.engine.setEmotion('cansado', 2600); // los bostezos se contagian
          if (this.life.mayReact()) this.say('cansado', 'Uaaah…', { subtitle: false, volume: 0.4 });
        }
        break;
      case 'saludo':
        if (this.life.mayReact()) {
          this.engine.hop(-0.7);
          this.answer('contento', name ? `¡Hola, ${name}!` : '¡Hola! ¡Hola!');
        }
        break;
      case 'gesto':
        if (ev.gesture === 'pulgar') {
          this.engine.setEmotion('feliz', 2000);
          this.engine.burst('sparkle', 5);
          if (this.life.mayReact() && Math.random() < 0.5) this.say('feliz', '¡Genial!');
        } else if (ev.gesture === 'paz' && free) {
          this.engine.setEmotion('contento', 1800);
        } else if (ev.gesture === 'puno' && free && this.life.mayReact()) {
          this.engine.hop(-0.5);
          this.say('emocionado', '¡Choca ese puño!');
        } else if (ev.gesture === 'palma' && this.ringing) {
          this.stopRinging();
        } else if (ev.gesture === 'palma' && this.life.mayReact() && (this.engine.busy || performance.now() - this.lastReplyAt < 30_000)) {
          const cmd = this.life.command('callate');
          if (cmd) this.answerLines('neutral', ['Vale, me callo un ratito.']);
        }
        break;
    }
  }

  onSound(e: SoundEvent) {
    const now = performance.now();
    const speaking = this.engine.speech !== null;
    this.perception.feedSound(e.level, now, speaking, now - this.lastWordsAt < 8000);
    if (this.dancing && !speaking && !this.sleeping && !this.games.playing && this.perception.beat()) {
      this.engine.hop(-0.32);
      if (Math.random() < 0.15) this.engine.burst('note', 1);
    }
  }

  // ================================================================ cuerpo
  onMotion(acceleration: number) {
    if (acceleration < SHAKE || this.life.privateMode) return;
    const now = performance.now();
    if (now - this.lastTouch < 900) return;
    this.shakes = this.shakes.filter((t) => now - t < 3000);
    this.shakes.push(now);
    if (now - this.lastStartle < 2500) return;
    this.lastStartle = now;
    this.buzz('strong');
    this.life.feel('susto');
    if (this.shakes.length >= 4) {
      this.engine.setEmotion('mareado', 3500);
      this.say('mareado', '¡Para, que me mareo!');
    } else if (this.sleeping) this.wake('¡Uy! ¿Qué pasa?');
    else this.say('asustado', '¡Ay! ¿Qué pasa?');
  }

  /** 1 = desenchufado, 2 = cargando, 3 = lleno (expo-battery). */
  onBattery(state: number) {
    const before = this.battery;
    this.battery = state;
    if (before === null || this.sleeping || this.life.privateMode) return;
    const wasPowered = before === 2 || before === 3;
    const isPowered = state === 2 || state === 3;
    if (wasPowered && state === 1) {
      this.life.noteBody('Me desenchufaron');
      if (this.life.mayReact()) this.say('curioso', '¡Eh! ¿Adónde vamos?');
    }
    if (before === 1 && isPowered) {
      this.life.noteBody('Me enchufaron');
      if (this.life.mayReact()) this.say('contento', '¡Ñam! Energía.');
    }
  }

  onCaress() {
    if (this.sleeping || this.life.privateMode || this.games.playing) return;
    this.caresses++;
    this.life.feel('caricia');
    this.engine.setEmotion(this.caresses > 8 ? 'enamorado' : 'contento', 1800);
    this.buzz('tick');
    if (this.caresses % 4 === 1) this.say('contento', 'mmm', { subtitle: false });
  }

  endCaress() {
    if (this.caresses >= 6 && !this.sleeping && !this.life.privateMode) {
      this.say(this.caresses > 8 ? 'enamorado' : 'contento', '¡Qué gustito!');
      this.life.noteBody('Me hicieron caricias');
    }
    this.caresses = 0;
  }

  // ================================================================ oído
  /** ¿Le está hablando a otra persona o a la mascota? ("Toby, ven aquí", "¿qué quieres cenar, Ana?") */
  private talkingToOther(t: string) {
    const me = normalize(this.speakerName() ?? '');
    for (const name of this.people.names()) {
      const n = normalize(name).split(' ')[0];
      if (!n || n === me) continue;
      const re = new RegExp(`^(?:(?:oye|eh|mira|venga|ven)\\s+)?${n}\\b|\\b${n}$`);
      if (re.test(t)) return true;
    }
    return false;
  }

  onHear(e: HearEvent) {
    if (e.error || !e.text) return;
    this.engine.markListening();
    const now = performance.now();
    this.lastWordsAt = now;
    if (!e.final) return;
    const text = e.text;
    const t = normalize(text);
    this.engine.showHeard(text);
    if (this.life.privateMode) return;

    // un temporizador sonando: "vale", "para", "ya" lo apagan
    if (this.ringing && (mentionsName(text) || /\b(vale|para|parar|ya|apaga|apagalo|calla|gracias|ok|basta|silencio|entendido|vale vale)\b/.test(t))) {
      this.stopRinging();
      return;
    }

    // ¿le hablan a él?
    //  - si le llaman por su nombre, sí
    //  - si estamos jugando, o acaba de hablar o de preguntar algo, sí (salvo que llames a otro por su nombre)
    //  - si le miras y no hay nadie más delante, también
    const named = mentionsName(text);
    const toOther = !named && this.talkingToOther(t);
    const waiting = !!this.asking || (!!this.offer && now - this.offer.at < OFFER_MS);
    const conversing = now < this.listenUntil;
    const alone = this.people.faceCount() < 2;
    const facing = this.attending && alone && now - this.lookingSince > 600;
    const addressed = named || this.games.playing || (!toOther && (conversing || waiting || facing));
    const reply = understand(text, { sleeping: this.sleeping, now: new Date(), seesSomeone: this.seesSomeone });

    if (this.sleeping) {
      if (reply?.action === 'wake' && addressed) this.wake(reply.text);
      return;
    }
    if (!addressed) {
      // no le hablan a él (por teléfono o con otra persona): no interrumpir
      this.life.overheard();
      if (Math.random() < 0.25) this.engine.setEmotion('curioso', 1500);
      return;
    }
    this.life.touchedTalk();
    // si le hablas mientras aún le quedaban frases por decir, se calla y te escucha
    this.life.cancelChain();

    // 0) respuestas a lo que Bip acaba de preguntar: quién eres, cómo se llama tu perro, ¿jugamos?
    if (this.answerAsking(text, t, now)) return;
    if (this.answerOffer(text, t, now)) return;

    // 1) juegos
    const wasPlaying = this.games.playing;
    const g = this.games.request(text);
    if (g) {
      this.answer(g.emo, g.text);
      return;
    }
    if (!wasPlaying && this.games.playing) return; // acaba de empezar un juego: esa frase era para elegirlo
    if (this.games.playing) {
      if (this.games.hear(text)) return;
    }
    // 2) ajustes
    if (this.onSettings && /\b(ajustes|configuracion|configurar|personaliza|personalizar|personalizate|opciones|preferencias)\b/.test(t)) {
      this.openSettings();
      this.answer('contento', 'Aquí tienes mis ajustes. Toca «Listo» al terminar.');
      return;
    }
    // 3) intimidad, silencio, diario, "¿cómo estás?"
    const cmd = this.life.command(text);
    if (cmd) {
      if (/\b(olvida|olvidate de|borra) todo\b/.test(t)) this.people.forgetAll();
      this.answerLines(cmd.emo, cmd.lines);
      if (cmd.after) {
        const total = cmd.lines.reduce((a, l) => a + speechSeconds(l, cmd.emo) + 1.4, 0);
        setTimeout(cmd.after, total * 1000);
      }
      return;
    }
    // 4) quién es quién ("no soy Luis", "¿quién soy?", "mi perro se llama Toby")
    if (this.peopleCommand(text, t, now)) return;
    // 5) temporizadores y avisos
    if (this.timerCommand(text, t)) return;
    // 6) su aspecto ("ponte azul", "efecto holograma")
    const th = themeCommand(text, this.engine.theme);
    if (th) {
      this.engine.theme = th.theme;
      saveTheme(th.theme);
      this.engine.hop(-0.8);
      this.engine.burst('sparkle', 6);
      this.answer('feliz', th.text);
      return;
    }
    // 7) respuestas a sus preguntas (tu nombre, tu ciudad...)
    const ans = this.life.answered(text);
    if (ans) {
      this.answer('contento', ans);
      return;
    }
    // 8) "me llamo Ana": es quien le habla ahora (no siempre la misma persona)
    const nm = nameFrom(text);
    if (nm) {
      this.answer('contento', this.named(nm, this.people.speakerTrack()));
      return;
    }
    // 9) ¿le piden recordar algo?
    const learned = learn(this.memory, text, new Date());
    if (learned) {
      if (learned.plan) this.life.learnedPlan(learned.plan.date, learned.plan.what);
      else if (learned.fact) this.life.learnedFact(`me pediste recordar «${learned.fact}»`);
      this.answer('contento', learned.text);
      this.life.noteTalk(text, learned.text);
      return;
    }
    // 10) internet: el tiempo, noticias, "busca..."
    if (this.netIntent(text)) return;
    // 11) órdenes y datos exactos: los resuelven las reglas al momento
    if (reply?.action === 'sleep') {
      this.sleep(reply.text);
      return;
    }
    if (reply && (reply.fast || reply.action === 'love')) {
      if (reply.action === 'love') {
        this.buzz('soft');
        this.engine.burst('heart', 6);
      }
      this.answer(reply.action === 'love' ? 'enamorado' : reply.emo, reply.text);
      this.life.noteTalk(text, reply.text);
      return;
    }
    // 12) todo lo demás, a la mente (si ya la tiene)
    if (this.mind.ready) {
      if (!this.mind.thinking) void this.thinkAbout(text);
      return;
    }
    if (reply) {
      this.answer(reply.emo, reply.text);
      this.life.noteTalk(text, reply.text);
    } else if (this.mind.state === 'descargando') {
      this.answer('pensando', `Aún estoy descargando mi cerebro (${Math.round(this.mind.progress * 100)} %).`);
    } else {
      this.answer('curioso', 'Te he oído, pero aún no sé responder a eso.');
    }
  }

  /** Contesta a "¿cómo te llamas?", "¿eres Ana?" y "¿cómo se llama tu perro?". true si era eso. */
  private answerAsking(text: string, t: string, now: number): boolean {
    const a = this.asking;
    if (!a) return false;
    if (now - a.at > ASK_MS) {
      this.asking = null;
      return false;
    }
    if (a.kind === 'mascota') {
      this.asking = null;
      if (isNo(text)) {
        this.answer('contento', 'Vale, no pasa nada.');
        return true;
      }
      const name = petNameFrom(text);
      if (!name) return false;
      const p = this.people.namePet(a.animal, name);
      this.life.learnedFact(`tu ${a.animal} se llama ${p.name}`);
      this.engine.burst('heart', 6);
      this.answer('enamorado', `¡Hola, ${p.name}! Ya me acordaré de ti.`);
      return true;
    }
    const no = isNo(text);
    const rest = text.replace(/^\s*(no|si|sí)(?=[\s,.!]|$)[,.!]?\s*/i, '');
    const nm = !isYes(text) || /\b(soy|me llamo)\b/i.test(text) ? nameFrom(rest, true) : null;
    // "¿Eres Luis?" — "Luis" (o "sí, soy Luis") es lo mismo que decir que sí
    const guessed = a.kind === 'eres' && !!nm && !!a.person.name && normalize(nm) === normalize(a.person.name);
    const yes = isYes(text) || guessed;
    if (nm && !guessed) {
      this.asking = null;
      this.answer('contento', this.named(nm, a.track));
      return true;
    }
    if (a.kind === 'eres') {
      if (yes && a.person.name) {
        this.asking = null;
        const name = a.person.name;
        this.people.confirm(a.track, name);
        this.whoIgnored = 0;
        this.askedWhoAt = -Infinity;
        const lines = this.life.greeting(0, name);
        this.engine.hop(-0.8);
        this.answerLines('feliz', [`¡Lo sabía! Hola, ${name}.`, ...lines.slice(1)]);
        return true;
      }
      if (no) {
        this.people.reject(a.track);
        if (a.other?.name) {
          this.asking = { kind: 'eres', track: a.track, person: a.other, at: now };
          this.answer('avergonzado', `¡Uy! ¿Eres ${a.other.name}, entonces?`);
        } else {
          this.asking = { kind: 'nombre', track: a.track, at: now };
          this.answer('avergonzado', '¡Uy, perdona! ¿Cómo te llamas?');
        }
        return true;
      }
      this.asking = null;
      return false;
    }
    // le había preguntado el nombre
    this.asking = null;
    if (no) {
      this.whoIgnored++;
      this.answer('neutral', 'Vale, no pasa nada.');
      return true;
    }
    return false;
  }

  /** Contesta a "¿jugamos?" con un "sí" (o un "no"). true si era eso. */
  private answerOffer(text: string, t: string, now: number): boolean {
    const o = this.offer;
    if (!o || now - o.at > OFFER_MS || this.games.playing) return false;
    if (isNo(text)) {
      this.offer = null;
      this.answer('contento', pick(['Vale, otro rato.', 'Vale. ¡Cuando quieras!', 'Bueno… ¡me lo guardo para luego!']));
      return true;
    }
    const game = GAME_LIST.find((g) => g.re.test(t))?.name ?? null;
    if (!isYes(text) && !game && !/\b(jug|jueg|partida)/.test(t)) return false;
    this.offer = null;
    const pickGame = game ?? o.game;
    const r = pickGame ? this.games.start(pickGame) : this.games.menu();
    if (r) this.answer(r.emo, r.text);
    return true;
  }

  /** "¿Quién soy?", "no soy Luis", "olvida mi cara", "mi perro se llama Toby"... true si era eso. */
  private peopleCommand(text: string, t: string, now: number): boolean {
    const notMe = t.match(/\bno soy (\w+)/);
    if (notMe) {
      const track = this.people.speakerTrack();
      this.people.reject(track);
      const nm = nameFrom(text.replace(/^.*?\bno soy\s+\S+[,.]?\s*/i, ''), true);
      if (nm) {
        this.answer('contento', this.named(nm, track));
      } else {
        this.asking = { kind: 'nombre', track, at: now };
        this.answer('avergonzado', '¡Uy, perdona! ¿Cómo te llamas?');
      }
      return true;
    }
    if (/\b(quien soy|sabes quien soy|como me llamo|sabes como me llamo|me reconoces)\b/.test(t)) {
      const sp = this.people.speaker();
      const track = this.people.speakerTrack();
      if (sp?.name) this.answer('feliz', `¡Claro! Eres ${sp.name}.`);
      else if (track === null) this.answer('confundido', 'No te veo bien. Ponte delante de mí.');
      else {
        this.asking = { kind: 'nombre', track, at: now };
        this.answer('pensando', 'Mmm… aún no te reconozco. ¿Cómo te llamas?');
      }
      return true;
    }
    if (/\b(a quien conoces|a quienes conoces|quien vive aqui|que personas conoces|conoces a alguien)\b/.test(t)) {
      const humans = this.people.humans.map((p) => p.name).filter((n): n is string => !!n);
      const pets = this.people.pets.filter((p) => p.name).map((p) => `${p.name} (el ${p.kind})`);
      const all = [...humans, ...pets];
      this.answer('contento', all.length ? `Conozco a ${joinNames(all)}.` : 'Aún no conozco a nadie. ¡Dime cómo te llamas!');
      return true;
    }
    if (/\bolvida(?:te de)? mi cara\b/.test(t)) {
      const sp = this.people.speaker();
      if (sp) {
        this.people.forget(sp.id);
        this.answer('neutral', 'Hecho: ya no recuerdo tu cara.');
      } else this.answer('confundido', 'No sé seguro quién eres, así que no puedo olvidarte.');
      return true;
    }
    const forgetWho = text.match(/\bolv[ií]da(?:te)?(?: de)? a ([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
    if (forgetWho) {
      const p = this.people.byName(forgetWho[1]);
      if (p) {
        this.people.forget(p.id);
        this.answer('neutral', `Hecho: he olvidado a ${p.name}.`);
      } else this.answer('confundido', `No conozco a nadie que se llame ${cap(forgetWho[1])}.`);
      return true;
    }
    const pet = text.match(/\bmi (perr[oa]|perrit[oa]|gat[oa]|gatit[oa])\s+se llama\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
    if (pet) {
      const kind = /^perr/i.test(pet[1]) ? 'perro' : 'gato';
      const p = this.people.namePet(kind, cap(pet[2]));
      this.life.learnedFact(`tu ${kind} se llama ${p.name}`);
      this.answer('enamorado', `¡Qué nombre tan bonito! Cuando vea a ${p.name}, le saludaré.`);
      return true;
    }
    const intro = text.match(/\b(?:te presento a|esta es|este es|ella es|el es|él es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
    if (intro) {
      const name = nameFrom(intro[1], true);
      if (!name) return false;
      const other = this.people.otherTrack();
      if (other !== null) {
        this.named(name, other);
        this.engine.hop(-0.8);
        this.answer('contento', `¡Hola, ${name}! Encantado. Ya me quedo con tu cara.`);
      } else this.answer('curioso', `¡Hola, ${name}! Ponte delante de mí para que me quede con tu cara.`);
      return true;
    }
    return false;
  }

  // ================================================================ temporizadores y avisos
  private timersNote() {
    const n = this.timers.next();
    if (!n) return '';
    return `Tienes un aviso puesto para las ${hhmm(n.at)}${n.label ? ` («${n.label}»)` : ''}.`;
  }

  /** "Avísame en 10 minutos", "¿cuánto queda?", "cancela el temporizador"... true si era eso. */
  private timerCommand(text: string, t: string): boolean {
    const now = Date.now();
    const next = this.timers.next();
    if (next && /\b(cuanto queda|cuanto falta|cuanto le queda|cuanto tiempo queda|cuanto le falta)\b/.test(t)) {
      this.answer('pensando', `Quedan ${sayDuration(next.at - now)}${next.label ? ` para lo de «${next.label}»` : ''}.`);
      return true;
    }
    if (/\b(cancela|cancelar|quita|quitar|borra|borrar|anula|anular|para|apaga)\b.*\b(temporizador|temporizadores|alarma|alarmas|aviso|avisos|cuenta atras)\b/.test(t)) {
      const all = /\b(todos|todas|los avisos|las alarmas|los temporizadores)\b/.test(t);
      const n = this.timers.cancel(all);
      this.engine.timerText = null;
      this.answer(n ? 'contento' : 'confundido', n ? (n > 1 ? `Hecho: he quitado ${n} avisos.` : 'Hecho: aviso quitado.') : 'No tenía ningún aviso puesto.');
      return true;
    }
    if (/\b(que avisos tengo|que alarmas tengo|que temporizadores tengo|tengo algun aviso|tengo alguna alarma|tengo avisos|tengo alarmas)\b/.test(t)) {
      const list = this.timers.list.slice(0, 3).map((x) => `a las ${hhmm(x.at)}${x.label ? ` («${x.label}»)` : ''}`);
      this.answer('pensando', list.length ? `Tienes ${this.timers.list.length === 1 ? 'un aviso' : `${this.timers.list.length} avisos`}: ${joinNames(list)}.` : 'No tienes ningún aviso puesto.');
      return true;
    }
    const r = parseTimer(text, new Date());
    if (!r) return false;
    if (!r.label && /\bdespiertame\b/.test(t)) r.label = 'despertarte';
    if (r.at - now < 3000) {
      this.answer('confundido', '¿Cuánto tiempo? Dime, por ejemplo, «avísame en 10 minutos».');
      return true;
    }
    if (r.at - now > 8 * 86_400_000) {
      this.answer('confundido', 'Eso queda muy lejos: puedo avisarte, como mucho, dentro de una semana.');
      return true;
    }
    this.timers.add(r, now);
    const lbl = r.label ? ` para lo de «${r.label}»` : '';
    if (r.kind === 'temporizador') {
      this.engine.timerText = clockText(r.at - now);
      this.answer('contento', `¡Hecho! Te aviso dentro de ${sayDuration(r.at - now)}${lbl}.`);
    } else {
      const d = new Date(r.at);
      const tomorrow = new Date(now + 86_400_000);
      const day = dayKey(d) === dayKey(new Date(now)) ? '' : dayKey(d) === dayKey(tomorrow) ? ' mañana' : ` ${spokenDay(d)}`;
      this.answer('contento', `¡Hecho! Te aviso${day} a las ${hhmm(d)}${lbl}.`);
    }
    return true;
  }

  /** Suena un temporizador: pitidos, lo que había que recordar, y más pitidos hasta que le digas "vale". */
  private ring(due: Timer[]) {
    const now = performance.now();
    if (this.sleeping) {
      this.asleepByDark = false;
      this.life.napping = false;
      BipSenses.setSeeingInterval(0.125);
    }
    const lines: string[] = [];
    for (const tm of due) {
      if (tm.kind === 'temporizador') {
        lines.push(`¡Tiempo! Ya han pasado ${sayDuration(tm.at - tm.set)}.`);
        if (tm.label) lines.push(`Era para lo de «${tm.label}».`);
      } else {
        lines.push(`¡Son las ${hhmm(tm.at)}!`);
        if (tm.label) lines.push(tm.label === 'despertarte' ? '¡Arriba, dormilón!' : `Me pediste que te avisara: «${tm.label}».`);
      }
    }
    const speakAt = now + 3600;
    const talk = lines.reduce((a, l) => a + speechSeconds(l, 'emocionado') + 1.4, 0) * 1000;
    const tones = [now, now + 1200, now + 2400];
    for (let x = speakAt + talk + 800; x < now + RING_MS; x += 1600) tones.push(x);
    this.ringing = { tones, speakAt, lines, until: now + RING_MS };
    this.engine.setEmotion('sorprendido', 3000);
    this.engine.hop(-1);
    this.buzz('strong');
  }

  /** Deja de pitar. Si aún no había dicho para qué era el aviso, lo dice ahora. */
  private stopRinging() {
    const r = this.ringing;
    this.ringing = null;
    if (r?.speakAt) this.answerLines('contento', r.lines);
    else this.engine.setEmotion('contento', 1500);
  }

  private ringStep(now: number) {
    const r = this.ringing;
    if (!r) return;
    if (now > r.until) {
      this.ringing = null;
      return;
    }
    while (r.tones.length && r.tones[0] <= now) {
      r.tones.shift();
      this.d.tone(1568, 110);
      setTimeout(() => this.d.tone(2093, 150), 160);
      this.engine.hop(-0.5);
      this.buzz('strong');
    }
    if (r.speakAt && now >= r.speakAt) {
      r.speakAt = 0;
      this.answerLines('emocionado', r.lines);
    }
  }

  // ================================================================ internet
  private netIntent(text: string): boolean {
    const t = normalize(text);
    const city = text.match(/\b(?:vivo en|mi ciudad es|estoy viviendo en)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{1,30})/i);
    if (city) {
      void this.setCity(city[1].replace(/[.!?]+$/, '').trim());
      return true;
    }
    if (/\b(que tiempo|tiempo hace|tiempo va a hacer|tiempo hara|va a llover|llovera|llueve|temperatura|hace frio|hace calor|paraguas)\b/.test(t)) {
      void this.tellWeather(/\bmanana\b/.test(t) ? 'mañana' : 'hoy');
      return true;
    }
    if (/\b(noticias|titulares|que pasa en el mundo|que ha pasado en el mundo|actualidad)\b/.test(t)) {
      void this.tellNews();
      return true;
    }
    const q = text.match(/\b(?:busca(?:me)?|buscar|mira en internet|consulta en internet)\s+(?:en internet\s+)?(?:que es\s+|quien es\s+|quien fue\s+)?(.{2,60})/i);
    if (q) {
      void this.searchFor(q[1].replace(/[.!?¿¡]+$/g, '').trim());
      return true;
    }
    return false;
  }

  private async thinkAbout(text: string) {
    this.engine.setEmotion('pensando', 30_000); // puntitos mientras piensa
    // si acaba de preguntarte algo, la mente lo tiene en cuenta (para entender un "sí" o un "no")
    const q = this.lastQuestion;
    const asked = q && performance.now() - q.at < 45_000 ? q.text : undefined;
    this.lastQuestion = null;
    const t = await this.mind.think(text, this.situation(), asked);
    if (this.sleeping || this.life.privateMode) return;
    if (!t) {
      this.answer('confundido', 'Mmm… se me ha ido el santo al cielo.');
      return;
    }
    // la mente ha decidido jugar
    if (t.accion && !this.games.playing) {
      const r = t.accion === 'juegos' ? this.games.menu() : this.games.start(t.accion as GameName);
      if (r) this.answer(r.emo, r.text);
      this.life.noteTalk(text, '(jugamos)');
      return;
    }
    this.answer(t.emo, t.text);
    this.life.noteTalk(text, t.text);
  }

  private async setCity(city: string) {
    this.engine.setEmotion('pensando', 8000);
    try {
      const p = await geocode(city);
      if (!p) {
        this.answer('confundido', `No encuentro «${city}» en el mapa. ¿Me lo dices de otra forma?`);
        return;
      }
      this.place = p;
      this.forecast = null;
      writeJSON(PLACE_FILE, p);
      this.life.learnedFact(`vives en ${p.name}`);
      this.answer('contento', `¡Apuntado! Estás en ${p.name}. Ya puedo mirarte el tiempo.`);
    } catch {
      this.answer('triste', 'Ahora no tengo internet para buscar tu ciudad.');
    }
  }

  private async refreshForecast() {
    if (!this.place) return null;
    if (this.forecast && Date.now() - this.forecastAt < 30 * 60_000) return this.forecast;
    this.forecast = await weather(this.place);
    this.forecastAt = Date.now();
    return this.forecast;
  }

  private async tellWeather(when: 'hoy' | 'mañana') {
    if (!this.place) {
      this.life.askCity();
      return;
    }
    this.engine.setEmotion('pensando', 8000);
    try {
      const w = await this.refreshForecast();
      if (w) this.answerLines(w.today.rain >= 50 && when === 'hoy' ? 'triste' : 'contento', sayWeather(w, when));
    } catch {
      this.answer('triste', 'Ahora no tengo internet para mirar el tiempo.');
    }
  }

  private async tellNews() {
    this.engine.setEmotion('pensando', 8000);
    try {
      const h = await headlines(3);
      this.answerLines('curioso', [`Titulares de ${h.source}:`, ...h.titles.map((x) => tidy(x, 110))]);
    } catch {
      this.answer('triste', 'Ahora no tengo internet para leer las noticias.');
    }
  }

  private async searchFor(query: string) {
    this.engine.setEmotion('pensando', 10_000);
    this.engine.say(`Buscando «${query}» en internet…`, null);
    try {
      const f = await search(query);
      if (!f) {
        this.answer('confundido', `No he encontrado nada sobre «${query}».`);
        return;
      }
      const sentences = f.text
        .replace(/([.!?])\s+/g, '$1|')
        .split('|')
        .filter(Boolean)
        .slice(0, 2);
      this.answerLines('curioso', [`Según ${f.source}:`, ...sentences.map((x) => tidy(x, 110))]);
    } catch {
      this.answer('triste', 'Ahora no tengo internet para buscarlo.');
    }
  }

  // ================================================================ lector de caras (MediaPipe)
  private ensureFaceReader() {
    if (this.readerState !== 'nada' && this.readerState !== 'error') return;
    if (this.mind.state === 'descargando' || this.mind.state === 'cargando') return; // primero el cerebro
    const path = BipSenses.modelPath(FACE_FILE);
    if (path) {
      void this.loadReader(path);
    } else if (this.readerState === 'nada') {
      this.readerState = 'descargando';
      BipSenses.downloadModel(FACE_URL, FACE_FILE);
    }
  }

  private async loadReader(path: string) {
    this.readerState = 'cargando';
    const ok = await BipSenses.loadFaceReader(path).catch(() => false);
    this.readerState = ok ? 'listo' : 'error';
    if (ok) this.perception.hasReader = true;
  }

  // ================================================================ cada 20 segundos
  tick() {
    if (!this.uiOpen) this.life.tick();
    this.games.tick();
    this.ensureFaceReader();
    if (this.place && !this.life.privateMode) {
      this.refreshForecast()
        .then((w) => {
          this.life.forecast = w;
        })
        .catch(() => undefined);
    }
    // avisos que se pasaron con la app cerrada: los cuenta en cuanto te ve
    if (this.missed.length && this.seesSomeone && !this.sleeping && !this.games.playing && this.life.mayReact()) {
      const m = this.missed.splice(0);
      this.answerLines(
        'avergonzado',
        m.map((x) => `Mientras estaba apagado se pasó tu aviso de las ${hhmm(x.at)}${x.label ? `: «${x.label}»` : ''}.`),
      );
    }
  }

  /** Más a menudo que tick (cada cuarto de segundo): juegos, temporizadores y preguntas sin contestar. */
  fastTick() {
    const now = performance.now();
    if (this.games.playing) this.games.tick();
    const due = this.timers.due(Date.now());
    if (due.length) {
      const late = due.filter((x) => Date.now() - x.at > 120_000);
      const fresh = due.filter((x) => Date.now() - x.at <= 120_000);
      this.missed.push(...late);
      if (fresh.length) this.ring(fresh);
    }
    this.ringStep(now);
    const next = this.timers.next();
    this.engine.timerText = next && next.at - Date.now() < 3_600_000 ? clockText(next.at - Date.now()) : null;
    // no te ha contestado a "¿cómo te llamas?": si pasa dos veces, deja de preguntar un par de horas
    if (this.asking && now - this.asking.at > ASK_MS) {
      if (this.asking.kind !== 'mascota') this.whoIgnored++;
      this.asking = null;
      if (this.whoIgnored >= 2) {
        this.whoIgnored = 0;
        this.whoPausedUntil = now + 2 * 3_600_000;
      }
    }
    if (this.offer && now - this.offer.at > OFFER_MS) this.offer = null;
  }
}
