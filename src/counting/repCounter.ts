import { THRESHOLDS, TRACKING, type ExerciseThresholds, type RepExerciseId, type TrackingConfig } from './config';
import type { Features } from './features';
import { OneEuroFilter } from './filters';

/**
 * Phases of one repetition. For all exercises the cycle is:
 *   start (extended) -> down (moving) -> target (flexed) -> up (returning) -> start  => +1 rep
 * 'unknown' = start position not (yet / any more) established; nothing is counted from there.
 */
export type Phase = 'unknown' | 'start' | 'down' | 'target' | 'up';

export type Tracking = 'ok' | 'uncertain' | 'lost';

export type RepEventType = 'rep' | 'partial' | 'too_fast' | 'reset_lost' | 'reset_posture';

export interface RepEvent {
  type: RepEventType;
  t: number;
  /** Rep number after this event (for 'rep'). */
  reps: number;
  /** Most flexed (smallest) smoothed angle during the attempt. */
  minAngle?: number;
  /** Largest normalized displacement during the attempt. */
  maxDisp?: number;
  durationMs?: number;
}

export type EffectiveThresholds = ExerciseThresholds;

export interface CounterSnapshot {
  reps: number;
  partials: number;
  phase: Phase;
  tracking: Tracking;
  postureOk: boolean;
  /** Smoothed primary angle (deg), NaN if no valid data. */
  angle: number;
  rawAngle: number;
  /** Normalized displacement relative to the start-position reference. */
  disp: number;
  confidence: number;
  side: Features['side'];
  missing: Features['missing'];
  /** Angle thresholds (null for counters that do not use them, e.g. jump rope). */
  thresholds: EffectiveThresholds | null;
  lastEvent: RepEvent | null;
}

export interface Calibration {
  /** Median primary angle measured in the start position. */
  startAngle: number;
}

/** Compute thresholds adapted to the calibrated start angle (body proportions / 2D projection). */
export function adaptThresholds(base: ExerciseThresholds, calibration?: Calibration | null): EffectiveThresholds {
  if (!calibration || !Number.isFinite(calibration.startAngle)) return { ...base };
  const hysteresis = base.startEnterDeg - base.startExitDeg;
  const startEnterDeg = Math.min(
    base.startEnterDeg,
    Math.max(base.minStartEnterDeg, calibration.startAngle - base.calibStartMarginDeg),
  );
  return { ...base, startEnterDeg, startExitDeg: startEnterDeg - hysteresis };
}

export class RepCounter {
  private readonly th: EffectiveThresholds;
  private readonly tracking: TrackingConfig;
  private readonly angleFilter: OneEuroFilter;
  private readonly auxFilter: OneEuroFilter;
  private readonly scaleFilter: OneEuroFilter;

  private reps = 0;
  private partials = 0;
  private phase: Phase = 'unknown';
  private trackingState: Tracking = 'lost';
  private invalidSince: number | null = null;
  private postureBadFrames = 0;

  private pendingPhase: Phase | null = null;
  private pendingCount = 0;

  private refAux: number | null = null;
  private refScale: number | null = null;
  private leftStartAt = 0;
  private attemptMinAngle = Number.POSITIVE_INFINITY;
  private attemptMaxDisp = Number.NEGATIVE_INFINITY;

  private lastAngle = Number.NaN;
  private lastRawAngle = Number.NaN;
  private lastDisp = Number.NaN;
  private lastFeatures: Features | null = null;
  private lastEvent: RepEvent | null = null;
  private readonly listeners: ((e: RepEvent) => void)[] = [];

  constructor(
    readonly exercise: RepExerciseId,
    options: {
      calibration?: Calibration | null;
      thresholds?: Partial<ExerciseThresholds>;
      tracking?: Partial<TrackingConfig>;
    } = {},
  ) {
    this.th = adaptThresholds({ ...THRESHOLDS[exercise], ...options.thresholds }, options.calibration);
    this.tracking = { ...TRACKING, ...options.tracking };
    this.angleFilter = new OneEuroFilter(this.tracking.angleFilter);
    this.auxFilter = new OneEuroFilter(this.tracking.positionFilter);
    this.scaleFilter = new OneEuroFilter(this.tracking.positionFilter);
  }

  onEvent(listener: (e: RepEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  get thresholds(): EffectiveThresholds {
    return this.th;
  }

  /**
   * Forget the current phase (e.g. after pause). The next repetition only counts
   * after the start position has been re-established — resuming can never add a rep.
   */
  resetPhase(): void {
    this.phase = 'unknown';
    this.pendingPhase = null;
    this.pendingCount = 0;
    this.refAux = null;
    this.refScale = null;
    this.angleFilter.reset();
    this.auxFilter.reset();
    this.scaleFilter.reset();
  }

  update(f: Features, t: number): CounterSnapshot {
    this.lastFeatures = f;
    if (!f.valid) {
      this.handleInvalid(t);
      return this.snapshot();
    }

    if (this.trackingState === 'lost') {
      // Re-acquired after a loss: filters start fresh, phase is already 'unknown'.
      this.angleFilter.reset();
      this.auxFilter.reset();
      this.scaleFilter.reset();
    }
    this.trackingState = 'ok';
    this.invalidSince = null;

    const angle = this.angleFilter.filter(f.primary, t);
    const aux = this.auxFilter.filter(f.auxRaw, t);
    const scale = this.scaleFilter.filter(f.scale, t);
    this.lastAngle = angle;
    this.lastRawAngle = f.primary;

    // Posture gate: e.g. standing up during push-ups, letting go of the bar.
    if (!f.postureOk) {
      this.postureBadFrames++;
      if (this.postureBadFrames >= this.tracking.postureResetFrames && this.phase !== 'unknown') {
        this.emit({ type: 'reset_posture', t, reps: this.reps });
        this.resetPhaseKeepFilters();
      }
      this.lastDisp = this.computeDisp(aux);
      return this.snapshot();
    }
    this.postureBadFrames = 0;

    const disp = this.computeDisp(aux);
    this.lastDisp = disp;

    const th = this.th;
    const atStart = angle >= (this.phase === 'start' ? th.startExitDeg : th.startEnterDeg);
    const dispOkForTarget =
      Number.isFinite(disp) && disp >= (this.phase === 'target' ? th.auxTargetExit : th.auxTargetEnter);
    const atTarget = angle <= (this.phase === 'target' ? th.targetExitDeg : th.targetEnterDeg) && dispOkForTarget;

    if (this.phase !== 'unknown' && this.phase !== 'start') {
      this.attemptMinAngle = Math.min(this.attemptMinAngle, angle);
      if (Number.isFinite(disp)) this.attemptMaxDisp = Math.max(this.attemptMaxDisp, disp);
    }

    const candidate = this.nextPhase(atStart, atTarget);
    if (candidate === this.phase) {
      this.pendingPhase = null;
      this.pendingCount = 0;
    } else {
      if (candidate === this.pendingPhase) this.pendingCount++;
      else {
        this.pendingPhase = candidate;
        this.pendingCount = 1;
      }
      if (this.pendingCount >= th.dwellFrames) this.commit(candidate, t, aux, scale, angle);
    }

    // While solidly in the start position, slowly track the reference (camera/body drift).
    if (this.phase === 'start' && angle >= th.startEnterDeg && this.refAux !== null && this.refScale !== null) {
      const a = this.tracking.referenceEma;
      this.refAux = this.refAux + a * (aux - this.refAux);
      this.refScale = this.refScale + a * (scale - this.refScale);
    }

    return this.snapshot();
  }

  private computeDisp(aux: number): number {
    if (this.refAux === null || this.refScale === null || this.refScale <= 0) return Number.NaN;
    const dir = this.lastFeatures?.auxDirection ?? 1;
    return (dir * (aux - this.refAux)) / this.refScale;
  }

  private nextPhase(atStart: boolean, atTarget: boolean): Phase {
    switch (this.phase) {
      case 'unknown':
        return atStart ? 'start' : 'unknown';
      case 'start':
        if (atStart) return 'start';
        return atTarget ? 'target' : 'down';
      case 'down':
        if (atTarget) return 'target';
        if (atStart) return 'start';
        return 'down';
      case 'target':
        if (atTarget) return 'target';
        return atStart ? 'start' : 'up';
      case 'up':
        if (atStart) return 'start';
        if (atTarget) return 'target';
        return 'up';
    }
  }

  private commit(next: Phase, t: number, aux: number, scale: number, angle: number): void {
    const prev = this.phase;
    this.phase = next;
    this.pendingPhase = null;
    this.pendingCount = 0;

    if (next === 'start') {
      if (prev === 'target' || prev === 'up') {
        const durationMs = t - this.leftStartAt;
        if (durationMs >= this.th.minRepMs) {
          this.reps++;
          this.emit({
            type: 'rep',
            t,
            reps: this.reps,
            minAngle: this.attemptMinAngle,
            maxDisp: this.attemptMaxDisp,
            durationMs,
          });
        } else {
          this.emit({ type: 'too_fast', t, reps: this.reps, durationMs });
        }
      } else if (prev === 'down') {
        this.partials++;
        this.emit({
          type: 'partial',
          t,
          reps: this.reps,
          minAngle: this.attemptMinAngle,
          maxDisp: this.attemptMaxDisp,
          durationMs: t - this.leftStartAt,
        });
      }
      // New reference for this repetition: the start position as it is now.
      this.refAux = aux;
      this.refScale = scale;
    } else if (prev === 'start') {
      this.leftStartAt = t;
      this.attemptMinAngle = angle;
      this.attemptMaxDisp = Number.NEGATIVE_INFINITY;
    }
  }

  private handleInvalid(t: number): void {
    if (this.invalidSince === null) this.invalidSince = t;
    if (this.trackingState === 'lost') return;
    if (t - this.invalidSince >= this.tracking.lostAfterMs) {
      this.trackingState = 'lost';
      if (this.phase !== 'unknown') this.emit({ type: 'reset_lost', t, reps: this.reps });
      this.resetPhase();
    } else {
      // Short dropout: freeze, keep the phase (a few bad frames must not break a rep).
      this.trackingState = 'uncertain';
    }
  }

  private resetPhaseKeepFilters(): void {
    this.phase = 'unknown';
    this.pendingPhase = null;
    this.pendingCount = 0;
    this.refAux = null;
    this.refScale = null;
  }

  private emit(e: RepEvent): void {
    this.lastEvent = e;
    for (const l of this.listeners) l(e);
  }

  snapshot(): CounterSnapshot {
    const f = this.lastFeatures;
    return {
      reps: this.reps,
      partials: this.partials,
      phase: this.phase,
      tracking: this.trackingState,
      postureOk: f?.postureOk ?? false,
      angle: f?.valid ? this.lastAngle : Number.NaN,
      rawAngle: f?.valid ? this.lastRawAngle : Number.NaN,
      disp: f?.valid ? this.lastDisp : Number.NaN,
      confidence: f?.confidence ?? 0,
      side: f?.side ?? null,
      missing: f?.missing ?? [],
      thresholds: this.th,
      lastEvent: this.lastEvent,
    };
  }
}
