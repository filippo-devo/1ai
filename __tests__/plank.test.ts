import { analyze, calibrate } from '../src/testing/run';
import { generateSequence, plankSkeleton, scaledBody, type Body, type SequenceOptions } from '../src/testing/synthetic';
import type { Point } from '../src/pose/types';

const hold = (segments: [number, number][]) => {
  const kf: [number, number][] = [];
  let t = 0;
  for (const [dur, deg] of segments) {
    kf.push([t, deg], [t + dur - 100, deg]);
    t += dur;
  }
  return kf;
};
const plank = (segments: [number, number][], extra: Partial<SequenceOptions> = {}) =>
  generateSequence({ exercise: 'plank', reps: [], keyframes: hold(segments), noisePx: 1.5, seed: 3, ...extra });
const run = (poses: ReturnType<typeof plank>) => analyze('plank', 'standard', poses);

describe('forearm plank', () => {
  test('straight plank: nearly all time evaluable and in tolerance', () => {
    const r = run(plank([[10000, 178]]));
    const s = r.result.plank!;
    expect(s.totalMs).toBeGreaterThan(9800);
    expect(s.inToleranceMs / s.totalMs).toBeGreaterThan(0.95);
    expect(s.longestInToleranceMs).toBe(s.inToleranceMs);
    expect(s.unevaluableMs).toBeLessThan(200);
  });

  test('sagging hips: in position but out of tolerance, with a "hips sag" hint (signed deviation > 0)', () => {
    const r = run(plank([[6000, 150]]));
    const s = r.result.plank!;
    expect(s.positionMs).toBeGreaterThan(5000);
    expect(s.inToleranceMs).toBe(0);
    expect(r.snaps.some((x) => x.hint?.id === 'plank_sag')).toBe(true);
    expect(r.snaps[r.snaps.length - 1].plank!.hipDev!).toBeGreaterThan(0);
  });

  test('raised hips (pike): negative deviation and a "hips too high" hint — also when facing the other way', () => {
    const pike = (deg: number, body: Body, origin: Point) => {
      const sk = plankSkeleton(deg, body, origin); // sagging, then mirrored above the line
      const sh = sk.leftShoulder!;
      const an = sk.leftAnkle!;
      const hp = sk.leftHip!;
      // mirror the hip across the shoulder–ankle line
      const lx = an.x - sh.x;
      const ly = an.y - sh.y;
      const len = Math.hypot(lx, ly);
      const nx = -ly / len;
      const ny = lx / len;
      const d = (hp.x - sh.x) * nx + (hp.y - sh.y) * ny;
      sk.leftHip = { x: hp.x - 2 * d * nx, y: hp.y - 2 * d * ny };
      sk.leftKnee = { x: (sk.leftHip.x + an.x) / 2, y: (sk.leftHip.y + an.y) / 2 };
      return sk;
    };
    const mirror = (fn: typeof pike) => (deg: number, body: Body, origin: Point) => {
      const sk = fn(deg, body, origin);
      const out: typeof sk = {};
      for (const [k, p] of Object.entries(sk)) if (p) out[k as keyof typeof sk] = { x: 640 - p.x, y: p.y };
      return out;
    };
    for (const fn of [pike, mirror(pike)]) {
      const r = run(plank([[6000, 150]], { skeletonFn: fn }));
      expect(r.result.plank!.inToleranceMs).toBe(0);
      expect(r.snaps.some((x) => x.hint?.id === 'plank_pike')).toBe(true);
    }
  });

  test('missing data: no time in tolerance is credited from stale points; the gap is non-evaluable', () => {
    const r = run(plank([[10000, 178]], { dropouts: [{ fromMs: 3000, toMs: 6000 }] }));
    const s = r.result.plank!;
    expect(s.inToleranceMs).toBeLessThan(7100);
    expect(s.inToleranceMs).toBeGreaterThan(6000);
    expect(s.unevaluableMs).toBeGreaterThan(2900);
    expect(s.longestInToleranceMs).toBeLessThan(4100);
  });

  test('a hidden wrist: plank position measured, but the elbow criterion is not assessable (time not evaluable)', () => {
    const r = run(plank([[5000, 178]], { hide: [{ kps: ['leftWrist', 'rightWrist'] }] }));
    const s = r.result.plank!;
    expect(s.positionMs).toBeGreaterThan(4500);
    expect(s.evaluableMs).toBe(0);
    expect(s.inToleranceMs).toBe(0);
  });

  test('jitter does not interrupt a good plank (noise tolerance)', () => {
    const r = run(plank([[8000, 177]], { noisePx: 3, seed: 11 }));
    expect(r.result.plank!.inToleranceMs).toBeGreaterThan(6500);
  });

  test('standing up is not plank time', () => {
    const standing = (deg: number, body: Body, origin: Point) => {
      const sk = plankSkeleton(deg, body, origin);
      const out: typeof sk = {};
      for (const [k, p] of Object.entries(sk)) if (p) out[k as keyof typeof sk] = { x: origin.x + (p.y - origin.y) * 0.3, y: origin.y - (origin.x - p.x) * 0.9 };
      return out;
    };
    const r = run(plank([[6000, 178]], { skeletonFn: standing }));
    expect(r.result.plank!.positionMs).toBe(0);
    expect(r.result.plank!.inToleranceMs).toBe(0);
  });

  test('different body sizes and frame rates', () => {
    for (const [body, fps] of [[scaledBody(0.6), 15], [scaledBody(1.3), 60]] as const) {
      const r = run(plank([[6000, 178]], { body, fps }));
      expect(r.result.plank!.inToleranceMs).toBeGreaterThan(5000);
    }
  });

  test('calibration stores the start body line and noise', () => {
    const cal = calibrate('plank', 'standard', plank([[2500, 176]]));
    expect(cal.result).not.toBeNull();
    expect(Math.abs(cal.result!.rest - 176)).toBeLessThan(3);
  });
});
