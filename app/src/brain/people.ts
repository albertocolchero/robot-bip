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
  /** Cuántas huellas ha recibido en total, y con cuántas decidió la última vez. */
  prints: number;
  checked: number;
  /** ¿Ya ha dicho algo de esta cara (saludo, "¿eres...?", "¿cómo te llamas?")? Entonces no vuelve a preguntar. */
  spoken: boolean;
  /** Personas que esta cara ha dicho que no es ("no soy Luis"). */
  rejected: string[];
  lastSampleAt: number;
};

export type WhoEvent =
  /** late: lo ha sabido después de dudar (o tras cruzaros): no hace falta saludar otra vez. */
  | { kind: 'conocido'; track: number; person: Person; absentMs: number; late?: boolean }
  | { kind: 'duda'; track: number; person: Person; other?: Person }
  | { kind: 'nuevo'; track: number }
  | { kind: 'mascota'; animal: 'perro' | 'gato'; pet: Person | null };

const FILE = 'personas.json';
const MAX_SAMPLES = 32;
/** Para reconocerte le bastan 2 huellas; para dudar o preguntar, espera a tener 4 (o 6 segundos). */
const SURE_PRINTS = 2;
const ASK_PRINTS = 4;
const ASK_AFTER_MS = 6000;

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

/** Si hay demasiadas huellas, quita la más repetida (la que más se parece a otra), no la más vieja:
 *  así recuerda cómo eres con distintas luces y días, y no solo cómo estabas hace un rato. */
function keepVaried(list: number[][], dist: (a: number[], b: number[]) => number) {
  const out = [...list];
  while (out.length > MAX_SAMPLES) {
    let drop = 0;
    let closest = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = dist(out[i], out[j]);
        if (d < closest) {
          closest = d;
          drop = i; // de las dos más parecidas, se queda la más reciente
        }
      }
    }
    out.splice(drop, 1);
  }
  return out;
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
  /** Para el registro: por qué ha decidido lo que ha decidido (puntuaciones de cada cara). */
  onNote: ((text: string) => void) | null = null;

  private note(text: string) {
    this.onNote?.(text);
  }

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
        tr = {
          id: this.nextTrack++,
          x: f.x,
          y: f.y,
          size: f.size,
          firstAt: t,
          lastAt: t,
          personId: null,
          sure: false,
          fps: [],
          geos: [],
          prints: 0,
          checked: 0,
          spoken: false,
          rejected: [],
          lastSampleAt: 0,
        };
        this.tracks.push(tr);
      }
      used.add(tr.id);
      Object.assign(tr, { x: f.x, y: f.y, size: f.size, lastAt: t });
      if (f.fp) {
        tr.fps = [...tr.fps, f.fp].slice(-8);
        tr.prints++;
      }
      if (geo && f === largest) tr.geos = [...tr.geos, geo].slice(-8);
    }
    // caras que se han ido
    for (const tr of this.tracks) {
      if (t - tr.lastAt > 2500 && tr.personId) {
        const p = this.byId(tr.personId);
        if (p) p.lastSeen = tr.lastAt;
      }
    }
    this.tracks = this.tracks.filter((tr) => t - tr.lastAt <= 2500);
    // y ahora, quién es cada una (todas a la vez: si sois dos, no os puede confundir con la misma persona)
    const now = this.tracks.filter((tr) => tr.lastAt === t);
    // primero, las que ya conocía: ¿siguen siendo quien creía? (si os cruzáis, se cambian de hueco)
    for (const tr of now) if (tr.sure && tr.personId && tr.prints !== tr.checked) this.verify(tr);
    for (const tr of now) {
      if (tr.sure && tr.personId) this.learnMore(tr, t);
      // sin decidir aún (o dudando): vuelve a mirar con cada huella nueva
      else if (tr.prints !== tr.checked && tr.fps.length >= SURE_PRINTS && t - tr.firstAt > 1500) {
        const ev = this.decide(tr, t);
        if (ev) events.push(ev);
      }
      tr.checked = tr.prints;
    }
    return events;
  }

  /** A quién se parece esta cara, de más a menos, sin contar a quien ya está en otra cara. */
  private rank(tr: Track) {
    const others = this.tracks.filter((x) => x !== tr);
    const busy = new Set(others.filter((x) => x.sure && x.personId).map((x) => x.personId as string));
    const candidates = this.humans.filter((p) => !busy.has(p.id) && !tr.rejected.includes(p.id));
    let ranked = candidates
      .filter((p) => p.fps.length)
      .map((p) => ({ p, s: scoreOf(p, tr.fps, tr.geos) }))
      .sort((a, b) => a.s - b.s);
    // dos caras a la vez: si la otra se parece aún más a la misma persona, esa persona es la otra
    for (const o of others) {
      if (o.sure || o.fps.length < SURE_PRINTS || ranked.length < 2) continue;
      const top = ranked[0];
      const theirs = scoreOf(top.p, o.fps, o.geos);
      const theirBest = Math.min(
        ...candidates.filter((p) => p.fps.length && !o.rejected.includes(p.id)).map((p) => scoreOf(p, o.fps, o.geos)),
      );
      if (theirs <= theirBest && theirs < top.s) ranked = ranked.slice(1);
    }
    return { candidates, ranked };
  }

  private decide(tr: Track, t: number): WhoEvent | null {
    const { candidates, ranked } = this.rank(tr);
    const [best, second] = ranked;
    if (!best) {
      if (tr.spoken) return null;
      tr.spoken = true;
      // conoce un nombre pero aún no su cara: "¿Eres Luis?"
      const named = candidates.find((p) => p.name);
      if (named) {
        tr.personId = named.id;
        this.note(`cara ${tr.id}: aún no conozco la cara de nadie; pregunto si es ${named.name}`);
        return { kind: 'duda', track: tr.id, person: named };
      }
      this.note(`cara ${tr.id}: no conozco a nadie con cara; pregunto el nombre`);
      return { kind: 'nuevo', track: tr.id };
    }
    const sp = best.p.spread;
    const scores = ranked
      .slice(0, 3)
      .map((r) => `${r.p.name ?? '?'} ${r.s.toFixed(3)}`)
      .join(', ');
    const why = `cara ${tr.id} (${tr.fps.length} huellas): ${scores}; margen de ${best.p.name ?? '?'} ${sp ? (sp * 2.5).toFixed(3) : 'sin aprender'}`;
    // seguro: se parece a alguien dentro de lo que suele variar su cara, y bastante más que al siguiente
    const clear = !second || best.s < second.s * 0.7;
    const close = sp > 0 && best.s <= sp * 2.5;
    const apart = !!second && best.s < second.s * 0.55 && (sp === 0 || best.s <= sp * 5);
    if (clear && (close || apart)) {
      const late = tr.spoken;
      tr.personId = best.p.id;
      tr.sure = true;
      tr.spoken = true;
      // una persona no puede ser dos caras: si otra cara dudaba de ella, deja de hacerlo
      for (const o of this.tracks) if (o !== tr && !o.sure && o.personId === best.p.id) o.personId = null;
      const absent = best.p.lastSeen ? t - best.p.lastSeen : Infinity;
      this.updateSpread(best.p, tr.fps);
      best.p.lastSeen = t;
      this.save();
      this.note(`${why} → es ${best.p.name}${late ? ' (ahora sí)' : ''}`);
      return { kind: 'conocido', track: tr.id, person: best.p, absentMs: absent, late };
    }
    // ya preguntó por esta cara: no vuelve a preguntar (sigue mirando por si se aclara)
    if (tr.spoken) {
      tr.personId = best.p.id;
      return null;
    }
    // para dudar o decir que no te conoce, espera a tener más huellas
    if (tr.fps.length < ASK_PRINTS && t - tr.firstAt < ASK_AFTER_MS) return null;
    tr.spoken = true;
    // alguien muy distinto de todos los que conoce es una persona nueva
    // (si se equivoca y eres tú, al decirle tu nombre aprende que tu cara varía más de lo que creía)
    if (sp > 0 && best.s > sp * 8 && (!second || best.s > second.s * 0.8)) {
      this.note(`${why} → no se parece a nadie: pregunto el nombre`);
      return { kind: 'nuevo', track: tr.id };
    }
    tr.personId = best.p.id;
    const other = second && best.s > second.s * 0.85 ? second.p : undefined;
    this.note(`${why} → dudo: ¿${best.p.name}${other ? ` o ${other.name}` : ''}?`);
    return { kind: 'duda', track: tr.id, person: best.p, other };
  }

  /** Con cada huella nueva, comprueba que sigue siendo quien creía (si os cruzáis, las caras se pueden cambiar de sitio). */
  private verify(tr: Track) {
    const p = this.byId(tr.personId);
    if (!p || tr.fps.length < 2) return;
    const recent = tr.fps.slice(-2);
    const geos = tr.geos.slice(-2);
    const mine = scoreOf(p, recent, geos);
    // se compara con todos (también con quien está en la otra cara: si os habéis cruzado, las dos están mal)
    const rival = Math.min(Infinity, ...this.humans.filter((q) => q !== p && q.fps.length).map((q) => scoreOf(q, recent, geos)));
    if (rival < mine * 0.6 && (!p.spread || mine > p.spread * 2.5)) {
      this.note(`cara ${tr.id}: ya no parece ${p.name} (${mine.toFixed(3)} frente a ${rival.toFixed(3)}); vuelvo a mirar`);
      Object.assign(tr, { sure: false, personId: null, fps: recent, geos, firstAt: tr.lastAt - 1600 });
    }
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
    p.fps = keepVaried([...p.fps, ...fps.map(round)], cosDist);
    p.geos = keepVaried([...p.geos, ...geos.map(round)], geoDist);
  }

  /** Mientras sabe quién eres, guarda de vez en cuando huellas nuevas (con otra luz, otro peinado...). */
  private learnMore(tr: Track, t: number) {
    if (t - tr.lastSampleAt < 30_000 || !tr.fps.length) return;
    const p = this.byId(tr.personId);
    if (!p) return;
    tr.lastSampleAt = t;
    p.lastSeen = t;
    // solo aprende de huellas que de verdad se parecen más a las suyas que a las de los demás
    // (si no, con el tiempo la cara de Luis se iría "manchando" con la de Ana)
    const last = tr.fps.slice(-1);
    const lastGeo = tr.geos.slice(-1);
    const mine = scoreOf(p, last, lastGeo);
    const rival = Math.min(Infinity, ...this.humans.filter((q) => q !== p && q.fps.length).map((q) => scoreOf(q, last, lastGeo)));
    if (mine > rival * 0.8) return;
    this.addSamples(p, last, lastGeo);
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
      tr.spoken = true;
      tr.rejected = tr.rejected.filter((id) => id !== p.id);
      tr.lastSampleAt = this.now();
      // y si otra cara creía ser esta persona, deja de creerlo
      for (const o of this.tracks) {
        if (o !== tr && o.personId === p.id) Object.assign(o, { personId: null, sure: false });
      }
      this.addSamples(p, tr.fps, tr.geos);
      if (!p.spread && tr.fps.length > 1) {
        // primera vez: una estimación prudente a partir de lo que ha variado durante este rato
        let d = 0;
        for (let i = 1; i < tr.fps.length; i++) d = Math.max(d, cosDist(tr.fps[i], tr.fps[i - 1]));
        p.spread = d * 3;
      }
      this.note(`cara ${tr.id}: me confirmas que es ${p.name} (margen ${(p.spread * 2.5).toFixed(3)}, ${p.fps.length} huellas guardadas)`);
    }
    p.lastSeen = this.now();
    this.save();
    return p;
  }

  /** "No soy Luis": esa cara no es quien pensaba. */
  reject(trackId: number | null) {
    const tr = this.tracks.find((x) => x.id === trackId);
    if (tr) {
      if (tr.personId) {
        tr.rejected.push(tr.personId);
        this.note(`cara ${tr.id}: me dices que no es ${this.byId(tr.personId)?.name ?? '?'}`);
      }
      tr.personId = null;
      tr.sure = false;
      tr.spoken = true;
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
