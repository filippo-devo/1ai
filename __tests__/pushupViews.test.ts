import { equivalentElbowAngle } from '../src/analysis/metrics';
import { analyze, calibrate } from '../src/testing/run';
import {
  fullReps,
  generateSequence,
  pushupFrontSkeleton,
  scaledBody,
  standingFrontSkeleton,
  type RepSpec,
  type Skeleton,
  type Body,
} from '../src/testing/synthetic';
import type { Point } from '../src/pose/types';
import type { PoseSource } from '../src/pose/types';

const front =
  (flare: number) =>
  (deg: number, body: Body, origin: Point): Skeleton =>
    pushupFrontSkeleton(deg, body, origin, flare);

function seq(reps: RepSpec[], opts: { flare?: number; source?: PoseSource; noisePx?: number; body?: Body; seed?: number } = {}) {
  return generateSequence({
    exercise: 'pushup',
    reps,
    skeletonFn: front(opts.flare ?? 0.5),
    source: opts.source ?? 'mediapipe',
    noisePx: opts.noisePx ?? 0.8,
    body: opts.body,
    seed: opts.seed,
    imageWidth: 480,
    imageHeight: 640,
    leadInMs: 1500,
  });
}

describe('push-up from the front (same detector as the side view)', () => {
  test('equivalent elbow angle: exact below 120°, linear (well conditioned) up to 180°', () => {
    expect(equivalentElbowAngle(1)).toBeCloseTo(180);
    expect(equivalentElbowAngle(Math.SQRT1_2)).toBeCloseTo(90, 1);
    expect(equivalentElbowAngle(Math.sin((50 * Math.PI) / 180))).toBeCloseTo(100, 1);
    expect(equivalentElbowAngle(Math.sin(Math.PI / 3))).toBeCloseTo(120, 1);
    // 1 % of noise at the top changes the value by less than 5°.
    expect(180 - equivalentElbowAngle(0.99)).toBeLessThan(5);
    expect(equivalentElbowAngle(0)).toBe(0);
  });

  test.each([
    ['tucked elbows (mostly toward the camera)', 0.2],
    ['flared elbows', 0.9],
  ])('counts full repetitions – %s', (_name, flare) => {
    const r = analyze('pushup', 'standard', seq(fullReps(5, { topDeg: 172, bottomDeg: 80 }), { flare }));
    expect(r.result.counts?.detected).toBe(5);
    expect(r.result.counts?.targetReached).toBe(5);
  });

  test('half repetitions are cycles with the target missed, not counted as full', () => {
    const r = analyze('pushup', 'standard', seq(fullReps(4, { topDeg: 172, bottomDeg: 128 })));
    expect(r.result.counts?.targetReached).toBe(0);
    expect(r.result.counts?.detected).toBe(4);
    expect(r.result.counts?.targetMissed).toBe(4);
  });

  test('works with MoveNet scores and other body proportions', () => {
    const r = analyze(
      'pushup',
      'standard',
      seq(fullReps(4, { topDeg: 170, bottomDeg: 78 }), { source: 'movenet', body: scaledBody(1.3, { forearm: 80 }), noisePx: 1.5, seed: 7 }),
    );
    expect(r.result.counts?.targetReached).toBe(4);
  });

  test('after moving further from the phone the straight-arm reference adapts', () => {
    const near = seq(fullReps(3, { topDeg: 172, bottomDeg: 80 }), { body: scaledBody(1.3) });
    const far = seq(fullReps(3, { topDeg: 172, bottomDeg: 80 }), { body: scaledBody(0.95), seed: 3 });
    // The person leaves the picture for ~3 s and comes back further away.
    const t0 = near[near.length - 1].timestamp + 3000;
    const poses = [...near, ...far.map((p) => ({ ...p, timestamp: p.timestamp + t0 }))];
    const r = analyze('pushup', 'standard', poses);
    expect(r.result.counts?.targetReached).toBe(6);
  });

  test('calibration accepts the straight-arm start position', () => {
    const { result } = calibrate('pushup', 'standard', seq([{ topDeg: 172, bottomDeg: 172, durationMs: 3000 }]));
    expect(result).not.toBeNull();
    expect(result!.rest).toBeGreaterThan(160);
  });

  test('standing with the arms hanging is not the push-up start and counts nothing', () => {
    const poses = generateSequence({
      exercise: 'pushup',
      reps: [{ topDeg: 170, bottomDeg: 170, durationMs: 4000 }],
      skeletonFn: standingFrontSkeleton,
      source: 'mediapipe',
      imageWidth: 480,
      imageHeight: 640,
    });
    expect(calibrate('pushup', 'standard', poses).result).toBeNull();
    expect(analyze('pushup', 'standard', poses).result.counts?.detected).toBe(0);
  });

  test('standing in front of the phone, then going down into push-ups: only the push-ups count', () => {
    const stand = generateSequence({
      exercise: 'pushup',
      reps: [{ topDeg: 170, bottomDeg: 170, durationMs: 3000 }],
      skeletonFn: standingFrontSkeleton,
      source: 'mediapipe',
      imageWidth: 480,
      imageHeight: 640,
      noisePx: 1,
    });
    const push = seq(fullReps(5, { topDeg: 170, bottomDeg: 85 }), { seed: 5 });
    const t0 = stand[stand.length - 1].timestamp + 1200; // ~1 s getting down (not in view)
    const r = analyze('pushup', 'standard', [...stand, ...push.map((p) => ({ ...p, timestamp: p.timestamp + t0 }))]);
    expect(r.result.counts?.detected).toBe(5);
    expect(r.result.counts?.targetReached).toBe(5);
  });

  test('side view with the far arm flickering in and out: every repetition still counts', () => {
    const poses = generateSequence({
      exercise: 'pushup',
      reps: fullReps(5, { topDeg: 172, bottomDeg: 80 }),
      skeletonFn: front(0.5),
      source: 'movenet',
      imageWidth: 480,
      imageHeight: 640,
      noisePx: 1,
      hide: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ kps: ['rightWrist', 'rightShoulder'], fromMs: 1500 + k * 1100, toMs: 1500 + k * 1100 + 500 })),
    });
    const r = analyze('pushup', 'standard', poses);
    expect(r.result.counts?.targetReached).toBe(5);
    expect(r.result.counts?.unevaluable).toBe(0);
  });
});

