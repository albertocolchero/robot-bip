// Sorpresas con la casa: un juego de luces, un vídeo de YouTube en la tele o música de radio.
// Lo hace Home Assistant (ver home.ts); aquí está lo que no depende de la casa: entender lo que
// pides, buscar el vídeo o la emisora y el guion del juego de luces.
//  - YouTube se busca en su web, sin clave (la página de resultados trae los datos de cada vídeo).
//  - La radio sale de radio-browser.info, un listado público y gratuito de emisoras de todo el mundo.
//  - El juego de luces enciende, apaga y cambia el brillo (y el color o el tono, si la luz puede).
//    Nunca parpadea más deprisa que unas tres veces por segundo, y al acabar deja cada luz como estaba.

export type ShowAsk =
  | { kind: 'luces' }
  | { kind: 'video'; query: string | null; app?: boolean }
  | { kind: 'musica'; query: string | null }
  | { kind: 'spotify' }
  | { kind: 'sorpresa' }
  | { kind: 'parar'; what: 'musica' | 'video' | 'luces' | 'todo' }
  | { kind: 'sorpresas'; on: boolean };

const CALL = /^(?:(?:bip|vip|pip|oye|eh|venga|porfa|por favor|anda)\s+)+/;
const PUT = '(?:pon|ponme|ponnos|pones|me pones|nos pones|puedes poner|podrias poner|quiero ver|quiero escuchar|quiero oir|reproduce|echa|echame|busca|buscame|abre|abreme)';
const ON_TV = /\s*\b(?:en|por) (?:la )?(?:tele|television|tv|televisor)\b\s*/;
const ON_SPEAKER = /\s*\ben (?:el )?(?:altavoz|nest|google)\b\s*/;
const VAGUE = /^(?:algo|alguna cosa|lo que quieras|lo que sea|cualquier cosa|algo chulo|algo divertido|algo bonito|algo gracioso|algo interesante|algo guay|algo para ver|algo que me guste)?$/;

/** ¿Pide un juego de luces, un vídeo, música...? (texto ya normalizado). null si no es eso. */
export function showAsk(raw: string): ShowAsk | null {
  const t = raw.replace(CALL, '').trim();
  if (/\b(no me (?:hagas|des|prepares) (?:mas )?sorpresas|deja de (?:hacerme|darme|hacer|dar) sorpresas|sin sorpresas|nada de sorpresas|no quiero (?:mas )?sorpresas)\b/.test(t)) {
    return { kind: 'sorpresas', on: false };
  }
  if (/\b(?:ya |)(?:puedes|vuelve a) (?:hacerme|darme|hacer|dar|darnos|hacernos) sorpresas\b/.test(t)) return { kind: 'sorpresas', on: true };
  if (/\b(sorprendeme|sorprendenos|hazme una sorpresa|dame una sorpresa|hazme algo chulo|haz algo chulo con la casa)\b/.test(t)) return { kind: 'sorpresa' };
  if (
    /\b(?:juego|juegos|fiesta|espectaculo|show|baile|bailecito) de (?:luces|luz)\b/.test(t) ||
    /\b(?:discoteca|modo fiesta|modo disco|luces de fiesta|luces de discoteca)\b/.test(t) ||
    /\b(?:baila|bailar|que bailen|haz bailar) (?:con )?(?:a )?las luces\b/.test(t) ||
    /\bhaz (?:algo|un truco|magia|una fiesta) con las luces\b/.test(t) ||
    /\bjuega con las luces\b/.test(t)
  ) {
    return { kind: 'luces' };
  }
  // parar lo que ha puesto Bip
  const stop = t.match(/^(?:para|parar|quita|quitame|apaga|deten|corta|pausa|pon en pausa) (?:la |el |las |los |ese |esa |este |esta )?(musica|radio|cancion|emisora|video|videos|youtube|fiesta|juego de luces)\b/);
  if (stop) {
    const w = stop[1];
    return { kind: 'parar', what: /musica|radio|cancion|emisora/.test(w) ? 'musica' : /video|youtube/.test(w) ? 'video' : 'luces' };
  }
  if (/\bspotify\b/.test(t) && new RegExp(`\\b${PUT}\\b`).test(t)) return { kind: 'spotify' };
  // la radio o una emisora: "pon la radio", "pon la emisora cadena 100"
  const radio = t.match(new RegExp(`^${PUT} (?:la |una |alguna )?(?:radio|emisora)(?: de radio)?\\b(.*)$`));
  if (radio) return { kind: 'musica', query: cleanQuery(radio[1]) };
  // YouTube: "pon un vídeo de gatos en la tele", "pon en youtube recetas", "pon youtube"
  const tv = ON_TV.test(t);
  const yt = /\byoutube\b/.test(t);
  const vid = /\bvideos?\b/.test(t);
  if (new RegExp(`^${PUT}\\b`).test(t) && (yt || vid || tv)) {
    let q = t
      .replace(new RegExp(`^${PUT}\\s*`), '')
      .replace(ON_TV, ' ')
      .replace(/\s*\b(?:en|de) youtube\b\s*/, ' ')
      .replace(/^youtube\b/, '')
      .trim();
    q = q.replace(/^(?:un|unos|el|los|algun|algunos|otro|otros)?\s*videos?\b\s*(?:de|sobre|del|con)?\s*/, '').trim();
    q = q.replace(/^(?:a|al)\s+/, '').trim();
    if (!yt && !vid && tv && !q) return null; // "pon en la tele": no dice qué
    if (/^(?:la tele|la television|el televisor)$/.test(q)) return null; // "pon la tele": eso es encenderla
    if (yt && !q) return { kind: 'video', query: null, app: true };
    return { kind: 'video', query: VAGUE.test(q) ? null : q };
  }
  // música: "pon música", "ponme algo de música de los 80", "quiero escuchar jazz"
  const music = t.match(new RegExp(`^${PUT} (?:un poco de |algo de |una |alguna )?(?:musica|cancion|canciones|musiquita)\\b(.*)$`));
  if (music) return { kind: 'musica', query: cleanQuery(music[1]) };
  return null;
}

/** " de jazz en el altavoz" → "jazz"; "" → null. */
function cleanQuery(rest: string): string | null {
  const q = rest
    .replace(ON_SPEAKER, ' ')
    .replace(ON_TV, ' ')
    .replace(/^\s*(?:de|del|que sea|tipo|estilo|rollo)\s+/, '')
    .replace(/^(?:la|el|los|las)\s+/, '')
    .trim();
  return q && !VAGUE.test(q) ? q : null;
}

// ================================================================ YouTube
export type Video = { id: string; title: string; minutes: number | null; live: boolean };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** Los primeros vídeos que salen al buscar en YouTube. */
export async function searchYouTube(query: string, max = 8): Promise<Video[]> {
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=es&gl=ES`, {
    headers: { 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`YouTube contesta ${r.status}`);
  return parseYouTube(await r.text(), max);
}

/** Saca los vídeos de la página de resultados (los datos van en "var ytInitialData = {...};"). */
export function parseYouTube(html: string, max = 8): Video[] {
  const key = 'var ytInitialData = ';
  const start = html.indexOf(key);
  if (start < 0) return [];
  const end = html.indexOf(';</script>', start);
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start + key.length, end));
  } catch {
    return [];
  }
  const out: Video[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object' || out.length >= max) return;
    const v = (o as { videoRenderer?: VideoRenderer }).videoRenderer;
    if (v?.videoId) {
      const len = v.lengthText?.simpleText ?? null;
      out.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text ?? '',
        minutes: len ? minutesOf(len) : null,
        live: !len || JSON.stringify(v.badges ?? []).includes('LIVE'),
      });
      return;
    }
    for (const k of Object.keys(o)) walk((o as Record<string, unknown>)[k]);
  };
  walk(data);
  return out;
}

type VideoRenderer = { videoId?: string; title?: { runs?: { text?: string }[] }; lengthText?: { simpleText?: string }; badges?: unknown[] };

/** "1:02:03" → 62; "4:05" → 4. */
function minutesOf(len: string) {
  const p = len.split(':').map(Number);
  if (p.some((x) => Number.isNaN(x))) return null;
  return p.length === 3 ? p[0] * 60 + p[1] : p[0];
}

/** Elige uno de los primeros (no siempre el mismo), mejor si no es un directo ni un vídeo de segundos. */
export function chooseVideo(list: Video[], random = Math.random): Video | null {
  const good = list.filter((v) => !v.live && (v.minutes ?? 0) >= 1);
  const pool = (good.length ? good : list).slice(0, 4);
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}

/** El título, para decirlo en voz alta: sin emojis, sin "#etiquetas" y no muy largo. */
export function sayableTitle(title: string) {
  const clean = title
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/#\S+/g, '')
    .replace(/[|•·]+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:-]+$/, '')}…`;
}

/** Temas para cuando le dices "pon algo en la tele" o te da una sorpresa. */
export const VIDEO_TOPICS: { q: string; say: string }[] = [
  { q: 'perros graciosos', say: 'perros graciosos' },
  { q: 'gatos graciosos', say: 'gatos graciosos' },
  { q: 'animales bebés graciosos', say: 'animales bebés' },
  { q: 'paisajes de Islandia a vista de dron 4K', say: 'paisajes de Islandia vistos desde un dron' },
  { q: 'acuario relajante 4K', say: 'un acuario relajante' },
  { q: 'la Tierra vista desde la Estación Espacial Internacional 4K', say: 'la Tierra vista desde el espacio' },
  { q: 'trucos de magia increíbles', say: 'trucos de magia' },
  { q: 'robots increíbles', say: 'robots como yo, pero más grandes' },
  { q: 'aurora boreal 4K', say: 'auroras boreales' },
  { q: 'dominó efecto cadena increíble', say: 'un dominó gigante' },
];

// ================================================================ radio
export type Station = { name: string; url: string };

// géneros dichos en castellano → etiquetas del listado de emisoras
const GENRES: [RegExp, string][] = [
  [/\b(relajante|tranquila|para relajarme|chill|chillout|para dormir)\b/, 'chillout'],
  [/\bclasica\b/, 'classical'],
  [/\bjazz\b/, 'jazz'],
  [/\brock\b/, 'rock'],
  [/\bpop\b/, 'pop'],
  [/\bflamenco\b/, 'flamenco'],
  [/\b(80|ochenta|ochentera)\b/, '80s'],
  [/\b(90|noventa|noventera)\b/, '90s'],
  [/\b(reggaeton|regueton)\b/, 'reggaeton'],
  [/\b(electronica|techno|house|dance)\b/, 'electronic'],
  [/\b(latina|salsa|bachata)\b/, 'latin'],
  [/\b(navidad|navidena|villancicos)\b/, 'christmas'],
  [/\b(infantil|para ninos)\b/, 'kids'],
  [/\b(country)\b/, 'country'],
  [/\b(blues)\b/, 'blues'],
  [/\b(lofi|lo fi)\b/, 'lofi'],
];

const RADIO = 'https://all.api.radio-browser.info/json/stations/search';

/** Una emisora para lo que pides: un género ("jazz"), un nombre ("cadena 100") o, sin nada, una de las más
 *  escuchadas de España. null si no encuentra ninguna. */
export async function findRadio(query: string | null, random = Math.random): Promise<Station | null> {
  const tries: string[] = [];
  const genre = query ? GENRES.find(([re]) => re.test(query))?.[1] : null;
  if (!query) tries.push('countrycode=ES&tag=pop', 'countrycode=ES');
  else if (genre) tries.push(`countrycode=ES&tag=${genre}`, `tag=${genre}`);
  else tries.push(`countrycode=ES&name=${encodeURIComponent(query)}`, `name=${encodeURIComponent(query.replace(/\s+/g, ''))}`, `tag=${encodeURIComponent(query)}`);
  for (const qs of tries) {
    const r = await fetch(`${RADIO}?${qs}&order=clickcount&reverse=true&limit=12&hidebroken=true`, { headers: { 'User-Agent': 'Bip/1.0' } });
    if (!r.ok) continue;
    const list = (await r.json()) as { name: string; url_resolved: string; codec: string; bitrate: number }[];
    const ok = list.filter((s) => s.url_resolved && /^(mp3|aac|aac\+)$/i.test(s.codec) && !/\.m3u8/.test(s.url_resolved));
    if (!ok.length) continue;
    // sin pedir nada concreto, una de las primeras (que no sea siempre la misma); con nombre, la que más se escucha
    const pool = query && !genre ? ok.slice(0, 1) : ok.slice(0, 5);
    const s = pool[Math.floor(random() * pool.length)];
    return { name: s.name.trim().replace(/\s+/g, ' '), url: s.url_resolved };
  }
  return null;
}

// ================================================================ juego de luces
export type LightInfo = {
  id: string;
  on: boolean;
  /** 0..255 */
  brightness: number | null;
  mode: string | null;
  kelvin: number | null;
  hs: [number, number] | null;
  /** Puede cambiar de color. */
  color: boolean;
  /** Puede cambiar de tono (cálido-frío): límites en kelvin. */
  temp: { min: number; max: number } | null;
};

/** Lo que se le pide a una luz en un paso: apagarla, o encenderla con este brillo, color o tono. */
export type LightStep = { id: string; on: boolean; pct?: number; hue?: number; kelvin?: number };

export const STEP_MS = 650;

type Pattern = (lights: LightInfo[], k: number) => LightStep[];

const full = (l: LightInfo, pct = 100): LightStep => ({ id: l.id, on: true, pct });
const off = (l: LightInfo): LightStep => ({ id: l.id, on: false });

const PATTERNS: { name: string; steps: number; needs?: 'color' | 'temp' | 'two'; fn: Pattern }[] = [
  // todas a la vez: fuerte, flojo, fuerte...
  { name: 'latido', steps: 6, fn: (ls, k) => ls.map((l) => full(l, k % 2 ? 15 : 100)) },
  // una sí, otra no, y al revés
  { name: 'ping-pong', steps: 6, needs: 'two', fn: (ls, k) => ls.map((l, i) => ((i + k) % 2 ? off(l) : full(l))) },
  // se enciende una detrás de otra
  { name: 'ola', steps: 6, needs: 'two', fn: (ls, k) => ls.map((l, i) => (i === k % ls.length ? full(l) : full(l, 8))) },
  // sube poco a poco y se apaga
  { name: 'amanecer', steps: 5, fn: (ls, k) => ls.map((l) => (k === 4 ? off(l) : full(l, [10, 35, 65, 100][k]))) },
  // los colores del arcoíris, cada luz un poco por delante
  { name: 'arcoiris', steps: 7, needs: 'color', fn: (ls, k) => ls.map((l, i) => (l.color ? { id: l.id, on: true, pct: 100, hue: (k * 55 + i * 120) % 360 } : full(l, k % 2 ? 30 : 100))) },
  // de luz cálida a luz fría y vuelta
  {
    name: 'calido-frio',
    steps: 6,
    needs: 'temp',
    fn: (ls, k) => ls.map((l) => (l.temp ? { id: l.id, on: true, pct: 100, kelvin: k % 2 ? l.temp.max : l.temp.min } : full(l, k % 2 ? 40 : 100))),
  },
];

/** El guion del juego de luces: una lista de pasos (uno cada STEP_MS). */
export function lightScript(lights: LightInfo[], secs: number, random = Math.random): LightStep[][] {
  if (!lights.length) return [];
  const usable = PATTERNS.filter(
    (p) => !p.needs || (p.needs === 'two' ? lights.length >= 2 : p.needs === 'color' ? lights.some((l) => l.color) : lights.some((l) => l.temp)),
  );
  const total = Math.max(4, Math.round((secs * 1000) / STEP_MS));
  const out: LightStep[][] = [];
  let last = '';
  while (out.length < total) {
    const options = usable.filter((p) => p.name !== last);
    const p = (options.length ? options : usable)[Math.floor(random() * (options.length || usable.length))];
    last = p.name;
    for (let k = 0; k < p.steps && out.length < total; k++) out.push(p.fn(lights, k));
  }
  return out;
}

/** Cómo dejar una luz como estaba antes del juego. */
export function restoreStep(l: LightInfo): { service: 'turn_on' | 'turn_off'; data: Record<string, unknown> } {
  if (!l.on) return { service: 'turn_off', data: { entity_id: l.id } };
  const data: Record<string, unknown> = { entity_id: l.id };
  if (l.brightness != null) data.brightness = l.brightness;
  if (l.mode === 'color_temp' && l.kelvin) data.color_temp_kelvin = l.kelvin;
  else if (l.hs && l.mode && /^(hs|xy|rgb|rgbw|rgbww)$/.test(l.mode)) data.hs_color = l.hs;
  return { service: 'turn_on', data };
}

/** Un paso, dicho como lo entiende Home Assistant. */
export function stepCall(s: LightStep): { service: 'turn_on' | 'turn_off'; data: Record<string, unknown> } {
  if (!s.on) return { service: 'turn_off', data: { entity_id: s.id } };
  const data: Record<string, unknown> = { entity_id: s.id, brightness_pct: s.pct ?? 100 };
  if (s.hue != null) data.hs_color = [s.hue, 100];
  if (s.kelvin != null) data.color_temp_kelvin = s.kelvin;
  return { service: 'turn_on', data };
}

type LightCall = (service: 'turn_on' | 'turn_off', data: Record<string, unknown>) => Promise<unknown>;

/** Un juego de luces en marcha. stop() lo corta; al acabar (o al cortarlo) cada luz vuelve a como estaba. */
export class LightShow {
  running = false;
  private stopped = false;

  constructor(
    private lights: LightInfo[],
    private call: LightCall,
    private wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    private now = () => Date.now(),
  ) {}

  stop() {
    this.stopped = true;
  }

  /** onBeat se llama en cada paso (para que Bip baile a la vez). */
  async run(secs: number, onBeat?: (step: number) => void, random = Math.random) {
    this.running = true;
    const script = lightScript(this.lights, secs, random);
    try {
      for (let i = 0; i < script.length && !this.stopped; i++) {
        const t0 = this.now();
        onBeat?.(i);
        await Promise.all(
          script[i].map((s) => {
            const c = stepCall(s);
            return this.call(c.service, c.data).catch(() => undefined);
          }),
        );
        const left = STEP_MS - (this.now() - t0);
        if (left > 0 && !this.stopped) await this.wait(left);
      }
    } finally {
      await Promise.all(
        this.lights.map((l) => {
          const c = restoreStep(l);
          return this.call(c.service, c.data).catch(() => undefined);
        }),
      );
      this.running = false;
    }
  }
}
