import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EXERCISES, type ExerciseId } from '../counting/config';
import { BODY_PART_PL, type Features } from '../counting/features';
import type { CounterSnapshot, RepEvent } from '../counting/repCounter';

const fmt = (v: number | undefined, digits = 0) => (v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits));

const EVENT_PL: Record<RepEvent['type'], string> = {
  rep: 'ZALICZONE',
  partial: 'niepełne (za płytko)',
  too_fast: 'odrzucone (za szybko)',
  reset_lost: 'reset: utrata sylwetki',
  reset_posture: 'reset: zła pozycja',
};

export function describeEvent(e: RepEvent | null): string {
  if (!e) return '–';
  const parts = [EVENT_PL[e.type]];
  if (e.minAngle !== undefined && Number.isFinite(e.minAngle)) parts.push(`min kąt ${e.minAngle.toFixed(0)}°`);
  if (e.maxDisp !== undefined && Number.isFinite(e.maxDisp)) parts.push(`przem. ${e.maxDisp.toFixed(2)}`);
  if (e.durationMs !== undefined) parts.push(`${(e.durationMs / 1000).toFixed(1)} s`);
  return parts.join(', ');
}

interface Props {
  exercise: ExerciseId;
  features: Features | null;
  snapshot: CounterSnapshot | null;
  fps: number;
  inferenceMs: number;
  cropSize: number;
  events: RepEvent[];
  engine?: string;
}

export function DebugPanel({ exercise, features, snapshot, fps, inferenceMs, cropSize, events, engine }: Props) {
  const info = EXERCISES[exercise];
  const th = snapshot?.thresholds;
  return (
    <View style={styles.panel} pointerEvents="none">
      <Text style={styles.line}>
        faza: <Text style={styles.strong}>{snapshot?.phase ?? '–'}</Text> | śledzenie: {snapshot?.tracking ?? '–'} | postawa:{' '}
        {features?.postureOk ? 'OK' : 'NIE'}
      </Text>
      <Text style={styles.line}>
        {info.primaryLabel}: {fmt(features?.primary)}° (wygł. {fmt(snapshot?.angle)}°) | strona: {features?.side ?? '–'}
      </Text>
      <Text style={styles.line}>
        {info.auxLabel}: {fmt(snapshot?.disp, 2)} | pewność: {fmt(features?.confidence, 2)}
      </Text>
      {features && !features.valid && features.missing.length > 0 && (
        <Text style={styles.line}>brak: {features.missing.map((m) => BODY_PART_PL[m]).join(', ')}</Text>
      )}
      {th && (
        <Text style={styles.line}>
          progi: start ≥{fmt(th.startEnterDeg)}° (wyjście &lt;{fmt(th.startExitDeg)}°), cel ≤{fmt(th.targetEnterDeg)}° (wyjście &gt;
          {fmt(th.targetExitDeg)}°) i przem. ≥{fmt(th.auxTargetEnter, 2)}
        </Text>
      )}
      {features &&
        Object.entries(features.debug).map(([k, v]) => (
          <Text key={k} style={styles.line}>
            {k}: {fmt(v, 1)}
          </Text>
        ))}
      <Text style={styles.line}>
        {engine ? `${engine} | ` : ''}
        {fmt(fps, 1)} fps | inferencja {fmt(inferenceMs)} ms{Number.isFinite(cropSize) ? ` | crop ${fmt(cropSize * 100)}%` : ''}
      </Text>
      <Text style={styles.line}>
        powt.: {snapshot?.reps ?? 0} | niepełne: {snapshot?.partials ?? 0}
      </Text>
      {events
        .slice(-4)
        .reverse()
        .map((e, i) => (
          <Text key={`${e.t}-${i}`} style={styles.event}>
            #{e.reps} {describeEvent(e)}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 4,
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 6,
    borderRadius: 6,
  },
  line: { color: 'white', fontSize: 11, fontFamily: 'monospace' },
  strong: { fontWeight: 'bold', color: '#facc15' },
  event: { color: '#a5f3fc', fontSize: 11, fontFamily: 'monospace' },
});
