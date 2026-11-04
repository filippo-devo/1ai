import { FOOT, KP, type Pose, type PoseSource } from '../pose/types';
import { LEG_VISIBILITY, VISIBILITY } from './config';
import type { P } from './geometry';

export type Part = 'nose' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe';
export type LR = 'left' | 'right';

export const PART_PL: Record<Part, string> = {
  nose: 'głowa',
  shoulder: 'barki',
  elbow: 'łokcie',
  wrist: 'nadgarstki',
  hip: 'biodra',
  knee: 'kolana',
  ankle: 'kostki',
  heel: 'pięty',
  toe: 'palce stóp',
};

const COCO: Partial<Record<Part, { left: number; right: number }>> = {
  nose: { left: KP.nose, right: KP.nose },
  shoulder: { left: KP.leftShoulder, right: KP.rightShoulder },
  elbow: { left: KP.leftElbow, right: KP.rightElbow },
  wrist: { left: KP.leftWrist, right: KP.rightWrist },
  hip: { left: KP.leftHip, right: KP.rightHip },
  knee: { left: KP.leftKnee, right: KP.rightKnee },
  ankle: { left: KP.leftAnkle, right: KP.rightAnkle },
};
const FEET: Partial<Record<Part, { left: number; right: number }>> = {
  heel: { left: FOOT.leftHeel, right: FOOT.rightHeel },
  toe: { left: FOOT.leftToe, right: FOOT.rightToe },
};

const LEG_PARTS = new Set<Part>(['hip', 'knee', 'ankle', 'heel', 'toe']);

export interface Landmark extends P {
  score: number;
}

/**
 * One frame's landmarks in a COMMON pixel scale (x·width, y·height of the upright
 * image: rotation, crop, letterboxing and mirroring are already undone by the model
 * adapters). Image coordinates only — no world/3D coordinates are mixed in.
 */
export class FrameView {
  readonly t: number;
  readonly source: PoseSource;
  readonly minScore: number;
  /** Threshold for leg points (hip, knee, ankle, heel, toe). */
  readonly minLegScore: number;

  constructor(
    readonly pose: Pose,
    minScoreOverride?: number,
  ) {
    this.t = pose.timestamp;
    this.source = pose.source ?? 'movenet';
    this.minScore = minScoreOverride ?? VISIBILITY[this.source];
    this.minLegScore = minScoreOverride ?? LEG_VISIBILITY[this.source];
  }

  private raw(part: Part, side: LR): Landmark | null {
    const coco = COCO[part];
    if (coco) {
      const i = coco[side];
      const k = this.pose.keypoints;
      return { x: k[i * 3] * this.pose.width, y: k[i * 3 + 1] * this.pose.height, score: k[i * 3 + 2] };
    }
    const feet = FEET[part];
    if (feet && this.pose.feet) {
      const i = feet[side];
      const f = this.pose.feet;
      return { x: f[i * 3] * this.pose.width, y: f[i * 3 + 1] * this.pose.height, score: f[i * 3 + 2] };
    }
    return null; // this model does not provide the point at all
  }

  /** Does the model provide this landmark at all (e.g. toes: MediaPipe yes, MoveNet no)? */
  provides(part: Part): boolean {
    return COCO[part] !== undefined || (FEET[part] !== undefined && !!this.pose.feet);
  }

  /** A usable point (score ≥ threshold and inside the frame) or null. */
  get(part: Part, side: LR): Landmark | null {
    const p = this.raw(part, side);
    if (!p || !(p.score >= (LEG_PARTS.has(part) ? this.minLegScore : this.minScore))) return null;
    const mx = 0.02 * this.pose.width;
    const my = 0.02 * this.pose.height;
    if (p.x < -mx || p.x > this.pose.width + mx || p.y < -my || p.y > this.pose.height + my) return null;
    return p;
  }

  visible(parts: Part[], side: LR): boolean {
    return parts.every((p) => this.get(p, side) !== null);
  }

  /** Minimum score of the given parts on a side (0 if a part is not provided). */
  quality(parts: Part[], side: LR): number {
    let q = 1;
    for (const part of parts) q = Math.min(q, this.raw(part, side)?.score ?? 0);
    return q;
  }

  missing(parts: Part[], side: LR): Part[] {
    return parts.filter((p) => this.get(p, side) === null);
  }
}

/**
 * Chooses which body side a metric is measured on.
 * - 'single': side views; one side only, never averaged with the occluded side.
 * - 'both': front/back views; both sides averaged ONLY when both are visible,
 *   otherwise the visible side alone (marked one-sided).
 * While locked (a repetition is in progress) the selection never changes: losing the
 * selected side makes the metric unavailable instead of jumping to the other side.
 */
export class SideTracker {
  private current: LR[] | null = null;
  locked = false;

  /**
   * 'any': every visible side each frame (no locking). Only for metrics normalised per side
   * (push-up: each side has its own straight-arm reference), where switching sides cannot
   * make the value jump.
   */
  constructor(private readonly mode: 'single' | 'both' | 'any') {}

  reset(): void {
    this.current = null;
    this.locked = false;
  }

  select(view: FrameView, parts: Part[]): LR[] | null {
    const ok = (s: LR) => view.visible(parts, s);
    if (this.mode === 'any') {
      const vis = (['left', 'right'] as LR[]).filter(ok);
      this.current = vis.length ? vis : null;
      return this.current;
    }
    if (this.locked) {
      // Mid-repetition: keep the side; if it is lost the metric is unavailable.
      return this.current && this.current.every(ok) ? this.current : null;
    }
    const l = ok('left');
    const r = ok('right');
    let next: LR[] | null = null;
    if (this.mode === 'both' && l && r) next = ['left', 'right'];
    else if (this.current && this.current.length === 1 && this.current.every(ok)) next = this.current; // sticky
    else if (l && r) next = view.quality(parts, 'left') >= view.quality(parts, 'right') ? ['left'] : ['right'];
    else if (l) next = ['left'];
    else if (r) next = ['right'];
    this.current = next;
    return next;
  }
}

/** COCO keypoint indices (both sides) of the given parts — for highlighting in the overlay. */
export function cocoIndices(parts: Part[]): number[] {
  return parts.flatMap((p) => {
    const c = COCO[p];
    return c ? [c.left, c.right] : [];
  });
}
