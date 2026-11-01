import { isRepExercise, PLANK, THRESHOLDS, TRACKING, type ExerciseId, type TrackingConfig } from './config';
import type { Features } from './features';
import { median, stdDev } from './geometry';
import type { Calibration } from './repCounter';

export type CalibrationStatus = 'not_visible' | 'wrong_posture' | 'holding' | 'done';

export interface CalibrationState {
  status: CalibrationStatus;
  /** 0..1 progress of holding the start position. */
  progress: number;
  result: Calibration | null;
  missing: Features['missing'];
}

/**
 * Short calibration before the workout: the user holds the start position
 * (push-up plank on straight arms / standing / dead hang / lying / plank) for
 * TRACKING.calibrationHoldMs while all required keypoints are visible.
 * The measured start angle adapts the start threshold (see adaptThresholds).
 */
export class Calibrator {
  private samples: { t: number; angle: number }[] = [];
  private result: Calibration | null = null;
  private readonly calibMinAngleDeg: number;
  private readonly tracking: TrackingConfig;

  constructor(
    readonly exercise: ExerciseId,
    options: { calibMinAngleDeg?: number; tracking?: Partial<TrackingConfig> } = {},
  ) {
    this.calibMinAngleDeg =
      options.calibMinAngleDeg ??
      (isRepExercise(exercise) ? THRESHOLDS[exercise].calibMinAngleDeg : PLANK.calibMinAngleDeg);
    this.tracking = { ...TRACKING, ...options.tracking };
  }

  reset(): void {
    this.samples = [];
    this.result = null;
  }

  update(f: Features, t: number): CalibrationState {
    if (this.result) return { status: 'done', progress: 1, result: this.result, missing: [] };
    if (!f.valid) {
      this.samples = [];
      return { status: 'not_visible', progress: 0, result: null, missing: f.missing };
    }
    if (!f.postureOk || f.primary < this.calibMinAngleDeg) {
      this.samples = [];
      return { status: 'wrong_posture', progress: 0, result: null, missing: [] };
    }
    this.samples.push({ t, angle: f.primary });
    // Must be still: if the window got noisy, restart it from the latest samples.
    while (this.samples.length > 3 && stdDev(this.samples.map((s) => s.angle)) > this.tracking.calibrationMaxStdDeg) {
      this.samples.shift();
    }
    const held = this.samples[this.samples.length - 1].t - this.samples[0].t;
    const progress = Math.min(1, held / this.tracking.calibrationHoldMs);
    if (held >= this.tracking.calibrationHoldMs && this.samples.length >= 5) {
      this.result = { startAngle: median(this.samples.map((s) => s.angle)) };
      return { status: 'done', progress: 1, result: this.result, missing: [] };
    }
    return { status: 'holding', progress, result: null, missing: [] };
  }
}
