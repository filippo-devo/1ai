import type { CalibrationResult } from '../calibration';
import { CYCLIC, FILTER, TECHNIQUE, type CyclicConfig, type ExerciseId, type VariantId } from '../config';
import { OneEuroFilter } from '../filters';
import { std } from '../geometry';
import type { FrameMetrics, MeasuredSide } from '../metrics';
import type { CycleCounts, CyclePhase, CycleRecord, DetectorEvent, TechState } from '../types';

export interface CyclicThresholds {
  restEnter: number;
  restExit: number;
  target: number;
  minAmplitude: number;
  /** Rest reference for 'relative' configs (crunch), else NaN. */
  base: number;
}

export interface CyclicSnapshot {
  state: TechState;
  phase: CyclePhase | null;
  /** Filtered driving value (deg) or NaN. */
  value: number;
  counts: CycleCounts;
  thresholds: CyclicThresholds;
  lastCycle: CycleRecord | null;
  /** Current data gap (ms), 0 when data is flowing. */
  gapMs: number;
}

/**
 * Exercise-specific rules plugged into the generic cycle state machine.
 * They see aggregated values of the current cycle; none of them changes the counting
 * of the movement itself except `ignoreCycle` (e.g. racking the bar is not a rep).
 */
interface Rules {
  /** Extra condition for being back at rest (e.g. squat: hips back to standing). */
  restExtra?(m: FrameMetrics, inRest: boolean): boolean;
  /** Reference values captured at rest, compared with the cycle's extremes. */
  refs?: string[];
  /** Decide target reached + reasons/flags/checks at the end of a cycle. */
  finish?(c: CycleAgg, out: { reasons: string[]; flags: string[]; checks: Record<string, number | null> }): boolean;
  /** Return a reason to ignore the movement entirely (not a cycle), or null. */
  ignoreCycle?(c: CycleAgg): 'rack_motion' | null;
}

/** Aggregates of the running cycle. */
interface CycleAgg {
  refs: Record<string, number | null>;
  min: Record<string, number>;
  max: Record<string, number>;
  /** Count of frames with a value / with value === 1 (for 0/1 flags). */
  frames: number;
  ones: Record<string, number>;
  views: { side: number; front: number };
  targetValue: boolean;
}

function rulesFor(exercise: ExerciseId, variant: VariantId): Rules {
  switch (exercise) {
    case 'squat':
      return {
        restExtra(m, inRest) {
          const hip = m.values.hip;
          if (hip === null || hip === undefined) return false;
          return hip >= (inRest ? TECHNIQUE.squat.hipTopExit : TECHNIQUE.squat.hipTopEnter);
        },
        finish(c, out) {
          out.checks.minKnee = c.min.knee ?? null;
          out.checks.minHip = c.min.hip ?? null;
          out.checks.minTrunkElevation = c.min.trunk ?? null; // informational, not penalized
          return c.targetValue;
        },
      };
    case 'pushup':
      return {
        refs: ['shoulderHeight'],
        finish(c, out) {
          const ref = c.refs.shoulderHeight;
          const drop = ref !== null && Number.isFinite(c.min.shoulderHeight) ? ref - c.min.shoulderHeight : null;
          out.checks.shoulderDrop = drop;
          out.checks.maxBodyLineDeviation = Number.isFinite(c.max.bodyLineDev) ? c.max.bodyLineDev : null;
          if (out.checks.maxBodyLineDeviation !== null && out.checks.maxBodyLineDeviation > TECHNIQUE.pushup.maxBodyLineDeviation) {
            out.flags.push('body_line');
          }
          const kneelingShare = c.frames > 0 ? (c.ones.kneeOnFloor ?? 0) / c.frames : 0;
          let ok = c.targetValue;
          // Front view: the driving value itself is the shoulder descent, no second check.
          if (variant !== 'front' && (drop === null || drop < TECHNIQUE.pushup.shoulderDropForTarget)) {
            out.reasons.push('shoulders_not_descending');
            ok = false;
          }
          if (variant === 'standard' && kneelingShare > 0.5) {
            out.reasons.push('variant_knees_detected');
            ok = false;
          }
          if (variant === 'knees' && c.frames > 0 && kneelingShare < 0.2 && (c.ones.kneeOnFloorKnown ?? 0) > 0) {
            out.flags.push('variant_standard_detected');
          }
          return ok;
        },
      };
    case 'bench':
      return {
        refs: ['wristUp'],
        finish(c, out) {
          const ref = c.refs.wristUp;
          const drop = ref !== null && Number.isFinite(c.min.wristUp) ? ref - c.min.wristUp : null;
          out.checks.wristDrop = drop;
          out.flags.push('bar_contact_not_measured');
          let ok = c.targetValue;
          if (drop === null || drop < TECHNIQUE.bench.wristDropForTarget) {
            out.reasons.push('bar_not_descending');
            ok = false;
          }
          return ok;
        },
        ignoreCycle(c) {
          // Unracking / racking moves the bar mostly horizontally: not a repetition.
          const ref = c.refs.wristUp;
          const vertical = ref !== null && Number.isFinite(c.min.wristUp) ? ref - c.min.wristUp : 0;
          const horizontal = Number.isFinite(c.max.wristX) && Number.isFinite(c.min.wristX) ? c.max.wristX - c.min.wristX : 0;
          return horizontal > 0 && vertical < TECHNIQUE.bench.minVerticalToHorizontal * horizontal ? 'rack_motion' : null;
        },
      };
    case 'pullup':
      return {
        refs: ['shoulderDrop'],
        finish(c, out) {
          const ref = c.refs.shoulderDrop;
          const rise = ref !== null && Number.isFinite(c.min.shoulderDrop) ? ref - c.min.shoulderDrop : null;
          out.checks.shoulderRise = rise;
          // The angle alone does not prove the chin cleared the bar: no bar/chin detection.
          out.flags.push('chin_over_bar_unverified');
          if (c.views.side > c.views.front && Number.isFinite(c.max.hipX) && Number.isFinite(c.min.hipX)) {
            const swing = c.max.hipX - c.min.hipX;
            out.checks.swing = swing;
            if (swing > TECHNIQUE.pullup.maxSwing) out.flags.push('swing');
          } else {
            out.checks.swing = null;
            out.flags.push('swing_not_assessable');
          }
          let ok = c.targetValue;
          if (rise === null || rise < TECHNIQUE.pullup.shoulderRiseForTarget) {
            out.reasons.push('shoulders_not_rising');
            ok = false;
          }
          return ok;
        },
      };
    default:
      return {
        finish(c) {
          return c.targetValue;
        },
      };
  }
}

/**
 * Generic repetition detector:
 *   NOT_READY ──(rest position held, posture OK)──▶ READY ──(leaves rest)──▶ ACTIVE
 *   ACTIVE: away (e.g. descent) → extreme (beyond target) → back → rest ⇒ cycle recorded
 * - hysteresis on rest (restEnter/restExit);
 * - the far end is confirmed by a change of direction of `reversal` degrees — no pause needed;
 * - movements smaller than max(minAmplitude, noiseFactor·noise) are ignored;
 * - reaching the target is recorded separately from detecting the cycle;
 * - a data gap longer than maxGapMs inside a cycle makes it non-evaluable and forces a
 *   re-synchronisation in the start position (old points are never used to count).
 */
export class CyclicDetector {
  readonly cfg: CyclicConfig;
  private readonly rules: Rules;
  private readonly filter = new OneEuroFilter(FILTER.angle);
  private th: CyclicThresholds;

  private state: TechState = 'NOT_READY';
  private phase: CyclePhase | null = null;
  private value = Number.NaN;
  private lastValidT: number | null = null;
  private gapStart: number | null = null;
  private restSince: number | null = null;
  private restSamples: number[] = [];
  private postureBadSince: number | null = null;
  private refs: Record<string, number | null> = {};
  /** Most extended value seen in the current rest period (the rest reference of the next cycle). */
  private restPeak = Number.NaN;

  // running cycle
  private cyc: {
    startT: number;
    restValue: number;
    extreme: number;
    extremeT: number;
    targetT: number | null;
    targetLeftT: number | null;
    min: number;
    max: number;
    gaps: number;
    gapMs: number;
    validMs: number;
    side: MeasuredSide | null;
    oneSided: boolean;
    agg: CycleAgg;
  } | null = null;

  private counts: CycleCounts = { detected: 0, targetReached: 0, targetMissed: 0, unevaluable: 0 };
  private cycles: CycleRecord[] = [];
  private listeners: ((e: DetectorEvent) => void)[] = [];

  constructor(
    readonly exercise: ExerciseId,
    readonly variant: VariantId,
    options: { calibration?: CalibrationResult | null; target?: number | null; config?: Partial<CyclicConfig> } = {},
  ) {
    const base = CYCLIC[`${exercise}/${variant}`];
    if (!base) throw new Error(`No cyclic config for ${exercise}/${variant}`);
    this.cfg = { ...base, ...options.config };
    this.rules = rulesFor(exercise, variant);
    this.th = this.computeThresholds(options.calibration ?? null, options.target ?? null);
  }

  private computeThresholds(cal: CalibrationResult | null, target: number | null): CyclicThresholds {
    const c = this.cfg;
    const noise = cal && Number.isFinite(cal.noise) ? cal.noise : 1.5;
    const minAmplitude = Math.max(c.minAmplitude, c.noiseFactor * noise);
    const tgt = target ?? c.target;
    if (c.mode === 'relative') {
      const base = cal ? cal.rest : Number.NaN; // NaN: taken from the first READY
      return { restEnter: c.restEnter, restExit: c.restExit, target: tgt, minAmplitude, base };
    }
    let restEnter = c.restEnter;
    if (cal && c.direction === 'decrease') {
      restEnter = Math.min(c.restEnter, Math.max(c.minRestEnter, cal.rest - c.calibMargin));
    }
    const hyst = c.restExit - c.restEnter;
    return { restEnter, restExit: restEnter + hyst, target: tgt, minAmplitude, base: Number.NaN };
  }

  onEvent(l: (e: DetectorEvent) => void): void {
    this.listeners.push(l);
  }

  get thresholds(): CyclicThresholds {
    return this.th;
  }

  get records(): CycleRecord[] {
    return this.cycles;
  }

  /** Is the side lock needed (a cycle is running)? */
  get inCycle(): boolean {
    return this.state === 'ACTIVE';
  }

  /** After a pause or camera switch: forget the current cycle, re-synchronise at rest. */
  resync(): void {
    this.toNotReady();
  }

  private emit(e: DetectorEvent): void {
    for (const l of this.listeners) l(e);
  }

  private abs(v: number): number {
    return this.cfg.mode === 'relative' ? v - this.th.base : v;
  }

  /** Signed excursion from rest toward the target (positive = toward the target). */
  private toward(v: number, rest: number): number {
    return this.cfg.direction === 'decrease' ? rest - v : v - rest;
  }

  private atRest(v: number, m: FrameMetrics, inRest: boolean): boolean {
    const a = this.abs(v);
    const angleOk =
      this.cfg.direction === 'decrease'
        ? a >= (inRest ? this.th.restExit : this.th.restEnter)
        : a <= (inRest ? this.th.restExit : this.th.restEnter);
    if (!angleOk) return false;
    return this.rules.restExtra ? this.rules.restExtra(m, inRest) : true;
  }

  private beyondTarget(v: number): boolean {
    const a = this.abs(v);
    return this.cfg.direction === 'decrease' ? a <= this.th.target : a >= this.th.target;
  }

  private setState(s: TechState, t: number): void {
    if (s !== this.state) {
      this.state = s;
      this.emit({ type: 'state', t, state: s });
    }
  }

  private toNotReady(): void {
    this.restPeak = Number.NaN;
    this.state = 'NOT_READY';
    this.phase = null;
    this.cyc = null;
    this.restSince = null;
    this.restSamples = [];
    this.filter.reset();
  }

  update(m: FrameMetrics): CyclicSnapshot {
    const t = m.t;
    // ---- data availability / gaps ------------------------------------------------------
    // Gap = time since the last frame WITH data (at low fps one missing frame already
    // means ~2 frame intervals without data).
    if (m.primary === null) {
      if (this.gapStart === null) this.gapStart = this.lastValidT ?? t;
      const gap = t - this.gapStart;
      if (this.state === 'ACTIVE' && gap > this.cfg.maxGapMs) this.abandon(t, 'tracking_gap');
      if (gap >= this.cfg.lostAfterMs) {
        this.toNotReady();
        this.setState('TRACKING_LOST', t);
      } else if (this.state === 'READY' && gap > this.cfg.maxGapMs) {
        this.toNotReady();
      }
      return this.snapshot(gap);
    }
    if (this.gapStart !== null) {
      const gap = t - this.gapStart;
      if (this.cyc) {
        this.cyc.gaps++;
        this.cyc.gapMs += gap;
      }
      this.gapStart = null;
      if (gap > this.cfg.maxGapMs) {
        this.filter.reset();
        // The cycle may have passed an important phase while nothing was visible.
        if (this.state === 'ACTIVE') this.abandon(t, 'tracking_gap');
        else if (this.state === 'READY') this.toNotReady();
      }
    }
    if (this.state === 'TRACKING_LOST') this.setState('NOT_READY', t);

    const v = this.filter.filter(m.primary, t);
    this.value = v;
    const dt = this.lastValidT === null ? 0 : Math.min(t - this.lastValidT, this.cfg.maxGapMs);
    this.lastValidT = t;

    // ---- posture --------------------------------------------------------------------------
    if (m.posture === false) {
      if (this.postureBadSince === null) this.postureBadSince = t;
      if (t - this.postureBadSince >= 600 && this.state !== 'NOT_READY') {
        if (this.state === 'ACTIVE') this.abandon(t, 'posture');
        this.toNotReady();
        this.setState('NOT_READY', t);
      }
      if (this.state === 'NOT_READY') return this.snapshot(0);
    } else {
      this.postureBadSince = null;
    }

    switch (this.state) {
      case 'NOT_READY':
      case 'TRACKING_LOST':
        this.updateNotReady(v, m, t);
        break;
      case 'READY':
        if (!this.atRest(v, m, true)) {
          this.startCycle(v, m, t);
        } else {
          this.captureRefs(m, 0.2);
          if (!Number.isFinite(this.restPeak) || this.toward(v, this.restPeak) < 0) this.restPeak = v;
        }
        break;
      case 'ACTIVE':
        this.updateActive(v, m, t, dt);
        break;
    }
    return this.snapshot(0);
  }

  private updateNotReady(v: number, m: FrameMetrics, t: number): void {
    if (m.posture !== true) {
      this.restSince = null;
      this.restSamples = [];
      return;
    }
    if (this.cfg.mode === 'relative' && !Number.isFinite(this.th.base)) {
      // No calibration: the rest reference is the first stable lying position.
      this.restSamples.push(v);
      if (this.restSamples.length > 60) this.restSamples.shift();
      if (this.restSince === null) this.restSince = t;
      const spread = Math.max(...this.restSamples) - Math.min(...this.restSamples);
      if (spread > 6) {
        this.restSamples = [v];
        this.restSince = t;
      } else if (t - this.restSince >= Math.max(this.cfg.readyHoldMs, 600)) {
        this.th.base = this.restSamples.reduce((a, b) => a + b, 0) / this.restSamples.length;
      }
      return;
    }
    // Hysteresis also while acquiring the start position: once the hold started, brief
    // dips below restEnter (noise biases near-straight angles low) do not restart it.
    if (!this.atRest(v, m, this.restSince !== null)) {
      this.restSince = null;
      this.restSamples = [];
      return;
    }
    if (this.restSince === null) this.restSince = t;
    this.restSamples.push(v);
    if (this.cfg.readyMaxStd !== undefined && this.restSamples.length >= 3) {
      if (std(this.restSamples) > this.cfg.readyMaxStd) {
        // Not stable yet (e.g. walking the bar out of the rack): restart the hold.
        this.restSamples = [v];
        this.restSince = t;
        return;
      }
    }
    if (t - this.restSince >= this.cfg.readyHoldMs) {
      this.captureRefs(m, 1);
      this.restPeak = v;
      this.setState('READY', t);
    }
  }

  private captureRefs(m: FrameMetrics, a: number): void {
    for (const key of this.rules.refs ?? []) {
      const val = m.values[key];
      if (val === null || val === undefined) continue;
      const prev = this.refs[key];
      this.refs[key] = prev === null || prev === undefined || a >= 1 ? val : prev + a * (val - prev);
    }
  }

  private startCycle(v: number, m: FrameMetrics, t: number): void {
    this.setState('ACTIVE', t);
    this.phase = 'away';
    this.cyc = {
      startT: t,
      restValue: Number.isFinite(this.restPeak) ? this.restPeak : v,
      extreme: v,
      extremeT: t,
      targetT: null,
      targetLeftT: null,
      min: v,
      max: v,
      gaps: 0,
      gapMs: 0,
      validMs: 0,
      side: m.side,
      oneSided: m.oneSided,
      agg: { refs: { ...this.refs }, min: {}, max: {}, frames: 0, ones: {}, views: { side: 0, front: 0 }, targetValue: false },
    };
    this.aggregate(m);
  }

  private aggregate(m: FrameMetrics): void {
    const c = this.cyc;
    if (!c) return;
    const agg = c.agg;
    agg.frames++;
    for (const [k, val] of Object.entries(m.values)) {
      if (val === null || val === undefined) continue;
      agg.min[k] = Math.min(agg.min[k] ?? Number.POSITIVE_INFINITY, val);
      agg.max[k] = Math.max(agg.max[k] ?? Number.NEGATIVE_INFINITY, val);
      if (val === 1) agg.ones[k] = (agg.ones[k] ?? 0) + 1;
      if (k === 'kneeOnFloor') agg.ones.kneeOnFloorKnown = (agg.ones.kneeOnFloorKnown ?? 0) + 1;
    }
    if (m.view === 'side') agg.views.side++;
    else if (m.view === 'front') agg.views.front++;
    if (m.oneSided) c.oneSided = true;
  }

  private updateActive(v: number, m: FrameMetrics, t: number, dt: number): void {
    const c = this.cyc;
    if (!c) return;
    c.validMs += dt;
    c.min = Math.min(c.min, v);
    c.max = Math.max(c.max, v);
    this.aggregate(m);

    // toward(v, extreme) > 0: v moved further toward the target than the extreme so far.
    if (this.toward(v, c.extreme) > 0) {
      c.extreme = v;
      c.extremeT = t;
      if (this.phase === 'back') this.phase = 'away'; // bounce at the bottom: same cycle
    }
    if (this.beyondTarget(v)) {
      c.agg.targetValue = true;
      if (c.targetT === null) c.targetT = t;
      if (this.phase === 'away') this.phase = 'extreme';
    } else if (this.phase === 'extreme' && c.targetLeftT === null) {
      c.targetLeftT = t;
    }
    // Extreme confirmed by a change of direction (no pause at the bottom required).
    if ((this.phase === 'away' || this.phase === 'extreme') && this.toward(c.extreme, v) >= this.cfg.reversal) {
      this.phase = 'back';
    }

    if (this.atRest(v, m, false)) {
      this.complete(t);
      return;
    }
    if (t - c.startT > this.cfg.maxCycleMs) this.abandon(t, 'too_long');
  }

  private complete(t: number): void {
    const c = this.cyc;
    if (!c) return;
    const amplitude = Math.abs(this.toward(c.extreme, c.restValue));
    const duration = t - c.startT;
    const ignore = (reason: 'small_amplitude' | 'too_fast' | 'rack_motion') => {
      this.emit({ type: 'ignored', t, reason });
      this.cyc = null;
      this.phase = null;
      this.restPeak = this.value;
      this.setState('READY', t);
    };
    if (amplitude < this.th.minAmplitude) return ignore('small_amplitude');
    if (duration < this.cfg.minCycleMs) return ignore('too_fast');
    const rack = this.rules.ignoreCycle?.(c.agg) ?? null;
    if (rack) return ignore(rack);

    const out = { reasons: [] as string[], flags: [] as string[], checks: {} as Record<string, number | null> };
    const reached = this.rules.finish ? this.rules.finish(c.agg, out) : c.agg.targetValue;
    if (!c.agg.targetValue && !out.reasons.includes('range_target_not_reached')) out.reasons.unshift('range_target_not_reached');
    if (c.oneSided) out.flags.push('one_sided');
    const bottomEnd = c.targetLeftT ?? c.extremeT;
    const record: CycleRecord = {
      index: this.cycles.length + 1,
      startT: c.startT,
      endT: t,
      outcome: reached ? 'target_reached' : 'target_missed',
      reasons: out.reasons,
      restValue: this.abs(c.restValue),
      extremeValue: this.abs(c.extreme),
      minValue: this.abs(c.min),
      maxValue: this.abs(c.max),
      amplitude,
      phaseMs: {
        // start → far end (e.g. descent), time inside the target zone, far end → rest (e.g. ascent)
        away: c.extremeT - c.startT,
        extreme: c.targetT !== null ? Math.max(0, bottomEnd - c.targetT) : 0,
        back: t - c.extremeT,
      },
      side: c.side,
      oneSided: c.oneSided,
      coverage: duration > 0 ? Math.min(1, c.validMs / duration) : 1,
      gaps: c.gaps,
      gapMs: c.gapMs,
      checks: out.checks,
      flags: out.flags,
    };
    this.record(record);
    this.cyc = null;
    this.phase = null;
    this.restPeak = this.value;
    this.setState('READY', t);
  }

  /** Close the running cycle as NON-EVALUABLE and require re-synchronisation at rest. */
  private abandon(t: number, reason: 'tracking_gap' | 'posture' | 'too_long'): void {
    const c = this.cyc;
    if (c && Math.abs(this.toward(c.extreme, c.restValue)) >= this.th.minAmplitude / 2) {
      this.record({
        index: this.cycles.length + 1,
        startT: c.startT,
        endT: t,
        outcome: 'unevaluable',
        reasons: [reason],
        restValue: this.abs(c.restValue),
        extremeValue: this.abs(c.extreme),
        minValue: this.abs(c.min),
        maxValue: this.abs(c.max),
        amplitude: Math.abs(this.toward(c.extreme, c.restValue)),
        phaseMs: { away: c.extremeT - c.startT, extreme: 0, back: 0 },
        side: c.side,
        oneSided: c.oneSided,
        coverage: t > c.startT ? Math.min(1, c.validMs / (t - c.startT)) : 0,
        gaps: c.gaps + (reason === 'tracking_gap' ? 1 : 0),
        gapMs: c.gapMs,
        checks: {},
        flags: [],
      });
    }
    this.toNotReady();
    this.setState('NOT_READY', t);
  }

  private record(r: CycleRecord): void {
    this.cycles.push(r);
    this.counts = { ...this.counts, detected: this.counts.detected + 1 };
    if (r.outcome === 'target_reached') this.counts.targetReached++;
    else if (r.outcome === 'target_missed') this.counts.targetMissed++;
    else this.counts.unevaluable++;
    this.emit({ type: 'cycle', cycle: r });
  }

  snapshot(gapMs = 0): CyclicSnapshot {
    return {
      state: this.state,
      phase: this.phase,
      value: this.value,
      counts: { ...this.counts },
      thresholds: { ...this.th },
      lastCycle: this.cycles[this.cycles.length - 1] ?? null,
      gapMs,
    };
  }
}
