import type { CalibrationResult } from '../calibration';
import { TECHNIQUE } from '../config';
import type { FrameMetrics } from '../metrics';
import type { TechState } from '../types';

export type PlankCriterion = 'elbow' | 'knee' | 'hip' | 'hipDev';

export interface PlankStats {
  /** Whole active time (also when nothing could be measured). */
  totalMs: number;
  /** Time in a plank-like posture with data. */
  positionMs: number;
  /** Time in which ALL criteria could be measured. */
  evaluableMs: number;
  /** Evaluable time with all criteria within tolerance. */
  inToleranceMs: number;
  /** Time without enough data (missing points, gaps) — nothing could be assessed. */
  unevaluableMs: number;
  /** Time with data but not in a plank-like posture. */
  notInPositionMs: number;
  longestInToleranceMs: number;
  currentInToleranceMs: number;
  /** Time out of tolerance per criterion (only while evaluable). */
  outOfToleranceMs: Record<PlankCriterion, number>;
}

export interface PlankSnapshot {
  state: TechState;
  inPosition: boolean;
  evaluable: boolean;
  inTolerance: boolean;
  /** Criteria currently outside tolerance (after hysteresis). */
  failing: PlankCriterion[];
  /** Signed hip deviation: + sagging, − raised (÷ shoulder–ankle length). */
  hipDev: number | null;
  stats: PlankStats;
}

/**
 * Forearm plank. Criteria (working detector parameters, see config.ts):
 * elbow 80–100°, knee ≥165°, shoulder–hip–knee ≥165°, |hip deviation| ≤ 0.05.
 * A straight skeleton segment is NOT evidence of a neutral spine.
 * Time is credited only between two consecutive frames that both have data and
 * are at most maxCreditGapMs apart — never from stale points.
 */
export class PlankDetector {
  private readonly p = TECHNIQUE.plank;
  private readonly tol: number;
  private state: TechState = 'NOT_READY';
  private lastT: number | null = null;
  private lastGood = false;
  private gapStart: number | null = null;
  private failing = new Set<PlankCriterion>();
  private stats: PlankStats = {
    totalMs: 0,
    positionMs: 0,
    evaluableMs: 0,
    inToleranceMs: 0,
    unevaluableMs: 0,
    notInPositionMs: 0,
    longestInToleranceMs: 0,
    currentInToleranceMs: 0,
    outOfToleranceMs: { elbow: 0, knee: 0, hip: 0, hipDev: 0 },
  };
  private last: { inPosition: boolean; evaluable: boolean; hipDev: number | null } = {
    inPosition: false,
    evaluable: false,
    hipDev: null,
  };

  constructor(options: { calibration?: CalibrationResult | null } = {}) {
    // Noise tolerance grows with the calibrated angle noise (but stays small).
    const noise = options.calibration?.noise ?? 1.5;
    this.tol = Math.max(this.p.toleranceDeg, 2 * noise);
  }

  resync(): void {
    this.lastT = null;
    this.lastGood = false;
    this.stats.currentInToleranceMs = 0;
    this.state = 'NOT_READY';
  }

  private outOf(c: PlankCriterion, v: number, failing: boolean): boolean {
    // Hysteresis: once failing, the value must come back by `hysteresisDeg` to pass.
    const h = failing ? this.p.hysteresisDeg : 0;
    switch (c) {
      case 'elbow':
        return v < this.p.elbowMin - this.tol + h || v > this.p.elbowMax + this.tol - h;
      case 'knee':
        return v < this.p.kneeMin - this.tol + h;
      case 'hip':
        return v < this.p.hipMin - this.tol + h;
      case 'hipDev': {
        const lim = this.p.maxHipDeviation + this.p.toleranceDeviation - (failing ? this.p.toleranceDeviation : 0);
        return Math.abs(v) > lim;
      }
    }
  }

  update(m: FrameMetrics): PlankSnapshot {
    const t = m.t;
    const dtRaw = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    this.stats.totalMs += dtRaw;

    const hasData = m.primary !== null;
    if (!hasData) {
      if (this.gapStart === null) this.gapStart = t;
      this.stats.unevaluableMs += dtRaw;
      this.stats.currentInToleranceMs = 0;
      this.lastGood = false;
      if (t - this.gapStart >= this.p.lostAfterMs) this.state = 'TRACKING_LOST';
      this.last = { inPosition: false, evaluable: false, hipDev: null };
      return this.snapshot();
    }
    this.gapStart = null;

    const inPosition = m.posture === true;
    const vals: Record<PlankCriterion, number | null> = {
      elbow: m.values.elbow ?? null,
      knee: m.values.knee ?? null,
      hip: m.values.hip ?? null,
      hipDev: m.values.hipDev ?? null,
    };
    const evaluable = inPosition && Object.values(vals).every((v) => v !== null);
    // Credit only continuous data: both this and the previous frame valid, small dt.
    const credit = this.lastGood && dtRaw <= this.p.maxCreditGapMs ? dtRaw : 0;
    if (credit === 0 && dtRaw > 0) this.stats.unevaluableMs += dtRaw;
    this.lastGood = true;

    this.state = inPosition ? 'ACTIVE' : 'NOT_READY';
    if (inPosition) this.stats.positionMs += credit;
    if (evaluable) {
      this.stats.evaluableMs += credit;
      for (const c of Object.keys(vals) as PlankCriterion[]) {
        const out = this.outOf(c, vals[c] as number, this.failing.has(c));
        if (out) {
          this.failing.add(c);
          this.stats.outOfToleranceMs[c] += credit;
        } else this.failing.delete(c);
      }
      if (this.failing.size === 0) {
        this.stats.inToleranceMs += credit;
        this.stats.currentInToleranceMs += credit;
        this.stats.longestInToleranceMs = Math.max(this.stats.longestInToleranceMs, this.stats.currentInToleranceMs);
      } else {
        this.stats.currentInToleranceMs = 0;
      }
    } else {
      if (inPosition) this.stats.unevaluableMs += credit;
      else this.stats.notInPositionMs += credit;
      this.failing.clear();
      this.stats.currentInToleranceMs = 0;
    }
    this.last = { inPosition, evaluable, hipDev: vals.hipDev };
    return this.snapshot();
  }

  snapshot(): PlankSnapshot {
    return {
      state: this.state,
      inPosition: this.last.inPosition,
      evaluable: this.last.evaluable,
      inTolerance: this.last.evaluable && this.failing.size === 0,
      failing: [...this.failing],
      hipDev: this.last.hipDev,
      stats: { ...this.stats, outOfToleranceMs: { ...this.stats.outOfToleranceMs } },
    };
  }
}
