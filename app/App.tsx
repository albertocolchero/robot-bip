// Bip · fase 1: la cara parpadea, mira a su alrededor y pita cuando la tocas.
//  - Toque corto: dice algo.
//  - Toque largo (casi un segundo): se duerme o se despierta.
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { Face } from './src/face/Face';
import { FaceEngine, type EmotionName } from './src/face/engine';
import { initAudio } from './src/voice/player';
import { speak } from './src/voice/speak';

const TAP_LINES: [EmotionName, string][] = [
  ['contento', '¡Hola! Soy Bip.'],
  ['sorprendido', '¡Uy! ¿Me has tocado?'],
  ['contento', '¡Qué gustito!'],
  ['curioso', '¿Jugamos a algo?'],
  ['contento', '¡Bip bip!'],
  ['pensando', 'Pronto podré verte y oírte.'],
];

const IDLE: EmotionName[] = ['curioso', 'pensando', 'contento', 'neutral'];

function buzz(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(style).catch(() => undefined);
}

export default function App() {
  useKeepAwake(); // la pantalla no se apaga mientras Bip está abierto
  const engine = useMemo(() => new FaceEngine(), []);
  const line = useRef(0);

  useEffect(() => {
    initAudio();
    const hello = setTimeout(() => speak(engine, '¡Hola! Soy Bip.', 'contento'), 1500);
    // de vez en cuando cambia de gesto él solo
    let idle: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!engine.busy && engine.emotion !== 'sueno') {
        engine.setEmotion(IDLE[Math.floor(Math.random() * IDLE.length)], 2500);
      }
      idle = setTimeout(tick, 8000 + Math.random() * 9000);
    };
    idle = setTimeout(tick, 9000);
    return () => {
      clearTimeout(hello);
      clearTimeout(idle);
    };
  }, [engine]);

  const onPress = () => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    if (engine.emotion === 'sueno') {
      speak(engine, '¿Mmm? ¡Ah, hola!', 'sorprendido');
      return;
    }
    const [emo, text] = TAP_LINES[line.current++ % TAP_LINES.length];
    speak(engine, text, emo);
  };

  const onLongPress = () => {
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    if (engine.emotion === 'sueno') speak(engine, '¡Ya estoy despierto!', 'contento');
    else speak(engine, 'Buenas noches…', 'sueno');
  };

  return (
    <Pressable style={styles.root} onPress={onPress} onLongPress={onLongPress} delayLongPress={800}>
      <StatusBar hidden />
      <Face engine={engine} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
