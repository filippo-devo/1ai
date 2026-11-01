import { PLANK, TRACKING, type PlankConfig, type TrackingConfig } from './config';
import type { Features } from './features';
import { OneEuroFilter } from './filters';
import type { Calibration, Tracking } from './repCounter';

export interface PlankSnapshot {
  /** Total time spent in a correct plank, ms. */
  heldMs: number;
  /** Current uninterrupted hold, ms (0 when out of position). */
  currentMs: number;
  /** Longest uninterrupted hold, ms. */
  bestMs: number;
  inPosition: boolean;
  tracking: Tracking;
  postureOk: boolean;
  /** Smoothed body line angle (shoulder–hip–ankle), deg. */
  angle: number;
  confidence: number;
  missing: Features['missing'];
  enterDeg: number;
  exitDeg: number;
}

/** Hold threshold adapted to the calibrated body angle (like adaptThresholds for reps). */
export function adaptPlank(base: PlankConfig, calibration?: Calibration | null): PlankConfig {
  if (!calibration || !Number.isFinite(calibration.startAngle)) return { ...base };
  const hysteresis = base.bodyEnterDeg - base.bodyExitDeg;
  const bodyEnterDeg = Math.min(
    base.bodyEnterDeg,
    Math.max(base.minBodyEnterDeg, calibration.startAngle - base.calibMarginDeg),
  );
  return { ...base, bodyEnterDeg, bodyExitDeg: bodyEnterDeg - hysteresis };
}

/**
 * Plank timer: time accumulates only while the body is in a correct plank,
 * confirmed for `enterMs` (and left after `exitMs` out of position), with
 * hysteresis on the body angle. Missing keypoints for longer than
 * TRACKING.lostAfterMs stop the clock ("Ustaw się w kadrze"); time is never
 * added for frames in which the person was not visible.
 */
export class PlankTimer {
  private readonly cfg: PlankConfig;
  private readonly tracking: TrackingConfig;
  private readonly filter: OneEuroFilter;

  private heldMs = 0;
  private bestMs = 0;
  private currentMs = 0;
  private inPosition = false;
  private pendingSince: number | null = null;
  private lastValidT: number | null = null;
  private invalidSince: number | null = null;
  private trackingState: Tracking = 'lost';
  private angle = Number.NaN;
  private last: Features | null = null;

  constructor(options: { calibration?: Calibration | null; config?: Partial<PlankConfig>; tracking?: Partial<TrackingConfig> } = {}) {
    this.cfg = adaptPlank({ ...PLANK, ...options.config }, options.calibration);
    this.tracking = { ...TRACKING, ...options.tracking };
    this.filter = new OneEuroFilter(this.tracking.angleFilter);
  }

  get config(): PlankConfig {
    return this.cfg;
  }

  /** After a pause: out of position until the plank is confirmed again. */
  resetPhase(): void {
    this.leavePosition();
    this.pendingSince = null;
    this.lastValidT = null;
    this.filter.reset();
  }

  update(f: Features, t: number): PlankSnapshot {
    this.last = f;
    if (!f.valid) {
      if (this.invalidSince === null) this.invalidSince = t;
      if (t - this.invalidSince >= this.tracking.lostAfterMs) {
        this.trackingState = 'lost';
        this.resetPhase();
      } else if (this.trackingState !== 'lost') {
        this.trackingState = 'uncertain';
      }
      return this.snapshot();
    }
    if (this.trackingState === 'lost') this.filter.reset();
    this.trackingState = 'ok';
    this.invalidSince = null;

    const angle = this.filter.filter(f.primary, t);
    this.angle = angle;
    const good = f.postureOk && angle >= (this.inPosition ? this.cfg.bodyExitDeg : this.cfg.bodyEnterDeg);

    // Accumulate time since the previous valid frame (gaps capped: no time for invisible periods).
    if (this.inPosition && good && this.lastValidT !== null) {
      const dt = Math.min(t - this.lastValidT, this.tracking.lostAfterMs);
      if (dt > 0) {
        this.heldMs += dt;
        this.currentMs += dt;
        this.bestMs = Math.max(this.bestMs, this.currentMs);
      }
    }
    this.lastValidT = t;

    if (good === this.inPosition) {
      this.pendingSince = null;
    } else {
      if (this.pendingSince === null) this.pendingSince = t;
      const need = good ? this.cfg.enterMs : this.cfg.exitMs;
      if (t - this.pendingSince >= need) {
        if (good) this.inPosition = true;
        else this.leavePosition();
        this.pendingSince = null;
      }
    }
    return this.snapshot();
  }

  private leavePosition(): void {
    this.inPosition = false;
    this.currentMs = 0;
  }

  snapshot(): PlankSnapshot {
    const f = this.last;
    return {
      heldMs: this.heldMs,
      currentMs: this.currentMs,
      bestMs: this.bestMs,
      inPosition: this.inPosition,
      tracking: this.trackingState,
      postureOk: f?.postureOk ?? false,
      angle: f?.valid ? this.angle : Number.NaN,
      confidence: f?.confidence ?? 0,
      missing: f?.missing ?? [],
      enterDeg: this.cfg.bodyEnterDeg,
      exitDeg: this.cfg.bodyExitDeg,
    };
  }
}
