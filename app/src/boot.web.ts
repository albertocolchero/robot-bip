// Arranque en el navegador: Skia tiene que descargar su motor (canvaskit.wasm) ANTES
// de cargar la app, porque la cara lo usa desde el primer momento.
import { registerRootComponent } from 'expo';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

export function start() {
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const App = require('../App').default;
    registerRootComponent(App);
  });
}
