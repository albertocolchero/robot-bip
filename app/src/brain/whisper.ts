// El oído Whisper: el reconocedor de voz de OpenAI, funcionando dentro del iPhone (whisper.cpp a través
// de whisper.rn, de los mismos autores que llama.rn, que mueve el cerebro). El iPhone graba cada frase
// que dices (módulo bip-senses) y aquí Whisper la convierte en texto. Nada sale del iPhone.
// El modelo ("small", unos 190 MB) se descarga una vez, como el cerebro.
import { cleanWhisper, WHISPER_PROMPT } from './whisperText';

export { WHISPER_FILE, WHISPER_MB, WHISPER_URL, cleanWhisper } from './whisperText';

// Lo poco que se usa de whisper.rn. La librería se carga solo si eliges Whisper (require dentro de load):
// así, si algo suyo fallara, no afecta al arranque. Además trae su código sin compilar, que no pasa
// nuestras comprobaciones de tipos, y su paquete solo publica "whisper.rn/index" (no "whisper.rn").
type WhisperContext = {
  transcribe(
    path: string,
    options: { language?: string; prompt?: string },
  ): { stop: () => Promise<void>; promise: Promise<{ result: string; isAborted: boolean }> };
  release(): Promise<void>;
};
type WhisperLib = {
  initWhisper(options: { filePath: string; useGpu?: boolean; useCoreMLIos?: boolean }): Promise<WhisperContext>;
};

export class WhisperEar {
  state: 'nada' | 'cargando' | 'listo' | 'error' = 'nada';
  error = '';
  private ctx: WhisperContext | null = null;
  private loading: Promise<boolean> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Carga el modelo (una vez). true si está listo. */
  load(path: string): Promise<boolean> {
    if (this.ctx) return Promise.resolve(true);
    if (this.loading) return this.loading;
    this.state = 'cargando';
    this.loading = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initWhisper } = require('whisper.rn/index') as WhisperLib;
        // con la gráfica del iPhone (Metal); sin el modelo extra de Core ML
        this.ctx = await initWhisper({ filePath: path, useGpu: true, useCoreMLIos: false });
        this.state = 'listo';
        return true;
      } catch (e) {
        this.state = 'error';
        this.error = String((e as Error)?.message ?? e);
        return false;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  get ready() {
    return !!this.ctx;
  }

  /** Escribe una frase grabada (de una en una, en orden). '' si no era voz. */
  transcribe(wavPath: string): Promise<string> {
    const run = async () => {
      if (!this.ctx) throw new Error('Whisper no está cargado');
      const { promise } = this.ctx.transcribe(wavPath, { language: 'es', prompt: WHISPER_PROMPT });
      const r = await promise;
      return r.isAborted ? '' : cleanWhisper(r.result);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async release() {
    const c = this.ctx;
    this.ctx = null;
    this.state = 'nada';
    await c?.release().catch(() => undefined);
  }
}
