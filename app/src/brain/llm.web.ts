// Versión de navegador: no hay modelo de verdad, solo respuestas de prueba
// para comprobar que la cara, los subtítulos y la memoria funcionan.
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
    async complete(messages) {
      await wait(1200);
      const last = messages[messages.length - 1]?.content ?? '';
      if (last.includes('Nadie te ha dicho nada')) {
        return JSON.stringify({ emocion: 'curioso', frase: '¿Sigues ahí? Me aburro un poquito.' });
      }
      return JSON.stringify({
        emocion: 'curioso',
        frase: 'En el navegador no tengo cerebro de verdad. ¡Pruébame en el iPhone!',
      });
    },
    async release() {},
  };
}
