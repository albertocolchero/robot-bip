// Fase 4: la mente. Un modelo de lenguaje (Gemma 4 E2B) que vive dentro del iPhone.
// - La primera vez descarga el modelo (unos 3 GB, solo por wifi). Después piensa sin internet.
// - Contesta cuando las reglas sencillas no saben qué decir.
// - De vez en cuando, si estás delante y hay silencio, decide él solo si dice algo.
import BipSenses, { type ModelEvent } from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import { loadBrain, type Brain, type ChatMessage } from './llm';
import { describe, type Memory } from './memory';

export const MODEL = {
  file: 'gemma-4-E2B-it-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
  bytes: 3.11e9,
};

export type MindState = 'sin-cerebro' | 'descargando' | 'cargando' | 'lista' | 'error';

export type Situation = {
  now: Date;
  seesSomeone: boolean;
  attending: boolean;
  charging: boolean | null;
  dark: boolean;
};

export type Thought = { emo: EmotionName; text: string };

type Say = (emo: EmotionName, text: string) => void;

const EMOS: EmotionName[] = ['neutral', 'contento', 'curioso', 'sorprendido', 'triste', 'pensando'];

const SCHEMA = {
  type: 'object',
  properties: {
    emocion: { type: 'string', enum: EMOS },
    frase: { type: 'string', maxLength: 160 },
  },
  required: ['emocion', 'frase'],
};

// Fijo para que el iPhone pueda reaprovechar el trabajo entre preguntas.
const SYSTEM = `Eres Bip, un pequeño robot de escritorio con aspecto de droide. Vives dentro de un iPhone que hace de cara: dos ojos verdes en una pantalla negra. Hablas con pitidos y la persona lee lo que dices en subtítulos.
Tu carácter: curioso, cariñoso, algo travieso y optimista. Eres un robot pequeño: no lo sabes todo y no pasa nada.
Reglas:
- Responde siempre en español de España.
- Frases muy cortas: una o dos, como mucho 25 palabras. Sin listas, sin emojis, sin comillas.
- No inventes cosas sobre la persona. Usa lo que recuerdas de ella solo si viene a cuento.
- No tienes internet ni puedes hacer cosas fuera de tu pantalla. Si te lo piden, dilo con gracia.
- Elige la emoción que pondrá tu cara.
Responde solo con JSON: {"emocion": "...", "frase": "..."}`;

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function context(s: Situation, memory: Memory) {
  const d = s.now;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const bits = [
    `Son las ${hh}:${mm} del ${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}.`,
    s.attending ? 'La persona está delante y te mira.' : s.seesSomeone ? 'Ves a alguien cerca.' : 'No ves a nadie.',
    s.charging === true ? 'Estás enchufado.' : s.charging === false ? 'Funcionas con batería.' : '',
    s.dark ? 'Hay poca luz.' : '',
    describe(memory),
  ];
  return `[${bits.filter(Boolean).join(' ')}]`;
}

function parse(raw: string): Thought | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const j = JSON.parse(raw.slice(start, end + 1)) as { emocion?: string; frase?: string };
    const text = (j.frase ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const emo = EMOS.includes(j.emocion as EmotionName) ? (j.emocion as EmotionName) : 'neutral';
    return { emo, text };
  } catch {
    return null;
  }
}

export class Mind {
  state: MindState = 'sin-cerebro';
  progress = 0;
  private brain: Brain | null = null;
  private busy = false;
  private history: ChatMessage[] = [];
  private lastChatAt = 0;
  private halfSaid = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private sub: { remove(): void } | null = null;

  constructor(
    private engine: FaceEngine,
    private say: Say,
    private memory: Memory,
  ) {}

  get ready() {
    return this.state === 'lista' && !!this.brain;
  }

  get thinking() {
    return this.busy;
  }

  /** Busca el modelo; si no está, empieza a descargarlo. */
  wake() {
    if (this.state === 'lista' || this.state === 'cargando') return;
    if (!this.sub) this.sub = BipSenses.addListener('onModel', (e) => this.onModel(e));
    const path = BipSenses.modelPath(MODEL.file);
    if (path) {
      this.load(path);
      return;
    }
    const free = BipSenses.freeDiskBytes();
    if (free >= 0 && free < MODEL.bytes + 400e6) {
      this.state = 'error';
      this.say('triste', 'No me cabe el cerebro: necesito 3,5 GB libres en el iPhone.');
      return;
    }
    if (this.state !== 'descargando') {
      this.say('curioso', 'Voy a descargar mi cerebro. Tardaré un rato: déjame con wifi y enchufado.');
    }
    this.state = 'descargando';
    this.engine.progress = this.progress;
    BipSenses.downloadModel(MODEL.url, MODEL.file);
  }

  stop() {
    if (this.retry) clearTimeout(this.retry);
    this.sub?.remove();
    this.sub = null;
  }

  private onModel(e: ModelEvent) {
    if (e.state === 'progress' && e.total && e.total > 0) {
      this.progress = Math.min(1, (e.received ?? 0) / e.total);
      this.engine.progress = this.progress;
      if (!this.halfSaid && this.progress >= 0.5) {
        this.halfSaid = true;
        this.say('contento', '¡Ya tengo medio cerebro!');
      }
    } else if (e.state === 'done' && e.path) {
      this.engine.progress = null;
      this.load(e.path);
    } else if (e.state === 'error') {
      this.state = 'error';
      this.engine.progress = null;
      this.say('triste', 'Se ha cortado la descarga. Lo vuelvo a intentar en un minuto.');
      if (this.retry) clearTimeout(this.retry);
      this.retry = setTimeout(() => this.wake(), 60_000);
    }
  }

  private async load(path: string) {
    this.state = 'cargando';
    this.engine.progress = 0;
    try {
      this.brain = await loadBrain(path, (p) => {
        this.engine.progress = p;
      });
      this.state = 'lista';
      this.engine.progress = null;
      this.say('contento', '¡Ya puedo pensar! Háblame.');
    } catch {
      this.state = 'error';
      this.engine.progress = null;
      this.say('triste', 'No consigo despertar mi cerebro.');
    }
  }

  private async ask(user: string, maxTokens: number): Promise<Thought | null> {
    if (!this.ready || this.busy || !this.brain) return null;
    this.busy = true;
    try {
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }, ...this.history, { role: 'user', content: user }];
      const raw = await this.brain.complete(messages, SCHEMA, maxTokens);
      return parse(raw);
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** Contesta a lo que le han dicho. */
  async think(heard: string, s: Situation, memory: Memory): Promise<Thought | null> {
    this.memory = memory;
    if (performance.now() - this.lastChatAt > 10 * 60_000) this.history = [];
    const who = memory.name ?? 'La persona';
    const user = `${context(s, memory)}\n${who} te dice: «${heard}»`;
    const t = await this.ask(user, 90);
    if (t) {
      this.history.push({ role: 'user', content: `${who} te dice: «${heard}»` }, { role: 'assistant', content: JSON.stringify({ emocion: t.emo, frase: t.text }) });
      this.history = this.history.slice(-6);
      this.lastChatAt = performance.now();
    }
    return t;
  }

  /** Iniciativa propia: ¿le apetece decir algo? Devuelve null si prefiere callar. */
  async muse(s: Situation, memory: Memory): Promise<Thought | null> {
    this.memory = memory;
    const user = `${context(s, memory)}\n(Nadie te ha dicho nada y llevas un rato en silencio con la persona delante. Si se te ocurre algo breve y simpático —una pregunta, un comentario sobre la hora o una idea—, dilo. Si no, deja la frase vacía.)`;
    const t = await this.ask(user, 70);
    if (t) {
      // el modelo espera turnos alternos (persona, Bip, persona, Bip...)
      this.history.push({ role: 'user', content: '(silencio)' }, { role: 'assistant', content: JSON.stringify({ emocion: t.emo, frase: t.text }) });
      this.history = this.history.slice(-6);
      this.lastChatAt = performance.now();
    }
    return t;
  }
}
