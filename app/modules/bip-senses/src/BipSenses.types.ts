export type SeenFace = {
  /** Centro de la cara, 0 = izquierda, 1 = derecha (como en un espejo). */
  x: number;
  /** Centro de la cara, 0 = arriba, 1 = abajo. */
  y: number;
  /** Tamaño de la cara respecto a la imagen (más grande = más cerca). */
  size: number;
  confidence: number;
  /** Giro de la cabeza en radianes (0 = mirando a Bip). */
  yaw?: number;
};

/** Tu expresión, resumida de las 52 medidas de MediaPipe (cada una de 0 a 1). */
export type Expression = {
  smile: number;
  frown: number;
  browUp: number;
  browDown: number;
  jawOpen: number;
  blinkL: number;
  blinkR: number;
  squint: number;
  wide: number;
  pucker: number;
  puff: number;
  sneer: number;
  press: number;
};

export type HandGesture = 'palma' | 'puno' | 'paz' | 'pulgar' | 'senala' | 'otro';

export type SeenHand = {
  gesture: HandGesture;
  /** Muñeca, 0..1 como en las caras. */
  x: number;
  y: number;
  confidence: number;
};

export type SeeEvent = {
  faces: SeenFace[];
  /** Brillo de la escena (EXIF): negativo = oscuro, 5 o más = mucha luz. */
  light?: number;
  /** Solo si el lector de caras está cargado y hay alguien cerca. */
  expr?: Expression;
  hand?: SeenHand;
  error?: string;
};

export type HearEvent = {
  text?: string;
  final?: boolean;
  error?: string;
};

/** Volumen de lo que suena, cada décima de segundo. */
export type SoundEvent = {
  /** 0 = silencio … 1 = muy fuerte */
  level: number;
  db: number;
};

export type PermissionResult = {
  camera: boolean;
  microphone: boolean;
  speech: boolean;
};

export type HearingStart = {
  ok: boolean;
  reason: string;
};

export type ModelEvent = {
  state: 'start' | 'progress' | 'paused' | 'done' | 'error';
  /** De qué archivo es el aviso. */
  file?: string;
  received?: number;
  total?: number;
  path?: string;
  error?: string;
  resumed?: boolean;
};

export type BipSensesEvents = {
  onSee: (event: SeeEvent) => void;
  onHear: (event: HearEvent) => void;
  onModel: (event: ModelEvent) => void;
  onSound: (event: SoundEvent) => void;
};
