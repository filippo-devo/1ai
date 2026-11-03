import { CalibrationCollector, type CalibrationResult, type MeasuredRange } from '../analysis/calibration';
import type { ExerciseId, VariantId } from '../analysis/config';
import { ExerciseAnalyzer, type AnalysisSnapshot, type SessionResult } from '../analysis/session';
import type { Pose } from '../pose/types';

export interface AnalyzeRun {
  snaps: AnalysisSnapshot[];
  result: SessionResult;
  analyzer: ExerciseAnalyzer;
}

/** Runs the full analysis pipeline on a recorded/synthetic pose sequence (no camera). */
export function analyze(
  exercise: ExerciseId,
  variant: VariantId,
  poses: Pose[],
  options: { calibration?: CalibrationResult | null; target?: number | null; measuredRange?: MeasuredRange | null } = {},
): AnalyzeRun {
  const analyzer = new ExerciseAnalyzer(exercise, variant, { ...options, source: poses[0]?.source });
  const snaps = poses.map((p) => analyzer.update(p));
  return { snaps, result: analyzer.result(), analyzer };
}

export function calibrate(exercise: ExerciseId, variant: VariantId, poses: Pose[]): { result: CalibrationResult | null; range: MeasuredRange | null } {
  const c = new CalibrationCollector(exercise, variant);
  let last = null as ReturnType<CalibrationCollector['update']> | null;
  for (const p of poses) last = c.update(p);
  return { result: last?.result ?? null, range: last?.measuredRange ?? null };
}
