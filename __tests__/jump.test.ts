import { analyze } from '../src/testing/run';
import { generateSequence, jumpKeyframes, scaledBody, toeRaiseSkeleton, type SequenceOptions } from '../src/testing/synthetic';

/** Leg length of the default body (thigh + shin), px. */
const LEG = 165;
const jumps = (n: number, h: number, hz: number, extra: Partial<SequenceOptions> = {}) =>
  generateSequence({ exercise: 'jumprope', reps: [], keyframes: jumpKeyframes(n, h * LEG, hz), noisePx: 1, seed: 5, source: 'mediapipe', ...extra });
const run = (poses: ReturnType<typeof jumps>) => analyze('jumprope', 'basic', poses);

describe('rope jumps (basic two-foot)', () => {
  test.each([
    ['typical, 2.5 Hz, 30 fps', 0.05, 2.5, 30],
    ['low jumps', 0.035, 2.5, 30],
    ['high and slow', 0.1, 1.5, 30],
    ['fast 3 Hz', 0.05, 3, 30],
    ['15 fps', 0.05, 2.5, 15],
    ['60 fps', 0.05, 2.5, 60],
  ])('one count per jump: %s', (_n, h, hz, fps) => {
    const r = run(jumps(20, h, hz, { fps }));
    expect(r.result.jump!.jumps).toBe(20);
    expect(r.result.jump!.evaluation).toBe('full');
    expect(r.result.jump!.withToes).toBe(20);
  });

  test('toe raises (heels up, toes on the ground) are not jumps', () => {
    const r = run(jumps(10, 0.06, 1.5, { skeletonFn: toeRaiseSkeleton }));
    expect(r.result.jump!.jumps).toBe(0);
    expect(r.result.jump!.toeRaises).toBeGreaterThanOrEqual(8);
  });

  test('standing still with jitter: no jumps', () => {
    const r = run(generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [15000, 0]], noisePx: 1.5, seed: 9, source: 'mediapipe' }));
    expect(r.result.jump!.jumps).toBe(0);
  });

  test('stepping away from the camera (slow drift) is not a jump', () => {
    const r = run(generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [1000, 0], [5000, 60], [8000, 60]], noisePx: 1, source: 'mediapipe' }));
    expect(r.result.jump!.jumps).toBe(0);
  });

  test('without toe points (MoveNet) jumps are counted but the evaluation is limited', () => {
    const poses = jumps(15, 0.12, 2, { source: 'movenet', noisePx: 2 });
    const r = run(poses);
    expect(r.result.jump!.jumps).toBe(15);
    expect(r.result.jump!.evaluation).toBe('limited_no_toes');
    expect(r.result.jump!.anklesOnly).toBe(15);
    expect(r.result.notAssessable.join(' ')).toMatch(/wspięcia na palce/);
  });

  test('one foot hidden: counted with a one-foot (limited) status and a setup hint', () => {
    const r = run(jumps(15, 0.05, 2.5, { hide: [{ kps: ['rightAnkle', 'rightKnee', 'rightHip', 'rightToe', 'rightHeel'] }] }));
    expect(r.result.jump!.jumps).toBe(15);
    expect(r.result.jump!.evaluation).toBe('limited_one_foot');
    expect(r.snaps.some((s) => s.hint?.id === 'feet')).toBe(true);
  });

  test('rhythm, active time, pauses and regularity', () => {
    const a = jumpKeyframes(20, 0.05 * LEG, 2.5, 1000, 0);
    const end = a[a.length - 1][0];
    const b = jumpKeyframes(20, 0.05 * LEG, 2.5, 3000, 1000).map(([t, v]) => [t + end, v] as [number, number]);
    const r = run(generateSequence({ exercise: 'jumprope', reps: [], keyframes: [...a, ...b], noisePx: 1, seed: 2, source: 'mediapipe' }));
    const s = r.result.jump!;
    expect(s.jumps).toBe(40);
    expect(s.pauses).toBe(1);
    expect(s.perMinute!).toBeGreaterThan(140);
    expect(s.perMinute!).toBeLessThan(160);
    expect(s.irregularity!).toBeLessThan(0.1);
  });

  test('leaving the frame: no counting from stale points; coming back adds nothing', () => {
    const r = run(jumps(20, 0.05, 2.5, { dropouts: [{ fromMs: 4000, toMs: 6000 }] }));
    expect(r.snaps.some((s) => s.state === 'TRACKING_LOST')).toBe(true);
    expect(r.result.jump!.jumps).toBeGreaterThanOrEqual(13);
    expect(r.result.jump!.jumps).toBeLessThanOrEqual(15);
  });

  test('different body sizes', () => {
    for (const s of [0.6, 1.3]) {
      const r = run(generateSequence({ exercise: 'jumprope', reps: [], keyframes: jumpKeyframes(12, 0.05 * LEG * s, 2.5), body: scaledBody(s), noisePx: 1, seed: 2, source: 'mediapipe' }));
      expect(r.result.jump!.jumps).toBe(12);
    }
  });
});

describe('rope jumps with the MoveNet thresholds (native engine)', () => {
  test('no false jumps at MoveNet-level jitter while standing', () => {
    let falseJumps = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const poses = generateSequence({ exercise: 'jumprope', reps: [], keyframes: [[0, 0], [20000, 0]], noisePx: 4, seed, source: 'movenet' });
      falseJumps += analyze('jumprope', 'basic', poses).result.jump!.jumps;
    }
    expect(falseJumps).toBeLessThanOrEqual(1);
  });
});
