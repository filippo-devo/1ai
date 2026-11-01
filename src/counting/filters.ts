/**
 * One Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter.
 * Slow movement / jitter -> strong smoothing; fast movement -> low lag.
 * This is what keeps the counter stable regardless of exercise tempo.
 */
export interface OneEuroParams {
  /** Minimum cutoff frequency in Hz (lower = smoother when still). */
  minCutoff: number;
  /** Speed coefficient (higher = less lag on fast movement). */
  beta: number;
  /** Cutoff for the derivative, Hz. */
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
    // Guard against duplicate / out-of-order timestamps.
    const dtSec = Math.max((timestampMs - this.tMs) / 1000, 1 / 240);
    this.tMs = timestampMs;
    const rawDx = (value - this.x) / dtSec;
    const aD = alpha(this.params.dCutoff, dtSec);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    const a = alpha(cutoff, dtSec);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}
