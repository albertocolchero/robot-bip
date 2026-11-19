// La cara de Bip: un lienzo de Skia (ojos, brillos, efectos, partículas) y, encima,
// los textos (subtítulos, lo que ha oído, avisos, juegos y partículas de letras).
// Todo se calcula en "unidades lógicas": la pantalla mide 240 de alto.
import { Canvas, Picture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { drawFace, eyeColor } from './draw';
import { FaceEngine } from './engine';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const TEXT_PARTICLES = { z: 'z', q: '?', ex: '!', note: '♪' } as const;

const css = (c: number[], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

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

  const picture = useMemo(() => drawFace(engine, W, H, now), [engine, W, H, now]);

  const s = H / 240;
  const LW = W / s;
  const MX = LW / 2;
  const color = eyeColor(engine);
  const glow = css(color);
  const texts: React.ReactNode[] = [];

  // partículas de letras: z (dormido), ? (confundido), ! (sorprendido), ♪ (tarareando)
  engine.particles.forEach((p, i) => {
    if (!(p.kind in TEXT_PARTICLES)) return;
    const k = p.age / p.life;
    const o = Math.min(1, p.age * 4) * (1 - k);
    const size = (p.kind === 'z' ? 15 : 20) * p.size;
    texts.push(
      <Text
        key={`p${i}`}
        style={[styles.particle, { color: glow, textShadowColor: glow, opacity: o, fontSize: size * s, left: (MX + p.x - size / 2) * s, top: (100 + p.y - size) * s }]}
      >
        {TEXT_PARTICLES[p.kind as keyof typeof TEXT_PARTICLES]}
      </Text>,
    );
  });

  // con el panel de ajustes abierto (la cara sube) el subtítulo quedaría tapado: el panel ya lo explica
  if (engine.subtitle && now < engine.subUntil && engine.lift === 0) {
    let n = engine.subtitle.length;
    const sp = engine.speech;
    if (sp) {
      const k = (now - sp.start) / (sp.end - sp.start);
      n = Math.max(0, Math.min(n, Math.ceil(k * n * 1.05)));
    }
    const fade = Math.min(1, (engine.subUntil - now) / 600);
    texts.push(
      <Text
        key="sub"
        style={[styles.sub, { opacity: fade, fontSize: 12.5 * s, lineHeight: 15 * s, top: 204 * s, left: (MX - 230) * s, width: 460 * s }]}
        numberOfLines={2}
      >
        {engine.subtitle.slice(0, n)}
      </Text>,
    );
  }

  if (engine.heard && now < engine.heardUntil) {
    const fade = Math.min(1, (engine.heardUntil - now) / 600) * 0.6;
    texts.push(
      <Text
        key="heard"
        style={[styles.heard, { opacity: fade, fontSize: 10 * s, lineHeight: 12 * s, top: 28 * s, left: (MX - 200) * s, width: 400 * s }]}
        numberOfLines={1}
      >
        «{engine.heard}»
      </Text>,
    );
  }

  if (engine.notice && now < engine.noticeUntil) {
    texts.push(
      <Text key="notice" style={[styles.heard, { color: '#FFC247', opacity: 0.9, fontSize: 9.5 * s, top: 42 * s, left: (MX - 210) * s, width: 420 * s }]} numberOfLines={2}>
        {engine.notice}
      </Text>,
    );
  }

  if (engine.badge) {
    texts.push(
      <Text key="badge" style={[styles.badge, { color: glow, fontSize: 9 * s, top: 8 * s, left: 12 * s }]}>
        {engine.badge}
      </Text>,
    );
  }

  const ov = engine.overlay;
  if (engine.timerText && !ov?.score) {
    texts.push(
      <Text key="timer" style={[styles.ovScore, { color: glow, opacity: 0.85, fontSize: 11 * s, top: 8 * s, right: 14 * s }]}>
        ⏱ {engine.timerText}
      </Text>,
    );
  }
  if (ov) {
    const padsOn = !!ov.pads;
    if (ov.title) {
      texts.push(
        <Text key="ovt" style={[styles.ovTitle, { color: glow, fontSize: 11 * s, top: (padsOn ? 104 : 14) * s, left: (MX - 150) * s, width: 300 * s }]}>
          {ov.title}
        </Text>,
      );
    }
    if (ov.score) {
      texts.push(
        <Text key="ovs" style={[styles.ovScore, { color: glow, fontSize: 10 * s, top: 14 * s, right: 14 * s }]}>
          {ov.score}
        </Text>,
      );
    }
    if (ov.big) {
      texts.push(
        <Text key="ovb" style={[styles.ovBig, { color: glow, textShadowColor: glow, fontSize: 46 * s, top: 150 * s, left: (MX - 150) * s, width: 300 * s }]}>
          {ov.big}
        </Text>,
      );
    }
    if (ov.left) {
      texts.push(
        <Text key="ovl" style={[styles.ovIcon, { fontSize: 44 * s, top: 66 * s, left: 14 * s, width: 90 * s }]}>
          {ov.left}
        </Text>,
      );
    }
    if (ov.right) {
      texts.push(
        <Text key="ovr" style={[styles.ovIcon, { fontSize: 44 * s, top: 66 * s, right: 14 * s, width: 90 * s }]}>
          {ov.right}
        </Text>,
      );
    }
    if (ov.hint) {
      texts.push(
        <Text key="ovh" style={[styles.heard, { opacity: 0.75, fontSize: 9.5 * s, top: (padsOn ? 120 : 222) * s, left: (MX - 200) * s, width: 400 * s }]}>
          {ov.hint}
        </Text>,
      );
    }
  }

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
      {texts}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', overflow: 'hidden' },
  sub: { position: 'absolute', color: '#E2FAF3', textAlign: 'center', fontFamily: MONO },
  heard: { position: 'absolute', color: '#9FB8B0', textAlign: 'center', fontFamily: MONO },
  badge: { position: 'absolute', fontFamily: MONO, opacity: 0.7, letterSpacing: 1 },
  particle: { position: 'absolute', fontWeight: '700', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  ovTitle: { position: 'absolute', textAlign: 'center', fontFamily: MONO, letterSpacing: 1 },
  ovScore: { position: 'absolute', fontFamily: MONO },
  ovBig: { position: 'absolute', textAlign: 'center', fontWeight: '800', fontFamily: MONO, textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  ovIcon: { position: 'absolute', textAlign: 'center' },
});
