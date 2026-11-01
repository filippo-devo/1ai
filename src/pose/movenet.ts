/**
 * MoveNet SinglePose (TFLite) input/output handling.
 *
 * Verified with the LiteRT interpreter against the bundled model file
 * `movenet_singlepose_lightning_int8_v4.tflite`:
 *   input : uint8   [1, 192, 192, 3]  (RGB, interleaved / NHWC, 0..255)
 *   output: float32 [1, 1, 17, 3]     (y, x, score), y/x normalized to the input image
 *
 * All functions here are plain math so they can run both inside the
 * VisionCamera frame worklet (they carry the 'worklet' directive) and in Jest.
 */

export const MOVENET_INPUT_SIZE = 192;
/** Size of the letterboxed square the Resizer produces; crops are sampled from it. */
export const RESIZER_SIZE = 384;
const NUM_KP = 17;

export type FrameOrientation = 'up' | 'right' | 'down' | 'left';

/** Rotation (degrees) the VisionCamera Resizer applies for a Frame orientation. */
export function orientationToDegrees(orientation: FrameOrientation): number {
  'worklet';
  switch (orientation) {
    case 'right':
      return 90;
    case 'down':
      return 180;
    case 'left':
      return 270;
    default:
      return 0;
  }
}

/** Size of the upright image the Resizer produces from a raw (sensor-oriented) frame. */
export function uprightSize(
  frameWidth: number,
  frameHeight: number,
  orientation: FrameOrientation,
): { width: number; height: number } {
  'worklet';
  const deg = orientationToDegrees(orientation);
  if (deg === 90 || deg === 270) return { width: frameHeight, height: frameWidth };
  return { width: frameWidth, height: frameHeight };
}

/**
 * Convert square-normalized keypoints `[x, y, score] * 17` (coordinates in the
 * letterboxed square, see crop.ts) to coordinates normalized to the upright
 * source image, undoing the Resizer's 'contain' letterboxing (content scaled
 * to fit and centered).
 */
export function squareToUpright(square: ArrayLike<number>, uprightWidth: number, uprightHeight: number): number[] {
  'worklet';
  const longest = Math.max(uprightWidth, uprightHeight);
  const contentW = uprightWidth / longest;
  const contentH = uprightHeight / longest;
  const offX = (1 - contentW) / 2;
  const offY = (1 - contentH) / 2;
  const result: number[] = new Array(NUM_KP * 3);
  for (let i = 0; i < NUM_KP; i++) {
    const x = (square[i * 3] - offX) / contentW;
    const y = (square[i * 3 + 1] - offY) / contentH;
    let score = square[i * 3 + 2];
    // A point predicted inside the black letterbox bars cannot be real.
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) score = 0;
    result[i * 3] = x;
    result[i * 3 + 1] = y;
    result[i * 3 + 2] = score;
  }
  return result;
}

/**
 * Decode raw MoveNet output (y, x, score) that was computed on the WHOLE
 * letterboxed square into the app's upright-normalized `[x, y, score] * 17`.
 */
export function decodeMoveNet(output: ArrayLike<number>, uprightWidth: number, uprightHeight: number): number[] {
  'worklet';
  const square: number[] = new Array(NUM_KP * 3);
  for (let i = 0; i < NUM_KP; i++) {
    square[i * 3] = output[i * 3 + 1];
    square[i * 3 + 1] = output[i * 3];
    square[i * 3 + 2] = output[i * 3 + 2];
  }
  return squareToUpright(square, uprightWidth, uprightHeight);
}

/**
 * Inverse of the Resizer's orientation/mirroring transform: maps a point
 * normalized to the upright image back to a normalized point in the raw Frame
 * buffer. Mirrors the shader logic in react-native-vision-camera-resizer
 * (ResizerKernels.metal: "Map output -> input by undoing rotation before
 * undoing mirroring").
 */
export function uprightToRawFrame(
  u: number,
  v: number,
  orientation: FrameOrientation,
  isMirrored: boolean,
): { x: number; y: number } {
  'worklet';
  const inverse = (360 - orientationToDegrees(orientation)) % 360;
  let x = u;
  let y = v;
  if (inverse === 90) {
    x = 1 - v;
    y = u;
  } else if (inverse === 180) {
    x = 1 - u;
    y = 1 - v;
  } else if (inverse === 270) {
    x = v;
    y = 1 - u;
  }
  if (isMirrored) x = 1 - x;
  return { x, y };
}
