// El instinto: recibe lo que notan los sentidos y decide qué hacer.
//  - Fase 2: reflejos (seguirte con la mirada, saludar, asustarse, ronronear, dormirse a oscuras).
//  - Fase 3: cuándo contestar a lo que oye.
//  - Fase 4: pasa la conversación a la mente.
//  - Fase 5: vida propia (ánimo, diario, iniciativa, respeto), juegos, internet, y reflejos con
//    tu cara (te devuelve la sonrisa, bosteza contigo), tus manos (saludos, pulgar arriba) y
//    los sonidos (palmadas, música).
import BipSenses, { type HearEvent, type SeeEvent, type SeenFace, type SoundEvent } from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { saveTheme, themeCommand } from '../face/theme';
import { speechSeconds } from '../voice/speak';
import { Games } from './games';
import { Life } from './life';
import { learn, type Memory } from './memory';
import type { Mind, Situation } from './mind';
import { geocode, headlines, sayWeather, search, tidy, weather, type Place, type Weather } from './net';
import { Perception, type PerceptionEvent } from './perception';
import { readJSON, writeJSON } from './store';
import { mentionsName, normalize, understand } from './talk';

export type Say = (emo: EmotionName, text: string, opts?: { subtitle?: boolean; volume?: number }) => void;
export type Buzz = (kind: 'tick' | 'soft' | 'strong') => void;

export type InstinctDeps = {
  engine: FaceEngine;
  say: Say;
  buzz: Buzz;
  mind: Mind;
  memory: Memory;
  /** Un tono puro (juegos). */
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
const CONVERSATION_MS = 12_000; // tras contestar, lo siguiente que oiga se toma como respuesta
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

export class Instinct {
  readonly life: Life;
  readonly games: Games;
  readonly perception: Perception;

  private engine: FaceEngine;
  private mind: Mind;
  private memory: Memory;
  private buzz: Buzz;
  private lastFaceAt = 0;
  private lastGreetAt = 0;
  private looking = false;
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
  lastLight: number | null = null;

  constructor(private d: InstinctDeps) {
    this.engine = d.engine;
    this.mind = d.mind;
    this.memory = d.memory;
    this.buzz = d.buzz;
    this.sayRaw = d.say;

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
    this.mind.whoName = () => this.memory.name;
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
    this.sayRaw(emo, text, { volume: this.life ? this.life.volume() : 1, ...opts });
  };

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
  }

  /** Varias frases, una detrás de otra. */
  private answerLines(emo: EmotionName, raw: string[]) {
    const lines = raw.flatMap((l) => chunks(l));
    if (!lines.length) return;
    this.markGreeted();
    this.lastReplyAt = performance.now();
    this.say(emo, lines[0]);
    this.life.chain(lines.slice(1), emo, speechSeconds(lines[0], emo) + 1.4);
    const total = lines.reduce((a, l) => a + speechSeconds(l, emo) + 1.4, 0);
    this.listenUntil = Math.max(this.listenUntil, performance.now() + total * 1000 + CONVERSATION_MS);
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
    if (this.games.playing || this.life.privateMode || this.sleeping || this.engine.busy) return null;
    if (this.dancing) return Math.random() < 0.6 ? 'feliz' : 'contento';
    return this.life.idleFace();
  }

  /** Un toque en la pantalla (x, y en unidades lógicas). true si lo ha usado. */
  onTap(x: number, y: number) {
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
    const face = largest(e.faces ?? []);
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
      this.looking = Math.abs(face.yaw ?? 0) < LOOKING_YAW;
      const absent = this.lastFaceAt ? now - this.lastFaceAt : Infinity;
      this.lastFaceAt = now;
      if (!this.sleeping && !this.games.playing && absent > GREET_AFTER_MS && now - this.lastGreetAt > GREET_AFTER_MS && this.life.mayReact()) {
        this.lastGreetAt = now;
        this.answerLines('contento', this.life.greeting(absent === Infinity ? 0 : absent));
      }
    } else if (now - this.lastFaceAt > 1500) {
      if (!gameGaze) this.engine.clearGaze();
      this.looking = false;
    }

    if (e.expr) {
      this.perception.feedExpr(e.expr, now);
      this.life.userMood = this.perception.userMood();
    }
    this.perception.feedHand(e.hand, now);
    if (this.games.playing) this.games.see();
    if (typeof e.light === 'number') this.onLight(e.light, now);
  }

  private onLight(light: number, now: number) {
    this.lastLight = light;
    if (light < DARK) {
      this.brightSince = 0;
      if (!this.darkSince) this.darkSince = now;
      if (!this.sleeping && !this.games.playing && now - this.darkSince > DARK_SECONDS * 1000) {
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
    const name = this.memory.name;
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
  onHear(e: HearEvent) {
    if (e.error || !e.text) return;
    this.engine.markListening();
    const now = performance.now();
    this.lastWordsAt = now;
    if (!e.final) return;
    const text = e.text;
    this.engine.showHeard(text);

    const named = mentionsName(text);
    const conversing = now < this.listenUntil || now - this.lastReplyAt < CONVERSATION_MS;
    const addressed = named || this.attending || conversing || this.games.playing;
    const reply = understand(text, { sleeping: this.sleeping, now: new Date(), seesSomeone: this.seesSomeone });

    if (this.life.privateMode) return;
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
    // 2) intimidad, silencio, diario, "¿cómo estás?"
    const cmd = this.life.command(text);
    if (cmd) {
      this.answerLines(cmd.emo, cmd.lines);
      if (cmd.after) {
        const total = cmd.lines.reduce((a, l) => a + speechSeconds(l, cmd.emo) + 1.4, 0);
        setTimeout(cmd.after, total * 1000);
      }
      return;
    }
    // 3) su aspecto ("ponte azul", "efecto holograma")
    const th = themeCommand(text, this.engine.theme);
    if (th) {
      this.engine.theme = th.theme;
      saveTheme(th.theme);
      this.engine.hop(-0.8);
      this.engine.burst('sparkle', 6);
      this.answer('feliz', th.text);
      return;
    }
    // 4) respuestas a sus preguntas (tu nombre, tu ciudad...)
    const ans = this.life.answered(text);
    if (ans) {
      this.answer('contento', ans);
      return;
    }
    // 5) ¿le piden recordar algo?
    const learned = learn(this.memory, text, new Date());
    if (learned) {
      if (learned.plan) this.life.learnedPlan(learned.plan.date, learned.plan.what);
      else if (learned.fact) this.life.learnedFact(`me pediste recordar «${learned.fact}»`);
      else if (learned.name) this.life.learnedFact(`te llamas ${learned.name}`);
      this.answer('contento', learned.text);
      this.life.noteTalk(text, learned.text);
      return;
    }
    // 6) internet: el tiempo, noticias, "busca..."
    if (this.netIntent(text)) return;
    // 7) órdenes y datos exactos: los resuelven las reglas al momento
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
    // 8) todo lo demás, a la mente (si ya la tiene)
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

  private async thinkAbout(text: string) {
    this.engine.setEmotion('pensando', 30_000); // puntitos mientras piensa
    const t = await this.mind.think(text, this.situation());
    if (this.sleeping || this.life.privateMode) return;
    if (t) {
      this.answer(t.emo, t.text);
      this.life.noteTalk(text, t.text);
    } else this.answer('confundido', 'Mmm… se me ha ido el santo al cielo.');
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
    this.life.tick();
    this.games.tick();
    this.ensureFaceReader();
    if (this.place && !this.life.privateMode) {
      this.refreshForecast()
        .then((w) => {
          this.life.forecast = w;
        })
        .catch(() => undefined);
    }
  }

  /** Más a menudo que tick: para los juegos (tiempos cortos). */
  fastTick() {
    if (this.games.playing) this.games.tick();
  }
}
