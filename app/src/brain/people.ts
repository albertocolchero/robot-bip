// Las personas (y mascotas) que conoce Bip, y quién está delante ahora mismo.
// Cómo distingue caras: cada cara cercana trae, de vez en cuando, una "huella" (Vision) y sus
// proporciones (MediaPipe). Bip sigue cada cara mientras está a la vista (si no desaparece, es la
// misma persona), junta varias huellas y las compara con las de la gente que conoce.
//  - Si se parece claramente a alguien: le saluda por su nombre.
//  - Si duda: pregunta "¿Eres Ana?". Con la respuesta aprende cuánto varía la cara de cada uno.
//  - Si no se parece a nadie: pregunta cómo se llama y la guarda.
// No es un reconocimiento facial de laboratorio: con pocas personas en casa suele bastar, y
// cuanto más os ve, mejor os distingue. Todo se queda dentro del iPhone.
import type { SeenAnimal, SeenFace } from '../../modules/bip-senses';
import { readJSON, writeJSON } from './store';
import { normalize } from './talk';

export type PersonKind = 'persona' | 'perro' | 'gato';

export type Person = {
  id: string;
  name: string | null;
  kind: PersonKind;
  /** Huellas guardadas de su cara. */
  fps: number[][];
  /** Proporciones de su cara. */
  geos: number[][];
  /** Cuánto varía su huella de un día a otro (se aprende al confirmar quién es). 0 = aún no se sabe. */
  spread: number;
  created: number;
  lastSeen: number;
};

type Track = {
  id: number;
  x: number;
  y: number;
  size: number;
  firstAt: number;
  lastAt: number;
  personId: string | null;
  sure: boolean;
  fps: number[][];
  geos: number[][];
  decided: boolean;
  lastSampleAt: number;
};

export type WhoEvent =
  | { kind: 'conocido'; track: number; person: Person; absentMs: number }
  | { kind: 'duda'; track: number; person: Person; other?: Person }
  | { kind: 'nuevo'; track: number }
  | { kind: 'mascota'; animal: 'perro' | 'gato'; pet: Person | null };

const FILE = 'personas.json';
const MAX_SAMPLES = 24;

function cosDist(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? 1 - dot / Math.sqrt(na * nb) : 1;
}

function geoDist(a: number[], b: number[]) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]) / Math.max(0.05, (a[i] + b[i]) / 2);
  return n ? s / n : 0;
}

/** Lo cerca que está un conjunto de huellas de las de una persona (menos = más parecido). */
function scoreOf(p: Person, fps: number[][], geos: number[][]) {
  if (!p.fps.length || !fps.length) return Infinity;
  const fp = fps.reduce((acc, f) => acc + Math.min(...p.fps.map((g) => cosDist(f, g))), 0) / fps.length;
  if (!p.geos.length || !geos.length) return fp;
  const geo = geos.reduce((acc, f) => acc + Math.min(...p.geos.map((g) => geoDist(f, g))), 0) / geos.length;
  return fp * (1 + Math.min(1, geo * 3)); // las proporciones ayudan a separar, sin mandar
}

export class People {
  persons: Person[];
  private tracks: Track[] = [];
  private nextTrack = 1;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private petSeen = new Map<string, { since: number; last: number; greeted: number }>();

  constructor(legacyName: string | null, private now: () => number = () => Date.now()) {
    this.persons = readJSON<Person[]>(FILE) ?? [];
    // si Bip ya sabía un nombre de antes (versiones anteriores), empieza conociéndolo (sin cara aún)
    if (!this.persons.length && legacyName) this.persons.push(this.make(legacyName, 'persona'));
  }

  private make(name: string | null, kind: PersonKind): Person {
    const t = this.now();
    return { id: `${kind}-${t}-${Math.round(Math.random() * 1e6)}`, name, kind, fps: [], geos: [], spread: 0, created: t, lastSeen: 0 };
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeJSON(FILE, this.persons);
    }, 1500);
  }

  get humans() {
    return this.persons.filter((p) => p.kind === 'persona');
  }

  get pets() {
    return this.persons.filter((p) => p.kind !== 'persona');
  }

  byId(id: string | null) {
    return id ? (this.persons.find((p) => p.id === id) ?? null) : null;
  }

  byName(name: string) {
    const k = normalize(name);
    return this.persons.find((p) => p.name && normalize(p.name) === k) ?? null;
  }

  /** Todos los nombres que conoce (personas y mascotas). */
  names() {
    return this.persons.map((p) => p.name).filter((n): n is string => !!n);
  }

  // ---------------------------------------------------------------- caras
  /** Recibe las caras de un fotograma. Devuelve lo que haya que decir (reconocido, duda, nuevo). */
  feed(faces: SeenFace[], geo: number[] | undefined, t = this.now()): WhoEvent[] {
    const events: WhoEvent[] = [];
    const used = new Set<number>();
    const largest = faces.reduce<SeenFace | null>((b, f) => (!b || f.size > b.size ? f : b), null);
    for (const f of faces) {
      let tr = this.tracks
        .filter((x) => !used.has(x.id) && t - x.lastAt < 2500)
        .map((x) => ({ x, d: Math.hypot(x.x - f.x, x.y - f.y) }))
        .filter((c) => c.d < 0.25)
        .sort((a, b) => a.d - b.d)[0]?.x;
      if (!tr) {
        tr = { id: this.nextTrack++, x: f.x, y: f.y, size: f.size, firstAt: t, lastAt: t, personId: null, sure: false, fps: [], geos: [], decided: false, lastSampleAt: 0 };
        this.tracks.push(tr);
      }
      used.add(tr.id);
      Object.assign(tr, { x: f.x, y: f.y, size: f.size, lastAt: t });
      if (f.fp) tr.fps = [...tr.fps, f.fp].slice(-8);
      if (geo && f === largest) tr.geos = [...tr.geos, geo].slice(-8);
      if (tr.sure && tr.personId) this.learnMore(tr, t);
      if (!tr.decided && tr.fps.length >= 2 && t - tr.firstAt > 1500) {
        tr.decided = true;
        const ev = this.decide(tr, t);
        if (ev) events.push(ev);
      }
    }
    // caras que se han ido
    for (const tr of this.tracks) {
      if (t - tr.lastAt > 2500 && tr.personId) {
        const p = this.byId(tr.personId);
        if (p) p.lastSeen = tr.lastAt;
      }
    }
    this.tracks = this.tracks.filter((tr) => t - tr.lastAt <= 2500);
    return events;
  }

  private decide(tr: Track, t: number): WhoEvent | null {
    const busy = new Set(this.tracks.filter((x) => x !== tr && x.sure && x.personId).map((x) => x.personId));
    const known = this.humans.filter((p) => !busy.has(p.id));
    const withFace = known.filter((p) => p.fps.length);
    if (!withFace.length) {
      // conoce un nombre pero aún no su cara: "¿Eres Luis?"
      const named = known.find((p) => p.name);
      if (named) {
        tr.personId = named.id;
        return { kind: 'duda', track: tr.id, person: named };
      }
      return { kind: 'nuevo', track: tr.id };
    }
    const ranked = withFace.map((p) => ({ p, s: scoreOf(p, tr.fps, tr.geos) })).sort((a, b) => a.s - b.s);
    const [best, second] = ranked;
    const sure = best.p.spread > 0 && best.s <= best.p.spread * 2.5;
    const clear = !second || best.s < second.s * 0.7;
    if (sure && clear) {
      tr.personId = best.p.id;
      tr.sure = true;
      const absent = best.p.lastSeen ? t - best.p.lastSeen : Infinity;
      this.updateSpread(best.p, tr.fps);
      best.p.lastSeen = t;
      this.save();
      return { kind: 'conocido', track: tr.id, person: best.p, absentMs: absent };
    }
    // alguien muy distinto de todos los que conoce es una persona nueva
    // (si se equivoca y eres tú, al decirle tu nombre aprende que tu cara varía más de lo que creía)
    if (best.p.spread > 0 && best.s > best.p.spread * 8 && (!second || best.s > second.s * 0.8)) {
      return { kind: 'nuevo', track: tr.id };
    }
    tr.personId = best.p.id;
    return { kind: 'duda', track: tr.id, person: best.p, other: second && best.s > second.s * 0.85 ? second.p : undefined };
  }

  /** Aprende cuánto varía la cara de alguien de una vez a otra (con huellas de otra sesión). */
  private updateSpread(p: Person, fps: number[][]) {
    if (!p.fps.length || !fps.length) return;
    const d = Math.min(...p.fps.map((g) => cosDist(fps[0], g)));
    p.spread = p.spread ? p.spread * 0.7 + d * 0.3 : d * 1.2;
  }

  private addSamples(p: Person, fps: number[][], geos: number[][]) {
    // con 4 decimales basta, y el archivo pesa mucho menos
    const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
    p.fps = [...p.fps, ...fps.map(round)].slice(-MAX_SAMPLES);
    p.geos = [...p.geos, ...geos.map(round)].slice(-MAX_SAMPLES);
  }

  /** Mientras sabe quién eres, guarda de vez en cuando huellas nuevas (con otra luz, otro peinado...). */
  private learnMore(tr: Track, t: number) {
    if (t - tr.lastSampleAt < 30_000 || !tr.fps.length) return;
    const p = this.byId(tr.personId);
    if (!p) return;
    tr.lastSampleAt = t;
    p.lastSeen = t;
    this.addSamples(p, tr.fps.slice(-1), tr.geos.slice(-1));
    this.save();
  }

  /** Ya sabe quién es esa cara (porque te lo ha dicho o lo ha confirmado). Devuelve la persona. */
  confirm(trackId: number | null, name: string): Person {
    const tr = this.tracks.find((x) => x.id === trackId) ?? null;
    let p = this.byName(name);
    if (p && p.kind !== 'persona') p = null;
    if (!p) {
      p = this.make(name, 'persona');
      this.persons.push(p);
    } else if (tr) {
      this.updateSpread(p, tr.fps);
    }
    if (tr) {
      // si esa cara estaba asignada a otra persona por error, se corrige
      tr.personId = p.id;
      tr.sure = true;
      tr.decided = true;
      tr.lastSampleAt = this.now();
      this.addSamples(p, tr.fps, tr.geos);
      if (!p.spread && tr.fps.length > 1) {
        // primera vez: una estimación prudente a partir de lo que ha variado durante este rato
        let d = 0;
        for (let i = 1; i < tr.fps.length; i++) d = Math.max(d, cosDist(tr.fps[i], tr.fps[i - 1]));
        p.spread = d * 3;
      }
    }
    p.lastSeen = this.now();
    this.save();
    return p;
  }

  /** "No soy Luis": esa cara no es quien pensaba. */
  reject(trackId: number | null) {
    const tr = this.tracks.find((x) => x.id === trackId);
    if (tr) {
      tr.personId = null;
      tr.sure = false;
    }
  }

  /** La cara más cercana (la que probablemente te está hablando). */
  speakerTrack(): number | null {
    const tr = [...this.tracks].sort((a, b) => b.size - a.size)[0];
    return tr ? tr.id : null;
  }

  /** Otra cara que no es la de quien habla (para "te presento a Ana"). */
  otherTrack(): number | null {
    const sorted = [...this.tracks].sort((a, b) => b.size - a.size);
    return sorted[1]?.id ?? null;
  }

  speaker(): Person | null {
    const tr = [...this.tracks].sort((a, b) => b.size - a.size)[0];
    return tr && tr.sure ? this.byId(tr.personId) : null;
  }

  /** Cuántas caras hay delante ahora. */
  faceCount() {
    return this.tracks.length;
  }

  /** Personas reconocidas que están delante ahora mismo. */
  present(): Person[] {
    return this.tracks
      .filter((x) => x.sure && x.personId)
      .map((x) => this.byId(x.personId))
      .filter((p): p is Person => !!p);
  }

  forget(id: string) {
    this.persons = this.persons.filter((p) => p.id !== id);
    for (const tr of this.tracks) if (tr.personId === id) Object.assign(tr, { personId: null, sure: false });
    writeJSON(FILE, this.persons);
  }

  forgetAll() {
    this.persons = [];
    this.tracks = [];
    writeJSON(FILE, this.persons);
  }

  rename(id: string, name: string) {
    const p = this.byId(id);
    if (p) {
      p.name = name;
      this.save();
    }
  }

  // ---------------------------------------------------------------- mascotas
  /** Ve perros o gatos. Avisa (como mucho cada 20 minutos) para saludarlos o preguntar su nombre. */
  feedAnimals(animals: SeenAnimal[] | undefined, t = this.now()): WhoEvent[] {
    if (!animals) return [];
    const events: WhoEvent[] = [];
    for (const kind of ['perro', 'gato'] as const) {
      const seen = animals.some((a) => a.kind === kind && a.confidence > 0.65);
      const st = this.petSeen.get(kind) ?? { since: 0, last: 0, greeted: -Infinity };
      if (seen) {
        if (!st.since || t - st.last > 10_000) st.since = t;
        st.last = t;
        if (t - st.since > 2500 && t - st.greeted > 20 * 60_000) {
          st.greeted = t;
          const pet = this.persons.find((p) => p.kind === kind) ?? null;
          if (pet) {
            pet.lastSeen = t;
            this.save();
          }
          events.push({ kind: 'mascota', animal: kind, pet });
        }
      }
      this.petSeen.set(kind, st);
    }
    return events;
  }

  /** ¿Está el perro (o el gato) a la vista ahora? */
  petVisible(kind: 'perro' | 'gato', t = this.now()) {
    const st = this.petSeen.get(kind);
    return !!st && t - st.last < 4000;
  }

  namePet(kind: 'perro' | 'gato', name: string): Person {
    let pet = this.persons.find((p) => p.kind === kind) ?? null;
    if (!pet) {
      pet = this.make(name, kind);
      this.persons.push(pet);
    } else pet.name = name;
    pet.lastSeen = this.now();
    this.save();
    return pet;
  }

  /** Para la mente: quién hay y quién habla. */
  describe(): string {
    const here = this.present();
    const speaker = this.speaker();
    const bits: string[] = [];
    if (here.length > 1) bits.push(`Delante tienes a ${here.map((p) => p.name ?? 'alguien').join(' y a ')}.`);
    if (speaker?.name) bits.push(`Te habla ${speaker.name}.`);
    else if (this.tracks.length) bits.push('No sabes seguro quién te habla.');
    for (const pet of this.pets) {
      if (pet.name && this.petVisible(pet.kind as 'perro' | 'gato')) bits.push(`También ves a ${pet.name}, el ${pet.kind} de casa.`);
    }
    const others = this.humans.filter((p) => p.name && !here.includes(p)).map((p) => p.name);
    if (others.length) bits.push(`También conoces a: ${others.join(', ')}.`);
    return bits.join(' ');
  }
}
