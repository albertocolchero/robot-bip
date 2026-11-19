// Panel de ajustes de Bip: se abre la primera vez, con tres toques seguidos en la pantalla
// o diciendo "Bip, ajustes". Los cambios se ven al momento en la cara.
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Instinct } from '../brain/instinct';
import { loadPrefs, savePrefs } from '../brain/prefs';
import type { FaceEngine } from './engine';
import { COLORS, EFFECTS, EFFECT_INFO, SHAPES, SHAPE_INFO, saveTheme, type ColorName, type ShapeName, type Theme } from './theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
type Tab = 'color' | 'ojos' | 'efecto' | 'sonido' | 'isla' | 'personas' | 'estado';
const TABS: [Tab, string][] = [
  ['color', 'Color'],
  ['ojos', 'Ojos'],
  ['efecto', 'Efecto'],
  ['sonido', 'Voz y silencio'],
  ['isla', 'Mini Bip'],
  ['personas', 'Personas'],
  ['estado', 'Estado'],
];

type Props = {
  engine: FaceEngine;
  instinct: Instinct;
  /** La primera vez que se abre la app (cambia el saludo del panel). */
  first: boolean;
  onClose: () => void;
  /** Dice algo para que oigas el volumen elegido. */
  onPreviewVoice: () => void;
};

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Los cambios van a la cara y al instinto (fuera del componente: no son estado de React)
function applyTheme(engine: FaceEngine, t: Theme) {
  engine.theme = t;
  saveTheme(t);
  engine.hop(-0.4);
}

function applyVolume(instinct: Instinct, v: number) {
  instinct.life.baseVolume = v;
  savePrefs({ volume: v });
}

function applyIsland(instinct: Instinct, on: boolean) {
  instinct.island.setEnabled(on);
  savePrefs({ island: on });
}

function liftFace(engine: FaceEngine, by: number) {
  engine.lift = by;
}

export function Settings({ engine, instinct, first, onClose, onPreviewVoice }: Props) {
  const [tab, setTab] = useState<Tab>('color');
  const [theme, setThemeState] = useState<Theme>({ ...engine.theme });
  const [volume, setVolume] = useState(instinct.life.baseVolume);
  const [quiet, setQuiet] = useState({ ...instinct.life.journal.settings });
  const [island, setIsland] = useState(() => loadPrefs().island);
  const [, setVersion] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const accent = COLORS[theme.color];

  // mientras el panel está abierto, la cara sube un poco para que se vea
  useEffect(() => {
    liftFace(engine, 62);
    return () => liftFace(engine, 0);
  }, [engine]);

  // la pestaña «Estado» se actualiza cada segundo
  useEffect(() => {
    if (tab !== 'estado') return;
    const id = setInterval(() => setVersion((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [tab]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(engine, t);
  };

  const changeVolume = (delta: number) => {
    const v = Math.round(Math.max(0.2, Math.min(1, volume + delta)) * 10) / 10;
    setVolume(v);
    applyVolume(instinct, v);
    onPreviewVoice();
  };

  const changeQuiet = (which: 'quietFrom' | 'quietTo', delta: number) => {
    const next = { ...quiet, [which]: (quiet[which] + delta + 24) % 24 };
    setQuiet(next);
    instinct.life.setQuietHours(next.quietFrom, next.quietTo);
  };

  const close = () => {
    saveTheme(engine.theme);
    savePrefs({ volume });
    onClose();
  };

  const people = instinct.people.persons;

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderColor: accent, backgroundColor: `${accent}22` }]}>
              <Text style={[styles.tabText, tab === k && { color: accent }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={close} style={[styles.done, { backgroundColor: accent }]}>
          <Text style={styles.doneText}>Listo</Text>
        </Pressable>
      </View>
      {first && tab === 'color' && <Text style={styles.hint}>¡Hola! Elige cómo quieres que sea. Puedes cambiarlo cuando quieras: toca tres veces la pantalla o di «Bip, ajustes».</Text>}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {tab === 'color' && (
          <>
            <View style={styles.row}>
              {(Object.keys(COLORS) as ColorName[]).map((c) => (
                <Pressable
                  key={c}
                  accessibilityLabel={`Color ${c}`}
                  onPress={() => setTheme({ ...theme, color: c })}
                  style={[styles.swatch, { backgroundColor: COLORS[c], shadowColor: COLORS[c] }, theme.color === c && styles.swatchOn]}
                />
              ))}
            </View>
            <Pressable onPress={() => setTheme({ ...theme, dynamic: !theme.dynamic })} style={styles.toggleRow}>
              <View style={[styles.toggle, theme.dynamic && { backgroundColor: accent, borderColor: accent }]}>
                <View style={[styles.knob, theme.dynamic && styles.knobOn]} />
              </View>
              <Text style={styles.label}>El color cambia con lo que siente (rojo si se enfada, más cálido de noche)</Text>
            </Pressable>
          </>
        )}

        {tab === 'ojos' && (
          <View style={styles.row}>
            {(Object.keys(SHAPES) as ShapeName[]).map((k) => {
              const s = SHAPES[k];
              const w = s.w * 0.42;
              const h = s.h * 0.42;
              return (
                <Pressable key={k} onPress={() => setTheme({ ...theme, shape: k })} style={[styles.card, theme.shape === k && { borderColor: accent }]}>
                  <View style={styles.eyes}>
                    {[0, 1].map((i) => (
                      <View key={i} style={{ width: w, height: h, borderRadius: (Math.min(w, h) / 2) * s.round, backgroundColor: accent }} />
                    ))}
                  </View>
                  <Text style={[styles.cardText, theme.shape === k && { color: accent }]}>{SHAPE_INFO[k]}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === 'efecto' && (
          <View style={styles.row}>
            {EFFECTS.map((k) => (
              <Pressable key={k} onPress={() => setTheme({ ...theme, effect: k })} style={[styles.chip, theme.effect === k && { borderColor: accent, backgroundColor: `${accent}22` }]}>
                <Text style={[styles.chipText, theme.effect === k && { color: accent }]}>{EFFECT_INFO[k]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'sonido' && (
          <>
            <View style={styles.line}>
              <Text style={styles.label}>Volumen de la voz</Text>
              <Stepper onMinus={() => changeVolume(-0.2)} onPlus={() => changeVolume(0.2)} accent={accent}>
                <View style={styles.bars}>
                  {[0.2, 0.4, 0.6, 0.8, 1].map((b) => (
                    <View key={b} style={[styles.bar, { height: 6 + b * 14, backgroundColor: volume >= b - 0.01 ? accent : '#2A3236' }]} />
                  ))}
                </View>
              </Stepper>
            </View>
            <View style={styles.line}>
              <Text style={styles.label}>Callado (habla bajito y no propone nada) desde</Text>
              <Stepper onMinus={() => changeQuiet('quietFrom', -1)} onPlus={() => changeQuiet('quietFrom', 1)} accent={accent}>
                <Text style={[styles.value, { color: accent }]}>{hour(quiet.quietFrom)}</Text>
              </Stepper>
            </View>
            <View style={styles.line}>
              <Text style={styles.label}>hasta</Text>
              <Stepper onMinus={() => changeQuiet('quietTo', -1)} onPlus={() => changeQuiet('quietTo', 1)} accent={accent}>
                <Text style={[styles.value, { color: accent }]}>{hour(quiet.quietTo)}</Text>
              </Stepper>
            </View>
          </>
        )}

        {tab === 'isla' && (
          <>
            <Pressable
              onPress={() => {
                setIsland(!island);
                applyIsland(instinct, !island);
              }}
              style={styles.toggleRow}
            >
              <View style={[styles.toggle, island && { backgroundColor: accent, borderColor: accent }]}>
                <View style={[styles.knob, island && styles.knobOn]} />
              </View>
              <Text style={styles.label}>Mini Bip fuera de la app</Text>
            </Pressable>
            <Text style={styles.label}>
              Cuando sales de la app, Bip se queda en pequeñito: en la Isla Dinámica (iPhone 14 Pro, 15 y siguientes) y en la pantalla de bloqueo. Enseña su
              cara, la cuenta atrás de tus temporizadores y lo último que te dijo. Tócalo para volver.
            </Text>
            <Text style={styles.dim}>
              Fuera de la app no te ve ni te oye (iOS no deja usar la cámara ni el micrófono en segundo plano).
              {instinct.island.ok ? '' : ' Ahora mismo iOS no lo deja: mira Ajustes del iPhone › Bip › Actividades en directo.'}
            </Text>
          </>
        )}

        {tab === 'estado' && (
          <>
            {instinct.status().map((line) => (
              <Text key={line.slice(0, 14)} style={styles.label}>
                {line}
              </Text>
            ))}
            <Text style={styles.dim}>Si algo no funciona, hazle una captura a esta pantalla.</Text>
          </>
        )}

        {tab === 'personas' && (
          <>
            {people.length === 0 && <Text style={styles.label}>Aún no conoce a nadie. Ponte delante de Bip: te preguntará cómo te llamas.</Text>}
            {people.map((p) => (
              <View key={p.id} style={styles.line}>
                <Text style={styles.label}>
                  {p.name ?? 'Sin nombre'} <Text style={styles.dim}>· {p.kind === 'persona' ? (p.fps.length ? `${p.fps.length} fotos de su cara` : 'aún no conoce su cara') : p.kind}</Text>
                </Text>
                <Pressable
                  onPress={() => {
                    if (confirming !== p.id) {
                      setConfirming(p.id);
                      return;
                    }
                    instinct.people.forget(p.id);
                    setConfirming(null);
                    setVersion((v) => v + 1);
                  }}
                  style={[styles.chip, confirming === p.id && { borderColor: '#FF5C5C' }]}
                >
                  <Text style={[styles.chipText, confirming === p.id && { color: '#FF5C5C' }]}>{confirming === p.id ? '¿Seguro? Toca otra vez' : 'Olvidar'}</Text>
                </Pressable>
              </View>
            ))}
            <Text style={styles.dim}>Si Bip se confunde, dile «no soy Luis, soy Ana». Las caras se quedan solo en este iPhone.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stepper({ children, onMinus, onPlus, accent }: { children: React.ReactNode; onMinus: () => void; onPlus: () => void; accent: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} style={[styles.step, { borderColor: accent }]} hitSlop={8}>
        <Text style={[styles.stepText, { color: accent }]}>−</Text>
      </Pressable>
      <View style={styles.stepValue}>{children}</View>
      <Pressable onPress={onPlus} style={[styles.step, { borderColor: accent }]} hitSlop={8}>
        <Text style={[styles.stepText, { color: accent }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '52%',
    backgroundColor: 'rgba(7,11,13,0.95)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A3236',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tabs: { gap: 8, paddingRight: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#2A3236' },
  tabText: { color: '#9FB8B0', fontFamily: MONO, fontSize: 12 },
  done: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 14 },
  doneText: { color: '#041014', fontWeight: '700', fontFamily: MONO, fontSize: 13 },
  hint: { color: '#C9DDD6', fontFamily: MONO, fontSize: 11, marginTop: 8 },
  body: { flex: 1, marginTop: 8 },
  bodyContent: { paddingBottom: 16, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  swatch: { width: 34, height: 34, borderRadius: 17, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  swatchOn: { borderWidth: 3, borderColor: '#FFFFFF', transform: [{ scale: 1.12 }] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  toggle: { width: 40, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#3A4448', backgroundColor: '#1A2124', padding: 2 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#9FB8B0' },
  knobOn: { transform: [{ translateX: 18 }], backgroundColor: '#041014' },
  label: { color: '#C9DDD6', fontFamily: MONO, fontSize: 12, flexShrink: 1 },
  dim: { color: '#6F8580', fontFamily: MONO, fontSize: 11 },
  card: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#2A3236', gap: 6 },
  eyes: { flexDirection: 'row', gap: 6, alignItems: 'center', height: 40 },
  cardText: { color: '#9FB8B0', fontFamily: MONO, fontSize: 11 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: '#2A3236' },
  chipText: { color: '#C9DDD6', fontFamily: MONO, fontSize: 12 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  stepValue: { minWidth: 70, alignItems: 'center' },
  value: { fontFamily: MONO, fontSize: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 22 },
  bar: { width: 8, borderRadius: 2 },
});
