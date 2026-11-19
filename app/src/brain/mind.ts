// Fase 4 y 5: la mente. Un modelo de lenguaje (Gemma 4 E2B) que vive dentro del iPhone.
// - La primera vez descarga el modelo (unos 3 GB, solo por wifi). Después piensa sin internet.
// - Contesta cuando las reglas sencillas no saben qué decir; si le falta un dato, lo busca en internet.
// - Toma la iniciativa cuando la "vida propia" se lo pide, saca fichas de las conversaciones
//   y escribe su diario.
import BipSenses, { type ModelEvent } from '../../modules/bip-senses';
import type { EmotionName, FaceEngine } from '../face/engine';
import type { CardKind } from './journal';
import type { Fact, MindLike, Situation, Thought } from './life';
import { loadBrain, type Brain, type ChatMessage } from './llm';
import { partialField, type PartialThought } from './streamSpeech';

export type { PartialThought, Situation, Thought };

export const MODEL = {
  file: 'gemma-4-E2B-it-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
  bytes: 3.11e9,
};

export type MindState = 'sin-cerebro' | 'descargando' | 'cargando' | 'lista' | 'error';

type Say = (emo: EmotionName, text: string) => void;
export type Lookup = (query: string) => Promise<{ source: string; title: string; text: string } | null>;

const EMOS: EmotionName[] = [
  'neutral',
  'contento',
  'feliz',
  'curioso',
  'sorprendido',
  'triste',
  'pensando',
  'cansado',
  'enfadado',
  'asustado',
  'enamorado',
  'confundido',
  'aburrido',
  'avergonzado',
  'emocionado',
];

/** Cosas que la mente puede hacer, además de hablar. */
export const ACTIONS = ['ninguna', 'juegos', 'miradas', 'caras', 'simon', 'ppt', 'numero', 'adivinanzas'] as const;
export type MindAction = (typeof ACTIONS)[number];

const SCHEMA = {
  type: 'object',
  properties: {
    emocion: { type: 'string', enum: EMOS },
    frase: { type: 'string', maxLength: 170 },
    accion: { type: 'string', enum: ACTIONS },
  },
  required: ['emocion', 'frase', 'accion'],
};

const SCHEMA_SEARCH = {
  type: 'object',
  properties: {
    emocion: { type: 'string', enum: EMOS },
    frase: { type: 'string', maxLength: 170 },
    buscar: { type: 'string', maxLength: 60 },
  },
  required: ['emocion', 'frase', 'buscar'],
};

/** Igual, pero obligando a escribir qué buscar (para preguntas sobre cosas reales). */
const SCHEMA_MUST_SEARCH = {
  type: 'object',
  properties: {
    emocion: { type: 'string', enum: EMOS },
    frase: { type: 'string', maxLength: 120 },
    buscar: { type: 'string', minLength: 2, maxLength: 60 },
  },
  required: ['emocion', 'frase', 'buscar'],
};

const KINDS: CardKind[] = ['persona', 'animal', 'cosa', 'lugar'];
const SCHEMA_NOTES = {
  type: 'object',
  properties: {
    apuntes: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string', maxLength: 40 },
          tipo: { type: 'string', enum: KINDS },
          dato: { type: 'string', maxLength: 90 },
        },
        required: ['nombre', 'tipo', 'dato'],
      },
    },
  },
  required: ['apuntes'],
};

const SCHEMA_DIARY = {
  type: 'object',
  properties: { diario: { type: 'string', maxLength: 280 } },
  required: ['diario'],
};

// Fijo para que el iPhone pueda reaprovechar el trabajo entre preguntas.
const SYSTEM = `Eres Bip, un pequeño robot de escritorio con aspecto de droide. Vives dentro de un iPhone que hace de cara: dos ojos de luz en una pantalla negra. Hablas con pitidos y la persona lee lo que dices en subtítulos. Puedes verla con la cámara, notar si sonríe y oírla.
Tu carácter: curioso, cariñoso, algo travieso y optimista. Eres un robot pequeño: no lo sabes todo y no pasa nada.
Sabes jugar a: duelo de miradas, imita mi cara, Simón de colores, piedra papel o tijera, adivina el número y adivinanzas.
Reglas:
- Responde siempre en español de España.
- Frases muy cortas: una o dos, como mucho 25 palabras. Sin listas, sin emojis, sin comillas.
- No inventes cosas sobre la persona. Usa lo que recuerdas de ella solo si viene a cuento.
- NUNCA inventes títulos de canciones, películas, libros, nombres, fechas ni cifras. Si no lo sabes seguro, búscalo o di que no lo sabes.
- No puedes hacer cosas fuera de tu pantalla. Puedes buscar datos en internet cuando se te indica cómo.
- Si la persona quiere jugar, o acepta un juego que tú propusiste, pon en "accion" ese juego (o "juegos" para que elija). Si no, "ninguna".
- Elige la emoción que pondrá tu cara.
Responde solo con JSON.`;

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function context(s: Situation, notes: string) {
  const d = s.now;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const bits = [
    `Son las ${hh}:${mm} del ${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}.`,
    s.attending ? 'La persona está delante y te mira.' : s.seesSomeone ? 'Ves a alguien cerca.' : 'No ves a nadie.',
    s.charging === true ? 'Estás enchufado.' : s.charging === false ? 'Funcionas con batería.' : '',
    s.dark ? 'Hay poca luz.' : '',
    notes,
  ];
  return `[${bits.filter(Boolean).join(' ')}]`;
}

function json(raw: string): Record<string, unknown> | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function thought(j: Record<string, unknown> | null): (Thought & { buscar?: string }) | null {
  if (!j) return null;
  const text = String(j.frase ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const emo = EMOS.includes(j.emocion as EmotionName) ? (j.emocion as EmotionName) : 'neutral';
  const buscar = typeof j.buscar === 'string' ? j.buscar.trim() : '';
  const accion = ACTIONS.includes(j.accion as MindAction) && j.accion !== 'ninguna' ? (j.accion as MindAction) : undefined;
  return { emo, text, buscar: buscar || undefined, accion };
}

/** ¿Pregunta por cosas reales (canciones, películas, personas, cifras...)? Ahí no hay que fiarse de la memoria del modelo. */
export function needsFacts(text: string) {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\b(cancion|canciones|disco|album|pelicula|peliculas|peli|serie|series|libro|libros|novela|autor|autora|cantante|grupo|banda|actor|actriz|director|futbolista|equipo|jugador|presidente|capital|poblacion|habitantes|cuantos anos|cuando nacio|cuando murio|cuando fue|en que ano|que ano|record|campeon|ganador|gano|premio|inventor|invento|descubrio|mide|altura|distancia|temperatura de)\b/.test(t)) {
    return true;
  }
  // un nombre propio en mitad de la frase (el reconocedor de voz los escribe con mayúscula)
  const proper = text.match(/\s([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/g) ?? [];
  return proper.some((p) => !/^(Bip|Vip|Pip)$/.test(p.trim()));
}

/** ¿Es una pregunta que quizá necesite buscar un dato? */
export function looksLikeQuestion(text: string) {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return /\?|\b(que es|quien es|quien fue|quienes|cuando|donde|cuanto|cuantos|cuantas|cual es|cuales|como se|por que|sabes si|dime|explicame|busca|buscame)\b/.test(t);
}

export class Mind implements MindLike {
  state: MindState = 'sin-cerebro';
  progress = 0;
  /** Lo que sabe ahora (memoria, diario, ánimo). Lo conecta la vida propia. */
  notes: (heard?: string) => string = () => '';
  /** Cómo se llama la persona (lo conecta la vida propia). */
  whoName: () => string | null = () => null;
  /** Cómo buscar en internet (lo conecta quien tiene internet). */
  lookup: Lookup | null = null;
  /** Avisa de que va a buscar (para poner cara de buscar). */
  onSearching: ((query: string) => void) | null = null;
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
    if (e.file && e.file !== MODEL.file) return; // es otra descarga (por ejemplo, el lector de caras)
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

  private async ask(user: string, schema: object, maxTokens: number, withHistory = true, onText?: (soFar: string) => void): Promise<Record<string, unknown> | null> {
    if (!this.ready || this.busy || !this.brain) return null;
    this.busy = true;
    try {
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }, ...(withHistory ? this.history : []), { role: 'user', content: user }];
      return json(await this.brain.complete(messages, schema, maxTokens, onText));
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  private remember(user: string, t: Thought) {
    this.history.push({ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify({ emocion: t.emo, frase: t.text }) });
    this.history = this.history.slice(-6);
    this.lastChatAt = performance.now();
  }

  /** Contesta a lo que le han dicho (buscando en internet si le falta un dato). */
  async think(heard: string, s: Situation, asked?: string, onPartial?: (p: PartialThought) => void): Promise<Thought | null> {
    if (performance.now() - this.lastChatAt > 10 * 60_000) this.history = [];
    // cada respuesta del modelo se va contando palabra a palabra a quien la va a decir
    let parts = 0;
    const stream = () => {
      const part = parts++;
      if (!onPartial) return undefined;
      return (soFar: string) => {
        const f = partialField(soFar, 'frase');
        if (!f) return;
        const e = partialField(soFar, 'emocion');
        const emo = e?.done && EMOS.includes(e.value as EmotionName) ? (e.value as EmotionName) : 'neutral';
        onPartial({ part, emo, text: f.value.replace(/\s+/g, ' ').trimStart(), done: f.done });
      };
    };
    const who = this.whoName() ?? 'La persona';
    // si contesta a una pregunta de Bip ("sí", "vale"), la mente tiene que saber cuál era
    const said = `${asked ? `(Tú le acabas de decir: «${asked}»)\n` : ''}${who} te dice: «${heard}»`;
    const base = `${context(s, this.notes(heard))}\n${said}`;
    const facts = !!this.lookup && needsFacts(heard);
    const canSearch = !!this.lookup && (facts || looksLikeQuestion(heard));
    if (!canSearch) {
      const t = thought(await this.ask(base, SCHEMA, 100, true, stream()));
      if (t) this.remember(said, t);
      return t;
    }
    const first = thought(
      facts
        ? await this.ask(
            `${base}\n(Esto va de cosas reales: NO contestes de memoria. Escribe en "buscar" de 2 a 5 palabras para buscarlo en internet —por ejemplo, el nombre de la persona, la película o el grupo y de qué se trata— y en "frase" algo como "Déjame que lo mire".)`,
            SCHEMA_MUST_SEARCH,
            70,
            true,
            stream(),
          )
        : await this.ask(
            `${base}\n(Si para contestar necesitas un dato que no sabes seguro —actualidad, fechas, personas, lugares, cifras, el tiempo—, escribe en "buscar" de 2 a 5 palabras para buscarlo en internet y en "frase" algo como "Déjame que lo busque". Si no hace falta, deja "buscar" vacío.)`,
            SCHEMA_SEARCH,
            100,
            true,
            stream(),
          ),
    );
    if (!first?.buscar || !this.lookup) {
      if (first) this.remember(said, first);
      return first;
    }
    this.onSearching?.(first.buscar);
    let extra: string;
    try {
      const found = await this.lookup(first.buscar);
      extra = found
        ? `(Has buscado «${first.buscar}» en internet. En ${found.source} pone: «${found.text}». Contesta con eso, en una o dos frases cortas y con tus palabras. Usa SOLO lo que pone ahí: no añadas títulos, nombres ni datos que no aparezcan. Si no responde a la pregunta, di que no lo has encontrado.)`
        : `(Has buscado «${first.buscar}» en internet y no has encontrado nada claro. Díselo con gracia y no inventes nada.)`;
    } catch {
      extra = `(Has intentado buscar «${first.buscar}» en internet, pero ahora no hay conexión. Díselo con gracia.)`;
    }
    const t = thought(await this.ask(`${base}\n${extra}`, SCHEMA, 110, true, stream()));
    if (t) this.remember(said, t);
    return t;
  }

  /** Iniciativa propia con una instrucción concreta (recordar algo, preguntar...). Null si prefiere callar. */
  async initiative(s: Situation, instruction: string, maxTokens = 70): Promise<Thought | null> {
    const user = `${context(s, this.notes())}\n(Nadie te ha dicho nada. ${instruction} Si no se te ocurre nada bueno, deja la frase vacía.)`;
    const t = thought(await this.ask(user, SCHEMA, maxTokens));
    if (t) this.remember('(silencio)', t); // el modelo espera turnos alternos
    return t;
  }

  /** Saca de una conversación datos que valga la pena recordar (fichas). */
  async extract(dialog: string, who: string): Promise<Fact[]> {
    const user = `APUNTES. Conversación reciente:\n${dialog}\n(Apunta como mucho 3 datos que valga la pena recordar sobre personas, animales, cosas o lugares de la vida de ${who}. Solo cosas dichas claramente, nada inventado. Si es sobre ${who} mismo, usa como nombre "${who}". Si no hay nada, deja la lista vacía.)`;
    const j = await this.ask(user, SCHEMA_NOTES, 160, false);
    const list = Array.isArray(j?.apuntes) ? (j.apuntes as Record<string, unknown>[]) : [];
    return list
      .map((a) => ({ nombre: String(a.nombre ?? '').trim(), tipo: (KINDS.includes(a.tipo as CardKind) ? a.tipo : 'cosa') as CardKind, dato: String(a.dato ?? '').trim() }))
      .filter((a) => a.nombre && a.dato);
  }

  /** Escribe su diario de un día, con sus palabras. */
  async writeDiary(summary: string, who: string): Promise<string | null> {
    const user = `DIARIO. Esto es lo que pasó un día: ${summary}\n(Escribe tu diario de ese día en dos o tres frases, en primera persona, con tu carácter de robot cariñoso. Llama a la persona ${who}.)`;
    const j = await this.ask(user, SCHEMA_DIARY, 120, false);
    const text = typeof j?.diario === 'string' ? j.diario.trim() : '';
    return text || null;
  }
}
