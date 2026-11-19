// Arranque de la app en el iPhone: Skia ya viene dentro, así que se registra directamente.
import { registerRootComponent } from 'expo';

import App from '../App';

export function start() {
  registerRootComponent(App);
}
