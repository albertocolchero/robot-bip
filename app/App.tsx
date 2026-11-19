// Bip · fases 1 a 4
//  - Cara: parpadea, mira a su alrededor y pita.
//  - Ojos: te ve con la cámara frontal, te sigue con la mirada y te saluda.
//  - Cuerpo: se asusta si lo mueves, ronronea con caricias, se duerme a oscuras
//    y comenta cuando lo enchufas o lo desenchufas.
//  - Oído: entiende frases sencillas en español, sin internet.
//  - Mente: un modelo de lenguaje dentro del iPhone para charlar y tomar la iniciativa.
// Toque corto: dice algo. Toque largo: se duerme o se despierta. Deslizar: caricia.
import { StatusBar } from 'expo-status-bar';
import * as Battery from 'expo-battery';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { DeviceMotion } from 'expo-sensors';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useRef } from 'react';
import { AppState, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';

import BipSenses, { type HearingStart } from './modules/bip-senses';
import { Instinct, type Buzz } from './src/brain/instinct';
import { loadMemory } from './src/brain/memory';
import { Mind } from './src/brain/mind';
import { Face } from './src/face/Face';
import { FaceEngine, type EmotionName } from './src/face/engine';
import { speak } from './src/voice/speak';

const TAP_LINES: [EmotionName, string][] = [
  ['contento', '¡Hola! Soy Bip.'],
  ['sorprendido', '¡Uy! ¿Me has tocado?'],
  ['curioso', 'Dime «hola, Bip».'],
  ['contento', '¡Bip bip!'],
  ['pensando', 'Pregúntame la hora.'],
  ['curioso', '¿Jugamos a algo?'],
];

const IDLE: EmotionName[] = ['curioso', 'pensando', 'contento', 'neutral'];

const buzz: Buzz = (kind) => {
  if (Platform.OS === 'web') return;
  const done =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(kind === 'soft' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy);
  done.catch(() => undefined);
};

/** Si hay una versión nueva de la app publicada por internet, la descarga y se reinicia. */
async function updateIfAvailable() {
  if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // sin internet o sin novedades: seguimos con la versión que hay
  }
}

function hearingProblem(r: HearingStart): string | null {
  if (r.ok) return null;
  switch (r.reason) {
    case 'permiso-microfono':
    case 'permiso-voz':
      return 'No puedo oírte: dame permiso en Ajustes › Bip.';
    case 'sin-modelo-local':
      return 'Para oírte sin internet necesito el dictado en español.';
    case 'idioma':
      return 'Aún no sé oír en español en este iPhone.';
    default:
      return 'Mis oídos no funcionan ahora mismo.';
  }
}

export default function App() {
  useKeepAwake(); // la pantalla no se apaga mientras Bip está abierto
  const engine = useMemo(() => new FaceEngine(), []);
  const { mind, instinct } = useMemo(() => {
    const memory = loadMemory();
    const say = (emo: EmotionName, text: string, opts?: { subtitle?: boolean }) => void speak(engine, text, emo, opts);
    const m = new Mind(engine, say, memory);
    return { mind: m, instinct: new Instinct(engine, say, buzz, m, memory) };
  }, [engine]);
  const line = useRef(0);

  // --------------------------------------------------- sentidos: ojos y oído
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let wentAway = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    const seeSub = BipSenses.addListener('onSee', (e) => instinct.onSee(e));
    const hearSub = BipSenses.addListener('onHear', (e) => instinct.onHear(e));

    const startSenses = async () => {
      if (running) return null;
      running = true;
      const perms = await BipSenses.requestPermissions().catch(() => ({ camera: false, microphone: false, speech: false }));
      if (cancelled) return null;
      if (perms.camera) BipSenses.startSeeing();
      let hearing: HearingStart;
      if (!perms.microphone) hearing = { ok: false, reason: 'permiso-microfono' };
      else if (!perms.speech) hearing = { ok: false, reason: 'permiso-voz' };
      else hearing = await BipSenses.startHearing('es-ES').catch(() => ({ ok: false, reason: 'error' }));
      return { camera: perms.camera, hearing };
    };

    const stopSenses = () => {
      running = false;
      BipSenses.stopSeeing();
      BipSenses.stopHearing();
    };

    (async () => {
      updateIfAvailable();
      const r = await startSenses();
      if (!r || cancelled) return;
      later(1200, () => {
        instinct.markGreeted();
        speak(engine, '¡Hola! Soy Bip.', 'contento');
      });
      if (!r.camera) later(4200, () => speak(engine, 'No puedo verte: dame permiso de cámara en Ajustes.', 'triste'));
      const problem = hearingProblem(r.hearing);
      if (problem) later(r.camera ? 4200 : 8200, () => speak(engine, problem, 'triste'));
      // la mente, cuando ya ha saludado y avisado de lo que falle
      later(problem || !r.camera ? 12000 : 6000, () => mind.wake());
    })();

    // cada pocos segundos, Bip piensa si le apetece decir algo
    const thinkTimer = setInterval(() => instinct.tick(), 20_000);

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wentAway = true;
        stopSenses();
      } else if (state === 'active' && wentAway) {
        wentAway = false;
        updateIfAvailable();
        startSenses();
        mind.wake(); // si estaba descargando el cerebro, continúa
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearInterval(thinkTimer);
      mind.stop();
      seeSub.remove();
      hearSub.remove();
      appSub.remove();
      stopSenses();
    };
  }, [engine, instinct, mind]);

  // --------------------------------------------------- cuerpo: movimiento y batería
  useEffect(() => {
    if (Platform.OS === 'web') return;
    DeviceMotion.setUpdateInterval(100);
    const motionSub = DeviceMotion.addListener((m) => {
      const a = m.acceleration;
      if (a) instinct.onMotion(Math.hypot(a.x, a.y, a.z));
    });
    Battery.getBatteryStateAsync()
      .then((s) => instinct.onBattery(s))
      .catch(() => undefined);
    const batterySub = Battery.addBatteryStateListener(({ batteryState }) => instinct.onBattery(batteryState));
    return () => {
      motionSub.remove();
      batterySub.remove();
    };
  }, [instinct]);

  // --------------------------------------------------- de vez en cuando cambia de gesto él solo
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!engine.busy && !instinct.sleeping) {
        engine.setEmotion(IDLE[Math.floor(Math.random() * IDLE.length)], 2500);
      }
      idle = setTimeout(tick, 8000 + Math.random() * 9000);
    };
    idle = setTimeout(tick, 9000);
    return () => clearTimeout(idle);
  }, [engine, instinct]);

  // --------------------------------------------------- caricias (deslizar el dedo)
  const pan = useMemo(() => {
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 14,
      onPanResponderGrant: (_e, g) => {
        lastX = g.moveX || g.x0;
        lastY = g.moveY || g.y0;
        travelled = 0;
        instinct.touched();
      },
      onPanResponderMove: (_e, g) => {
        instinct.touched();
        travelled += Math.hypot(g.moveX - lastX, g.moveY - lastY);
        lastX = g.moveX;
        lastY = g.moveY;
        while (travelled > 60) {
          travelled -= 60;
          instinct.onCaress();
        }
      },
      onPanResponderRelease: () => instinct.endCaress(),
      onPanResponderTerminate: () => instinct.endCaress(),
    });
  }, [instinct]);

  const onPress = () => {
    buzz('soft');
    if (instinct.sleeping) {
      instinct.wake('¿Mmm? ¡Ah, hola!');
      return;
    }
    const [emo, text] = TAP_LINES[line.current++ % TAP_LINES.length];
    speak(engine, text, emo);
  };

  const onLongPress = () => {
    buzz('strong');
    if (instinct.sleeping) instinct.wake();
    else instinct.sleep();
  };

  return (
    <View style={styles.root} {...pan.panHandlers}>
      <StatusBar hidden />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPressIn={() => instinct.touched()}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={800}
      >
        <Face engine={engine} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
