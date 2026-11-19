// Versión de navegador: no hay Whisper de verdad (en el navegador se prueba con window.bipOye).
export { WHISPER_FILE, WHISPER_MB, WHISPER_URL, cleanWhisper } from './whisperText';

export class WhisperEar {
  state: 'nada' | 'cargando' | 'listo' | 'error' = 'nada';
  error = '';

  async load(_path: string): Promise<boolean> {
    this.state = 'error';
    this.error = 'solo funciona en el iPhone';
    return false;
  }

  get ready() {
    return false;
  }

  async transcribe(_wavPath: string): Promise<string> {
    return '';
  }

  async release() {}
}
