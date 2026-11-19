// El aspecto de Bip: color, forma de los ojos y efecto de pantalla. Se cambia con la voz
// ("Bip, ponte azul", "ojos redondos", "efecto holograma", "sorpréndeme") y se guarda en el iPhone.
import { readJSON, writeJSON } from '../brain/store';
import { normalize } from '../brain/talk';

export const COLORS = {
  menta: '#4FE3C1',
  cian: '#59D2FF',
  azul: '#5B8CFF',
  lila: '#B48CFF',
  rosa: '#FF6FB5',
  rojo: '#FF5C5C',
  naranja: '#FF9A3D',
  ambar: '#FFC247',
  verde: '#62FF7A',
  blanco: '#E8F3FF',
} as const;
export type ColorName = keyof typeof COLORS;

/** Forma base de los ojos: ancho, alto y redondez (1 = todo lo redondo que se pueda). */
export const SHAPES = {
  redondo: { w: 64, h: 80, round: 0.62 },
  circulo: { w: 72, h: 72, round: 1 },
  capsula: { w: 50, h: 90, round: 1 },
  cuadrado: { w: 68, h: 76, round: 0.14 },
  ancho: { w: 88, h: 60, round: 0.55 },
} as const;
export type ShapeName = keyof typeof SHAPES;

export const EFFECTS = ['limpio', 'neon', 'retro', 'holograma', 'plasma'] as const;
export type EffectName = (typeof EFFECTS)[number];

export type Theme = {
  color: ColorName;
  shape: ShapeName;
  effect: EffectName;
  /** El color se tiñe con la emoción y se suaviza de noche. */
  dynamic: boolean;
};

export const DEFAULT_THEME: Theme = { color: 'menta', shape: 'redondo', effect: 'neon', dynamic: true };
const FILE = 'tema.json';

export function loadTheme(): Theme {
  const t = readJSON<Partial<Theme>>(FILE) ?? {};
  return {
    color: t.color && t.color in COLORS ? t.color : DEFAULT_THEME.color,
    shape: t.shape && t.shape in SHAPES ? t.shape : DEFAULT_THEME.shape,
    effect: t.effect && EFFECTS.includes(t.effect) ? t.effect : DEFAULT_THEME.effect,
    dynamic: typeof t.dynamic === 'boolean' ? t.dynamic : true,
  };
}

export function saveTheme(t: Theme) {
  writeJSON(FILE, t);
}

/** ¿Ya lo ha personalizado alguna vez? (si no, es la primera vez que se abre la app) */
export function hasTheme() {
  return readJSON(FILE) !== null;
}

/** Cómo se llama cada efecto en el panel de ajustes. */
export const EFFECT_INFO: Record<EffectName, string> = {
  limpio: 'Limpio',
  neon: 'Neón',
  retro: 'Tele antigua',
  holograma: 'Holograma',
  plasma: 'Plasma',
};

export const SHAPE_INFO: Record<ShapeName, string> = {
  redondo: 'Redondos',
  circulo: 'Círculos',
  capsula: 'Cápsulas',
  cuadrado: 'Cuadrados',
  ancho: 'Anchos',
};

const COLOR_WORDS: [RegExp, ColorName][] = [
  [/\b(menta|verde agua|turquesa)\b/, 'menta'],
  [/\b(cian|celeste|azul claro)\b/, 'cian'],
  [/\bazul\b/, 'azul'],
  [/\b(lila|morado|violeta|purpura)\b/, 'lila'],
  [/\b(rosa|rosado|fucsia)\b/, 'rosa'],
  [/\b(rojo|roja)\b/, 'rojo'],
  [/\b(naranja)\b/, 'naranja'],
  [/\b(amarillo|amarilla|ambar|dorado)\b/, 'ambar'],
  [/\b(verde)\b/, 'verde'],
  [/\b(blanco|blanca)\b/, 'blanco'],
];

const SHAPE_WORDS: [RegExp, ShapeName][] = [
  [/\b(circulo|circulares|redonditos|bolitas)\b/, 'circulo'],
  [/\b(capsula|pildora|alargados|altos)\b/, 'capsula'],
  [/\b(cuadrados|cuadrado|retro|pixel)\b.*\bojos\b|\bojos\b.*\b(cuadrados|cuadrado)\b/, 'cuadrado'],
  [/\b(anchos|panoramicos)\b/, 'ancho'],
  [/\bojos\b.*\b(normales|redondos)\b|\b(redondos)\b/, 'redondo'],
];

const EFFECT_WORDS: [RegExp, EffectName][] = [
  [/\b(neon|brillo|brillante)\b/, 'neon'],
  [/\b(retro|antigua|antiguo|tele vieja|crt|ochentero)\b/, 'retro'],
  [/\b(holograma|holografico|holografica)\b/, 'holograma'],
  [/\b(plasma|lava|psicodelico)\b/, 'plasma'],
  [/\b(limpio|simple|sin efectos|normal)\b/, 'limpio'],
];

export type ThemeChange = { theme: Theme; text: string };

function pick<T>(list: readonly T[], not?: T): T {
  const opts = list.filter((x) => x !== not);
  return opts[Math.floor(Math.random() * opts.length)];
}

/** Entiende "ponte azul", "ojos de cápsula", "efecto holograma", "sorpréndeme", "vuelve a ser tú". */
export function themeCommand(raw: string, current: Theme): ThemeChange | null {
  const t = normalize(raw);
  const looks = /\b(ponte|pon|cambia|cambiate|quiero|vuelve|haz|hazte|tus ojos|los ojos|ojos|color|efecto|estilo|aspecto|look)\b/.test(t);
  if (!looks && !/\bsorprendeme\b/.test(t)) return null;

  if (/\b(sorprendeme|cambia de look|cambia tu aspecto|algo distinto)\b/.test(t)) {
    const theme: Theme = {
      color: pick(Object.keys(COLORS) as ColorName[], current.color),
      shape: pick(Object.keys(SHAPES) as ShapeName[], current.shape),
      effect: pick(EFFECTS, current.effect),
      dynamic: true,
    };
    return { theme, text: '¡Tachán! ¿Qué te parece mi nuevo look?' };
  }
  if (/\b(vuelve a ser tu|como antes|como siempre|tu color de siempre|original)\b/.test(t)) {
    return { theme: { ...DEFAULT_THEME }, text: '¡Vuelvo a ser el de siempre!' };
  }
  if (/\b(color fijo|no cambies de color|sin cambiar de color)\b/.test(t)) {
    return { theme: { ...current, dynamic: false }, text: 'Vale: ya no cambio de color con lo que siento.' };
  }
  if (/\b(cambia de color con|colores con|color dinamico)\b/.test(t)) {
    return { theme: { ...current, dynamic: true }, text: '¡Bien! Mi color cambiará según cómo me sienta.' };
  }

  const next = { ...current };
  const said: string[] = [];
  if (/\b(cambia de color|otro color)\b/.test(t)) {
    next.color = pick(Object.keys(COLORS) as ColorName[], current.color);
    said.push(`color ${next.color}`);
  } else {
    for (const [re, c] of COLOR_WORDS) {
      if (re.test(t)) {
        next.color = c;
        said.push(`color ${c}`);
        break;
      }
    }
  }
  if (/\b(cambia los ojos|otros ojos|cambia la forma)\b/.test(t)) {
    next.shape = pick(Object.keys(SHAPES) as ShapeName[], current.shape);
    said.push(`ojos ${next.shape}`);
  } else {
    for (const [re, s] of SHAPE_WORDS) {
      if (re.test(t) && /\bojos\b|\bforma\b/.test(t)) {
        next.shape = s;
        said.push(`ojos ${s}`);
        break;
      }
    }
  }
  if (/\b(cambia el efecto|otro efecto)\b/.test(t)) {
    next.effect = pick(EFFECTS, current.effect);
    said.push(`efecto ${next.effect}`);
  } else {
    for (const [re, e] of EFFECT_WORDS) {
      if (re.test(t) && (/\befecto|estilo|modo|pantalla\b/.test(t) || e !== 'limpio')) {
        next.effect = e;
        said.push(`efecto ${e}`);
        break;
      }
    }
  }
  if (!said.length) return null;
  return { theme: next, text: `¡Hecho! ${said.join(', ')}. ¿Te gusta?` };
}
