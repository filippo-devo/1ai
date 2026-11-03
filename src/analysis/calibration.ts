import { CALIBRATION, CYCLIC, type ExerciseId, type VariantId } from './config';
import { median, std } from './geometry';
import { FrameView, type Part } from './landmarks';
import { MetricExtractor, type MeasuredSide } from './metrics';
import type { Pose, PoseSource } from '../pose/types';

/** Tracking calibration: what the start position looks like for THIS person and setup. */
export interface CalibrationResult {
  exercise: ExerciseId;
  variant: VariantId;
  /** Driving value in the start position (individual extension / rest), deg. */
  rest: number;
  /** Noise of the driving value while still (std, deg). */
  noise: number;
  /** Share of frames during the collection with all required points visible. */
  availability: number;
  side: MeasuredSide | null;
  source: PoseSource;
  samples: number;
}

/**
 * Range observed during optional controlled movements after the start position.
 * Kept SEPARATE from the target: shallow calibration movements never become the target.
 */
export interface MeasuredRange {
  rest: number;
  extreme: number;
  cycles: number;
}

export type CalibrationStatus = 'not_visible' | 'wrong_posture' | 'holding' | 'done';

export interface CalibrationState {
  status: CalibrationStatus;
  progress: number;
  result: CalibrationResult | null;
  measuredRange: MeasuredRange | null;
  missing: Part[];
}

/** Is the driving value in a plausible start position for calibration? */
function looksLikeStart(exercise: ExerciseId, variant: VariantId, v: number): boolean {
  const cfg = CYCLIC[`${exercise}/${variant}`];
  if (exercise === 'plank') return v >= 150;
  if (exercise === 'jumprope') return v >= 150; // standing: knee nearly straight
  if (!cfg) return false;
  if (cfg.direction === 'decrease') return v >= cfg.calibStart;
  // abs: lying on the back
  return v <= 35;
}

export class CalibrationCollector {
  private readonly extractor: MetricExtractor;
  private samples: { t: number; v: number }[] = [];
  private frames = 0;
  private validFrames = 0;
  private result: CalibrationResult | null = null;
  private range: MeasuredRange | null = null;
  private rangeAway = false;
  private rangeExtreme = Number.NaN;

  constructor(
    readonly exercise: ExerciseId,
    readonly variant: VariantId,
  ) {
    this.extractor = new MetricExtractor(exercise, variant);
  }

  reset(): void {
    this.samples = [];
    this.frames = 0;
    this.validFrames = 0;
    this.result = null;
    this.range = null;
    this.rangeAway = false;
    this.extractor.sides.reset();
  }

  update(pose: Pose): CalibrationState {
    const m = this.extractor.extract(new FrameView(pose));
    this.frames++;
    if (m.primary !== null) this.validFrames++;
    if (this.result) {
      this.trackRange(m.primary);
      return { status: 'done', progress: 1, result: this.result, measuredRange: this.range, missing: [] };
    }
    if (m.primary === null) {
      this.samples = [];
      return { status: 'not_visible', progress: 0, result: null, measuredRange: null, missing: m.missing };
    }
    if (m.posture === false || !looksLikeStart(this.exercise, this.variant, m.primary)) {
      this.samples = [];
      return { status: 'wrong_posture', progress: 0, result: null, measuredRange: null, missing: [] };
    }
    this.samples.push({ t: m.t, v: m.primary });
    while (this.samples.length > 3 && std(this.samples.map((s) => s.v)) > CALIBRATION.maxStd) this.samples.shift();
    const held = this.samples[this.samples.length - 1].t - this.samples[0].t;
    if (held >= CALIBRATION.holdMs && this.samples.length >= 5) {
      const values = this.samples.map((s) => s.v);
      this.result = {
        exercise: this.exercise,
        variant: this.variant,
        rest: median(values),
        noise: std(values),
        availability: this.frames > 0 ? this.validFrames / this.frames : 0,
        side: m.side,
        source: pose.source ?? 'movenet',
        samples: values.length,
      };
      return { status: 'done', progress: 1, result: this.result, measuredRange: null, missing: [] };
    }
    return { status: 'holding', progress: Math.min(1, held / CALIBRATION.holdMs), result: null, measuredRange: null, missing: [] };
  }

  /** Optional: measure up to CALIBRATION.maxRangeCycles controlled movements after the hold. */
  private trackRange(v: number | null): void {
    const cfg = CYCLIC[`${this.exercise}/${this.variant}`];
    if (!this.result || v === null || !cfg) return;
    if (this.range && this.range.cycles >= CALIBRATION.maxRangeCycles) return;
    const sign = cfg.direction === 'decrease' ? -1 : 1;
    const excursion = sign * (v - this.result.rest);
    const half = cfg.minAmplitude / 2;
    if (!this.rangeAway && excursion >= half) {
      this.rangeAway = true;
      this.rangeExtreme = v;
    } else if (this.rangeAway) {
      if (sign * (v - this.rangeExtreme) > 0) this.rangeExtreme = v;
      if (excursion < half / 2) {
        this.rangeAway = false;
        const prev = this.range;
        const extreme = prev ? (sign > 0 ? Math.max(prev.extreme, this.rangeExtreme) : Math.min(prev.extreme, this.rangeExtreme)) : this.rangeExtreme;
        this.range = { rest: this.result.rest, extreme, cycles: (prev?.cycles ?? 0) + 1 };
      }
    }
  }
}
