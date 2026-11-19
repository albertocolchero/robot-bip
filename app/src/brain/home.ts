// La casa: Bip le pide cosas a Home Assistant (el "centro de la casa", que corre en un ordenador
// de casa) por el WiFi, sin pasar por internet.
// Home Assistant ya entiende frases en castellano ("enciende la luz del salón", "pon a limpiar el
// robot", "¿está encendida la tele?") con su asistente, Assist. Bip le pasa las frases que suenan a
// órdenes de la casa y dice lo que conteste. Si Assist no la entiende, la frase sigue su camino
// normal (la mente de Bip).
// Para conectarse hacen falta la dirección (por ejemplo http://homeassistant.local:8123) y un
// "token de larga duración" que se crea en Home Assistant (tu perfil › Seguridad). Se guardan solo
// en este iPhone.
import { readJSON, writeJSON } from './store';

export type HomeConfig = { url: string; token: string };
const FILE = 'casa.json';
const TIMEOUT_MS = 6000;

export function loadHome(): HomeConfig | null {
  const c = readJSON<HomeConfig>(FILE);
  return c?.url && c.token ? c : null;
}

export function saveHome(c: HomeConfig | null) {
  writeJSON(FILE, c ?? {});
}

/** "homeassistant.local:8123" → "http://homeassistant.local:8123" (sin barra al final). El puerto se
 *  escribe tal cual: 8123 es el de siempre, pero algunas instalaciones nuevas usan la dirección sin puerto. */
export function cleanUrl(raw: string) {
  let u = raw.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

const VERBS =
  /\b(enciende|encienda|enciendeme|apaga|apague|apagame|sube|baja|pon|ponme|quita|abre|cierra|activa|desactiva|arranca|para|deten|manda|aspira|limpia|bloquea|desbloquea|cambia)\b/;
const THINGS =
  /\b(luz|luces|lampara|lamparas|bombilla|bombillas|foco|focos|enchufe|enchufes|robot|aspiradora|aspirador|roborock|tele|television|persiana|persianas|calefaccion|aire|ventilador|estufa|altavoz|brillo|todo|todas|casa|salon|cocina|dormitorio|habitacion|bano|pasillo|terraza)\b/;
const QUESTIONS = /\b(esta encendid[ao]|estan encendid[ao]s|esta apagad[ao]|hay alguna luz|que luces|esta limpiando|cuanta bateria tiene el robot|donde esta el robot)\b/;

/** ¿Suena a orden (o pregunta) de la casa? names: nombres de aparatos y zonas que tiene Home Assistant. */
export function looksLikeHome(t: string, names: string[] = []): boolean {
  if (QUESTIONS.test(t)) return true;
  if (!VERBS.test(t)) return false;
  if (THINGS.test(t)) return true;
  return names.some((n) => n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
}

export type HomeReply = { understood: boolean; speech: string; done: boolean };

export class Home {
  private nameCache: { at: number; names: string[] } | null = null;

  constructor(
    private cfg: HomeConfig,
    private normalize: (s: string) => string,
  ) {}

  private async call(path: string, body?: unknown): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${this.cfg.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (r.status === 401) throw new Error('token');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Comprueba la conexión. Devuelve null si va bien, o qué falla, en palabras. */
  async check(): Promise<string | null> {
    try {
      const j = (await this.call('/api/')) as { message?: string };
      return j.message ? null : 'contesta algo raro';
    } catch (e) {
      const m = String((e as Error).message);
      if (m === 'token') return 'el token no vale (créalo otra vez en tu perfil de Home Assistant)';
      if (/abort/i.test(m)) return 'no contesta (¿está encendido el ordenador?)';
      return `no llego (${m})`;
    }
  }

  /** Nombres de aparatos y zonas (para saber si una frase va de la casa). Se refresca cada 10 minutos. */
  async names(): Promise<string[]> {
    if (this.nameCache && Date.now() - this.nameCache.at < 10 * 60_000) return this.nameCache.names;
    try {
      const states = await this.states();
      const names = [...new Set(states.flatMap((s) => [s.name, ...s.words]).filter((n) => n.length > 2))];
      this.nameCache = { at: Date.now(), names };
      return names;
    } catch {
      return this.nameCache?.names ?? [];
    }
  }

  /** Los aparatos útiles, con su estado y las palabras de su nombre ("TV Tele" → tv, tele). */
  private async states() {
    const raw = (await this.call('/api/states')) as { entity_id: string; state: string; attributes?: { friendly_name?: string } }[];
    const useful = /^(light|switch|fan|vacuum|media_player|cover|climate|humidifier|lock)\./;
    return raw
      .filter((s) => useful.test(s.entity_id) && s.attributes?.friendly_name)
      .map((s) => {
        const name = this.normalize(s.attributes!.friendly_name!);
        return { id: s.entity_id, state: s.state, name, words: name.split(' ').filter((w) => w.length >= 4) };
      });
  }

  /** El aparato del que hablas ("la tele", "el humidificador"), con cómo nombrarlo. null si no sabe cuál. */
  private async find(t: string) {
    const states = await this.states();
    const words = new Set(t.split(' '));
    const hit = states.find((s) => s.words.some((w) => words.has(w)) && !/(alarm|alarma|indicador|lock|bloque|sonido)/.test(s.id + s.name));
    if (!hit) return null;
    const word = hit.words.find((w) => words.has(w)) ?? hit.name;
    const female = /^(tele|television|luz|lampara|aspiradora|bombilla)$/.test(word);
    return { ...hit, label: `${female ? 'La' : 'El'} ${word}`, female };
  }

  /** "¿Está encendida la tele?", "¿qué hace el robot?": lo contesta mirando el estado (el asistente de
   *  Home Assistant aún no entiende bien estas preguntas en castellano). null si no sabe de qué aparato. */
  async stateAnswer(t: string): Promise<string | null> {
    const hit = await this.find(t);
    if (!hit) return null;
    const what = hit.label;
    if (hit.state === 'unavailable' || hit.state === 'unknown') return `${what} no contesta ahora mismo.`;
    if (hit.id.startsWith('vacuum.')) {
      const v: Record<string, string> = {
        docked: 'está en su base',
        cleaning: 'está limpiando',
        returning: 'está volviendo a la base',
        paused: 'está en pausa',
        idle: 'está parado',
        error: 'tiene un problema: mira la app',
      };
      return `${what} ${v[hit.state] ?? `está «${hit.state}»`}.`;
    }
    const on = /^(on|playing|paused|idle|heat|cool|open)$/.test(hit.state);
    return `${what} está ${on ? (hit.female ? 'encendida' : 'encendido') : hit.female ? 'apagada' : 'apagado'}.`;
  }

  /** Le pasa la frase al asistente de Home Assistant. understood=false si no era para él. */
  async ask(text: string): Promise<HomeReply> {
    const t = this.normalize(text);
    // frases que el asistente entiende mal en castellano, dichas como sí las entiende
    const said = rephrase(t) ?? text;
    const j = (await this.call('/api/conversation/process', { text: said, language: 'es' })) as {
      response?: { response_type?: string; speech?: { plain?: { speech?: string } }; data?: { code?: string } };
    };
    const r = j.response;
    let speech = r?.speech?.plain?.speech?.trim() ?? '';
    if (!r || r.response_type === 'error') {
      // no_valid_targets: no sabe qué aparato es; no_intent_match: no ha entendido la frase.
      // Antes de rendirse: si era una pregunta, la contesta Bip mirando el estado...
      if (/\b(esta|estan|que hace|como esta|sigue)\b/.test(t)) {
        const asked = await this.stateAnswer(t).catch(() => null);
        if (asked) return { understood: true, speech: asked, done: false };
      }
      // ...y si era encender o apagar algo que conoce, lo hace él directamente
      const service = /\b(enciende|encienda|enciendeme|activa)\b/.test(t) ? 'turn_on' : /\b(apaga|apague|apagame|desactiva)\b/.test(t) ? 'turn_off' : null;
      const hit = service ? await this.find(t).catch(() => null) : null;
      if (service && hit && !hit.id.startsWith('vacuum.')) {
        await this.call(`/api/services/homeassistant/${service}`, { entity_id: hit.id });
        const done = service === 'turn_on' ? (hit.female ? 'encendida' : 'encendido') : hit.female ? 'apagada' : 'apagado';
        return { understood: true, speech: `Hecho: ${hit.label.toLowerCase()}, ${done}.`, done: true };
      }
      if (r?.data?.code === 'no_valid_targets') return { understood: true, speech: speech || 'No encuentro ese aparato en casa.', done: false };
      return { understood: false, speech: '', done: false };
    }
    if (speech === 'Ningún dispositivo') speech = 'Ninguno.';
    return { understood: true, speech: speech || 'Hecho.', done: r.response_type === 'action_done' };
  }
}

/** El robot, dicho como lo entiende el asistente de Home Assistant ("pon a limpiar el robot" lo confundía
 *  con poner música). null si no hace falta cambiar nada. (Texto ya normalizado.) */
export function rephrase(t: string): string | null {
  if (!/\b(robot|aspiradora|aspirador|roborock)\b/.test(t)) return null;
  if (/\b(para|parar|deten|detente|apaga|vuelve|vuelva|volver|base|cargar|carga)\b/.test(t)) return 'manda el robot a la base';
  if (/\b(limpia|limpiar|limpie|pasa|pasar|pon|arranca|empieza|inicia|enciende|aspira|aspirar)\b/.test(t)) return 'inicia el robot';
  return null;
}
