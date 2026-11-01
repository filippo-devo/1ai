import { PLANK } from '../src/counting/config';
import { adaptPlank } from '../src/counting/plankTimer';
import { runCalibration, runPlank } from '../src/testing/run';
import { generateSequence, plankSkeleton, scaledBody, type Body } from '../src/testing/synthetic';
import type { Point } from '../src/pose/types';

const hold = (segments: Array<[number, number]>) => {
  // segments: [durationMs, bodyDeg]; returns keyframes with short transitions.
  const kf: Array<[number, number]> = [];
  let t = 0;
  for (const [dur, deg] of segments) {
    kf.push([t, deg], [t + dur - 100, deg]);
    t += dur;
  }
  return kf;
};

const plank = (keyframes: Array<[number, number]>, extra: Partial<Parameters<typeof generateSequence>[0]> = {}) =>
  generateSequence({ exercise: 'plank', reps: [], keyframes, noisePx: 1.5, seed: 3, ...extra });

describe('plank timer', () => {
  test('counts the time held in a straight plank', () => {
    const r = runPlank(plank(hold([[10000, 176]])));
    expect(r.last.heldMs).toBeGreaterThan(9000);
    expect(r.last.heldMs).toBeLessThanOrEqual(10000);
    expect(r.last.bestMs).toBe(r.last.heldMs);
  });

  test('does not count sagging hips', () => {
    const r = runPlank(plank(hold([[8000, 128]])));
    expect(r.last.heldMs).toBe(0);
  });

  test('pauses while the hips sag and resumes afterwards', () => {
    const r = runPlank(plank(hold([[4000, 176], [3000, 125], [4000, 176]])));
    expect(r.last.heldMs).toBeGreaterThan(6500);
    expect(r.last.heldMs).toBeLessThan(8200);
    expect(r.last.bestMs).toBeLessThan(4100);
  });

  test('jitter does not interrupt a good plank', () => {
    const r = runPlank(plank(hold([[8000, 175]]), { noisePx: 4, seed: 11 }));
    expect(r.last.heldMs).toBeGreaterThan(7000);
  });

  test('no time is counted while the person is out of frame', () => {
    const r = runPlank(plank(hold([[10000, 176]]), { dropouts: [{ fromMs: 3000, toMs: 6000 }] }));
    expect(r.snapshots.some((s) => s.tracking === 'lost')).toBe(true);
    expect(r.last.heldMs).toBeGreaterThan(5500);
    expect(r.last.heldMs).toBeLessThan(7100);
  });

  test('lying flat on the floor is not a plank', () => {
    const lying = (deg: number, body: Body, origin: Point) => {
      const sk = plankSkeleton(deg, body, origin);
      // Lower the upper body onto the floor.
      const out: typeof sk = {};
      for (const [k, p] of Object.entries(sk)) if (p) out[k as keyof typeof sk] = { x: p.x, y: Math.max(p.y, origin.y - 4) };
      out.leftElbow = { x: origin.x - 20, y: origin.y + 2 };
      return out;
    };
    expect(runPlank(plank(hold([[6000, 176]]), { skeletonFn: lying })).last.heldMs).toBe(0);
  });

  test('standing upright is not a plank', () => {
    const standing = (deg: number, body: Body, origin: Point) => {
      const sk = plankSkeleton(deg, body, origin);
      const out: typeof sk = {};
      for (const [k, p] of Object.entries(sk)) if (p) out[k as keyof typeof sk] = { x: origin.x + (p.y - origin.y) * 0.3, y: origin.y - (origin.x - p.x) * 0.9 };
      return out;
    };
    expect(runPlank(plank(hold([[6000, 176]]), { skeletonFn: standing })).last.heldMs).toBe(0);
  });

  test.each([
    ['small (far away)', scaledBody(0.6)],
    ['large (close)', scaledBody(1.3)],
  ])('works for different body sizes: %s', (_n, body) => {
    expect(runPlank(plank(hold([[6000, 176]]), { body })).last.heldMs).toBeGreaterThan(5000);
  });

  test('calibration lowers the threshold for a slightly piked/sagged but steady plank', () => {
    const deg = PLANK.bodyEnterDeg - 3;
    expect(runPlank(plank(hold([[6000, deg]]))).last.heldMs).toBe(0);
    const calibration = runCalibration('plank', plank(hold([[2500, deg]])));
    expect(calibration).not.toBeNull();
    const cfg = adaptPlank(PLANK, calibration);
    expect(cfg.bodyEnterDeg).toBeLessThan(deg);
    expect(cfg.bodyEnterDeg).toBeGreaterThanOrEqual(PLANK.minBodyEnterDeg);
    expect(runPlank(plank(hold([[6000, deg]])), { calibration }).last.heldMs).toBeGreaterThan(5000);
  });
});
