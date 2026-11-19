// Bip · fases 1 a 5 (y 1.4: reconoce a cada uno, temporizadores, panel de ajustes)
//  - Cara: ojos con párpados de verdad, 18 emociones, temas y efectos (Skia + shaders).
//  - Ojos: te ve con la cámara frontal, te sigue con la mirada, lee tu expresión (MediaPipe)
//    y tus gestos con la mano.
//  - Cuerpo: se asusta si lo mueves, ronronea con caricias, se duerme a oscuras.
//  - Oído: entiende frases en español sin internet; nota palmadas y música.
//  - Mente: un modelo de lenguaje dentro del iPhone; busca en internet si le falta un dato.
//  - Vida propia: ánimo, diario, recuerdos, iniciativa, normas de respeto y juegos.
// Toque corto: dice algo (o juega). Tres toques: ajustes. Toque largo: se duerme o se despierta. Deslizar: caricia.
import { StatusBar } from 'expo-status-bar';
import * as Battery from 'expo-battery';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { DeviceMotion } from 'expo-sensors';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, Linking, PanResponder, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import BipSenses, { type HearingStart } from './modules/bip-senses';
import { Instinct, type Buzz } from './src/brain/instinct';
import { loadMemory } from './src/brain/memory';
import { Mind } from './src/brain/mind';
import { setStorage } from './src/brain/store';
import { Face } from './src/face/Face';
import { FaceEngine, type EmotionName } from './src/face/engine';
import { loadPrefs } from './src/brain/prefs';
import { Settings } from './src/face/Settings';
import { hasTheme, loadTheme } from './src/face/theme';
import { toneWav } from './src/voice/droidVoice';
import { playWav } from './src/voice/player';
import { speak } from './src/voice/speak';

// los recuerdos de Bip se guardan dentro del iPhone
setStorage(BipSenses);

const TAP_LINES: [EmotionName, string][] = [
  ['contento', '¡Hola! Soy Bip.'],
  ['sorprendido', '¡Uy! ¿Me has tocado?'],
  ['curioso', 'Dime «hola, Bip».'],
  ['feliz', '¡Bip bip!'],
  ['pensando', 'Pregúntame la hora.'],
  ['emocionado', '¿Jugamos? Di «Bip, vamos a jugar».'],
  ['curioso', 'Prueba: «Bip, ponte azul».'],
  ['contento', 'Salúdame con la mano.'],
  ['curioso', 'Toca tres veces seguidas para ver mis ajustes.'],
  ['pensando', 'Prueba: «avísame en 5 minutos».'],
];

const buzz: Buzz = (kind) => {
  if (Platform.OS === 'web') return;
  const done =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(kind === 'soft' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy);
  done.catch(() => undefined);
};

/** Ancho de la pantalla en unidades lógicas (la pantalla mide 240 de alto). */
function logicalWidth() {
  const { width, height } = Dimensions.get('window');
  return width / (height / 240);
}

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
  const engine = useMemo(() => {
    const e = new FaceEngine();
    e.theme = loadTheme();
    const d = new Date();
    if (d.getMonth() === 11 && d.getDate() >= 15) e.weather = 'snow'; // en Navidad, nieva
    return e;
  }, []);
  const senses = useRef<(on: boolean) => void>(() => undefined);
  const { mind, instinct } = useMemo(() => {
    const memory = loadMemory();
    const say = (emo: EmotionName, text: string, opts?: { subtitle?: boolean; volume?: number }) => void speak(engine, text, emo, opts);
    const m = new Mind(engine, say);
    const i: Instinct = new Instinct({
      engine,
      say,
      buzz,
      mind: m,
      memory,
      tone: (freq, ms) => void playWav(toneWav(freq, ms, i.life.volume())).catch(() => undefined),
      senses: (on) => senses.current(on),
      width: logicalWidth,
    });
    i.life.baseVolume = loadPrefs().volume;
    return { mind: m, instinct: i };
  }, [engine]);
  // la primera vez que se abre la app, Bip empieza con el panel para personalizarlo
  const firstRun = useMemo(() => !hasTheme(), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(false);
  const openSettings = useCallback(() => {
    settingsRef.current = true;
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    settingsRef.current = false;
    setSettingsOpen(false);
    instinct.settingsClosed(firstRun);
  }, [instinct, firstRun]);
  instinct.onSettings = openSettings;
  const taps = useRef<number[]>([]);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gear, setGear] = useState(false);
  const gearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const line = useRef(0);
  if (Platform.OS === 'web') (globalThis as unknown as { bip: object }).bip = { engine, mind, instinct };

  // --------------------------------------------------- sentidos: ojos y oído
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let wentAway = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    const seeSub = BipSenses.addListener('onSee', (e) => instinct.onSee(e));
    const hearSub = BipSenses.addListener('onHear', (e) => instinct.onHear(e));
    const soundSub = BipSenses.addListener('onSound', (e) => instinct.onSound(e));

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

    // el modo privado apaga y enciende cámara y micrófono
    senses.current = (on) => {
      if (on) void startSenses();
      else stopSenses();
    };

    (async () => {
      updateIfAvailable();
      const r = await startSenses();
      if (!r || cancelled) return;
      later(1200, () => {
        if (firstRun) {
          instinct.openSettings();
          instinct.speakTo('contento', '¡Hola! Elige cómo quieres que sea y toca «Listo».');
        } else instinct.startGreeting();
      });
      if (!r.camera) later(4200, () => speak(engine, 'No puedo verte: dame permiso de cámara en Ajustes.', 'triste'));
      const problem = hearingProblem(r.hearing);
      if (problem) later(r.camera ? 4200 : 8200, () => speak(engine, problem, 'triste'));
      // la mente, cuando ya ha saludado y avisado de lo que falle
      later(problem || !r.camera ? 12000 : 7000, () => mind.wake());
    })();

    // cada pocos segundos, Bip repasa si le apetece hacer algo
    const thinkTimer = setInterval(() => instinct.tick(), 20_000);
    const gameTimer = setInterval(() => instinct.fastTick(), 250);

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wentAway = true;
        instinct.island.away(); // se queda en pequeñito en la Isla Dinámica
        stopSenses();
      } else if (state === 'active' && wentAway) {
        wentAway = false;
        instinct.island.sync(true);
        updateIfAvailable();
        if (!instinct.life.privateMode) startSenses();
        mind.wake(); // si estaba descargando el cerebro, continúa
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearInterval(thinkTimer);
      clearInterval(gameTimer);
      mind.stop();
      seeSub.remove();
      hearSub.remove();
      soundSub.remove();
      appSub.remove();
      stopSenses();
    };
  }, [engine, instinct, mind, firstRun]);

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

  // --------------------------------------------------- enlaces: la llave de la casa llega escaneando un QR
  useEffect(() => {
    const open = (url?: string | null) => {
      if (url) void instinct.openLink(url);
    };
    Linking.getInitialURL()
      .then(open)
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [instinct]);

  // --------------------------------------------------- de vez en cuando cambia de gesto él solo (según su ánimo)
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const tick = () => {
      const face = instinct.idleFace();
      if (face) engine.setEmotion(face, 2500);
      idle = setTimeout(tick, 7000 + Math.random() * 9000);
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
      onMoveShouldSetPanResponderCapture: (_e, g) => !instinct.games.playing && !settingsRef.current && Math.abs(g.dx) + Math.abs(g.dy) > 14,
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

  const onPress = (e: GestureResponderEvent) => {
    // la cara ocupa toda la pantalla: la posición en pantalla vale (en el navegador no hay locationX)
    const s = Dimensions.get('window').height / 240;
    const x = e.nativeEvent.pageX ?? e.nativeEvent.locationX;
    const y = e.nativeEvent.pageY ?? e.nativeEvent.locationY;
    if (instinct.onTap(x / s, y / s)) {
      buzz('tick');
      return;
    }
    buzz('soft');
    if (instinct.sleeping) {
      instinct.wake('¿Mmm? ¡Ah, hola!');
      return;
    }
    // tras un toque, durante unos segundos sale el botón de ajustes en una esquina
    setGear(true);
    if (gearTimer.current) clearTimeout(gearTimer.current);
    gearTimer.current = setTimeout(() => setGear(false), 5000);
    // tres toques seguidos: ajustes. Si no, al poquito dice una de sus frases
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1500), now];
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (taps.current.length >= 3) {
      taps.current = [];
      instinct.openSettings();
      return;
    }
    tapTimer.current = setTimeout(() => {
      const [emo, text] = TAP_LINES[line.current++ % TAP_LINES.length];
      instinct.speakTo(emo, text);
    }, 420);
  };

  const onLongPress = () => {
    if (settingsRef.current) return;
    buzz('strong');
    if (instinct.life.privateMode) {
      instinct.life.leavePrivate();
      return;
    }
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
      {gear && !settingsOpen && (
        <Pressable
          style={styles.gear}
          hitSlop={12}
          onPress={() => {
            setGear(false);
            if (tapTimer.current) clearTimeout(tapTimer.current);
            instinct.openSettings();
          }}
        >
          <Text style={styles.gearText}>⚙ Ajustes</Text>
        </Pressable>
      )}
      {settingsOpen && (
        <Settings
          engine={engine}
          instinct={instinct}
          first={firstRun}
          onClose={closeSettings}
          onPreviewVoice={() => void speak(engine, '¡Así sueno!', 'feliz', { volume: instinct.life.volume() })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  gear: {
    position: 'absolute',
    right: 18,
    bottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3236',
    backgroundColor: 'rgba(10,16,18,0.85)',
  },
  gearText: { color: '#C9DDD6', fontSize: 13 },
});
