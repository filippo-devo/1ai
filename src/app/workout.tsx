import { useKeepAwake } from 'expo-keep-awake';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera, POSE_ENGINE } from '../camera/PoseCamera';
import type { DetectedPose } from '../camera/types';
import { DebugPanel } from '../components/DebugPanel';
import { Calibrator, type CalibrationState } from '../counting/calibration';
import { EXERCISES, EXERCISE_IDS, type ExerciseId } from '../counting/config';
import {
  BODY_PART_PL,
  extractFeatures,
  requiredKeypointIndices,
  visibleParts,
  type Features,
} from '../counting/features';
import { RepCounter, type Calibration, type CounterSnapshot, type Phase, type RepEvent } from '../counting/repCounter';
import { formatDuration } from '../utils/format';

type Stage = 'setup' | 'countdown' | 'active' | 'paused';

const COUNTDOWN_S = 5;

function useAppStateActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function say(text: string, enabled: boolean) {
  if (!enabled) return;
  void Speech.stop();
  Speech.speak(text, { language: 'pl-PL', rate: 1.1 });
}

export default function WorkoutScreen() {
  useKeepAwake();
  const params = useLocalSearchParams<{ exercise: string; voice?: string; debug?: string }>();
  const exercise: ExerciseId = (EXERCISE_IDS as string[]).includes(params.exercise)
    ? (params.exercise as ExerciseId)
    : 'pushup';
  const info = EXERCISES[exercise];
  const voice = params.voice !== '0';
  const [debug, setDebug] = useState(params.debug === '1');

  // --- camera / permissions / lifecycle -------------------------------------------------
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const isFocused = useIsFocused();
  const appActive = useAppStateActive();

  // --- workout state ---------------------------------------------------------------------
  const [stage, setStage] = useState<Stage>('setup');
  // Mirror of `stage` for callbacks running outside React's render (pose events, timers).
  const stageRef = useRef<Stage>('setup');
  const goTo = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);
  const [calibrator] = useState(() => new Calibrator(exercise));
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const calibrationResultRef = useRef<Calibration | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const [snapshot, setSnapshot] = useState<CounterSnapshot | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [lastPose, setLastPose] = useState<DetectedPose | null>(null);
  const [perf, setPerf] = useState({ fps: 0, inferenceMs: 0 });
  const [events, setEvents] = useState<RepEvent[]>([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [elapsedMs, setElapsedMs] = useState(0);
  const accumulatedMsRef = useRef(0);
  const activeSinceRef = useRef<number | null>(null);
  const fpsRef = useRef({ lastT: 0, fps: 0 });

  // Processing stops when the screen is not focused / app in background (camera inactive).
  const isActive = isFocused && appActive;

  // --- pose handling (JS thread) ---------------------------------------------------------
  const onPose = useCallback(
    (pose: DetectedPose) => {
      const s = fpsRef.current;
      if (s.lastT > 0 && pose.timestamp > s.lastT) {
        const inst = 1000 / (pose.timestamp - s.lastT);
        s.fps = s.fps === 0 ? inst : s.fps * 0.9 + inst * 0.1;
      }
      s.lastT = pose.timestamp;

      const f = extractFeatures(exercise, pose);
      const st = stageRef.current;
      if (st === 'setup') {
        setCalibration(calibrator.update(f, pose.timestamp));
      } else if (st === 'active' && counterRef.current) {
        setSnapshot(counterRef.current.update(f, pose.timestamp));
      }
      setFeatures(f);
      setLastPose(pose);

      if (debug) {
        setPerf({ fps: s.fps, inferenceMs: pose.inferenceMs });
      }
    },
    [exercise, calibrator, debug],
  );

  // --- timer (active time only, pauses excluded) ------------------------------------------
  useEffect(() => {
    if (stage !== 'active') return;
    const id = setInterval(() => {
      const since = activeSinceRef.current;
      setElapsedMs(accumulatedMsRef.current + (since !== null ? Date.now() - since : 0));
    }, 250);
    return () => clearInterval(id);
  }, [stage]);

  // --- countdown -> start counting -------------------------------------------------------
  const startCountdown = () => {
    // The calibration result is frozen when Start is pressed.
    calibrationResultRef.current = calibration?.result ?? null;
    setCountdown(COUNTDOWN_S);
    say(String(COUNTDOWN_S), voice);
    goTo('countdown');
  };

  useEffect(() => {
    if (stage !== 'countdown') return;
    let left = COUNTDOWN_S;
    const id = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCountdown(left);
        say(String(left), voice);
        return;
      }
      clearInterval(id);
      const counter = new RepCounter(exercise, { calibration: calibrationResultRef.current });
      counter.onEvent((e) => {
        setEvents((prev) => [...prev.slice(-19), e]);
        if (e.type === 'rep') say(String(e.reps), voice);
      });
      counterRef.current = counter;
      setSnapshot(counter.snapshot());
      activeSinceRef.current = Date.now();
      say('Start', voice);
      goTo('active');
    }, 1000);
    return () => clearInterval(id);
  }, [stage, exercise, voice, goTo]);

  const pause = useCallback(() => {
    if (stageRef.current !== 'active') return;
    const since = activeSinceRef.current;
    if (since !== null) accumulatedMsRef.current += Date.now() - since;
    activeSinceRef.current = null;
    setElapsedMs(accumulatedMsRef.current);
    goTo('paused');
  }, [goTo]);

  const resume = useCallback(() => {
    // After a pause the start position must be re-established: resuming never adds a rep.
    counterRef.current?.resetPhase();
    activeSinceRef.current = Date.now();
    goTo('active');
  }, [goTo]);

  const finish = useCallback(() => {
    const since = activeSinceRef.current;
    if (since !== null) accumulatedMsRef.current += Date.now() - since;
    activeSinceRef.current = null;
    void Speech.stop();
    const snap = counterRef.current?.snapshot();
    router.replace({
      pathname: '/summary',
      params: {
        exercise,
        reps: String(snap?.reps ?? 0),
        partials: String(snap?.partials ?? 0),
        durationMs: String(Math.round(accumulatedMsRef.current)),
      },
    });
  }, [exercise]);

  // Auto-pause when the app goes to background (the camera stops, so counting must too).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') pause();
    });
    return () => sub.remove();
  }, [pause]);

  useEffect(
    () => () => {
      void Speech.stop();
    },
    [],
  );

  const switchCamera = useCallback(() => {
    setPosition((p) => (p === 'back' ? 'front' : 'back'));
    if (stageRef.current === 'setup') {
      calibrator.reset();
      setCalibration(null);
    } else {
      counterRef.current?.resetPhase();
    }
  }, [calibrator]);

  const recalibrate = () => {
    calibrator.reset();
    setCalibration(null);
  };

  const highlight = useMemo(() => requiredKeypointIndices(exercise), [exercise]);

  const counting = stage === 'active' || stage === 'paused';

  return (
    <View style={styles.root}>
      <View style={styles.cameraBox}>
        <PoseCamera
          position={position}
          active={isActive}
          debug={debug}
          highlight={highlight}
          onPose={onPose}
          onSwitchCamera={switchCamera}
        />
        {debug && (
          <DebugPanel
            exercise={exercise}
            features={features}
            snapshot={snapshot}
            fps={perf.fps}
            inferenceMs={perf.inferenceMs}
            cropSize={lastPose?.cropSize ?? Number.NaN}
            engine={POSE_ENGINE === 'native' ? 'MoveNet (natywnie)' : 'MediaPipe (WebView, Expo Go)'}
            events={events}
          />
        )}
        {stage === 'countdown' && (
          <View style={styles.countdownBox} pointerEvents="none">
            <Text style={styles.countdown}>{countdown}</Text>
            <Text style={styles.countdownHint}>Przyjmij pozycję: {info.startLabel}</Text>
          </View>
        )}
        {counting && (
          <CountingOverlay
            snapshot={snapshot}
            features={features}
            exercise={exercise}
            paused={stage === 'paused'}
            elapsedMs={elapsedMs}
          />
        )}
      </View>

      <View style={styles.bottom}>
        {stage === 'setup' && (
          <SetupPanel
            exercise={exercise}
            calibration={calibration}
            parts={lastPose ? visibleParts(exercise, lastPose) : null}
            onStart={startCountdown}
            onRecalibrate={recalibrate}
          />
        )}
        <View style={styles.buttons}>
          {stage === 'active' && <Btn label="Pauza" onPress={pause} />}
          {stage === 'paused' && <Btn label="Wznów" onPress={resume} primary />}
          {counting && <Btn label="Zakończ" onPress={finish} danger />}
          {stage === 'countdown' && <Btn label="Anuluj" onPress={() => goTo('setup')} />}
          <Btn label={position === 'back' ? 'Kamera: tylna' : 'Kamera: przednia'} onPress={switchCamera} />
          <Btn label={debug ? 'Debug: wł.' : 'Debug: wył.'} onPress={() => setDebug((d) => !d)} />
        </View>
      </View>
    </View>
  );
}

function Btn({
  label,
  onPress,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        primary && styles.btnPrimary,
        danger && styles.btnDanger,
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.btnText, (primary || danger) && { color: 'white' }]}>{label}</Text>
    </Pressable>
  );
}

function phaseText(phase: Phase, exercise: ExerciseId): string {
  const info = EXERCISES[exercise];
  switch (phase) {
    case 'unknown':
      return `Przyjmij pozycję: ${info.startLabel}`;
    case 'start':
      return info.startLabel;
    case 'down':
      return `→ ${info.targetLabel}`;
    case 'target':
      return info.targetLabel;
    case 'up':
      return `→ ${info.startLabel}`;
  }
}

function CountingOverlay({
  snapshot,
  features,
  exercise,
  paused,
  elapsedMs,
}: {
  snapshot: CounterSnapshot | null;
  features: Features | null;
  exercise: ExerciseId;
  paused: boolean;
  elapsedMs: number;
}) {
  const info = EXERCISES[exercise];
  let message: string;
  let alert = false;
  if (paused) message = 'Pauza';
  else if (!snapshot || snapshot.tracking === 'lost') {
    alert = true;
    const missing = features && !features.valid ? features.missing.map((m) => BODY_PART_PL[m]).join(', ') : '';
    message = `Ustaw się w kadrze${missing ? `\n(nie widać: ${missing})` : ''}`;
  } else if (snapshot.tracking === 'uncertain') message = 'Słaba widoczność…';
  else if (snapshot.phase === 'unknown' && !snapshot.postureOk) message = info.postureHint;
  else message = phaseText(snapshot.phase, exercise);

  return (
    <View style={styles.countingBox} pointerEvents="none">
      <Text style={styles.reps}>{snapshot?.reps ?? 0}</Text>
      <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
      <Text style={[styles.status, alert && styles.statusAlert]}>{message}</Text>
    </View>
  );
}

function SetupPanel({
  exercise,
  calibration,
  parts,
  onStart,
  onRecalibrate,
}: {
  exercise: ExerciseId;
  calibration: CalibrationState | null;
  parts: { part: keyof typeof BODY_PART_PL; visible: boolean }[] | null;
  onStart: () => void;
  onRecalibrate: () => void;
}) {
  const info = EXERCISES[exercise];
  const done = calibration?.status === 'done';
  let calibText = 'Czekam na obraz…';
  if (calibration) {
    switch (calibration.status) {
      case 'not_visible':
        calibText = `Ustaw się w kadrze${calibration.missing.length ? ` (nie widać: ${calibration.missing.map((m) => BODY_PART_PL[m]).join(', ')})` : ''}`;
        break;
      case 'wrong_posture':
        calibText = info.postureHint;
        break;
      case 'holding':
        calibText = `Kalibracja – nie ruszaj się… ${Math.round(calibration.progress * 100)}%`;
        break;
      case 'done':
        calibText = `Kalibracja OK (kąt w pozycji startowej: ${calibration.result?.startAngle.toFixed(0)}°)`;
        break;
    }
  }
  return (
    <ScrollView style={styles.setup} contentContainerStyle={{ gap: 4 }}>
      <Text style={styles.setupTitle}>{info.name} – ustawienie telefonu</Text>
      <Text style={styles.setupLine}>• {info.setup.phoneOrientation}</Text>
      <Text style={styles.setupLine}>• {info.setup.distance}</Text>
      <Text style={styles.setupLine}>• {info.setup.angle}</Text>
      <Text style={styles.setupLine}>• {info.setup.bodyParts}</Text>
      {info.setup.tips.map((t) => (
        <Text key={t} style={styles.setupLine}>
          • {t}
        </Text>
      ))}
      <Text style={styles.setupTitle}>Widoczność sylwetki</Text>
      <View style={styles.parts}>
        {(parts ?? []).map(({ part, visible }) => (
          <Text key={part} style={[styles.part, visible ? styles.partOk : styles.partBad]}>
            {visible ? '✓' : '✗'} {BODY_PART_PL[part]}
          </Text>
        ))}
      </View>
      <Text style={[styles.calib, done && styles.partOk]}>{calibText}</Text>
      <View style={styles.buttons}>
        <Btn label="Start" onPress={onStart} primary disabled={!done} />
        {done && <Btn label="Kalibruj ponownie" onPress={onRecalibrate} />}
      </View>
      {!done && <Text style={styles.small}>Start będzie aktywny po kalibracji.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  cameraBox: { flex: 1 },
  bottom: { backgroundColor: 'white', padding: 8, maxHeight: '48%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  msg: { fontSize: 17, textAlign: 'center' },
  small: { fontSize: 13, color: '#555', textAlign: 'center' },
  primary: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10 },
  primaryText: { color: 'white', fontSize: 17, fontWeight: '600' },
  secondary: { padding: 12 },
  secondaryText: { color: '#2563eb', fontSize: 16 },
  banner: { position: 'absolute', bottom: 8, left: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 8 },
  bannerError: { backgroundColor: 'rgba(185,28,28,0.9)' },
  bannerText: { color: 'white', fontSize: 14 },
  countdownBox: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  countdown: { fontSize: 160, fontWeight: '800', color: 'white', textShadowColor: 'black', textShadowRadius: 12 },
  countdownHint: { fontSize: 20, color: 'white', textShadowColor: 'black', textShadowRadius: 6 },
  countingBox: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  reps: { fontSize: 130, fontWeight: '800', color: 'white', textShadowColor: 'black', textShadowRadius: 12, lineHeight: 140 },
  timer: { fontSize: 28, color: 'white', fontVariant: ['tabular-nums'], textShadowColor: 'black', textShadowRadius: 6 },
  status: { fontSize: 20, color: 'white', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, borderRadius: 6, marginTop: 4 },
  statusAlert: { backgroundColor: 'rgba(220,38,38,0.85)', fontSize: 26, fontWeight: '700' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#e5e7eb' },
  btnPrimary: { backgroundColor: '#2563eb' },
  btnDanger: { backgroundColor: '#dc2626' },
  btnText: { fontSize: 16, fontWeight: '600', color: '#111' },
  setup: { flexGrow: 0 },
  setupTitle: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  setupLine: { fontSize: 14 },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  part: { fontSize: 15, fontWeight: '600' },
  partOk: { color: '#15803d' },
  partBad: { color: '#b91c1c' },
  calib: { fontSize: 15, fontWeight: '600', marginTop: 4 },
});
