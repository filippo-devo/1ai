import { VIEW_DETECTION } from './config';
import { dist } from './geometry';
import type { FrameView, LR } from './landmarks';

export type CameraView = 'front' | 'side';

/** Per-frame guess: shoulder width relative to arm length (both shoulders visible). */
export function frameViewGuess(view: FrameView): CameraView | null {
  const ls = view.get('shoulder', 'left');
  const rs = view.get('shoulder', 'right');
  const armOf = (s: LR) => {
    const sh = view.get('shoulder', s);
    const el = view.get('elbow', s);
    const wr = view.get('wrist', s);
    const a = dist(sh, el);
    const b = dist(el, wr);
    return a !== null && b !== null ? a + b : null;
  };
  const arms = [armOf('left'), armOf('right')].filter((a): a is number => a !== null && a > 0);
  if (arms.length === 0) return null;
  const arm = Math.max(...arms);
  if (!ls || !rs) return arms.length === 1 ? 'side' : null;
  const ratio = Math.abs(ls.x - rs.x) / arm;
  if (ratio >= VIEW_DETECTION.frontRatio) return 'front';
  if (ratio <= VIEW_DETECTION.sideRatio) return 'side';
  return null; // diagonal: undecided
}

/**
 * Decides whether the camera sees the person from the front or from the side, only after
 * the same answer has held for `holdMs` (one ambiguous frame does not flip it). Used before
 * the start to pick the push-up variant automatically.
 */
export class ViewDetector {
  private candidate: CameraView | null = null;
  private since = 0;
  current: CameraView | null = null;

  update(view: FrameView): CameraView | null {
    const g = frameViewGuess(view);
    if (g === null) return this.current;
    if (g !== this.candidate) {
      this.candidate = g;
      this.since = view.t;
    }
    if (view.t - this.since >= VIEW_DETECTION.holdMs) this.current = g;
    return this.current;
  }

  reset(): void {
    this.candidate = null;
    this.current = null;
  }
}
