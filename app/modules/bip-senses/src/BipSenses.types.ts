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

export type SeeEvent = {
  faces: SeenFace[];
  /** Brillo de la escena (EXIF): negativo = oscuro, 5 o más = mucha luz. */
  light?: number;
  error?: string;
};

export type HearEvent = {
  text?: string;
  final?: boolean;
  error?: string;
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
};
