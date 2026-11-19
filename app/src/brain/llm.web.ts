// Versión de navegador: no hay modelo de verdad, solo respuestas de prueba
// para comprobar que la cara, los subtítulos, la memoria, las fichas y las búsquedas funcionan.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Brain = {
  complete(messages: ChatMessage[], schema: object, maxTokens: number): Promise<string>;
  release(): Promise<void>;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loadBrain(_path: string, onProgress?: (fraction: number) => void): Promise<Brain> {
  for (let i = 1; i <= 4; i++) {
    await wait(250);
    onProgress?.(i / 4);
  }
  return {
    async complete(messages, schema) {
      await wait(900);
      const last = messages[messages.length - 1]?.content ?? '';
      const props = (schema as { properties?: Record<string, unknown> }).properties ?? {};
      if ('apuntes' in props) {
        return JSON.stringify({ apuntes: /perro/i.test(last) ? [{ nombre: 'Toby', tipo: 'animal', dato: 'es su perro y le encanta correr' }] : [] });
      }
      if ('diario' in props) {
        return JSON.stringify({ diario: 'Hoy ha sido un día tranquilo. Hemos charlado un rato y me lo he pasado bien.' });
      }
      const found = last.match(/En (.+?) pone: «(.+?)»/);
      if (found) {
        return JSON.stringify({ emocion: 'contento', frase: `¡Lo encontré en ${found[1]}! ${found[2].slice(0, 110)}` });
      }
      if ('buscar' in props) {
        const q = last.match(/te dice: «(.+?)»/)?.[1] ?? '';
        const words = q.replace(/[¿?]/g, '').replace(/^(bip|vip),?\s*/i, '').replace(/^(que es|qué es|quien es|quién es|quien fue|quién fue)\s+/i, '').trim();
        return JSON.stringify({ emocion: 'pensando', frase: 'Déjame que lo busque.', buscar: words.slice(0, 50) });
      }
      if (last.includes('Nadie te ha dicho nada')) {
        return JSON.stringify({ emocion: 'curioso', frase: '¿Sigues ahí? Me aburro un poquito.' });
      }
      return JSON.stringify({ emocion: 'curioso', frase: 'En el navegador no tengo cerebro de verdad. ¡Pruébame en el iPhone!' });
    },
    async release() {},
  };
}
