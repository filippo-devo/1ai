import type { ExerciseId, VariantId } from './config';
import { TECHNIQUE } from './config';
import { angle, dist, elevation, inclination, signedDeviation, type P } from './geometry';
import { FrameView, SideTracker, type LR, type Part } from './landmarks';

export type MeasuredSide = 'left' | 'right' | 'both';

/**
 * Measurements of one frame. Every value is either a number or null (= unavailable:
 * a required point is missing or a segment has zero length). `quality` is the minimum
 * score of the points used; `oneSided` marks measurements from a single visible side.
 */
export interface FrameMetrics {
  t: number;
  /** Driving value of the detector (deg), null when unavailable. */
  primary: number | null;
  values: Record<string, number | null>;
  side: MeasuredSide | null;
  oneSided: boolean;
  quality: number;
  /** Required parts not visible (on the better side), for "Ustaw się w kadrze" messages. */
  missing: Part[];
  /** Is the body in the posture this exercise needs (null = cannot tell)? */
  posture: boolean | null;
  view: 'side' | 'front' | 'unknown';
}

interface Spec {
  mode: 'single' | 'both';
  /** Points required for the driving metric. */
  required: Part[];
  /** Optional points read on the same side(s) when visible. */
  optional: Part[];
  compute(pts: (part: Part) => P | null): { primary: number | null; values: Record<string, number | null>; posture: boolean | null };
}

const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
const div = (a: number | null, b: number | null) => (a === null || b === null || b <= 0 ? null : a / b);
const sum = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

function specFor(exercise: ExerciseId, variant: VariantId): Spec {
  switch (exercise) {
    case 'squat':
      return {
        mode: 'single',
        required: ['shoulder', 'hip', 'knee', 'ankle'],
        optional: [],
        compute(p) {
          const knee = angle(p('hip'), p('knee'), p('ankle'));
          const hip = angle(p('shoulder'), p('hip'), p('knee'));
          const trunk = elevation(p('hip'), p('shoulder'));
          const leg = sum(dist(p('hip'), p('knee')), dist(p('knee'), p('ankle')));
          const hipHeight = div(sub(p('ankle')?.y ?? null, p('hip')?.y ?? null), leg);
          const sh = p('shoulder');
          const hp = p('hip');
          const an = p('ankle');
          const posture = sh && hp && an && trunk !== null ? sh.y < hp.y && hp.y < an.y && trunk >= 30 : null;
          return { primary: knee, values: { knee, hip, trunk, hipHeight }, posture };
        },
      };
    case 'pushup':
      return {
        mode: 'single',
        required: ['shoulder', 'elbow', 'wrist', 'hip'],
        optional: ['knee', 'ankle'],
        compute(p) {
          const elbow = angle(p('shoulder'), p('elbow'), p('wrist'));
          const arm = sum(dist(p('shoulder'), p('elbow')), dist(p('elbow'), p('wrist')));
          // Shoulders above the hands (image y down) ÷ arm length; decreases going down.
          const shoulderHeight = div(sub(p('wrist')?.y ?? null, p('shoulder')?.y ?? null), arm);
          const torso = inclination(p('shoulder'), p('hip'));
          const end = variant === 'knees' ? p('knee') : p('ankle');
          const line = angle(p('shoulder'), p('hip'), end);
          const kneeAngle = angle(p('hip'), p('knee'), p('ankle'));
          const kn = p('knee');
          const wr = p('wrist');
          const kneeOnFloor =
            kneeAngle !== null && kn && wr && arm !== null
              ? kneeAngle < TECHNIQUE.pushup.kneelingKneeAngle && kn.y >= wr.y - 0.15 * arm
                ? 1
                : 0
              : null;
          const posture = torso !== null && shoulderHeight !== null ? torso <= 50 && shoulderHeight > -0.1 : null;
          return {
            primary: elbow,
            values: { elbow, shoulderHeight, torso, bodyLineDev: line === null ? null : 180 - line, kneeAngle, kneeOnFloor },
            posture,
          };
        },
      };
    case 'bench':
      return {
        mode: 'single',
        required: ['shoulder', 'elbow', 'wrist', 'hip'],
        optional: [],
        compute(p) {
          const elbow = angle(p('shoulder'), p('elbow'), p('wrist'));
          const arm = sum(dist(p('shoulder'), p('elbow')), dist(p('elbow'), p('wrist')));
          const wristUp = div(sub(p('shoulder')?.y ?? null, p('wrist')?.y ?? null), arm);
          const wristX = div(sub(p('wrist')?.x ?? null, p('shoulder')?.x ?? null), arm);
          const torso = inclination(p('shoulder'), p('hip'));
          const posture = torso !== null && wristUp !== null ? torso <= 35 && wristUp > -0.1 : null;
          return { primary: elbow, values: { elbow, wristUp, wristX, torso }, posture };
        },
      };
    case 'pullup':
      return {
        mode: 'both',
        required: ['shoulder', 'elbow', 'wrist'],
        optional: ['hip'],
        compute(p) {
          const elbow = angle(p('shoulder'), p('elbow'), p('wrist'));
          const arm = sum(dist(p('shoulder'), p('elbow')), dist(p('elbow'), p('wrist')));
          // Shoulders below the hands ÷ arm length; decreases while pulling up.
          const shoulderDrop = div(sub(p('shoulder')?.y ?? null, p('wrist')?.y ?? null), arm);
          const torsoLen = dist(p('shoulder'), p('hip'));
          const hipX = div(p('hip')?.x ?? null, torsoLen);
          const posture = shoulderDrop !== null ? shoulderDrop > -0.15 : null;
          return { primary: elbow, values: { elbow, shoulderDrop, hipX, arm }, posture };
        },
      };
    case 'abs':
      return {
        mode: 'single',
        required: ['shoulder', 'hip', 'knee', 'ankle'],
        optional: [],
        compute(p) {
          // Trunk (hip → shoulder) elevation vs the floor: 0° lying, 90° sitting upright.
          // NOT a measurement of lumbar flexion.
          const trunk = elevation(p('hip'), p('shoulder'));
          const knee = angle(p('hip'), p('knee'), p('ankle'));
          const leg = sum(dist(p('hip'), p('knee')), dist(p('knee'), p('ankle')));
          const hp = p('hip');
          const an = p('ankle');
          const posture =
            hp && an && leg !== null && knee !== null ? Math.abs(an.y - hp.y) < 0.35 * leg && knee < 150 : null;
          return { primary: trunk, values: { trunk, knee }, posture };
        },
      };
    case 'plank':
      return {
        mode: 'single',
        required: ['shoulder', 'elbow', 'hip', 'ankle'],
        optional: ['wrist', 'knee'],
        compute(p) {
          const sh = p('shoulder');
          const an = p('ankle');
          const el = p('elbow');
          const bodyLen = dist(sh, an);
          const line = angle(sh, p('hip'), an);
          const incl = inclination(sh, an);
          const elev = div(sub(an?.y ?? null, sh?.y ?? null), bodyLen);
          const posture =
            incl !== null && elev !== null && sh && el
              ? incl <= TECHNIQUE.plank.maxInclination && elev >= TECHNIQUE.plank.minElevation && el.y > sh.y
              : null;
          return {
            primary: line,
            values: {
              elbow: angle(sh, el, p('wrist')),
              knee: angle(p('hip'), p('knee'), an),
              hip: angle(sh, p('hip'), p('knee')),
              bodyLine: line,
              hipDev: signedDeviation(sh, p('hip'), an),
            },
            posture,
          };
        },
      };
    case 'jumprope':
      return {
        mode: 'both',
        required: ['hip', 'knee', 'ankle'],
        optional: ['shoulder', 'toe', 'heel'],
        compute(p) {
          const leg = sum(dist(p('hip'), p('knee')), dist(p('knee'), p('ankle')));
          const sh = p('shoulder');
          const hp = p('hip');
          const an = p('ankle');
          const posture = hp && an ? (sh ? sh.y < hp.y : true) && hp.y < an.y : null;
          return {
            primary: angle(p('hip'), p('knee'), p('ankle')),
            values: { hipY: hp?.y ?? null, ankleY: an?.y ?? null, toeY: p('toe')?.y ?? null, leg },
            posture,
          };
        },
      };
  }
}

/** Extracts the per-frame metrics of one exercise/variant with a sticky side choice. */
export class MetricExtractor {
  private readonly spec: Spec;
  readonly sides: SideTracker;

  constructor(
    readonly exercise: ExerciseId,
    readonly variant: VariantId,
  ) {
    this.spec = specFor(exercise, variant);
    this.sides = new SideTracker(this.spec.mode);
  }

  get requiredParts(): Part[] {
    return this.spec.required;
  }

  /** Lock the measured side for the duration of a repetition. */
  lock(locked: boolean): void {
    this.sides.locked = locked;
  }

  extract(view: FrameView): FrameMetrics {
    const sides = this.sides.select(view, this.spec.required);
    const better: LR = view.quality(this.spec.required, 'left') >= view.quality(this.spec.required, 'right') ? 'left' : 'right';
    const frontView = this.viewOf(view);
    if (!sides) {
      return {
        t: view.t,
        primary: null,
        values: {},
        side: null,
        oneSided: false,
        quality: Math.max(view.quality(this.spec.required, 'left'), view.quality(this.spec.required, 'right')),
        missing: view.missing(this.spec.required, better),
        posture: null,
        view: frontView,
      };
    }
    const results = sides.map((s) => this.spec.compute((part) => view.get(part, s)));
    // Average both sides only when both are measured; never mix with an occluded side.
    const avg = (vals: (number | null)[]): number | null => {
      let total = 0;
      for (const v of vals) {
        if (v === null) return null;
        total += v;
      }
      return total / vals.length;
    };
    const values: Record<string, number | null> = {};
    for (const key of Object.keys(results[0].values)) values[key] = avg(results.map((r) => r.values[key]));
    const postures = results.map((r) => r.posture);
    return {
      t: view.t,
      primary: avg(results.map((r) => r.primary)),
      values,
      side: sides.length === 2 ? 'both' : sides[0],
      oneSided: this.spec.mode === 'both' && sides.length === 1,
      quality: Math.min(...sides.map((s) => view.quality(this.spec.required, s))),
      missing: [],
      posture: postures.some((p) => p === null) ? null : postures.every((p) => p),
      view: frontView,
    };
  }

  private viewOf(view: FrameView): 'side' | 'front' | 'unknown' {
    const ls = view.get('shoulder', 'left');
    const rs = view.get('shoulder', 'right');
    const le = view.get('elbow', 'left') ?? view.get('elbow', 'right');
    const lw = view.get('wrist', 'left') ?? view.get('wrist', 'right');
    const s = ls ?? rs;
    if (!s || !le || !lw) return 'unknown';
    const arm = (dist(s, le) ?? 0) + (dist(le, lw) ?? 0);
    if (arm <= 0) return 'unknown';
    if (!ls || !rs) return 'side';
    return Math.abs(ls.x - rs.x) / arm > TECHNIQUE.pullup.frontViewShoulderRatio ? 'front' : 'side';
  }
}
