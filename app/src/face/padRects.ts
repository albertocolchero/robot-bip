/** Las cuatro teclas del juego de Simón (en unidades lógicas: la pantalla mide 240 de alto). */
export function padRects(LW: number) {
  const w = Math.min(170, LW * 0.3);
  const h = 78;
  const m = 14;
  return [
    { x: m, y: m, w, h },
    { x: LW - m - w, y: m, w, h },
    { x: m, y: 240 - m - h, w, h },
    { x: LW - m - w, y: 240 - m - h, w, h },
  ];
}
