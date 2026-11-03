import { JUMP, type JumpConfig } from '../config';
import { TimeEma } from '../filters';
import { angle, dist, median, percentile, std } from '../geometry';
import type { FrameView, LR } from '../landmarks';
import type { FrameMetrics } from '../metrics';
import type { TechState } from '../types';

export interface JumpRecord {
  index: number;
  t: number;
  airMs: number;
  /** Peak heights (÷ leg length). */
  peakFeet: number;
  peakHip: number;
  /** 'toes': toes seen leaving the ground; 'ankles_only': toes not visible (cannot rule out a toe raise). */
  evidence: 'toes' | 'ankles_only';
  feet: 'both' | 'one';
  /** Auxiliary only (no correctness rule). */
  minKnee: number | null;
}

export interface JumpStats {
  jumps: number;
  toeRaises: number;
  pauses: number;
  pauseMs: number;
  /** Time spent jumping (intervals between jumps, pauses excluded). */
  activeMs: number;
  perMinute: number | null;
  intervalMeanMs: number | null;
  intervalStdMs: number | null;
  /** Coefficient of variation of intervals (std / mean); lower = more regular. */
  irregularity: number | null;
  withToes: number;
  anklesOnly: number;
  oneFoot: number;
}

export type JumpEvaluation = 'full' | 'limited_no_toes' | 'limited_one_foot' | 'unavailable';

export interface JumpSnapshot {
  state: TechState;
  airborne: boolean;
  evaluation: JumpEvaluation;
  lastJump: JumpRecord | null;
  feetHeight: number | null;
  hipHeight: number | null;
  stats: JumpStats;
}

class Ground {
  private hist: { t: number; y: number }[] = [];
  private readonly ema: TimeEma;
  constructor(private readonly cfg: JumpConfig) {
    this.ema = new TimeEma(cfg.smoothingMs);
  }
  reset(): void {
    this.hist = [];
    this.ema.reset();
  }
  /** Height above ground ÷ leg (null until ~0.3 s of history). */
  push(y: number, t: number, leg: number): number | null {
    const v = this.ema.filter(y, t);
    this.hist.push({ t, y: v });
    while (this.hist.length && this.hist[0].t < t - this.cfg.groundWindowMs) this.hist.shift();
    if (this.hist.length < 3 || t - this.hist[0].t < 300) return null;
    const ground = percentile(
      this.hist.map((h) => h.y),
      this.cfg.groundPercentile,
    );
    return (ground - v) / leg; // image y grows downward: above ground => positive
  }
}

/**
 * Basic two-foot rope jumps. One jump = take-off (both feet and hips rise above the
 * ground level) → flight → landing. Rope turns, double unders and the rope itself are
 * NOT detected (no rope tracking) — results are "podskoki".
 */
export class JumpDetector {
  private readonly cfg: JumpConfig;
  private grounds: Record<string, Ground> = {};
  private state: TechState = 'NOT_READY';
  private gapStart: number | null = null;
  private airborne = false;
  private airSince = 0;
  /** First frame with the feet above the landing threshold (take-off moment). */
  private liftT: number | null = null;
  private peakFeet = 0;
  private peakHip = 0;
  private toeSeenInFlight = false;
  private oneFootInFlight = false;
  private minKnee: number | null = null;
  private toeRaising = false;
  private lastJumpT: number | null = null;
  private intervals: number[] = [];
  private records: JumpRecord[] = [];
  private toeRaises = 0;
  private pauses = 0;
  private pauseMs = 0;
  private lastFeet: number | null = null;
  private lastHip: number | null = null;
  private evaluation: JumpEvaluation = 'unavailable';
  private listeners: ((r: JumpRecord) => void)[] = [];

  constructor(options: { config?: Partial<JumpConfig> } = {}) {
    this.cfg = { ...JUMP, ...options.config };
  }

  onJump(l: (r: JumpRecord) => void): void {
    this.listeners.push(l);
  }

  get jumps(): JumpRecord[] {
    return this.records;
  }

  private ground(key: string): Ground {
    if (!this.grounds[key]) this.grounds[key] = new Ground(this.cfg);
    return this.grounds[key];
  }

  resync(): void {
    for (const g of Object.values(this.grounds)) g.reset();
    this.airborne = false;
    this.toeRaising = false;
    this.state = 'NOT_READY';
  }

  private refractoryMs(): number {
    const recent = this.intervals.slice(-6);
    const base = recent.length >= 2 ? median(recent) * this.cfg.refractoryFactor : this.cfg.refractoryMinMs;
    return Math.max(this.cfg.refractoryMinMs, Math.min(this.cfg.refractoryMaxMs, base));
  }

  update(view: FrameView, m: FrameMetrics): JumpSnapshot {
    const t = view.t;
    if (m.primary === null || m.posture === false) {
      if (this.gapStart === null) this.gapStart = t;
      if (t - this.gapStart >= this.cfg.lostAfterMs) {
        this.resync();
        this.state = m.primary === null ? 'TRACKING_LOST' : 'NOT_READY';
      }
      this.lastFeet = null;
      this.lastHip = null;
      return this.snapshot();
    }
    this.gapStart = null;

    const sides: LR[] = ['left', 'right'];
    const legs: number[] = [];
    const hipYs: number[] = [];
    for (const s of sides) {
      const h = view.get('hip', s);
      const k = view.get('knee', s);
      const a = view.get('ankle', s);
      if (h && k && a) {
        legs.push((dist(h, k) ?? 0) + (dist(k, a) ?? 0));
        hipYs.push(h.y);
      }
    }
    const leg = legs.length ? legs.reduce((x, y) => x + y, 0) / legs.length : 0;
    if (leg <= 0) return this.snapshot();
    const hip = this.ground('hip').push(hipYs.reduce((x, y) => x + y, 0) / hipYs.length, t, leg);

    const feet: number[] = [];
    const toes: number[] = [];
    for (const s of sides) {
      const a = view.get('ankle', s);
      if (a) {
        const h = this.ground(`ankle_${s}`).push(a.y, t, leg);
        if (h !== null) feet.push(h);
      } else this.ground(`ankle_${s}`).reset();
      const toe = view.get('toe', s);
      if (toe) {
        const h = this.ground(`toe_${s}`).push(toe.y, t, leg);
        if (h !== null) toes.push(h);
      } else this.ground(`toe_${s}`).reset();
    }
    const knees = sides
      .map((s) => angle(view.get('hip', s), view.get('knee', s), view.get('ankle', s)))
      .filter((v): v is number => v !== null);

    if (hip === null || feet.length === 0) {
      this.state = 'NOT_READY';
      return this.snapshot();
    }
    this.lastHip = hip;
    this.lastFeet = Math.min(...feet);
    this.evaluation = feet.length < 2 ? 'limited_one_foot' : toes.length < 2 ? 'limited_no_toes' : 'full';
    if (this.state === 'NOT_READY' || this.state === 'TRACKING_LOST') this.state = 'READY';

    const feetUp = feet.every((h) => h >= this.cfg.feetEnter);
    const feetDown = Math.max(...feet) <= this.cfg.feetExit;
    const hipUp = hip >= this.cfg.hipEnter;
    const toesUp = toes.length === 0 ? null : toes.every((h) => h >= this.cfg.toeEnter);
    if (Math.min(...feet) > this.cfg.feetExit) {
      if (this.liftT === null) this.liftT = t;
    } else if (!this.airborne) this.liftT = null;

    if (!this.airborne) {
      if (feetUp && hipUp && toesUp !== false) {
        this.airborne = true;
        // Flight time is measured from take-off (feet above the landing threshold).
        this.airSince = this.liftT ?? t;
        this.peakFeet = Math.min(...feet);
        this.peakHip = hip;
        this.toeSeenInFlight = toesUp === true;
        this.oneFootInFlight = feet.length < 2;
        this.minKnee = knees.length ? Math.min(...knees) : null;
      } else if (feetUp && toesUp === false && !this.toeRaising) {
        // Heels/ankles up but the toes stay on the ground: a toe raise, not a jump.
        this.toeRaising = true;
        this.toeRaises++;
      } else if (feetDown) {
        this.toeRaising = false;
      }
    } else {
      this.peakFeet = Math.max(this.peakFeet, Math.min(...feet));
      this.peakHip = Math.max(this.peakHip, hip);
      if (toesUp === true) this.toeSeenInFlight = true;
      if (feet.length < 2) this.oneFootInFlight = true;
      if (knees.length) this.minKnee = Math.min(this.minKnee ?? Number.POSITIVE_INFINITY, ...knees);
      const air = t - this.airSince;
      if (feetDown) {
        this.airborne = false;
        this.liftT = null;
        const sinceLast = this.lastJumpT === null ? Number.POSITIVE_INFINITY : t - this.lastJumpT;
        if (air >= this.cfg.minAirMs && air <= this.cfg.maxAirMs && sinceLast >= this.refractoryMs()) {
          this.count(t, air);
        }
      } else if (air > this.cfg.maxAirMs) {
        // Not a jump (stepping away from the camera, crouching…): restart the ground level.
        this.resync();
        this.state = 'READY';
      }
    }
    if (this.lastJumpT !== null && t - this.lastJumpT > this.cfg.pauseMs && this.state === 'ACTIVE') this.state = 'READY';
    return this.snapshot();
  }

  private count(t: number, air: number): void {
    if (this.lastJumpT !== null) {
      const interval = t - this.lastJumpT;
      if (interval > this.cfg.pauseMs) {
        this.pauses++;
        this.pauseMs += interval;
      } else this.intervals.push(interval);
    }
    this.lastJumpT = t;
    this.state = 'ACTIVE';
    const r: JumpRecord = {
      index: this.records.length + 1,
      t,
      airMs: air,
      peakFeet: this.peakFeet,
      peakHip: this.peakHip,
      evidence: this.toeSeenInFlight ? 'toes' : 'ankles_only',
      feet: this.oneFootInFlight ? 'one' : 'both',
      minKnee: this.minKnee,
    };
    this.records.push(r);
    for (const l of this.listeners) l(r);
  }

  stats(): JumpStats {
    const n = this.intervals.length;
    const mean = n ? this.intervals.reduce((a, b) => a + b, 0) / n : null;
    const sd = n >= 2 ? std(this.intervals) : null;
    const activeMs = this.intervals.reduce((a, b) => a + b, 0);
    return {
      jumps: this.records.length,
      toeRaises: this.toeRaises,
      pauses: this.pauses,
      pauseMs: this.pauseMs,
      activeMs,
      perMinute: activeMs > 0 ? (n / activeMs) * 60000 : null,
      intervalMeanMs: mean,
      intervalStdMs: sd,
      irregularity: mean && sd !== null ? sd / mean : null,
      withToes: this.records.filter((r) => r.evidence === 'toes').length,
      anklesOnly: this.records.filter((r) => r.evidence === 'ankles_only').length,
      oneFoot: this.records.filter((r) => r.feet === 'one').length,
    };
  }

  snapshot(): JumpSnapshot {
    return {
      state: this.state,
      airborne: this.airborne,
      evaluation: this.evaluation,
      lastJump: this.records[this.records.length - 1] ?? null,
      feetHeight: this.lastFeet,
      hipHeight: this.lastHip,
      stats: this.stats(),
    };
  }
}
