import { THRESHOLDS, type ExerciseId } from '../src/counting/config';
import { adaptThresholds } from '../src/counting/repCounter';
import { runCalibration, runCounter } from '../src/testing/run';
import {
  AVERAGE_BODY,
  fullReps,
  generateSequence,
  pullupSkeleton,
  pushupSkeleton,
  scaledBody,
  type RepSpec,
} from '../src/testing/synthetic';

/** Typical joint-angle ranges of a correct repetition per exercise. */
const FULL: Record<ExerciseId, { topDeg: number; bottomDeg: number }> = {
  pushup: { topDeg: 172, bottomDeg: 80 },
  squat: { topDeg: 175, bottomDeg: 85 },
  pullup: { topDeg: 170, bottomDeg: 55 },
};
/** Clearly incomplete repetitions (not deep / high enough). */
const HALF: Record<ExerciseId, { topDeg: number; bottomDeg: number }> = {
  pushup: { topDeg: 172, bottomDeg: 120 },
  squat: { topDeg: 175, bottomDeg: 130 },
  pullup: { topDeg: 170, bottomDeg: 120 },
};

const ALL: ExerciseId[] = ['pushup', 'squat', 'pullup'];

describe.each(ALL)('%s', (exercise) => {
  test('counts full repetitions', () => {
    const poses = generateSequence({ exercise, reps: fullReps(5, FULL[exercise]), noisePx: 1.5, seed: 11 });
    const r = runCounter(exercise, poses);
    expect(r.reps).toBe(5);
    expect(r.partials).toBe(0);
    expect(r.events.filter((e) => e.type === 'rep').map((e) => e.reps)).toEqual([1, 2, 3, 4, 5]);
  });

  test('one full cycle = exactly one repetition (counted on return to start, not at the bottom)', () => {
    const poses = generateSequence({ exercise, reps: fullReps(1, FULL[exercise]), leadOutMs: 0 });
    const r = runCounter(exercise, poses);
    expect(r.reps).toBe(1);
    // While at the bottom nothing is counted yet.
    const atTarget = r.snapshots.filter((s) => s.phase === 'target');
    expect(atTarget.length).toBeGreaterThan(0);
    expect(atTarget.every((s) => s.reps === 0)).toBe(true);
  });

  test('does not count incomplete repetitions (reported as partial)', () => {
    const reps: RepSpec[] = [
      ...fullReps(2, FULL[exercise]),
      ...fullReps(3, HALF[exercise]),
      ...fullReps(1, FULL[exercise]),
    ];
    const r = runCounter(exercise, generateSequence({ exercise, reps, noisePx: 1.5, seed: 3 }));
    expect(r.reps).toBe(3);
    expect(r.partials).toBe(3);
  });

  test('ignores jitter while holding the start position', () => {
    const poses = generateSequence({
      exercise,
      reps: [{ ...FULL[exercise], bottomDeg: FULL[exercise].topDeg, durationMs: 10000 }],
      noisePx: 4,
      seed: 5,
    });
    expect(runCounter(exercise, poses).reps).toBe(0);
  });

  test('ignores small oscillations (tremor) around the start position', () => {
    // 20 tiny "reps" of only 12 degrees.
    const reps = fullReps(20, { topDeg: FULL[exercise].topDeg, bottomDeg: FULL[exercise].topDeg - 12, durationMs: 500 });
    const r = runCounter(exercise, generateSequence({ exercise, reps, noisePx: 2, seed: 9 }));
    expect(r.reps).toBe(0);
    expect(r.partials).toBe(0);
  });

  test('ignores small oscillations while at the bottom (one rep only)', () => {
    const { topDeg, bottomDeg } = FULL[exercise];
    const keyframes: Array<[number, number]> = [
      [0, topDeg],
      [800, topDeg],
      [1600, bottomDeg],
    ];
    // Bounce 6x by +/-10 degrees at the bottom.
    let t = 1600;
    for (let i = 0; i < 6; i++) {
      keyframes.push([(t += 200), bottomDeg + 10], [(t += 200), bottomDeg]);
    }
    keyframes.push([(t += 800), topDeg], [(t += 800), topDeg]);
    const r = runCounter(exercise, generateSequence({ exercise, reps: [], keyframes, noisePx: 1.5, seed: 4 }));
    expect(r.reps).toBe(1);
  });

  test('a bottom "bounce" that comes up only half way and goes down again is still one rep', () => {
    const { topDeg, bottomDeg } = FULL[exercise];
    const midDeg = (topDeg + bottomDeg) / 2;
    const keyframes: Array<[number, number]> = [
      [0, topDeg],
      [800, topDeg],
      [1600, bottomDeg],
      [2200, midDeg],
      [2800, bottomDeg],
      [3600, topDeg],
      [4400, topDeg],
    ];
    expect(runCounter(exercise, generateSequence({ exercise, reps: [], keyframes, noisePx: 1 })).reps).toBe(1);
  });

  test('rejects single-frame outliers (spikes) at the start position', () => {
    const poses = generateSequence({
      exercise,
      reps: [{ ...FULL[exercise], bottomDeg: FULL[exercise].topDeg, durationMs: 4000 }],
      spikes: [
        { atMs: 1500, kp: 'leftElbow', dx: 60, dy: 60 },
        { atMs: 2500, kp: 'leftKnee', dx: 70, dy: -40 },
        { atMs: 3200, kp: 'leftWrist', dx: -50, dy: 50 },
      ],
    });
    expect(runCounter(exercise, poses).reps).toBe(0);
  });

  test.each([
    ['fast', exercise === 'pullup' ? 1000 : 700, 30],
    ['slow', 5000, 30],
    ['low fps', 1500, 10],
    ['high fps', 1200, 60],
  ])('handles tempo: %s', (_name, durationMs, fps) => {
    const reps = fullReps(4, { ...FULL[exercise], durationMs, holdTopMs: 150, holdBottomMs: 50 });
    const r = runCounter(exercise, generateSequence({ exercise, reps, fps, noisePx: 1.5, seed: 21 }));
    expect(r.reps).toBe(4);
  });

  test.each([
    ['far away (small)', scaledBody(0.55)],
    ['close (large)', scaledBody(1.35)],
    ['long arms', scaledBody(1, { upperArm: 72, forearm: 66 })],
    ['short legs, long torso', scaledBody(1, { thigh: 70, shin: 68, torso: 130 })],
  ])('handles body proportions: %s', (_name, body) => {
    const r = runCounter(exercise, generateSequence({ exercise, reps: fullReps(3, FULL[exercise]), body, noisePx: 1, seed: 8 }));
    expect(r.reps).toBe(3);
  });

  test('pauses on lost keypoints and discards the interrupted rep', () => {
    // 3 reps of 1600 ms after an 800 ms lead-in (+300 ms hold each).
    // Rep 2 goes down ~1100..2000 ms after its start; hide the person around its bottom.
    const reps = fullReps(3, FULL[exercise]);
    const rep2Start = 800 + 1 * (300 + 1600) + 300;
    const poses = generateSequence({
      exercise,
      reps,
      dropouts: [{ fromMs: rep2Start + 500, toMs: rep2Start + 1500 }],
      noisePx: 1,
      seed: 2,
    });
    const r = runCounter(exercise, poses);
    expect(r.lostFrames).toBeGreaterThan(0);
    expect(r.reps).toBe(2);
    expect(r.events.some((e) => e.type === 'reset_lost')).toBe(true);
    // No count may happen in the frame where the person re-appears.
    const reappear = r.snapshots.findIndex((s, i) => i > 0 && r.snapshots[i - 1].tracking === 'lost' && s.tracking === 'ok');
    expect(reappear).toBeGreaterThan(0);
    expect(r.snapshots[reappear].reps).toBe(r.snapshots[reappear - 1].reps);
  });

  test('re-detection of the silhouette never adds a repetition', () => {
    // Person disappears in the start position and re-appears in the start position, repeatedly.
    const poses = generateSequence({
      exercise,
      reps: [{ ...FULL[exercise], bottomDeg: FULL[exercise].topDeg, durationMs: 8000 }],
      dropouts: [
        { fromMs: 1000, toMs: 1800 },
        { fromMs: 3000, toMs: 3600 },
        { fromMs: 5000, toMs: 6500 },
      ],
    });
    const r = runCounter(exercise, poses);
    expect(r.lostFrames).toBeGreaterThan(0);
    expect(r.reps).toBe(0);
  });

  test('disappearing at the bottom and re-appearing at the top does not count', () => {
    const { topDeg, bottomDeg } = FULL[exercise];
    // Long hold at the bottom; person vanishes there, comes back standing at the top.
    const poses = generateSequence({
      exercise,
      reps: [{ topDeg, bottomDeg, durationMs: 4000, holdBottomMs: 2000, holdTopMs: 300 }],
      dropouts: [{ fromMs: 800 + 300 + 1200, toMs: 800 + 300 + 3800 }],
    });
    const r = runCounter(exercise, poses);
    expect(r.reps).toBe(0);
  });

  test('a short dropout (2 frames) does not break a valid rep', () => {
    const reps = fullReps(2, FULL[exercise]);
    const poses = generateSequence({
      exercise,
      reps,
      dropouts: [{ fromMs: 1700, toMs: 1760 }],
      noisePx: 1,
    });
    const r = runCounter(exercise, poses);
    expect(r.lostFrames).toBe(0);
    expect(r.reps).toBe(2);
  });

  test('calibration adapts the start threshold to a limited range of motion', () => {
    const base = THRESHOLDS[exercise];
    const limitedTop = base.startEnterDeg - 2; // user cannot fully extend
    const reps = fullReps(3, { topDeg: limitedTop, bottomDeg: FULL[exercise].bottomDeg });
    // Without calibration nothing reaches the start threshold => nothing counted.
    expect(runCounter(exercise, generateSequence({ exercise, reps })).reps).toBe(0);

    const calibPoses = generateSequence({
      exercise,
      reps: [{ topDeg: limitedTop, bottomDeg: limitedTop, durationMs: 2000 }],
      noisePx: 1,
    });
    const calibration = runCalibration(exercise, calibPoses);
    expect(calibration).not.toBeNull();
    expect(Math.abs(calibration!.startAngle - limitedTop)).toBeLessThan(1.5);
    const th = adaptThresholds(base, calibration);
    expect(th.startEnterDeg).toBeLessThan(limitedTop);
    expect(th.startEnterDeg).toBeGreaterThanOrEqual(base.minStartEnterDeg);
    expect(runCounter(exercise, generateSequence({ exercise, reps }), { calibration }).reps).toBe(3);
  });

  test('calibration waits for a still start position with all keypoints visible', () => {
    const { topDeg, bottomDeg } = FULL[exercise];
    // Moving all the time -> never calibrated.
    const moving = generateSequence({ exercise, reps: fullReps(3, { topDeg, bottomDeg, durationMs: 900, holdTopMs: 0 }), leadInMs: 0, leadOutMs: 0 });
    expect(runCalibration(exercise, moving)).toBeNull();
    // Not visible -> never calibrated.
    const hidden = generateSequence({
      exercise,
      reps: [{ topDeg, bottomDeg: topDeg, durationMs: 3000 }],
      dropouts: [{ fromMs: 0, toMs: 99999 }],
    });
    expect(runCalibration(exercise, hidden)).toBeNull();
  });
});

describe('posture gates', () => {
  test('push-up: bending the arms while standing upright is not counted', () => {
    // Same arm movement but the torso is vertical (rotate the push-up skeleton by 90°).
    const poses = generateSequence({
      exercise: 'pushup',
      reps: fullReps(4, FULL.pushup),
      skeletonFn: (deg, body, origin) => {
        const sk = pushupSkeleton(deg, body, origin);
        const out: typeof sk = {};
        for (const [k, p] of Object.entries(sk)) {
          if (!p) continue;
          // Rotate around origin by -90° so the body line becomes vertical.
          const dx = p.x - origin.x;
          const dy = p.y - origin.y;
          out[k as keyof typeof sk] = { x: origin.x + dy * 0.5, y: origin.y - dx * 0.8 - 40 };
        }
        return out;
      },
    });
    expect(runCounter('pushup', poses).reps).toBe(0);
  });

  test('pull-up: hands below the shoulders (not hanging) is not counted', () => {
    const poses = generateSequence({
      exercise: 'pullup',
      reps: fullReps(3, FULL.pullup),
      skeletonFn: (deg, body, origin) => {
        return pullupSkeletonUpsideDown(deg, body, origin);
      },
    });
    expect(runCounter('pullup', poses).reps).toBe(0);
  });
});

/** Pull-up skeleton mirrored vertically: wrists end up below the shoulders. */
function pullupSkeletonUpsideDown(deg: number, body: typeof AVERAGE_BODY, origin: { x: number; y: number }) {
  const sk = pullupSkeleton(deg, body, origin);
  const out: typeof sk = {};
  for (const [k, p] of Object.entries(sk)) {
    if (p) out[k as keyof typeof sk] = { x: p.x, y: origin.y + 400 - (p.y - origin.y) };
  }
  return out;
}

describe('thresholds are consistent', () => {
  test.each(ALL)('%s: hysteresis ordering', (exercise) => {
    const t = THRESHOLDS[exercise];
    expect(t.startExitDeg).toBeLessThan(t.startEnterDeg);
    expect(t.targetExitDeg).toBeGreaterThan(t.targetEnterDeg);
    expect(t.targetExitDeg).toBeLessThan(t.startExitDeg);
    expect(t.auxTargetExit).toBeLessThan(t.auxTargetEnter);
    expect(t.minStartEnterDeg - (t.startEnterDeg - t.startExitDeg)).toBeGreaterThan(t.targetExitDeg);
  });
});
