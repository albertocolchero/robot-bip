// El modelo de lenguaje dentro del iPhone (llama.cpp a través de llama.rn).
// En el navegador se usa llm.web.ts, que finge pensar.
import { initLlama } from 'llama.rn';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Brain = {
  /** Devuelve el texto JSON que genera el modelo, obligado a seguir `schema`. */
  complete(messages: ChatMessage[], schema: object, maxTokens: number): Promise<string>;
  release(): Promise<void>;
};

export async function loadBrain(path: string, onProgress?: (fraction: number) => void): Promise<Brain> {
  const ctx = await initLlama(
    {
      model: path,
      n_ctx: 2048,
      n_batch: 256,
      n_gpu_layers: 99, // todo en la gráfica del iPhone (Metal)
      use_mmap: true,
      use_mlock: false,
      flash_attn_type: 'auto',
    },
    (p) => onProgress?.(p > 1 ? p / 100 : p),
  );
  return {
    async complete(messages, schema, maxTokens) {
      const result = await ctx.completion({
        messages,
        n_predict: maxTokens,
        temperature: 0.8,
        top_p: 0.95,
        enable_thinking: false,
        response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
      });
      return result.content || result.text;
    },
    release: () => ctx.release(),
  };
}
