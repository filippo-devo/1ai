/**
 * Synthetic 2D pose sequences for testing the counting logic without a camera.
 * Poses are generated from simple planar kinematics (joint angles -> keypoints)
 * so the joint angle the counter measures is exactly controlled.
 */
import { KP, NUM_KEYPOINTS, type Point, type Pose } from '../pose/types';
import type { ExerciseId } from '../counting/config';

export interface Body {
  /** Pixel lengths of body segments. */
  upperArm: number;
  forearm: number;
  torso: number;
  thigh: number;
  shin: number;
}

export const AVERAGE_BODY: Body = { upperArm: 60, forearm: 55, torso: 110, thigh: 85, shin: 80 };

export function scaledBody(scale: number, overrides: Partial<Body> = {}): Body {
  const b: Body = {
    upperArm: AVERAGE_BODY.upperArm * scale,
    forearm: AVERAGE_BODY.forearm * scale,
    torso: AVERAGE_BODY.torso * scale,
    thigh: AVERAGE_BODY.thigh * scale,
    shin: AVERAGE_BODY.shin * scale,
  };
  return { ...b, ...overrides };
}

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const add = (p: Point, len: number, angleRad: number): Point => ({
  x: p.x + len * Math.cos(angleRad),
  y: p.y + len * Math.sin(angleRad),
});

/** Law of cosines: distance between segment ends for a joint angle. */
function span(a: number, b: number, jointDeg: number): number {
  return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(rad(jointDeg)));
}

/** Elbow/knee position for a two-segment chain from `from` (length a) to `to` (length b). */
function joint(from: Point, to: Point, a: number, b: number, bendSign: 1 | -1): Point {
  const d = Math.max(1e-6, Math.hypot(to.x - from.x, to.y - from.y));
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const base = Math.atan2(to.y - from.y, to.x - from.x);
  return add(from, a, base + bendSign * Math.acos(cosA));
}

type Skeleton = Partial<Record<keyof typeof KP, Point>>;

/** Push-up, side view. Person's head to the right, hands on the floor. */
export function pushupSkeleton(elbowDeg: number, body: Body, origin: Point): Skeleton {
  const floorY = origin.y;
  const wrist = { x: origin.x, y: floorY };
  // Shoulder slightly behind the hands (toward the feet), at exactly the
  // distance that produces the requested elbow angle.
  const d = span(body.upperArm, body.forearm, elbowDeg);
  const shoulder = { x: wrist.x - 0.0995 * d, y: floorY - 0.995 * d };
  const elbow = joint(shoulder, wrist, body.upperArm, body.forearm, -1);
  const legs = body.thigh + body.shin;
  const ankle = { x: origin.x - (body.torso + legs) * 0.97, y: floorY - 6 };
  const along = (frac: number): Point => ({
    x: shoulder.x + (ankle.x - shoulder.x) * frac,
    y: shoulder.y + (ankle.y - shoulder.y) * frac,
  });
  const total = body.torso + legs;
  const hip = along(body.torso / total);
  const knee = along((body.torso + body.thigh) / total);
  const nose = { x: shoulder.x + 0.35 * body.torso, y: shoulder.y + 0.05 * body.torso };
  return {
    nose,
    leftEye: { x: nose.x + 4, y: nose.y - 4 },
    leftEar: { x: nose.x - 10, y: nose.y - 4 },
    leftShoulder: shoulder,
    leftElbow: elbow,
    leftWrist: wrist,
    leftHip: hip,
    leftKnee: knee,
    leftAnkle: ankle,
  };
}

/** Squat, side view. Person faces +x. */
export function squatSkeleton(kneeDeg: number, body: Body, origin: Point): Skeleton {
  const flex = 180 - kneeDeg;
  const ankle = { x: origin.x, y: origin.y };
  const shinLean = rad(0.35 * flex); // from vertical, forward
  const knee = { x: ankle.x + body.shin * Math.sin(shinLean), y: ankle.y - body.shin * Math.cos(shinLean) };
  // Thigh direction: rotate knee->ankle direction by the knee angle, toward the back (-x).
  const kaAngle = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
  const c1 = add(knee, body.thigh, kaAngle + rad(kneeDeg));
  const c2 = add(knee, body.thigh, kaAngle - rad(kneeDeg));
  const hip = c1.x <= c2.x ? c1 : c2;
  const torsoLean = rad(0.45 * flex);
  const shoulder = { x: hip.x + body.torso * Math.sin(torsoLean), y: hip.y - body.torso * Math.cos(torsoLean) };
  const elbow = { x: shoulder.x + body.upperArm * 0.8, y: shoulder.y + body.upperArm * 0.3 };
  const wrist = { x: elbow.x + body.forearm, y: elbow.y };
  const nose = { x: shoulder.x + 12, y: shoulder.y - 0.3 * body.torso };
  return {
    nose,
    leftEye: { x: nose.x + 3, y: nose.y - 4 },
    leftEar: { x: nose.x - 10, y: nose.y - 2 },
    leftShoulder: shoulder,
    leftElbow: elbow,
    leftWrist: wrist,
    leftHip: hip,
    leftKnee: knee,
    leftAnkle: ankle,
    // Far side slightly offset (partially visible in side view).
    rightShoulder: { x: shoulder.x - 4, y: shoulder.y + 2 },
    rightHip: { x: hip.x - 4, y: hip.y + 1 },
    rightKnee: { x: knee.x - 4, y: knee.y + 1 },
    rightAnkle: { x: ankle.x - 5, y: ankle.y },
  };
}

/** Pull-up, front view. Hands on the bar at y = origin.y. */
export function pullupSkeleton(elbowDeg: number, body: Body, origin: Point): Skeleton {
  const grip = 0.75 * (body.upperArm + body.forearm);
  const shoulderHalf = 0.35 * body.torso;
  const d = span(body.upperArm, body.forearm, elbowDeg);
  const dx = grip - shoulderHalf;
  const dy = Math.sqrt(Math.max(1, d * d - dx * dx));
  const lw = { x: origin.x - grip, y: origin.y };
  const rw = { x: origin.x + grip, y: origin.y };
  const ls = { x: origin.x - shoulderHalf, y: origin.y + dy };
  const rs = { x: origin.x + shoulderHalf, y: origin.y + dy };
  const le = joint(ls, lw, body.upperArm, body.forearm, 1);
  const re = joint(rs, rw, body.upperArm, body.forearm, -1);
  const hipHalf = 0.25 * body.torso;
  const lh = { x: origin.x - hipHalf, y: ls.y + body.torso };
  const rh = { x: origin.x + hipHalf, y: rs.y + body.torso };
  const lk = { x: lh.x, y: lh.y + body.thigh };
  const rk = { x: rh.x, y: rh.y + body.thigh };
  const la = { x: lk.x, y: lk.y + body.shin };
  const ra = { x: rk.x, y: rk.y + body.shin };
  const nose = { x: origin.x, y: ls.y - 0.3 * body.torso };
  return {
    nose,
    leftEye: { x: nose.x - 6, y: nose.y - 5 },
    rightEye: { x: nose.x + 6, y: nose.y - 5 },
    leftEar: { x: nose.x - 14, y: nose.y },
    rightEar: { x: nose.x + 14, y: nose.y },
    leftShoulder: ls,
    rightShoulder: rs,
    leftElbow: le,
    rightElbow: re,
    leftWrist: lw,
    rightWrist: rw,
    leftHip: lh,
    rightHip: rh,
    leftKnee: lk,
    rightKnee: rk,
    leftAnkle: la,
    rightAnkle: ra,
  };
}

/**
 * Sit-up, side view, lying on the back (head to the left, feet to the right).
 * `hipDeg` is the shoulder–hip–knee angle (thighs fixed at 45° from the floor):
 * ~135° lying flat, ~45° sitting upright.
 */
export function situpSkeleton(hipDeg: number, body: Body, origin: Point): Skeleton {
  const floorY = origin.y;
  const hip = { x: origin.x, y: floorY };
  const thighAngle = rad(45);
  const knee = { x: hip.x + body.thigh * Math.cos(thighAngle), y: hip.y - body.thigh * Math.sin(thighAngle) };
  const kneeH = floorY - knee.y;
  const ankle = { x: knee.x + Math.sqrt(Math.max(1, body.shin * body.shin - kneeH * kneeH)), y: floorY };
  const torsoRaise = rad(Math.max(0, Math.min(100, 135 - hipDeg)));
  const shoulder = { x: hip.x - body.torso * Math.cos(torsoRaise), y: hip.y - body.torso * Math.sin(torsoRaise) };
  const dir = { x: (shoulder.x - hip.x) / body.torso, y: (shoulder.y - hip.y) / body.torso };
  const nose = { x: shoulder.x + dir.x * 0.3 * body.torso, y: shoulder.y + dir.y * 0.3 * body.torso - 4 };
  // Hands crossed on the chest.
  const elbow = { x: shoulder.x - dir.x * 0.3 * body.torso + 6, y: shoulder.y - dir.y * 0.3 * body.torso - 10 };
  const wrist = { x: shoulder.x - dir.x * 0.1 * body.torso + 4, y: shoulder.y - dir.y * 0.1 * body.torso - 14 };
  return {
    nose,
    leftEye: { x: nose.x + 3, y: nose.y - 3 },
    leftEar: { x: nose.x - 6, y: nose.y - 2 },
    leftShoulder: shoulder,
    leftElbow: elbow,
    leftWrist: wrist,
    leftHip: hip,
    leftKnee: knee,
    leftAnkle: ankle,
  };
}

/**
 * Forearm plank, side view (head to the right). `bodyDeg` is the
 * shoulder–hip–ankle angle: 180 = straight; smaller = hips sagging.
 */
export function plankSkeleton(bodyDeg: number, body: Body, origin: Point): Skeleton {
  const floorY = origin.y;
  const elbow = { x: origin.x, y: floorY };
  const wrist = { x: elbow.x + body.forearm, y: floorY };
  const shoulder = { x: elbow.x, y: floorY - body.upperArm };
  const legs = body.thigh + body.shin;
  const total = body.torso + legs;
  const ankle = { x: shoulder.x - Math.sqrt(Math.max(1, total * total - body.upperArm * body.upperArm)), y: floorY - 4 };
  const lx = ankle.x - shoulder.x;
  const ly = ankle.y - shoulder.y;
  const len = Math.hypot(lx, ly);
  const ux = lx / len;
  const uy = ly / len;
  // Perpendicular pointing down (toward the floor).
  const nx = -uy;
  const ny = ux;
  const a = (body.torso / total) * len;
  const b = len - a;
  const angleFor = (d: number) => 180 - ((Math.atan2(d, a) + Math.atan2(d, b)) * 180) / Math.PI;
  let lo = 0;
  let hi = len;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (angleFor(mid) > bodyDeg) lo = mid;
    else hi = mid;
  }
  const sag = (lo + hi) / 2;
  const sign = ny >= 0 ? 1 : -1;
  const hip = { x: shoulder.x + ux * a + sign * nx * sag, y: shoulder.y + uy * a + sign * ny * sag };
  const knee = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 };
  const nose = { x: shoulder.x + 0.3 * body.torso, y: shoulder.y - 0.08 * body.torso };
  return {
    nose,
    leftEye: { x: nose.x + 4, y: nose.y - 4 },
    leftEar: { x: nose.x - 10, y: nose.y - 4 },
    leftShoulder: shoulder,
    leftElbow: elbow,
    leftWrist: wrist,
    leftHip: hip,
    leftKnee: knee,
    leftAnkle: ankle,
  };
}

/** Rep profile: [time fraction, angle] keyframes are linearly interpolated. */
export interface RepSpec {
  /** Angle at the start position (extended). */
  topDeg: number;
  /** Most flexed angle reached in this rep. */
  bottomDeg: number;
  /** Total duration of the rep in ms. */
  durationMs: number;
  /** Hold at top before the rep, ms. */
  holdTopMs?: number;
  /** Hold at bottom, ms. */
  holdBottomMs?: number;
}

export interface SequenceOptions {
  exercise: ExerciseId;
  reps: RepSpec[];
  fps?: number;
  body?: Body;
  imageWidth?: number;
  imageHeight?: number;
  /** Gaussian keypoint noise, pixels. */
  noisePx?: number;
  /** Keypoint score for visible points. */
  score?: number;
  seed?: number;
  /** Hold the start position this long before the first and after the last rep. */
  leadInMs?: number;
  leadOutMs?: number;
  /**
   * Time windows (ms from sequence start) during which the person is not
   * visible (all keypoints get a near-zero score and random positions).
   */
  dropouts?: { fromMs: number; toMs: number }[];
  /** Single-frame outliers: at these times, the given keypoint jumps by (dx, dy) px. */
  spikes?: { atMs: number; kp: keyof typeof KP; dx: number; dy: number }[];
  /** Explicit [timeMs, angleDeg] keyframes; overrides `reps` when given. */
  keyframes?: [number, number][];
  /** Override posture: e.g. for "standing while bending arms" tests. */
  skeletonFn?: (deg: number, body: Body, origin: Point) => Skeleton;
}

export function keyframeTrack(keys: [number, number][]): { durationMs: number; at: (t: number) => number } {
  return {
    durationMs: keys[keys.length - 1][0],
    at(time: number): number {
      if (time <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (time <= keys[i][0]) {
          const [t0, a0] = keys[i - 1];
          const [t1, a1] = keys[i];
          const f = t1 > t0 ? (time - t0) / (t1 - t0) : 1;
          // Smooth (cosine) easing like real movement.
          const e = (1 - Math.cos(Math.PI * f)) / 2;
          return a0 + (a1 - a0) * e;
        }
      }
      return keys[keys.length - 1][1];
    },
  };
}

export function angleTrack(reps: RepSpec[], leadInMs: number, leadOutMs: number): {
  durationMs: number;
  at: (t: number) => number;
} {
  const keys: [number, number][] = [];
  let t = 0;
  const firstTop = reps[0]?.topDeg ?? 170;
  keys.push([0, firstTop]);
  t += leadInMs;
  keys.push([t, firstTop]);
  for (const r of reps) {
    const holdTop = r.holdTopMs ?? 0;
    const holdBottom = r.holdBottomMs ?? 0;
    const move = Math.max(1, r.durationMs - holdBottom);
    t += holdTop;
    keys.push([t, r.topDeg]);
    t += move / 2;
    keys.push([t, r.bottomDeg]);
    t += holdBottom;
    keys.push([t, r.bottomDeg]);
    t += move / 2;
    keys.push([t, r.topDeg]);
  }
  const last = keys[keys.length - 1][1];
  t += leadOutMs;
  keys.push([t, last]);
  return keyframeTrack(keys);
}

const SKELETONS: Record<ExerciseId, (deg: number, body: Body, origin: Point) => Skeleton> = {
  pushup: pushupSkeleton,
  squat: squatSkeleton,
  pullup: pullupSkeleton,
  situp: situpSkeleton,
  plank: plankSkeleton,
};

export function generateSequence(opts: SequenceOptions): Pose[] {
  const fps = opts.fps ?? 30;
  const body = opts.body ?? AVERAGE_BODY;
  const isPortrait = opts.exercise === 'squat' || opts.exercise === 'pullup';
  const W = opts.imageWidth ?? (isPortrait ? 480 : 640);
  const H = opts.imageHeight ?? (isPortrait ? 640 : 480);
  const rand = rng(opts.seed ?? 1);
  const noise = opts.noisePx ?? 0;
  const score = opts.score ?? 0.8;
  const track = opts.keyframes
    ? keyframeTrack(opts.keyframes)
    : angleTrack(opts.reps, opts.leadInMs ?? 800, opts.leadOutMs ?? 800);
  const skeletonFn = opts.skeletonFn ?? SKELETONS[opts.exercise];
  const origin: Point =
    opts.exercise === 'pushup' || opts.exercise === 'plank'
      ? { x: W * 0.75, y: H * 0.8 }
      : opts.exercise === 'situp'
        ? { x: W * 0.45, y: H * 0.8 }
        : opts.exercise === 'squat'
        ? { x: W * 0.5, y: H * 0.88 }
        : { x: W * 0.5, y: H * 0.12 };

  const poses: Pose[] = [];
  const dt = 1000 / fps;
  for (let t = 0; t <= track.durationMs; t += dt) {
    const sk = skeletonFn(track.at(t), body, origin);
    const kps = new Array<number>(NUM_KEYPOINTS * 3).fill(0);
    const hidden = (opts.dropouts ?? []).some((d) => t >= d.fromMs && t < d.toMs);
    for (const [name, index] of Object.entries(KP) as [keyof typeof KP, number][]) {
      const p = sk[name];
      if (!p || hidden) {
        kps[index * 3] = rand();
        kps[index * 3 + 1] = rand();
        kps[index * 3 + 2] = 0.05 * rand();
        continue;
      }
      let x = p.x + noise * gaussian(rand);
      let y = p.y + noise * gaussian(rand);
      for (const s of opts.spikes ?? []) {
        if (s.kp === name && Math.abs(t - s.atMs) < dt / 2) {
          x += s.dx;
          y += s.dy;
        }
      }
      kps[index * 3] = x / W;
      kps[index * 3 + 1] = y / H;
      kps[index * 3 + 2] = Math.min(1, Math.max(0, score + 0.05 * gaussian(rand)));
    }
    poses.push({ keypoints: kps, width: W, height: H, timestamp: t });
  }
  return poses;
}

export function fullReps(n: number, spec: Partial<RepSpec> & Pick<RepSpec, 'topDeg' | 'bottomDeg'>): RepSpec[] {
  return Array.from({ length: n }, () => ({ durationMs: 1600, holdTopMs: 300, holdBottomMs: 150, ...spec }));
}
