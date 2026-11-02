import { JUMP, TRACKING, type JumpConfig, type TrackingConfig } from './config';
import type { Features } from './features';
import type { CounterSnapshot, RepEvent, Tracking } from './repCounter';

/**
 * Jump rope counter. Signal: vertical position of the body (mean of hips and
 * feet), relative to the ground level and normalized by leg length.
 *
 * - Ground level = a high percentile of the (smoothed) vertical position over the
 *   last `groundWindowMs` — robust to keypoint noise, and it follows the person
 *   if they move closer/further from the camera.
 * - Hysteresis: airborne above `airborneEnter`, landed below `airborneExit`.
 *   One take-off + landing = one jump; flights shorter than `minAirMs` are noise.
 * - Jumps closer than `minIntervalMs` are ignored (noise); "flights" longer than
 *   `maxAirMs` are not jumps (stepping back, crouching) and reset the ground level.
 * - Missing keypoints for TRACKING.lostAfterMs: counting stops, history is cleared;
 *   re-appearing never adds a jump.
 */
export class JumpCounter {
  private readonly cfg: JumpConfig;
  private readonly tracking: TrackingConfig;
  private reps = 0;
  private history: { t: number; y: number }[] = [];
  private smoothY: number | null = null;
  private airborne = false;
  private airSince = 0;
  private lastJumpT = Number.NEGATIVE_INFINITY;
  private height = Number.NaN;
  private trackingState: Tracking = 'lost';
  private invalidSince: number | null = null;
  private last: Features | null = null;
  private lastEvent: RepEvent | null = null;
  private readonly listeners: ((e: RepEvent) => void)[] = [];

  constructor(options: { config?: Partial<JumpConfig>; tracking?: Partial<TrackingConfig> } = {}) {
    this.cfg = { ...JUMP, ...options.config };
    this.tracking = { ...TRACKING, ...options.tracking };
  }

  onEvent(listener: (e: RepEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  resetPhase(): void {
    this.history = [];
    this.smoothY = null;
    this.airborne = false;
    this.height = Number.NaN;
  }

  update(f: Features, t: number): CounterSnapshot {
    this.last = f;
    if (!f.valid || !f.postureOk) {
      if (this.invalidSince === null) this.invalidSince = t;
      if (t - this.invalidSince >= this.tracking.lostAfterMs) {
        if (this.trackingState !== 'lost' && !f.valid) this.emit({ type: 'reset_lost', t, reps: this.reps });
        this.trackingState = f.valid ? 'ok' : 'lost';
        this.resetPhase();
      } else if (this.trackingState !== 'lost') {
        this.trackingState = 'uncertain';
      }
      return this.snapshot();
    }
    this.invalidSince = null;
    this.trackingState = 'ok';

    const a = this.cfg.smoothing;
    this.smoothY = this.smoothY === null ? f.auxRaw : a * f.auxRaw + (1 - a) * this.smoothY;
    const y = this.smoothY;
    this.history.push({ t, y });
    while (this.history.length > 0 && this.history[0].t < t - this.cfg.groundWindowMs) this.history.shift();

    // Need ~0.3 s of history before the ground level is meaningful.
    if (this.history.length < 3 || t - this.history[0].t < 300) {
      this.height = Number.NaN;
      return this.snapshot();
    }
    const sorted = this.history.map((h) => h.y).sort((p, q) => p - q);
    const ground = sorted[Math.min(sorted.length - 1, Math.floor(this.cfg.groundPercentile * (sorted.length - 1)))];
    const h = (ground - y) / f.scale; // image y grows downward: above ground => positive
    this.height = h;

    if (!this.airborne) {
      if (h >= this.cfg.airborneEnter) {
        this.airborne = true;
        this.airSince = t;
      }
    } else if (h <= this.cfg.airborneExit) {
      this.airborne = false;
      const air = t - this.airSince;
      if (air < this.cfg.minAirMs) {
        // Single-frame spike: not a jump.
      } else if (air <= this.cfg.maxAirMs && t - this.lastJumpT >= this.cfg.minIntervalMs) {
        this.reps++;
        this.lastJumpT = t;
        this.emit({ type: 'rep', t, reps: this.reps, durationMs: air });
      } else if (t - this.lastJumpT < this.cfg.minIntervalMs) {
        this.emit({ type: 'too_fast', t, reps: this.reps, durationMs: t - this.lastJumpT });
      }
    } else if (t - this.airSince > this.cfg.maxAirMs) {
      // Not a jump (moved away from the camera, crouched…): start over from here.
      this.airborne = false;
      this.history = [{ t, y }];
      this.emit({ type: 'reset_posture', t, reps: this.reps });
    }
    return this.snapshot();
  }

  private emit(e: RepEvent): void {
    this.lastEvent = e;
    for (const l of this.listeners) l(e);
  }

  snapshot(): CounterSnapshot {
    const f = this.last;
    const ready = Number.isFinite(this.height) && this.trackingState === 'ok';
    return {
      reps: this.reps,
      partials: 0,
      phase: !ready ? 'unknown' : this.airborne ? 'target' : 'start',
      tracking: this.trackingState,
      postureOk: f?.postureOk ?? false,
      angle: f?.valid ? f.primary : Number.NaN,
      rawAngle: f?.valid ? f.primary : Number.NaN,
      disp: this.height,
      confidence: f?.confidence ?? 0,
      side: f?.side ?? null,
      missing: f?.missing ?? [],
      thresholds: null,
      lastEvent: this.lastEvent,
    };
  }
}
