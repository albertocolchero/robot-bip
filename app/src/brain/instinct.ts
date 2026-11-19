// Fase 2: el instinto. Recibe lo que notan los sentidos y decide reflejos:
// seguirte con la mirada, saludar, asustarse, ronronear, dormirse a oscuras.
// Fase 3: también decide cuándo contestar a lo que oye.
import BipSenses, { type HearEvent, type SeeEvent, type SeenFace } from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { greeting, mentionsName, understand } from './talk';

export type Say = (emo: EmotionName, text: string, opts?: { subtitle?: boolean }) => void;
export type Buzz = (kind: 'tick' | 'soft' | 'strong') => void;

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

function largest(faces: SeenFace[]) {
  let best: SeenFace | null = null;
  for (const f of faces) if (!best || f.size > best.size) best = f;
  return best;
}

export class Instinct {
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
  lastLight: number | null = null;

  constructor(
    private engine: FaceEngine,
    private say: Say,
    private buzz: Buzz,
  ) {}

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

  sleep(text = 'Buenas noches…') {
    this.say('sueno', text);
    BipSenses.setSeeingInterval(1);
  }

  wake(text = '¡Ya estoy despierto!') {
    this.asleepByDark = false;
    BipSenses.setSeeingInterval(0.125);
    this.say('contento', text);
  }

  // ---------------------------------------------------------------- ojos
  onSee(e: SeeEvent) {
    const now = performance.now();
    const face = largest(e.faces ?? []);
    if (face && this.sleeping) {
      this.lastFaceAt = now; // dormido no te sigue con los ojos
      this.engine.clearGaze();
    } else if (face) {
      const gx = FLIP_X * (face.x - 0.5) * 2 * GAZE_X;
      const gy = FLIP_Y * (face.y - 0.5) * 2 * GAZE_Y;
      this.engine.setGaze(Math.max(-GAZE_X, Math.min(GAZE_X, gx)), Math.max(-GAZE_Y, Math.min(GAZE_Y, gy)));
      this.looking = Math.abs(face.yaw ?? 0) < LOOKING_YAW;
      const absent = this.lastFaceAt ? now - this.lastFaceAt : Infinity;
      this.lastFaceAt = now;
      if (!this.sleeping && absent > GREET_AFTER_MS && now - this.lastGreetAt > GREET_AFTER_MS) {
        this.lastGreetAt = now;
        const g = greeting(new Date(), absent === Infinity ? 0 : absent);
        this.say(g.emo, g.text);
      }
    } else if (now - this.lastFaceAt > 1500) {
      this.engine.clearGaze();
      this.looking = false;
    }

    if (typeof e.light === 'number') this.onLight(e.light, now);
  }

  private onLight(light: number, now: number) {
    this.lastLight = light;
    if (light < DARK) {
      this.brightSince = 0;
      if (!this.darkSince) this.darkSince = now;
      if (!this.sleeping && now - this.darkSince > DARK_SECONDS * 1000) {
        this.asleepByDark = true;
        this.sleep('Qué oscuro… a dormir.');
      }
    } else if (light > BRIGHT) {
      this.darkSince = 0;
      if (!this.brightSince) this.brightSince = now;
      if (this.asleepByDark && this.sleeping && now - this.brightSince > 2500) {
        this.wake('¡Ya hay luz! Buenos días.');
      }
    }
  }

  // ---------------------------------------------------------------- cuerpo
  onMotion(acceleration: number) {
    if (acceleration < SHAKE) return;
    const now = performance.now();
    if (now - this.lastTouch < 900) return;
    this.shakes = this.shakes.filter((t) => now - t < 3000);
    this.shakes.push(now);
    if (now - this.lastStartle < 2500) return;
    this.lastStartle = now;
    this.buzz('strong');
    if (this.shakes.length >= 4) this.say('triste', '¡Para, que me mareo!');
    else if (this.sleeping) this.wake('¡Uy! ¿Qué pasa?');
    else this.say('sorprendido', '¡Ay! ¿Qué pasa?');
  }

  /** 1 = desenchufado, 2 = cargando, 3 = lleno (expo-battery). */
  onBattery(state: number) {
    const before = this.battery;
    this.battery = state;
    if (before === null || this.sleeping) return;
    const wasPowered = before === 2 || before === 3;
    const isPowered = state === 2 || state === 3;
    if (wasPowered && state === 1) this.say('curioso', '¡Eh! ¿Adónde vamos?');
    if (before === 1 && isPowered) this.say('contento', '¡Ñam! Energía.');
  }

  onCaress() {
    if (this.sleeping) return;
    this.caresses++;
    this.engine.setEmotion('contento', 1800);
    this.buzz('tick');
    if (this.caresses % 4 === 1) this.say('contento', 'mmm', { subtitle: false });
  }

  endCaress() {
    if (this.caresses >= 6 && !this.sleeping) this.say('contento', '¡Qué gustito!');
    this.caresses = 0;
  }

  // ---------------------------------------------------------------- oído
  onHear(e: HearEvent) {
    if (e.error || !e.text) return;
    this.engine.markListening();
    if (!e.final) return;
    this.engine.showHeard(e.text);

    const addressed = mentionsName(e.text) || this.attending;
    const reply = understand(e.text, { sleeping: this.sleeping, now: new Date(), seesSomeone: this.seesSomeone });

    if (this.sleeping) {
      if (reply?.action === 'wake' && (addressed || mentionsName(e.text))) this.wake(reply.text);
      return;
    }
    if (!addressed) {
      // no le hablan a él: como mucho, le pica la curiosidad
      if (Math.random() < 0.25) this.engine.setEmotion('curioso', 1500);
      return;
    }
    if (!reply) {
      this.say('curioso', 'Te he oído, pero aún no sé responder a eso.');
      return;
    }
    if (reply.action === 'sleep') {
      this.sleep(reply.text);
      return;
    }
    if (reply.action === 'love') this.buzz('soft');
    this.markGreeted();
    this.say(reply.emo, reply.text);
  }
}
