/**
 * Replays MoveNet outputs recorded from REAL exercise videos through the app's
 * own decode + feature + counting code.
 *
 * Fixtures are produced by scripts/verify/extract_movenet.py (which mirrors
 * the app's Resizer -> smart crop -> MoveNet pipeline) and are not committed
 * (third-party videos). When they are missing these tests are skipped.
 * See scripts/verify/README.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RepExerciseId as ExerciseId } from '../src/counting/config';
import { computeCropRegion } from '../src/pose/crop';
import { squareToUpright } from '../src/pose/movenet';
import type { Pose } from '../src/pose/types';
import { runCounter } from '../src/testing/run';
import { webMessageToPose } from '../src/pose/web/messages';

interface Fixture {
  width: number;
  height: number;
  fps: number;
  frames: Array<{ t: number; crop: [number, number, number]; square: number[] }>;
}

const DIR = path.join(__dirname, '..', 'fixtures', 'real');

/** Ground truth counted by hand from the videos (see scripts/verify/README.md). */
const CASES: Array<{ file: string; exercise: ExerciseId; reps: number }> = [
  { file: 'pushups.json', exercise: 'pushup', reps: 4 },
  { file: 'pushups_every3.json', exercise: 'pushup', reps: 4 },
  { file: 'squats.json', exercise: 'squat', reps: 4 },
  { file: 'squats_every3.json', exercise: 'squat', reps: 4 },
  { file: 'pullups.json', exercise: 'pullup', reps: 4 },
  { file: 'pullups_every3.json', exercise: 'pullup', reps: 4 },
];

function loadFixture(file: string): Fixture | null {
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as Fixture) : null;
}

function toPoses(fx: Fixture): Pose[] {
  return fx.frames.map((f) => ({
    keypoints: squareToUpright(f.square, fx.width, fx.height),
    width: fx.width,
    height: fx.height,
    timestamp: f.t,
  }));
}

describe.each(CASES)('real video $file', ({ file, exercise, reps }) => {
  const fx = loadFixture(file);
  const maybe = fx ? test : test.skip;

  maybe(`counts ${reps} ${exercise} repetitions`, () => {
    const r = runCounter(exercise, toPoses(fx!));
    if (process.env.REPLAY_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(
        r.snapshots
          .map(
            (s, i) =>
              `${i}\t${s.phase}\t${s.angle.toFixed(0)}\t${s.disp.toFixed(2)}\t${s.confidence.toFixed(2)}\t${s.tracking}\t${s.reps}`,
          )
          .join('\n'),
      );
    }
    expect(r.reps).toBe(reps);
  });

  maybe('TypeScript crop logic reproduces the crops used during extraction', () => {
    for (let i = 1; i < fx!.frames.length; i++) {
      const c = computeCropRegion(fx!.frames[i - 1].square);
      const [x, y, size] = fx!.frames[i].crop;
      expect(c.x).toBeCloseTo(x, 4);
      expect(c.y).toBeCloseTo(y, 4);
      expect(c.size).toBeCloseTo(size, 4);
    }
  });
});

describe('real video with simulated occlusion', () => {
  const fx = loadFixture('pushups.json');
  const maybe = fx ? test : test.skip;

  maybe('person hidden during the 3rd push-up: only that repetition is lost', () => {
    const poses = toPoses(fx!).map((p, i) =>
      i >= 150 && i < 180 ? { ...p, keypoints: p.keypoints.map((v, k) => (k % 3 === 2 ? 0 : v)) } : p,
    );
    const r = runCounter('pushup', poses);
    expect(r.events.some((e) => e.type === 'reset_lost')).toBe(true);
    expect(r.reps).toBe(3);
  });
});

/**
 * Expo Go path: MediaPipe Pose Landmarker landmarks (same model as the WebView page),
 * produced by scripts/verify/extract_mediapipe.py in the format the WebView posts.
 */
interface WebPoseMessage {
  t: number;
  w: number;
  h: number;
  lm: number[] | null;
}

function loadWebPoses(file: string): Pose[] | null {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return null;
  const msgs = JSON.parse(fs.readFileSync(p, 'utf8')) as WebPoseMessage[];
  return msgs.map((m) => webMessageToPose(m));
}

const MP_CASES: { file: string; exercise: ExerciseId; reps: number }[] = [
  { file: 'mp_pushups_full.json', exercise: 'pushup', reps: 4 },
  { file: 'mp_pushups_lite.json', exercise: 'pushup', reps: 4 },
  { file: 'mp_pushups_full_every3.json', exercise: 'pushup', reps: 4 },
  { file: 'mp_squats_full.json', exercise: 'squat', reps: 4 },
  { file: 'mp_squats_lite.json', exercise: 'squat', reps: 4 },
  { file: 'mp_squats_full_every3.json', exercise: 'squat', reps: 4 },
];

describe.each(MP_CASES)('Expo Go path (MediaPipe) $file', ({ file, exercise, reps }) => {
  const poses = loadWebPoses(file);
  const maybe = poses ? test : test.skip;
  maybe(`counts ${reps} ${exercise} repetitions`, () => {
    const r = runCounter(exercise, poses!);
    if (process.env.REPLAY_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(
        r.snapshots
          .map((s, i) => `${i}\t${s.phase}\t${s.angle.toFixed(0)}\t${s.disp.toFixed(2)}\t${s.confidence.toFixed(2)}\t${s.tracking}\t${s.reps}`)
          .join('\n'),
      );
    }
    expect(r.reps).toBe(reps);
  });
});
