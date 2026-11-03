/**
 * One Euro filter (Casiez et al., CHI 2012) driven by REAL timestamps (dt in seconds),
 * not by frame counts: the smoothing is the same at 10, 30 or 60 fps.
 */
export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

function alpha(cutoff: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private tMs: number | null = null;

  constructor(private readonly params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.tMs = null;
  }

  filter(value: number, timestampMs: number): number {
    if (this.x === null || this.tMs === null) {
      this.x = value;
      this.dx = 0;
      this.tMs = timestampMs;
      return value;
    }
    const dtSec = Math.max((timestampMs - this.tMs) / 1000, 1 / 240);
    this.tMs = timestampMs;
    const aD = alpha(this.params.dCutoff, dtSec);
    this.dx = aD * ((value - this.x) / dtSec) + (1 - aD) * this.dx;
    const a = alpha(this.params.minCutoff + this.params.beta * Math.abs(this.dx), dtSec);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

/** Exponential moving average with a time constant (ms), independent of the frame rate. */
export class TimeEma {
  private y: number | null = null;
  private t: number | null = null;
  constructor(private readonly tauMs: number) {}
  reset(): void {
    this.y = null;
    this.t = null;
  }
  filter(value: number, tMs: number): number {
    if (this.y === null || this.t === null || this.tauMs <= 0) {
      this.y = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(0, tMs - this.t);
    this.t = tMs;
    const a = 1 - Math.exp(-dt / this.tauMs);
    this.y = this.y + a * (value - this.y);
    return this.y;
  }
}
