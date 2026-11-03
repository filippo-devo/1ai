import { CALIBRATION, CYCLIC, type ExerciseId, type VariantId } from '../src/analysis/config';
import { angle, elevation, signedDeviation } from '../src/analysis/geometry';
import { HintEngine } from '../src/analysis/hints';
import { FrameView } from '../src/analysis/landmarks';
import { MetricExtractor } from '../src/analysis/metrics';
import type { Hint } from '../src/analysis/types';
import { analyze, calibrate } from '../src/testing/run';
import {
  absSkeleton,
  fullReps,
  generateSequence,
  kneePushupSkeleton,
  scaledBody,
  type RepSpec,
  type SequenceOptions,
} from '../src/testing/synthetic';

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------
describe('geometry', () => {
  test('angle with the vertex at B; 180° = straight', () => {
    expect(angle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeCloseTo(180);
    expect(angle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(90);
  });
  test('missing point or zero-length segment => unavailable (null), not a made-up angle', () => {
    expect(angle(null, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(angle({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 })).toBeNull();
  });
  test('angles use a common pixel scale (x·width, y·height), not raw normalized values', () => {
    // A right angle in pixels on a 640×480 image.
    const kp = new Array(51).fill(0);
    const set = (i: number, x: number, y: number) => {
      kp[i * 3] = x / 640;
      kp[i * 3 + 1] = y / 480;
      kp[i * 3 + 2] = 0.9;
    };
    set(5, 100, 100); // shoulder
    set(7, 200, 100); // elbow
    set(9, 200, 200); // wrist
    set(11, 0, 110); // hip
    const view = new FrameView({ keypoints: kp, width: 640, height: 480, timestamp: 0 });
    const m = new MetricExtractor('bench', 'standard').extract(view);
    expect(m.values.elbow).toBeCloseTo(90, 5);
  });
  test('signed hip deviation: + below the shoulder–ankle line, − above, independent of facing direction', () => {
    const sh = { x: 100, y: 100 };
    const an = { x: 400, y: 120 };
    const sag = { x: 250, y: 140 };
    const pike = { x: 250, y: 80 };
    expect(signedDeviation(sh, sag, an)!).toBeGreaterThan(0);
    expect(signedDeviation(sh, pike, an)!).toBeLessThan(0);
    // Mirror the scene horizontally (person facing the other way): same sign.
    const m = (p: { x: number; y: number }) => ({ x: 500 - p.x, y: p.y });
    expect(signedDeviation(m(sh), m(sag), m(an))!).toBeGreaterThan(0);
    expect(signedDeviation(m(an), m(pike), m(sh))!).toBeLessThan(0);
  });
  test('trunk elevation vs the floor is direction-agnostic', () => {
    expect(elevation({ x: 0, y: 100 }, { x: 100, y: 100 })).toBeCloseTo(0);
    expect(elevation({ x: 0, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(90);
    expect(elevation({ x: 100, y: 100 }, { x: 50, y: 50 })).toBeCloseTo(45);
  });
});

// ---------------------------------------------------------------------------------------------
// Cyclic exercises
// ---------------------------------------------------------------------------------------------
interface Case {
  ex: ExerciseId;
  variant: VariantId;
  /** Full and partial (target not reached) ranges, in the generator's channel. */
  full: { topDeg: number; bottomDeg: number };
  partial: { topDeg: number; bottomDeg: number };
  seq?: Partial<SequenceOptions>;
  slowFastMs: [number, number];
}

const CASES: Case[] = [
  { ex: 'squat', variant: 'standard', full: { topDeg: 175, bottomDeg: 80 }, partial: { topDeg: 175, bottomDeg: 125 }, slowFastMs: [800, 6000] },
  { ex: 'pushup', variant: 'standard', full: { topDeg: 172, bottomDeg: 80 }, partial: { topDeg: 172, bottomDeg: 125 }, slowFastMs: [700, 6000] },
  {
    ex: 'pushup',
    variant: 'knees',
    full: { topDeg: 172, bottomDeg: 80 },
    partial: { topDeg: 172, bottomDeg: 125 },
    seq: { skeletonFn: kneePushupSkeleton },
    slowFastMs: [700, 6000],
  },
  { ex: 'bench', variant: 'standard', full: { topDeg: 172, bottomDeg: 75 }, partial: { topDeg: 172, bottomDeg: 125 }, seq: { leadInMs: 1500 }, slowFastMs: [1000, 6000] },
  { ex: 'pullup', variant: 'strict', full: { topDeg: 170, bottomDeg: 55 }, partial: { topDeg: 170, bottomDeg: 115 }, slowFastMs: [1000, 7000] },
  // abs channel = trunk elevation above the floor (0 = lying)
  { ex: 'abs', variant: 'crunch', full: { topDeg: 0, bottomDeg: 30 }, partial: { topDeg: 0, bottomDeg: 14 }, seq: { leadInMs: 1200 }, slowFastMs: [700, 5000] },
  { ex: 'abs', variant: 'situp', full: { topDeg: 0, bottomDeg: 75 }, partial: { topDeg: 0, bottomDeg: 45 }, slowFastMs: [1000, 6000] },
];

const seq = (c: Case, reps: RepSpec[], extra: Partial<SequenceOptions> = {}) =>
  generateSequence({ exercise: c.ex, reps, noisePx: 1.5, seed: 7, ...c.seq, ...extra });

describe.each(CASES)('$ex/$variant', (c) => {
  test('full repetitions: every cycle detected and reaches the target', () => {
    const r = analyze(c.ex, c.variant, seq(c, fullReps(5, c.full)));
    expect(r.result.counts).toMatchObject({ detected: 5, targetReached: 5, targetMissed: 0, unevaluable: 0 });
  });

  test('partial repetitions: cycles detected but recorded as "target missed"', () => {
    const r = analyze(c.ex, c.variant, seq(c, [...fullReps(2, c.full), ...fullReps(3, c.partial), ...fullReps(1, c.full)]));
    expect(r.result.counts).toMatchObject({ detected: 6, targetReached: 3, targetMissed: 3 });
    expect(r.result.cycles.filter((x) => x.outcome === 'target_missed').every((x) => x.reasons.includes('range_target_not_reached'))).toBe(true);
  });

  test('standing still with detection jitter: nothing detected', () => {
    const r = analyze(c.ex, c.variant, seq(c, [{ ...c.full, bottomDeg: c.full.topDeg, durationMs: 10000 }], { noisePx: 3 }));
    expect(r.result.counts?.detected).toBe(0);
  });

  test('small oscillations (below minimum amplitude) are not cycles', () => {
    const amp = c.ex === 'abs' && c.variant === 'crunch' ? 5 : 12;
    const dir = c.full.bottomDeg < c.full.topDeg ? -1 : 1;
    const r = analyze(c.ex, c.variant, seq(c, fullReps(15, { topDeg: c.full.topDeg, bottomDeg: c.full.topDeg + dir * amp, durationMs: 600 })));
    expect(r.result.counts?.detected).toBe(0);
  });

  test('smooth repetitions without any pause at the bottom are counted', () => {
    const r = analyze(c.ex, c.variant, seq(c, fullReps(4, { ...c.full, holdTopMs: 0, holdBottomMs: 0, durationMs: 1600 }), { leadInMs: c.seq?.leadInMs ?? 1000 }));
    expect(r.result.counts?.targetReached).toBe(4);
  });

  test('stopping half-way, then continuing to the bottom: one cycle; stopping half-way and returning: target missed', () => {
    const { topDeg, bottomDeg } = c.full;
    const midDeg = (topDeg + bottomDeg) / 2;
    const lead = c.seq?.leadInMs ?? 1000;
    const kf1: [number, number][] = [[0, topDeg], [lead, topDeg], [lead + 600, midDeg], [lead + 2600, midDeg], [lead + 3200, bottomDeg], [lead + 4000, topDeg], [lead + 5000, topDeg]];
    const r1 = analyze(c.ex, c.variant, seq(c, [], { keyframes: kf1 }));
    expect(r1.result.counts).toMatchObject({ detected: 1, targetReached: 1 });
    const kf2: [number, number][] = [[0, topDeg], [lead, topDeg], [lead + 600, midDeg], [lead + 2600, midDeg], [lead + 3200, topDeg], [lead + 4200, topDeg]];
    const r2 = analyze(c.ex, c.variant, seq(c, [], { keyframes: kf2 }));
    expect(r2.result.counts).toMatchObject({ detected: 1, targetReached: 0, targetMissed: 1 });
  });

  test.each([
    ['fast', 0],
    ['very slow', 1],
  ])('%s repetitions', (_n, i) => {
    const r = analyze(c.ex, c.variant, seq(c, fullReps(3, { ...c.full, durationMs: c.slowFastMs[i], holdTopMs: 200, holdBottomMs: 0 })));
    expect(r.result.counts?.targetReached).toBe(3);
  });

  test.each([10, 30, 60])('frame rate %i fps (real timestamps, not frame counts)', (fps) => {
    const r = analyze(c.ex, c.variant, seq(c, fullReps(3, c.full), { fps }));
    expect(r.result.counts?.targetReached).toBe(3);
  });

  test('different image size / aspect ratio and body size', () => {
    const r1 = analyze(c.ex, c.variant, seq(c, fullReps(3, c.full), { imageWidth: 1280, imageHeight: 720, body: scaledBody(1.6) }));
    const r2 = analyze(c.ex, c.variant, seq(c, fullReps(3, c.full), { imageWidth: 720, imageHeight: 1280, body: scaledBody(0.7) }));
    expect(r1.result.counts?.targetReached).toBe(3);
    expect(r2.result.counts?.targetReached).toBe(3);
  });

  test('points lost in the key phase: the cycle is not evaluable, nothing counted from stale points, re-sync needed', () => {
    // 3 reps; hide the person around the bottom of the 2nd rep.
    const reps = fullReps(3, c.full);
    const lead = c.seq?.leadInMs ?? 800;
    const rep2 = lead + 1 * 1900 + 300; // start of the 2nd movement
    const r = analyze(c.ex, c.variant, seq(c, reps, { dropouts: [{ fromMs: rep2 + 550, toMs: rep2 + 1300 }] }));
    expect(r.result.counts?.unevaluable).toBe(1);
    // Bench re-synchronises only after a 1 s stable lockout; the 3rd rep starts after 0.3 s,
    // so it is (correctly) not counted.
    expect(r.result.counts?.targetReached).toBe(c.ex === 'bench' ? 1 : 2);
    const states = r.snaps.map((s) => s.state);
    expect(states).toContain('TRACKING_LOST');
  });

  test('re-appearing in the start position never adds a cycle', () => {
    const top = c.full.topDeg;
    const r = analyze(c.ex, c.variant, seq(c, [{ topDeg: top, bottomDeg: top, durationMs: 8000 }], { dropouts: [{ fromMs: 2000, toMs: 3000 }, { fromMs: 5000, toMs: 6500 }] }));
    expect(r.result.counts?.detected).toBe(0);
  });
});

describe('side handling', () => {
  test('side view with the far side occluded: one side measured, never averaged with the hidden side', () => {
    const c = CASES[0];
    const r = analyze('squat', 'standard', seq(c, fullReps(3, c.full), { hide: [{ kps: ['rightShoulder', 'rightHip', 'rightKnee', 'rightAnkle'] }] }));
    expect(r.result.counts?.targetReached).toBe(3);
    expect(r.result.cycles.every((x) => x.side === 'left')).toBe(true);
  });

  test('pull-up front view with one side hidden: counted and marked one-sided', () => {
    const c = CASES.find((x) => x.ex === 'pullup')!;
    const r = analyze('pullup', 'strict', seq(c, fullReps(3, c.full), { hide: [{ kps: ['rightShoulder', 'rightElbow', 'rightWrist'] }] }));
    expect(r.result.counts?.targetReached).toBe(3);
    expect(r.result.cycles.every((x) => x.oneSided)).toBe(true);
    expect(r.result.cycleSummary?.oneSided).toBe(3);
  });

  test('losing the measured side mid-repetition does not switch sides (no artificial angle jump)', () => {
    const c = CASES.find((x) => x.ex === 'pullup')!;
    const lead = 800;
    // Right side disappears in the middle of the 2nd rep.
    const r = analyze('pullup', 'strict', seq(c, fullReps(3, c.full), { hide: [{ kps: ['rightElbow'], fromMs: lead + 1900 + 900, toMs: lead + 1900 + 1500 }] }));
    // The 2nd rep had both sides at its start: it is not continued on one side.
    const second = r.result.cycles[1];
    expect(second.outcome).toBe('unevaluable');
    expect(r.result.counts?.targetReached).toBe(2);
  });
});

describe('exercise-specific rules', () => {
  test('squat: a deeper user target is recorded separately from cycle detection', () => {
    const c = CASES[0];
    const r = analyze('squat', 'standard', seq(c, fullReps(3, { topDeg: 175, bottomDeg: 92 })), { target: 80 });
    expect(r.result.counts).toMatchObject({ detected: 3, targetReached: 0, targetMissed: 3 });
    const r2 = analyze('squat', 'standard', seq(c, fullReps(3, { topDeg: 175, bottomDeg: 92 })));
    expect(r2.result.counts?.targetReached).toBe(3);
  });

  test('push-up: a knee push-up selected as "standard" is flagged and does not reach the target', () => {
    const c = CASES[1];
    const r = analyze('pushup', 'standard', seq(c, fullReps(3, c.full), { skeletonFn: kneePushupSkeleton }));
    expect(r.result.counts?.detected).toBe(3);
    expect(r.result.counts?.targetReached).toBe(0);
    expect(r.result.cycles.every((x) => x.reasons.includes('variant_knees_detected'))).toBe(true);
  });

  test('bench: un-racking and re-racking (bar moved horizontally) is not counted; counting starts after a stable lockout', () => {
    // Channel = elbow angle; a custom skeleton walks the bar horizontally from the rack.
    const rackShift = (t: number) => (t < 1000 ? 60 * (1 - t / 1000) : t > 8000 ? 60 * Math.min(1, (t - 8000) / 1000) : 0);
    let time = 0;
    const base = CASES.find((x) => x.ex === 'bench')!;
    const poses = generateSequence({
      exercise: 'bench',
      reps: [],
      keyframes: [
        [0, 160], // bar in the rack: arms slightly bent
        [600, 172],
        [2500, 172], // stable lockout
        [3300, 75],
        [4100, 172],
        [4800, 75],
        [5600, 172],
        [8000, 172],
        [8500, 158], // re-rack: slight bend while moving the bar back
        [9300, 160],
      ],
      noisePx: 1,
      skeletonFn: (deg, body, origin) => {
        const sk = require('../src/testing/synthetic').benchSkeleton(deg, body, origin);
        const shift = rackShift(time);
        time += 1000 / 30;
        for (const k of ['leftWrist', 'leftElbow'] as const) sk[k] = { x: sk[k].x + shift, y: sk[k].y };
        return sk;
      },
    });
    void base;
    const r = analyze('bench', 'standard', poses);
    expect(r.result.counts?.detected).toBe(2);
    expect(r.result.counts?.targetReached).toBe(2);
  });

  test('pull-up: chin over the bar is never claimed (no bar/chin detection) and swing is not assessable from the front', () => {
    const c = CASES.find((x) => x.ex === 'pullup')!;
    const r = analyze('pullup', 'strict', seq(c, fullReps(2, c.full)));
    for (const cyc of r.result.cycles) {
      expect(cyc.flags).toContain('chin_over_bar_unverified');
      expect(cyc.flags).toContain('swing_not_assessable');
    }
    expect(r.result.unavailable.join(' ')).toMatch(/Broda nad drążkiem/);
  });

  test('abs: moving only the head is not a repetition', () => {
    const c = CASES.find((x) => x.variant === 'crunch')!;
    const headOnly = (deg: number, body: ReturnType<typeof scaledBody>, origin: { x: number; y: number }) => {
      const sk = absSkeleton(0, body, origin); // trunk stays on the floor
      sk.nose = { x: sk.nose!.x + deg, y: sk.nose!.y - deg * 1.5 };
      return sk;
    };
    const r = analyze('abs', 'crunch', seq(c, fullReps(6, { topDeg: 0, bottomDeg: 30 }), { skeletonFn: headOnly }));
    expect(r.result.counts?.detected).toBe(0);
  });

  test('crunch vs sit-up: a crunch-sized movement is not a sit-up', () => {
    const c = CASES.find((x) => x.variant === 'situp')!;
    const r = analyze('abs', 'situp', seq(c, fullReps(4, { topDeg: 0, bottomDeg: 30 })));
    expect(r.result.counts?.targetReached).toBe(0);
  });
});

describe('calibration', () => {
  test('measures rest, noise and availability; shallow calibration movements never become the target', () => {
    const c = CASES[0];
    // Hold the start position, then 2 shallow controlled movements.
    const poses = seq(c, [{ topDeg: 175, bottomDeg: 175, durationMs: 1500 }, ...fullReps(2, { topDeg: 175, bottomDeg: 135 })], { noisePx: 1 });
    const cal = calibrate('squat', 'standard', poses);
    expect(cal.result).not.toBeNull();
    expect(Math.abs(cal.result!.rest - 175)).toBeLessThan(2);
    expect(cal.result!.noise).toBeLessThan(CALIBRATION.maxStd);
    expect(cal.result!.availability).toBeGreaterThan(0.9);
    expect(cal.range).toMatchObject({ cycles: 2 });
    expect(cal.range!.extreme).toBeLessThan(145);
    // The target stays the configured one (100°), not the shallow measured range.
    const r = analyze('squat', 'standard', seq(c, fullReps(2, { topDeg: 175, bottomDeg: 130 })), { calibration: cal.result, measuredRange: cal.range });
    expect(r.result.target).toBe(CYCLIC['squat/standard'].target);
    expect(r.result.counts?.targetReached).toBe(0);
    expect(r.result.measuredRange?.cycles).toBe(2);
  });

  test('individual extension: a person who cannot fully extend still gets a READY state', () => {
    const c = CASES[0];
    const top = 160; // below the default 165° top threshold
    const reps = fullReps(3, { topDeg: top, bottomDeg: 85 });
    expect(analyze('squat', 'standard', seq(c, reps)).result.counts?.detected).toBe(0);
    const cal = calibrate('squat', 'standard', seq(c, [{ topDeg: top, bottomDeg: top, durationMs: 2000 }], { noisePx: 1 }));
    expect(analyze('squat', 'standard', seq(c, reps), { calibration: cal.result }).result.counts?.targetReached).toBe(3);
  });
});

describe('hints', () => {
  const tech: Hint = { id: 'line', kind: 'technique', text: 'Utrzymaj ciało w jednej linii' };
  const setup: Hint = { id: 'frame', kind: 'setup', text: 'Ustaw się w kadrze' };

  test('technique hints need a persistent deviation; one hint at a time; setup hints win', () => {
    const h = new HintEngine(700, 1500, 300);
    expect(h.update(0, [tech])).toBeNull();
    expect(h.update(500, [tech])).toBeNull();
    expect(h.update(800, [tech])?.id).toBe('line');
    // A short blip of a setup problem must persist 300 ms…
    expect(h.update(900, [tech, setup])?.id).toBe('line');
    // …then it replaces the technique hint immediately (higher priority).
    expect(h.update(1250, [tech, setup])?.id).toBe('frame');
  });

  test('a deviation shorter than the persistence time never shows a hint', () => {
    const h = new HintEngine(700, 1500, 300);
    for (let t = 0; t < 600; t += 33) expect(h.update(t, [tech])).toBeNull();
    expect(h.update(700, [])).toBeNull();
  });
});
