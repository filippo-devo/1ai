/**
 * Offline evaluation on recordings with hand-labelled repetitions.
 * Pure functions over recorded landmark sequences (no camera); used by
 * __tests__/evaluation.test.ts (`npm run evaluate`).
 */
import type { ExerciseId, VariantId } from '../analysis/config';
import { squareToUpright } from '../pose/movenet';
import type { Pose } from '../pose/types';
import { webMessageToPose, type WebPoseMessage } from '../pose/web/messages';
import { analyze } from '../testing/run';

export interface LabeledRecording {
  id: string;
  /** Path relative to the fixtures directory. */
  file: string;
  /** 'movenet-square': scripts/verify/extract_movenet.py; 'mediapipe-messages': extract_mediapipe.py. */
  format: 'movenet-square' | 'mediapipe-messages';
  exercise: ExerciseId;
  variant: VariantId;
  /** Tuning data must never be used to report accuracy. */
  split: 'tune' | 'test';
  /** Hand-labelled times (ms) at which each repetition/jump was completed. */
  labelsMs: number[];
  notes?: string;
}

export interface Manifest {
  /** Matching window around a labelled completion time (ms). */
  toleranceMs: number;
  recordings: LabeledRecording[];
}

export interface RecordingReport {
  id: string;
  split: 'tune' | 'test';
  exercise: ExerciseId;
  variant: VariantId;
  labeled: number;
  /** Detected cycles (any outcome) / jumps. */
  detected: number;
  matched: number;
  /** Labelled repetitions that the detector reported as non-evaluable attempts (tracking gap). */
  unevaluable: number;
  /** Labelled repetitions with neither a cycle nor a non-evaluable attempt. */
  missed: number;
  falsePositives: number;
  /** detected − labelled. */
  countError: number;
  targetReached: number | null;
  unevaluableCycles: number | null;
  /** Share of frames without the required points. */
  unevaluableFrameShare: number;
}

interface MovenetFixture {
  width: number;
  height: number;
  frames: { t: number; square: number[] }[];
}

export function toPoses(format: LabeledRecording['format'], data: unknown): Pose[] {
  if (format === 'movenet-square') {
    const fx = data as MovenetFixture;
    return fx.frames.map((f) => ({
      keypoints: squareToUpright(f.square, fx.width, fx.height),
      width: fx.width,
      height: fx.height,
      timestamp: f.t,
      source: 'movenet',
    }));
  }
  return (data as WebPoseMessage[]).map(webMessageToPose);
}

/** Greedy one-to-one matching of detections to labels within ±toleranceMs. */
export function matchEvents(labels: number[], detections: number[], toleranceMs: number): { matched: number; missed: number; falsePositives: number } {
  const used = new Set<number>();
  let matched = 0;
  for (const l of labels) {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    detections.forEach((d, i) => {
      const dd = Math.abs(d - l);
      if (!used.has(i) && dd <= toleranceMs && dd < bestD) {
        best = i;
        bestD = dd;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return { matched, missed: labels.length - matched, falsePositives: detections.length - used.size };
}

export function evaluateRecording(rec: LabeledRecording, poses: Pose[], toleranceMs: number): RecordingReport {
  const r = analyze(rec.exercise, rec.variant, poses);
  const times =
    rec.exercise === 'jumprope'
      ? (r.analyzer.jump?.jumps ?? []).map((j) => j.t)
      : r.result.cycles.filter((c) => c.outcome !== 'unevaluable').map((c) => c.endT);
  const m = matchEvents(rec.labelsMs, times, toleranceMs);
  // Unmatched labels covered by a non-evaluable attempt (started before the label, closed by a gap).
  const unevaluableAttempts = r.result.cycles.filter((c) => c.outcome === 'unevaluable');
  const matchedTimes = new Set<number>();
  for (const l of rec.labelsMs) if (times.some((d) => Math.abs(d - l) <= toleranceMs)) matchedTimes.add(l);
  const unevaluable = rec.labelsMs.filter(
    (l) => !matchedTimes.has(l) && unevaluableAttempts.some((c) => c.startT <= l && l <= c.endT + 2 * toleranceMs),
  ).length;
  return {
    id: rec.id,
    split: rec.split,
    exercise: rec.exercise,
    variant: rec.variant,
    labeled: rec.labelsMs.length,
    detected: times.length,
    matched: m.matched,
    unevaluable,
    missed: m.missed - unevaluable,
    falsePositives: m.falsePositives,
    countError: times.length - rec.labelsMs.length,
    targetReached: r.result.counts?.targetReached ?? null,
    unevaluableCycles: r.result.counts?.unevaluable ?? null,
    unevaluableFrameShare: 1 - r.result.coverage.share,
  };
}

export function formatReport(reports: RecordingReport[]): string {
  const lines = ['split | recording | exercise/variant | labelled | detected | matched | non-evaluable | missed | false+ | count err | target reached | frames w/o data'];
  for (const r of reports) {
    lines.push(
      [r.split, r.id, `${r.exercise}/${r.variant}`, r.labeled, r.detected, r.matched, r.unevaluable, r.missed, r.falsePositives, r.countError, r.targetReached ?? '–', `${(r.unevaluableFrameShare * 100).toFixed(1)}%`].join(' | '),
    );
  }
  for (const split of ['tune', 'test'] as const) {
    const rs = reports.filter((r) => r.split === split);
    if (!rs.length) {
      lines.push(`${split}: no recordings`);
      continue;
    }
    const sum = (k: 'labeled' | 'matched' | 'unevaluable' | 'missed' | 'falsePositives') => rs.reduce((a, r) => a + r[k], 0);
    const frames = rs.reduce((a, r) => a + r.unevaluableFrameShare, 0) / rs.length;
    lines.push(
      `${split} total: labelled ${sum('labeled')}, matched ${sum('matched')}, non-evaluable ${sum('unevaluable')}, missed ${sum('missed')}, false positives ${sum('falsePositives')}, mean frames without data ${(frames * 100).toFixed(1)}% (${rs.length} recordings)`,
    );
  }
  return lines.join('\n');
}
