import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CalibrationState } from '../analysis/calibration';
import { DETECTOR_VERSION } from '../analysis/config';
import type { AnalysisSnapshot } from '../analysis/session';
import type { CycleRecord } from '../analysis/types';

const fmt = (v: number | null | undefined, digits = 0) => (v === undefined || v === null || !Number.isFinite(v) ? '–' : v.toFixed(digits));

const OUTCOME_PL: Record<CycleRecord['outcome'], string> = {
  target_reached: 'CEL OSIĄGNIĘTY',
  target_missed: 'cel nieosiągnięty',
  unevaluable: 'nieocenialna',
};

export function describeCycle(c: CycleRecord): string {
  const parts = [`#${c.index} ${OUTCOME_PL[c.outcome]}`, `${fmt(c.restValue)}°→${fmt(c.extremeValue)}°`, `${((c.endT - c.startT) / 1000).toFixed(1)} s`];
  if (c.reasons.length) parts.push(c.reasons.join(','));
  if (c.flags.length) parts.push(`[${c.flags.join(',')}]`);
  return parts.join(' ');
}

interface Props {
  snapshot: AnalysisSnapshot | null;
  calibration: CalibrationState | null;
  fps: number;
  inferenceMs: number;
  cropSize: number;
  cycles: CycleRecord[];
  engine?: string;
  /** Distance from the top of the camera area (below the top bar). */
  top?: number;
}

export function DebugPanel({ snapshot, calibration, fps, inferenceMs, cropSize, cycles, engine, top = 4 }: Props) {
  const m = snapshot?.metrics;
  const th = snapshot?.cyclic?.thresholds;
  const cal = calibration?.result;
  return (
    <View style={[styles.panel, { top }]} pointerEvents="none">
      <Text style={styles.line}>
        stan: <Text style={styles.strong}>{snapshot?.state ?? '–'}</Text> | faza: {snapshot?.phase ?? '–'} | postawa:{' '}
        {m?.posture === null || m?.posture === undefined ? '?' : m.posture ? 'OK' : 'NIE'}
      </Text>
      <Text style={styles.line}>
        wartość: {fmt(m?.primary)} (filtr {fmt(snapshot?.cyclic?.value)}) | strona: {m?.side ?? '–'}
        {m?.oneSided ? ' (jednostronnie)' : ''} | jakość {fmt(m?.quality, 2)} | pokrycie 3 s {fmt((snapshot?.coverage ?? 0) * 100)}%
      </Text>
      {th && (
        <Text style={styles.line}>
          progi: spocz. {fmt(Number.isFinite(th.base) ? th.base : null)} wej. {fmt(th.restEnter)} / wyj. {fmt(th.restExit)} | cel {fmt(th.target)} |
          min. amplituda {fmt(th.minAmplitude)}
        </Text>
      )}
      {m && Object.keys(m.values).length > 0 && (
        <Text style={styles.line}>
          {Object.entries(m.values)
            .map(([k, v]) => `${k}=${fmt(v, Math.abs(v ?? 0) < 2 ? 2 : 0)}`)
            .join(' ')}
        </Text>
      )}
      {snapshot?.plank && (
        <Text style={styles.line}>
          deska: w tol. {fmt(snapshot.plank.stats.inToleranceMs / 1000, 1)} s | ocenialny {fmt(snapshot.plank.stats.evaluableMs / 1000, 1)} s |
          poza: {snapshot.plank.failing.join(',') || '–'} | odchyl. bioder {fmt(snapshot.plank.hipDev, 3)}
        </Text>
      )}
      {snapshot?.jump && (
        <Text style={styles.line}>
          skoki: {snapshot.jump.stats.jumps} | stopy {fmt(snapshot.jump.feetHeight, 3)} biodra {fmt(snapshot.jump.hipHeight, 3)} | ocena{' '}
          {snapshot.jump.evaluation} | palce: {snapshot.jump.stats.toeRaises}
        </Text>
      )}
      <Text style={styles.line}>
        kalibracja: {cal ? `spocz. ${fmt(cal.rest)}°, szum ${fmt(cal.noise, 1)}°, dostępność ${fmt(cal.availability * 100)}%` : '–'}
      </Text>
      <Text style={styles.line}>
        {engine ? `${engine} | ` : ''}
        {fmt(fps, 1)} fps | inferencja {fmt(inferenceMs)} ms{Number.isFinite(cropSize) ? ` | crop ${fmt(cropSize * 100)}%` : ''} | {DETECTOR_VERSION}
      </Text>
      {snapshot?.hint && <Text style={styles.hint}>wskazówka ({snapshot.hint.kind}): {snapshot.hint.text}</Text>}
      {cycles
        .slice(-4)
        .reverse()
        .map((c) => (
          <Text key={`${c.index}-${c.endT}`} style={styles.event}>
            {describeCycle(c)}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 6,
  },
  line: { color: 'white', fontSize: 10.5, fontFamily: 'monospace' },
  strong: { fontWeight: 'bold', color: '#facc15' },
  hint: { color: '#fde68a', fontSize: 10.5, fontFamily: 'monospace' },
  event: { color: '#a5f3fc', fontSize: 10.5, fontFamily: 'monospace' },
});
