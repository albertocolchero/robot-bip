// Dibuja la cara de Bip con vistas normales de React Native (sin librerías extra).
// Todo se calcula en "unidades lógicas": la pantalla mide 240 de alto.
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { FaceEngine } from './engine';

export const GLOW = '#4FE3C1';
const BG = '#000000';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function Face({ engine }: { engine: FaceEngine }) {
  const { width: W, height: H } = useWindowDimensions();
  // el reloj vive en el estado: cada fotograma lo actualiza y la cara se redibuja
  const [now, setNow] = useState(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = performance.now();
      engine.update(t);
      setNow(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const s = H / 240;
  const LW = W / s;
  const MX = LW / 2;
  const p = engine.p;
  const a = engine.amp(now);
  const cy = 104 + p.dy + p.ly * 0.6 + engine.look[1] - a * 3;
  const cx0 = MX + p.lx * 1.4 + engine.look[0] * 1.6;
  const gap = Math.min(92, 54 * Math.max(1, LW / 320));

  const pieces: React.ReactNode[] = [];

  ([-1, 1] as const).forEach((side) => {
    let w = p.w;
    let h = p.h * engine.blink;
    if (p.asym) {
      const k = side < 0 ? 1 + 0.14 * p.asym : 1 - 0.16 * p.asym;
      w *= k;
      h *= k;
    }
    h = Math.max(h, 3.5);
    const cx = cx0 + side * gap;
    const y0 = cy - h / 2;
    const r = Math.min(p.r, h / 2, w / 2);

    pieces.push(
      <View
        key={`eye${side}`}
        style={[styles.eye, { left: (cx - w / 2) * s, top: y0 * s, width: w * s, height: h * s, borderRadius: r * s }]}
      />,
    );

    if (p.happy > 0.02) {
      // ojos en arco: un óvalo negro tapa la parte de abajo
      const ey = cy + h * (1.25 - 0.62 * p.happy);
      const d = 1.6 * w;
      pieces.push(
        <View
          key={`happy${side}`}
          style={[
            styles.mask,
            {
              left: (cx - d / 2) * s,
              top: (ey - d / 2) * s,
              width: d * s,
              height: d * s,
              borderRadius: (d / 2) * s,
              transform: [{ scaleY: (1.24 * h) / d }],
            },
          ]}
        />,
      );
    }

    if (p.sad > 0.02) {
      // párpado caído hacia fuera
      const drop = 0.55 * h * p.sad;
      const ang = Math.atan2(drop, w) * (side < 0 ? -1 : 1);
      const lw = w * 2.2;
      const lh = h * 1.5;
      const mx = cx;
      const my = y0 + drop / 2;
      pieces.push(
        <View
          key={`sad${side}`}
          style={[
            styles.mask,
            {
              left: (mx - lw / 2) * s,
              top: (my - lh) * s,
              width: lw * s,
              height: lh * s,
              transform: [{ translateY: (lh / 2) * s }, { rotate: `${ang}rad` }, { translateY: (-lh / 2) * s }],
            },
          ]}
        />,
      );
    }

    if (p.asym > 0.5 && side > 0) {
      pieces.push(
        <View
          key="lid"
          style={[styles.mask, { left: (cx - w / 2 - 3) * s, top: (y0 - 3) * s, width: (w + 6) * s, height: (h * 0.22 + 3) * s }]}
        />,
      );
    }
  });

  if (p.think > 0.5) {
    for (let i = 0; i < 3; i++) {
      const o = 0.35 + 0.65 * Math.max(0, Math.sin(now / 380 - i * 0.7));
      pieces.push(
        <View
          key={`dot${i}`}
          style={[styles.dot, { opacity: o, left: (MX - 14 + i * 14 - 3.4) * s, top: (176 - 3.4) * s, width: 6.8 * s, height: 6.8 * s, borderRadius: 3.4 * s }]}
        />,
      );
    }
  }

  if (p.sleep > 0.5) {
    const t = (now / 1600) % 1;
    const t2 = (t + 0.5) % 1;
    const zx = MX + gap + 22;
    pieces.push(
      <Text key="z1" style={[styles.z, { fontSize: 16 * s, opacity: 1 - t, left: (zx + t * 14) * s, top: (70 - 16 - t * 26) * s }]}>z</Text>,
      <Text key="z2" style={[styles.z, { fontSize: 16 * s, opacity: 1 - t2, left: (zx + 12 + t2 * 14) * s, top: (62 - 16 - t2 * 26) * s }]}>z</Text>,
    );
  }

  if (a > 0.01) {
    for (let i = 0; i < 9; i++) {
      const hh = 2 + a * 14 * Math.abs(Math.sin(now / 55 + i * 1.3));
      pieces.push(
        <View key={`bar${i}`} style={[styles.bar, { left: (MX - 36 + i * 8.4) * s, top: (190 - hh / 2) * s, width: 4.4 * s, height: hh * s }]} />,
      );
    }
  }

  let subtitle: React.ReactNode = null;
  if (engine.subtitle && now < engine.subUntil) {
    let n = engine.subtitle.length;
    const sp = engine.speech;
    if (sp) {
      const k = (now - sp.start) / (sp.end - sp.start);
      n = Math.max(0, Math.min(n, Math.ceil(k * n * 1.05)));
    }
    const fade = Math.min(1, (engine.subUntil - now) / 600);
    subtitle = (
      <Text
        style={[styles.sub, { opacity: fade, fontSize: 12.5 * s, lineHeight: 15 * s, top: 202 * s, left: (MX - 210) * s, width: 420 * s }]}
        numberOfLines={2}
      >
        {engine.subtitle.slice(0, n)}
      </Text>
    );
  }

  return (
    <View style={styles.root} pointerEvents="none">
      {pieces}
      {subtitle}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, overflow: 'hidden' },
  eye: {
    position: 'absolute',
    backgroundColor: GLOW,
    shadowColor: GLOW,
    shadowOpacity: 0.85,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  mask: { position: 'absolute', backgroundColor: BG },
  dot: { position: 'absolute', backgroundColor: GLOW },
  bar: { position: 'absolute', backgroundColor: GLOW, opacity: 0.85 },
  z: { position: 'absolute', color: GLOW, fontWeight: '600' },
  sub: { position: 'absolute', color: '#D8F7EE', textAlign: 'center', fontFamily: MONO },
});
