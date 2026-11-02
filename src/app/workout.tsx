import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PoseCamera, POSE_ENGINE } from '../camera/PoseCamera';
import type { DetectedPose } from '../camera/types';
import { DebugPanel } from '../components/DebugPanel';
import { Calibrator, type CalibrationState } from '../counting/calibration';
import { EXERCISES, EXERCISE_IDS, isRepExercise, JUMP_MOVENET, type ExerciseId } from '../counting/config';
import {
  BODY_PART_PL,
  extractFeatures,
  requiredKeypointIndices,
  visibleParts,
  type BodyPart,
  type Features,
} from '../counting/features';
import { JumpCounter } from '../counting/jumpCounter';
import { PlankTimer, type PlankSnapshot } from '../counting/plankTimer';
import { RepCounter, type Calibration, type CounterSnapshot, type Phase, type RepEvent } from '../counting/repCounter';
import { colors, exerciseTint, radius, withAlpha } from '../ui/theme';
import { formatDuration } from '../utils/format';

type Stage = 'setup' | 'countdown' | 'active' | 'paused';
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

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

/** Spoken plank time: "10 sekund", "1 minuta", "1 minuta 20". */
function spokenTime(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  if (m === 0) return `${s} sekund`;
  const min = m === 1 ? 'minuta' : m < 5 ? 'minuty' : 'minut';
  return s === 0 ? `${m} ${min}` : `${m} ${min} ${s}`;
}

export default function WorkoutScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ exercise: string; voice?: string; debug?: string }>();
  const exercise: ExerciseId = (EXERCISE_IDS as string[]).includes(params.exercise)
    ? (params.exercise as ExerciseId)
    : 'pushup';
  const info = EXERCISES[exercise];
  const tint = exerciseTint[exercise];
  const voice = params.voice !== '0';
  const [debug, setDebug] = useState(params.debug === '1');

  // --- camera lifecycle ------------------------------------------------------------------
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const isFocused = useIsFocused();
  const appActive = useAppStateActive();
  // Processing stops when the screen is not focused / app in background (camera inactive).
  const isActive = isFocused && appActive;

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
  const counterRef = useRef<RepCounter | JumpCounter | null>(null);
  const plankRef = useRef<PlankTimer | null>(null);
  const announcedRef = useRef(0);
  const [snapshot, setSnapshot] = useState<CounterSnapshot | null>(null);
  const [plank, setPlank] = useState<PlankSnapshot | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [lastPose, setLastPose] = useState<DetectedPose | null>(null);
  const [perf, setPerf] = useState({ fps: 0, inferenceMs: 0 });
  const [events, setEvents] = useState<RepEvent[]>([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [elapsedMs, setElapsedMs] = useState(0);
  const accumulatedMsRef = useRef(0);
  const activeSinceRef = useRef<number | null>(null);
  const fpsRef = useRef({ lastT: 0, fps: 0 });

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
      } else if (st === 'active') {
        if (counterRef.current) setSnapshot(counterRef.current.update(f, pose.timestamp));
        if (plankRef.current) {
          const p = plankRef.current.update(f, pose.timestamp);
          setPlank(p);
          const tens = Math.floor(p.heldMs / 10000);
          if (tens > announcedRef.current) {
            announcedRef.current = tens;
            say(spokenTime(tens * 10), voice);
          }
        }
      }
      setFeatures(f);
      setLastPose(pose);
      if (debug) setPerf({ fps: s.fps, inferenceMs: pose.inferenceMs });
    },
    [exercise, calibrator, debug, voice],
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
      if (isRepExercise(exercise) || exercise === 'jumprope') {
        const counter =
          exercise === 'jumprope'
            ? new JumpCounter({ config: POSE_ENGINE === 'native' ? JUMP_MOVENET : undefined })
            : new RepCounter(exercise, { calibration: calibrationResultRef.current });
        // Jump rope is fast: announce every 10th jump instead of every jump.
        const announceEvery = exercise === 'jumprope' ? 10 : 1;
        counter.onEvent((e) => {
          setEvents((prev) => [...prev.slice(-19), e]);
          if (e.type === 'rep' && e.reps % announceEvery === 0) say(String(e.reps), voice);
        });
        counterRef.current = counter;
        setSnapshot(counter.snapshot());
      } else {
        const timer = new PlankTimer({ calibration: calibrationResultRef.current });
        plankRef.current = timer;
        announcedRef.current = 0;
        setPlank(timer.snapshot());
      }
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
    plankRef.current?.resetPhase();
    activeSinceRef.current = Date.now();
    goTo('active');
  }, [goTo]);

  const finish = useCallback(() => {
    const since = activeSinceRef.current;
    if (since !== null) accumulatedMsRef.current += Date.now() - since;
    activeSinceRef.current = null;
    void Speech.stop();
    const snap = counterRef.current?.snapshot();
    const hold = plankRef.current?.snapshot();
    router.replace({
      pathname: '/summary',
      params: {
        exercise,
        reps: String(snap?.reps ?? 0),
        partials: String(snap?.partials ?? 0),
        heldMs: String(Math.round(hold?.heldMs ?? 0)),
        bestMs: String(Math.round(hold?.bestMs ?? 0)),
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
      plankRef.current?.resetPhase();
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
            events={events}
            engine={POSE_ENGINE === 'native' ? 'MoveNet (natywnie)' : 'MediaPipe (WebView, Expo Go)'}
            top={insets.top + 64}
          />
        )}

        {stage === 'countdown' && (
          <View style={styles.countdownBox} pointerEvents="none">
            <View style={[styles.countdownRing, { borderColor: tint }]}>
              <Text style={styles.countdown}>{countdown}</Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillText}>Przyjmij pozycję: {info.startLabel}</Text>
            </View>
          </View>
        )}

        {counting && (
          <CountingOverlay
            exercise={exercise}
            snapshot={snapshot}
            plank={plank}
            features={features}
            paused={stage === 'paused'}
            elapsedMs={elapsedMs}
            bottomInset={insets.bottom}
            onPause={pause}
            onResume={resume}
            onFinish={finish}
          />
        )}

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <RoundButton icon="close" label="Zamknij" onPress={() => router.back()} />
          <View style={styles.titlePill}>
            <MaterialCommunityIcons name={info.icon as IconName} size={18} color={tint} />
            <Text style={styles.titleText}>{info.name}</Text>
          </View>
          <View style={styles.topRight}>
            <RoundButton icon="camera-flip-outline" label="Przełącz kamerę" onPress={switchCamera} />
            <RoundButton
              icon="bug-outline"
              label="Tryb debugowania"
              onPress={() => setDebug((d) => !d)}
              active={debug}
            />
          </View>
        </View>
      </View>

      {(stage === 'setup' || stage === 'countdown') && (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          {stage === 'setup' ? (
            <SetupPanel
              exercise={exercise}
              calibration={calibration}
              parts={lastPose ? visibleParts(exercise, lastPose) : null}
              onStart={startCountdown}
              onRecalibrate={recalibrate}
            />
          ) : (
            <Pressable style={styles.cancelButton} onPress={() => goTo('setup')}>
              <Text style={styles.cancelText}>Anuluj</Text>
            </Pressable>
          )}
        </SafeAreaView>
      )}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  active,
  size = 44,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.roundButton,
        { width: size, height: size, borderRadius: size / 2 },
        active && { backgroundColor: colors.accent },
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.5} color={active ? colors.onAccent : colors.text} />
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

function lostMessage(features: Features | null): string {
  const missing = features && !features.valid ? features.missing.map((m) => BODY_PART_PL[m]).join(', ') : '';
  return `Ustaw się w kadrze${missing ? ` · nie widać: ${missing}` : ''}`;
}

function CountingOverlay({
  exercise,
  snapshot,
  plank,
  features,
  paused,
  elapsedMs,
  bottomInset,
  onPause,
  onResume,
  onFinish,
}: {
  exercise: ExerciseId;
  snapshot: CounterSnapshot | null;
  plank: PlankSnapshot | null;
  features: Features | null;
  paused: boolean;
  elapsedMs: number;
  bottomInset: number;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}) {
  const info = EXERCISES[exercise];
  const isHold = info.kind === 'hold';
  const tracking = isHold ? plank?.tracking : snapshot?.tracking;

  let message: string;
  let tone: 'normal' | 'alert' | 'good' = 'normal';
  if (paused) message = 'Pauza';
  else if (!tracking || tracking === 'lost') {
    tone = 'alert';
    message = lostMessage(features);
  } else if (tracking === 'uncertain') message = 'Słaba widoczność…';
  else if (isHold) {
    if (plank?.inPosition) {
      tone = 'good';
      message = 'Trzymaj!';
    } else message = plank?.postureOk ? 'Wyprostuj ciało w jednej linii' : info.postureHint;
  } else if (snapshot && snapshot.phase === 'unknown' && !snapshot.postureOk) message = info.postureHint;
  else if (exercise === 'jumprope') {
    message = snapshot && snapshot.phase !== 'unknown' ? 'Skacz!' : 'Stań prosto…';
    if (snapshot?.phase !== 'unknown') tone = 'good';
  } else message = snapshot ? phaseText(snapshot.phase, exercise) : '';

  const big = isHold ? formatDuration(plank?.heldMs ?? 0) : String(snapshot?.reps ?? 0);
  const caption = isHold ? 'czas w desce' : exercise === 'jumprope' ? 'skoki' : 'powtórzenia';

  return (
    <View style={[styles.countingBox, { paddingBottom: bottomInset + 16 }]} pointerEvents="box-none">
      <View
        style={[
          styles.statusPill,
          tone === 'alert' && { backgroundColor: withAlpha(colors.danger, 0.92) },
          tone === 'good' && { backgroundColor: withAlpha(colors.ok, 0.9) },
        ]}
      >
        <Text style={[styles.statusText, tone !== 'normal' && { color: tone === 'good' ? colors.onAccent : 'white' }]}>
          {message}
        </Text>
      </View>

      <Text style={[styles.bigNumber, isHold && styles.bigTime]} accessibilityLabel={`${caption}: ${big}`}>
        {big}
      </Text>
      <Text style={styles.caption}>{caption.toUpperCase()}</Text>

      <View style={styles.controls}>
        <View style={styles.timerChip}>
          <MaterialCommunityIcons name="timer-outline" size={18} color={colors.muted} />
          <Text style={styles.timerText}>{formatDuration(elapsedMs)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Wznów' : 'Pauza'}
          onPress={paused ? onResume : onPause}
          style={({ pressed }) => [styles.pauseButton, paused && { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
        >
          <MaterialCommunityIcons name={paused ? 'play' : 'pause'} size={34} color={paused ? colors.onAccent : colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onFinish}
          style={({ pressed }) => [styles.finishButton, pressed && { opacity: 0.8 }]}
        >
          <MaterialCommunityIcons name="stop" size={20} color="white" />
          <Text style={styles.finishText}>Zakończ</Text>
        </Pressable>
      </View>
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
  parts: { part: BodyPart; visible: boolean }[] | null;
  onStart: () => void;
  onRecalibrate: () => void;
}) {
  const info = EXERCISES[exercise];
  const tint = exerciseTint[exercise];
  const done = calibration?.status === 'done';
  const progress = calibration?.status === 'holding' ? calibration.progress : done ? 1 : 0;

  let calibText = 'Czekam na obraz z kamery…';
  let calibIcon: IconName = 'progress-clock';
  if (calibration) {
    switch (calibration.status) {
      case 'not_visible':
        calibText = `Ustaw się w kadrze${calibration.missing.length ? ` · nie widać: ${calibration.missing.map((m) => BODY_PART_PL[m]).join(', ')}` : ''}`;
        calibIcon = 'account-search-outline';
        break;
      case 'wrong_posture':
        calibText = info.postureHint;
        calibIcon = 'human';
        break;
      case 'holding':
        calibText = 'Kalibracja — nie ruszaj się…';
        calibIcon = 'progress-clock';
        break;
      case 'done':
        calibText = 'Gotowe! Możesz zaczynać.';
        calibIcon = 'check-circle';
        break;
    }
  }

  const steps: { icon: IconName; text: string }[] = [
    { icon: 'cellphone', text: info.setup.phoneOrientation },
    { icon: 'ruler', text: info.setup.distance },
    { icon: 'camera-outline', text: info.setup.angle },
    { icon: 'human', text: info.setup.bodyParts },
    ...info.setup.tips.map((t) => ({ icon: 'lightbulb-on-outline' as IconName, text: t })),
  ];

  return (
    <View style={styles.setup}>
      <View style={styles.handle} />
      <ScrollView style={styles.stepsScroll} contentContainerStyle={styles.steps} showsVerticalScrollIndicator={false}>
        {steps.map((s) => (
          <View key={s.text} style={styles.stepRow}>
            <View style={[styles.stepIcon, { backgroundColor: withAlpha(tint, 0.14) }]}>
              <MaterialCommunityIcons name={s.icon} size={18} color={tint} />
            </View>
            <Text style={styles.stepText}>{s.text}</Text>
          </View>
        ))}
      </ScrollView>

      {parts && (
        <View style={styles.chips}>
          {parts.map(({ part, visible }) => (
            <View
              key={part}
              style={[
                styles.chip,
                { backgroundColor: withAlpha(visible ? colors.ok : colors.danger, 0.16), borderColor: visible ? colors.ok : colors.danger },
              ]}
            >
              <MaterialCommunityIcons name={visible ? 'check' : 'close'} size={14} color={visible ? colors.ok : colors.danger} />
              <Text style={[styles.chipText, { color: visible ? colors.ok : colors.danger }]}>{BODY_PART_PL[part]}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.calibCard}>
        <MaterialCommunityIcons name={calibIcon} size={22} color={done ? colors.ok : colors.muted} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={[styles.calibText, done && { color: colors.ok }]}>{calibText}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: done ? colors.ok : tint }]} />
          </View>
        </View>
        {done && (
          <Pressable accessibilityRole="button" accessibilityLabel="Kalibruj ponownie" onPress={onRecalibrate} hitSlop={8}>
            <MaterialCommunityIcons name="refresh" size={22} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start"
        accessibilityState={{ disabled: !done }}
        disabled={!done}
        onPress={onStart}
        style={({ pressed }) => [
          styles.startButton,
          !done && styles.startButtonDisabled,
          pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        ]}
      >
        <MaterialCommunityIcons name="play" size={30} color={done ? colors.onAccent : colors.muted} />
        <Text style={[styles.startText, !done && { color: colors.muted }]}>{done ? 'START' : 'Najpierw kalibracja'}</Text>
      </Pressable>
    </View>
  );
}

const textShadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  cameraBox: { flex: 1 },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topRight: { flexDirection: 'row', gap: 10 },
  roundButton: { backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.overlay,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
  },
  titleText: { color: colors.text, fontSize: 16, fontWeight: '700' },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '58%',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  setup: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 14, flexShrink: 1 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  stepsScroll: { flexGrow: 0, flexShrink: 1 },
  steps: { gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, opacity: 0.9, paddingTop: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  calibCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: 14,
  },
  calibText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  startButton: {
    height: 68,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  startButtonDisabled: { backgroundColor: colors.surface2, shadowOpacity: 0, elevation: 0 },
  startText: { color: colors.onAccent, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  cancelButton: { margin: 20, height: 56, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.text, fontSize: 18, fontWeight: '700' },

  countdownBox: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 20 },
  countdownRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  countdown: { fontSize: 110, fontWeight: '800', color: colors.text },
  pill: { backgroundColor: colors.overlay, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  pillText: { color: colors.text, fontSize: 16, fontWeight: '600' },

  countingBox: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 16 },
  statusPill: {
    backgroundColor: colors.overlay,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: '100%',
  },
  statusText: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  bigNumber: { fontSize: 140, lineHeight: 150, fontWeight: '800', color: 'white', fontVariant: ['tabular-nums'], ...textShadow },
  bigTime: { fontSize: 96, lineHeight: 110 },
  caption: { color: colors.text, opacity: 0.85, fontSize: 14, fontWeight: '700', letterSpacing: 2, marginTop: -6, ...textShadow },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.overlay,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 24,
    minWidth: 96,
    justifyContent: 'center',
  },
  timerText: { color: colors.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pauseButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.overlay,
    borderWidth: 2,
    borderColor: withAlpha(colors.text, 0.25),
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.danger,
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 24,
  },
  finishText: { color: 'white', fontSize: 16, fontWeight: '800' },
});
