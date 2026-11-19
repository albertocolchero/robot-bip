// Internet para Bip: la mente sigue dentro del iPhone; esto solo consulta datos.
// Servicios gratuitos y sin registro. Lo único que sale del iPhone son las palabras
// de la búsqueda (o la ciudad, para el tiempo): ni tu voz, ni tu cara, ni tu nombre.
//  - Wikipedia en español y DuckDuckGo: "¿qué es...?", "¿quién fue...?"
//  - Open-Meteo: el tiempo
//  - Portadas de El País y El Mundo: titulares
const UA = 'BipRobot/1.0 (https://github.com/albertocolchero/robot-bip)';
const TIMEOUT_MS = 7000;

export type Place = { name: string; lat: number; lon: number };
export type Found = { source: string; title: string; text: string };

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'Api-User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

/** Quita lo que estorba al leerlo en voz alta: paréntesis, pronunciaciones, espacios raros. */
export function tidy(text: string, max = 420) {
  let t = text.replace(/[​‎‏]/g, '');
  for (let i = 0; i < 3; i++) t = t.replace(/\s*\([^()]*\)/g, '');
  t = t.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const dot = cut.lastIndexOf('. ');
  return dot > max * 0.5 ? cut.slice(0, dot + 1) : `${cut.trimEnd()}…`;
}

async function wikipedia(q: string): Promise<Found | null> {
  const url =
    'https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=1&prop=extracts&exintro=1' +
    `&explaintext=1&exsentences=3&format=json&formatversion=2&origin=*&gsrsearch=${encodeURIComponent(q)}`;
  const j = (await (await get(url)).json()) as { query?: { pages?: { title: string; extract?: string }[] } };
  const p = j.query?.pages?.[0];
  if (!p?.extract) return null;
  return { source: 'Wikipedia', title: p.title, text: tidy(p.extract) };
}

async function duckduckgo(q: string): Promise<Found | null> {
  const url = `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&kl=es-es&q=${encodeURIComponent(q)}`;
  const j = (await (await get(url)).json()) as { Answer?: string; AbstractText?: string; Heading?: string; Definition?: string };
  const text = j.Answer || j.AbstractText || j.Definition;
  if (!text) return null;
  return { source: 'DuckDuckGo', title: j.Heading || q, text: tidy(String(text)) };
}

/** Quita lo que estorba para buscar: el nombre de Bip y el "¿quién fue...?" del principio. */
export function cleanQuery(q: string) {
  let t = q.replace(/[¿?¡!«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(/^(bip|vip|pip|oye|dime|sabes|me dices|busca(me)?|buscar|en internet)\b[\s,]*/i, '')
      .replace(/^(qu[eé] es|qu[eé] son|qu[eé] significa|qui[eé]n es|qui[eé]n fue|qui[eé]nes son|qui[eé]nes fueron|cu[aá]l es|c[oó]mo se llama)\b\s*/i, '')
      .replace(/^(el|la|los|las|un|una)\s+(?=\S+\s*$)/i, '')
      .trim();
  }
  return t;
}

/** Busca algo. Devuelve null si no encuentra nada; lanza error si no hay internet. */
export async function search(q: string): Promise<Found | null> {
  const query = cleanQuery(q);
  if (!query) return null;
  let failures = 0;
  for (const source of [wikipedia, duckduckgo]) {
    try {
      const f = await source(query);
      if (f) return f;
    } catch {
      failures++;
    }
  }
  if (failures === 2) throw new Error('sin-internet');
  return null;
}

// ------------------------------------------------------------------ el tiempo
export async function geocode(city: string): Promise<Place | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&format=json&name=${encodeURIComponent(city)}`;
  const j = (await (await get(url)).json()) as { results?: { name: string; latitude: number; longitude: number }[] };
  const r = j.results?.[0];
  return r ? { name: r.name, lat: r.latitude, lon: r.longitude } : null;
}

/** Códigos del tiempo de la OMM, en palabras. */
export function sky(code: number) {
  if (code === 0) return 'despejado';
  if (code <= 2) return 'algo nublado';
  if (code === 3) return 'nublado';
  if (code <= 48) return 'con niebla';
  if (code <= 57) return 'con llovizna';
  if (code <= 67) return 'con lluvia';
  if (code <= 77) return 'con nieve';
  if (code <= 82) return 'con chubascos';
  if (code <= 86) return 'con chubascos de nieve';
  return 'con tormenta';
}

export type Weather = {
  place: string;
  now: { temp: number; sky: string };
  today: { max: number; min: number; rain: number; sky: string };
  tomorrow: { max: number; min: number; rain: number; sky: string };
};

export async function weather(p: Place): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=2';
  const j = (await (await get(url)).json()) as {
    current: { temperature_2m: number; weather_code: number };
    daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  };
  const day = (i: number) => ({
    max: Math.round(j.daily.temperature_2m_max[i]),
    min: Math.round(j.daily.temperature_2m_min[i]),
    rain: j.daily.precipitation_probability_max[i] ?? 0,
    sky: sky(j.daily.weather_code[i]),
  });
  return { place: p.name, now: { temp: Math.round(j.current.temperature_2m), sky: sky(j.current.weather_code) }, today: day(0), tomorrow: day(1) };
}

/** El tiempo en una o dos frases cortas. */
export function sayWeather(w: Weather, when: 'hoy' | 'mañana' = 'hoy'): string[] {
  if (when === 'mañana') {
    const t = w.tomorrow;
    const lines = [`Mañana en ${w.place}: ${t.sky}, entre ${t.min} y ${t.max} grados.`];
    if (t.rain >= 50) lines.push(`Hay un ${t.rain} % de probabilidad de lluvia: ¡paraguas!`);
    return lines;
  }
  const lines = [`En ${w.place} hace ${w.now.temp} grados y está ${w.now.sky}.`, `Hoy, entre ${w.today.min} y ${w.today.max} grados.`];
  if (w.today.rain >= 50) lines.push(`Y puede llover (${w.today.rain} %): ¡coge paraguas!`);
  return lines;
}

// ------------------------------------------------------------------ titulares
const FEEDS = [
  { name: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' },
  { name: 'El Mundo', url: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml' },
];

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export async function headlines(n = 3): Promise<{ source: string; titles: string[] }> {
  for (const f of FEEDS) {
    try {
      const xml = await (await get(f.url)).text();
      const items = xml.split(/<item[\s>]/).slice(1);
      const titles = items
        .map((it) => it.match(/<title>([\s\S]*?)<\/title>/)?.[1])
        .filter((t): t is string => !!t)
        .map(decode)
        .filter((t) => t.length > 10)
        .slice(0, n);
      if (titles.length) return { source: f.name, titles };
    } catch {
      // probamos el siguiente periódico
    }
  }
  throw new Error('sin-internet');
}
