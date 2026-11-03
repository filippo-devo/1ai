import { computeCropRegion, cropOutputToSquare, FULL_CROP, sampleCrop } from '../src/pose/crop';
import { MEDIAPIPE_LANDMARKS, mediapipeToCoco } from '../src/pose/mediapipe';
import { webMessageToPose } from '../src/pose/web/messages';
import { decodeMoveNet, squareToUpright, uprightSize, uprightToRawFrame } from '../src/pose/movenet';

const kpArray = (fill: (i: number) => [number, number, number]) => {
  const a: number[] = [];
  for (let i = 0; i < 17; i++) a.push(...fill(i));
  return a;
};

describe('letterbox (Resizer scaleMode "contain") mapping', () => {
  test('landscape 640x480: horizontal bars at top and bottom', () => {
    // content height = 480/640 = 0.75 of the square, offset 0.125
    const sq = kpArray(() => [0.5, 0.125, 0.9]);
    sq[3] = 0;
    sq[4] = 0.875; // keypoint 1 at bottom edge of content
    const up = squareToUpright(sq, 640, 480);
    expect(up[0]).toBeCloseTo(0.5);
    expect(up[1]).toBeCloseTo(0);
    expect(up[3]).toBeCloseTo(0);
    expect(up[4]).toBeCloseTo(1);
    expect(up[2]).toBeCloseTo(0.9);
  });

  test('portrait 480x640: vertical bars left and right', () => {
    const sq = kpArray(() => [0.125, 0.5, 0.9]);
    const up = squareToUpright(sq, 480, 640);
    expect(up[0]).toBeCloseTo(0);
    expect(up[1]).toBeCloseTo(0.5);
  });

  test('points predicted inside the black bars get score 0', () => {
    const sq = kpArray(() => [0.5, 0.05, 0.9]); // y=0.05 is in the top bar for landscape
    const up = squareToUpright(sq, 640, 480);
    expect(up[2]).toBe(0);
  });

  test('decodeMoveNet swaps the model (y, x) order', () => {
    const out = kpArray(() => [0.25, 0.75, 0.6]); // y=0.25, x=0.75 on a square image
    const up = decodeMoveNet(out, 500, 500);
    expect(up[0]).toBeCloseTo(0.75);
    expect(up[1]).toBeCloseTo(0.25);
  });
});

describe('frame orientation', () => {
  test('sideways frames swap width/height', () => {
    expect(uprightSize(640, 480, 'up')).toEqual({ width: 640, height: 480 });
    expect(uprightSize(640, 480, 'right')).toEqual({ width: 480, height: 640 });
    expect(uprightSize(640, 480, 'left')).toEqual({ width: 480, height: 640 });
    expect(uprightSize(640, 480, 'down')).toEqual({ width: 640, height: 480 });
  });

  test('upright -> raw mapping matches the Resizer shader and is a bijection on corners', () => {
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    for (const o of ['up', 'right', 'down', 'left'] as const) {
      for (const mirrored of [false, true]) {
        const mapped = corners.map(([u, v]) => uprightToRawFrame(u, v, o, mirrored));
        const keys = new Set(mapped.map((p) => `${p.x},${p.y}`));
        expect(keys.size).toBe(4);
        for (const p of mapped) {
          expect([0, 1]).toContain(p.x);
          expect([0, 1]).toContain(p.y);
        }
      }
    }
    expect(uprightToRawFrame(0.2, 0.3, 'up', false)).toEqual({ x: 0.2, y: 0.3 });
    expect(uprightToRawFrame(0.2, 0.3, 'up', true)).toEqual({ x: 0.8, y: 0.3 });
    // shader: rotationDegrees 90 ('right') -> inverse 270 -> (v, 1-u)
    expect(uprightToRawFrame(0.2, 0.3, 'right', false)).toEqual({ x: 0.3, y: 0.8 });
    // 'left' (270) -> inverse 90 -> (1-v, u)
    const l = uprightToRawFrame(0.2, 0.3, 'left', false);
    expect(l.x).toBeCloseTo(0.7);
    expect(l.y).toBeCloseTo(0.2);
    const d = uprightToRawFrame(0.2, 0.3, 'down', false);
    expect(d.x).toBeCloseTo(0.8);
    expect(d.y).toBeCloseTo(0.7);
  });
});

describe('smart crop', () => {
  test('falls back to the full image when the torso is not visible', () => {
    expect(computeCropRegion(kpArray(() => [0.5, 0.5, 0.1]))).toEqual(FULL_CROP);
  });

  test('crop is a square centred on the hips that contains the whole body with margin', () => {
    // A standing person roughly in the middle of the square.
    const kp = kpArray((i) => {
      const y = 0.3 + (i / 16) * 0.4; // head 0.3 .. ankles 0.7
      return [0.5 + (i % 2 ? 0.03 : -0.03), y, 0.8];
    });
    const c = computeCropRegion(kp);
    expect(c.size).toBeGreaterThan(0);
    expect(c.size).toBeLessThan(1);
    for (let i = 0; i < 17; i++) {
      expect(kp[i * 3]).toBeGreaterThan(c.x);
      expect(kp[i * 3]).toBeLessThan(c.x + c.size);
      expect(kp[i * 3 + 1]).toBeGreaterThan(c.y);
      expect(kp[i * 3 + 1]).toBeLessThan(c.y + c.size);
    }
    const cx = (kp[11 * 3] + kp[12 * 3]) / 2;
    expect(c.x + c.size / 2).toBeCloseTo(cx);
  });

  test('crop output maps back to square coordinates', () => {
    const crop = { x: 0.2, y: 0.1, size: 0.5 };
    const sq = cropOutputToSquare(kpArray(() => [0.5, 1, 0.7]), crop); // y=0.5, x=1 in crop
    expect(sq[0]).toBeCloseTo(0.7);
    expect(sq[1]).toBeCloseTo(0.35);
    expect(sq[2]).toBeCloseTo(0.7);
  });

  test('nearest-neighbour sampling: full crop picks every 2nd pixel, outside is black', () => {
    const S = 8;
    const src = new Uint8Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) src.set([x * 10, y * 10, 7], (y * S + x) * 3);
    const dst = new Uint8Array(4 * 4 * 3);
    sampleCrop(src, S, FULL_CROP, dst, 4);
    // dst pixel (col 1, row 2) <- src (floor(1.5/4*8)=3, floor(2.5/4*8)=5)
    expect(Array.from(dst.slice((2 * 4 + 1) * 3, (2 * 4 + 1) * 3 + 3))).toEqual([30, 50, 7]);

    const out = new Uint8Array(4 * 4 * 3).fill(99);
    sampleCrop(src, S, { x: -0.5, y: 0, size: 1 }, out, 4); // left half outside the image
    expect(Array.from(out.slice(0, 3))).toEqual([0, 0, 0]);
    // col 3 -> x = floor((-0.5 + 3.5/4) * 8) = 3, row 0 -> y = floor(0.5/4 * 8) = 1
    expect(Array.from(out.slice(3 * 3, 3 * 3 + 3))).toEqual([30, 10, 7]);
  });
});

describe('MediaPipe (Expo Go engine) -> COCO keypoints', () => {
  test('maps the 17 COCO keypoints from the 33 MediaPipe landmarks', () => {
    const lm: number[] = [];
    for (let i = 0; i < MEDIAPIPE_LANDMARKS; i++) lm.push(i / 100, i / 50, 0.9);
    const coco = mediapipeToCoco(lm);
    expect(coco).toHaveLength(51);
    // left_shoulder (COCO 5) <- MediaPipe 11, right_ankle (COCO 16) <- MediaPipe 28
    expect(coco.slice(15, 18)).toEqual([0.11, 0.22, 0.9]);
    expect(coco.slice(48, 51)).toEqual([0.28, 0.56, 0.9]);
  });

  test('visibility is clamped to 0..1 and NaN becomes 0', () => {
    const lm = new Array(MEDIAPIPE_LANDMARKS * 3).fill(0.5);
    lm[0 * 3 + 2] = 1.7;
    lm[11 * 3 + 2] = Number.NaN;
    const coco = mediapipeToCoco(lm);
    expect(coco[2]).toBe(1);
    expect(coco[5 * 3 + 2]).toBe(0);
  });

  test('a frame without a person becomes a pose with all scores 0', () => {
    const p = webMessageToPose({ t: 10, w: 640, h: 480, lm: null });
    expect(p.keypoints).toHaveLength(51);
    expect(p.keypoints.every((v) => v === 0)).toBe(true);
    expect(p).toMatchObject({ width: 640, height: 480, timestamp: 10 });
  });
});

describe('MediaPipe foot landmarks (heels, toes)', () => {
  test('are passed to Pose.feet in [left_heel, right_heel, left_toe, right_toe] order; MoveNet poses have none', () => {
    const lm = new Array(33 * 3).fill(0).map((_, i) => (i % 3 === 2 ? 0.9 : i / 1000));
    const p = webMessageToPose({ t: 0, w: 640, h: 480, lm });
    expect(p.source).toBe('mediapipe');
    expect(p.feet).toHaveLength(12);
    expect(p.feet![0]).toBeCloseTo((29 * 3) / 1000);
    expect(p.feet![9]).toBeCloseTo((32 * 3) / 1000);
  });
});
