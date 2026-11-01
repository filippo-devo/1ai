import type { ExerciseId, ExerciseThresholds, TrackingConfig } from '../counting/config';
import { Calibrator } from '../counting/calibration';
import { extractFeatures } from '../counting/features';
import { RepCounter, type Calibration, type CounterSnapshot, type RepEvent } from '../counting/repCounter';
import type { Pose } from '../pose/types';

export interface RunResult {
  reps: number;
  partials: number;
  events: RepEvent[];
  snapshots: CounterSnapshot[];
  /** Number of frames processed while tracking was 'lost'. */
  lostFrames: number;
}

export function runCounter(
  exercise: ExerciseId,
  poses: Pose[],
  options: {
    calibration?: Calibration | null;
    thresholds?: Partial<ExerciseThresholds>;
    tracking?: Partial<TrackingConfig>;
  } = {},
): RunResult {
  const counter = new RepCounter(exercise, options);
  const events: RepEvent[] = [];
  counter.onEvent((e) => events.push(e));
  const snapshots: CounterSnapshot[] = [];
  let lostFrames = 0;
  for (const p of poses) {
    const s = counter.update(extractFeatures(exercise, p), p.timestamp);
    if (s.tracking === 'lost') lostFrames++;
    snapshots.push(s);
  }
  const last = snapshots[snapshots.length - 1];
  return { reps: last?.reps ?? 0, partials: last?.partials ?? 0, events, snapshots, lostFrames };
}

export function runCalibration(exercise: ExerciseId, poses: Pose[]): Calibration | null {
  const c = new Calibrator(exercise);
  for (const p of poses) {
    const s = c.update(extractFeatures(exercise, p), p.timestamp);
    if (s.result) return s.result;
  }
  return null;
}
