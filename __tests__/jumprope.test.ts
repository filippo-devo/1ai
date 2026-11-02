import { JUMP_MOVENET } from '../src/counting/config';
import { JumpCounter } from '../src/counting/jumpCounter';
import { extractFeatures } from '../src/counting/features';
import type { Pose } from '../src/pose/types';
import { generateSequence, jumpKeyframes, scaledBody, type Body } from '../src/testing/synthetic';

/** Leg length of the default body (thigh + shin), px. */
const LEG = 165;

function run(poses: Pose[], config?: typeof JUMP_MOVENET) {
  const c = new JumpCounter({ config });
  const snaps = poses.map((p) => c.update(extractFeatures('jumprope', p), p.timestamp));
  return { jumps: snaps[snaps.length - 1].reps, snaps };
}

const jumps = (n: number, heightFrac: number, hz: number, extra: Partial<Parameters<typeof generateSequence>[0]> = {}) =>
  generateSequence({
    exercise: 'jumprope',
    reps: [],
    keyframes: jumpKeyframes(n, heightFrac * LEG * ((extra.body as Body | undefined)?.shin ?? 80) / 80, hz),
    noisePx: 1.5,
    seed: 5,
    ...extra,
  });

describe('jump rope', () => {
  test.each([
    ['typical (5% of leg length, 2.5 Hz, 30 fps)', 0.05, 2.5, 30],
    ['low jumps (3.5%)', 0.035, 2.5, 30],
    ['high jumps (10%), slow', 0.1, 1.5, 30],
    ['fast (3 Hz)', 0.05, 3, 30],
    ['15 fps', 0.05, 2.5, 15],
  ])('counts every jump: %s', (_n, h, hz, fps) => {
    expect(run(jumps(20, h, hz, { fps })).jumps).toBe(20);
  });

  test('standing still with keypoint jitter is not a jump', () => {
    const poses = generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [10000, 0]], noisePx: 2.5, seed: 9 });
    expect(run(poses).jumps).toBe(0);
  });

  test('tiny bounces (1% of leg length) are not counted', () => {
    expect(run(jumps(15, 0.01, 2.5)).jumps).toBe(0);
  });

  test('moving away from the camera (feet slowly rising in the image) is not a jump', () => {
    const poses = generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [1000, 0], [5000, 60], [8000, 60]], noisePx: 1.5 });
    expect(run(poses).jumps).toBe(0);
  });

  test('different body sizes', () => {
    for (const s of [0.6, 1.3]) {
      const body = scaledBody(s);
      const poses = generateSequence({ exercise: 'jumprope', reps: [], keyframes: jumpKeyframes(12, 0.05 * LEG * s, 2.5), body, noisePx: 1, seed: 2 });
      expect(run(poses).jumps).toBe(12);
    }
  });

  test('leaving the frame stops counting; coming back does not add jumps', () => {
    // 20 jumps; hidden for 2 s in the middle (~5 jumps not seen).
    const poses = jumps(20, 0.05, 2.5, { dropouts: [{ fromMs: 4000, toMs: 6000 }] });
    const r = run(poses);
    expect(r.snaps.some((s) => s.tracking === 'lost')).toBe(true);
    expect(r.jumps).toBeGreaterThanOrEqual(13);
    expect(r.jumps).toBeLessThanOrEqual(15);
  });
});

describe('jump rope with the MoveNet (native) thresholds', () => {
  test('counts clear jumps (10% of leg length)', () => {
    expect(run(jumps(20, 0.1, 2, { noisePx: 3 }), JUMP_MOVENET).jumps).toBe(20);
  });
  test('stays quiet with MoveNet-level jitter while standing', () => {
    let falseJumps = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const poses = generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [30000, 0]], noisePx: 4, seed });
      falseJumps += run(poses, JUMP_MOVENET).jumps;
    }
    expect(falseJumps).toBeLessThanOrEqual(1);
  });
});
