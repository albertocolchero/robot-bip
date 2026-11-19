// Dónde guarda Bip sus recuerdos (memoria, diario, ánimo).
// La app le conecta el almacén del iPhone al arrancar; las pruebas usan uno en memoria.
export type StorageBackend = {
  readText(name: string): string | null;
  writeText(name: string, text: string): void;
};

const scratch = new Map<string, string>();
let backend: StorageBackend = {
  readText: (name) => scratch.get(name) ?? null,
  writeText: (name, text) => {
    scratch.set(name, text);
  },
};

export function setStorage(b: StorageBackend) {
  backend = b;
}

export function readJSON<T>(name: string): T | null {
  try {
    const raw = backend.readText(name);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // vacío o dañado: se empieza de cero
  }
}

export function writeJSON(name: string, value: unknown) {
  try {
    backend.writeText(name, JSON.stringify(value));
  } catch {
    // si no se puede guardar, lo recordará hasta que se cierre la app
  }
}
