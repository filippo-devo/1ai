/**
 * MoveNet "smart cropping": instead of always running the 192x192 model on the
 * whole (letterboxed) camera image, run it on a square crop around the person
 * found in the previous frame. This is the cropping algorithm recommended by
 * the MoveNet authors (TF Hub MoveNet tutorial, `determine_crop_region`).
 *
 * Measured on a real side-view push-up video (scripts/verify): frames where a
 * required keypoint fell below the 0.3 score threshold went from 123/254
 * (whole image) to 2/254 (crop) — at the bottom of a push-up the whole-image
 * input is simply too small for the model.
 *
 * Coordinates here are normalized to the letterboxed SQUARE image the Resizer
 * produces (0..1 on both axes, includes the black bars).
 */

export interface CropRegion {
  x: number;
  y: number;
  size: number;
}

export const FULL_CROP: CropRegion = { x: 0, y: 0, size: 1 };

const CROP_SCORE = 0.2;
const L_SH = 5;
const R_SH = 6;
const L_HIP = 11;
const R_HIP = 12;

/**
 * @param kp flat [x, y, score] * 17 in square-normalized coordinates (previous frame).
 * @returns crop for the next frame, or FULL_CROP when the torso is not visible.
 */
export function computeCropRegion(kp: ArrayLike<number>): CropRegion {
  'worklet';
  const s = (i: number) => kp[i * 3 + 2];
  const torsoVisible = (s(L_HIP) > CROP_SCORE || s(R_HIP) > CROP_SCORE) && (s(L_SH) > CROP_SCORE || s(R_SH) > CROP_SCORE);
  if (!torsoVisible) return { x: 0, y: 0, size: 1 };
  const cx = (kp[L_HIP * 3] + kp[R_HIP * 3]) / 2;
  const cy = (kp[L_HIP * 3 + 1] + kp[R_HIP * 3 + 1]) / 2;
  let torsoRange = 0;
  const torso = [L_SH, R_SH, L_HIP, R_HIP];
  for (let j = 0; j < torso.length; j++) {
    const i = torso[j];
    torsoRange = Math.max(torsoRange, Math.abs(cx - kp[i * 3]), Math.abs(cy - kp[i * 3 + 1]));
  }
  let bodyRange = 0;
  for (let i = 0; i < 17; i++) {
    if (s(i) > CROP_SCORE) {
      bodyRange = Math.max(bodyRange, Math.abs(cx - kp[i * 3]), Math.abs(cy - kp[i * 3 + 1]));
    }
  }
  let half = Math.max(torsoRange * 1.9, bodyRange * 1.2);
  half = Math.min(half, Math.max(cx, 1 - cx, cy, 1 - cy));
  if (!(half > 0) || half > 0.5) return { x: 0, y: 0, size: 1 };
  return { x: cx - half, y: cy - half, size: 2 * half };
}

/**
 * Nearest-neighbour sample of `crop` from an interleaved RGB uint8 square image
 * (srcSize x srcSize) into `dst` (dstSize x dstSize x 3). Outside the source -> black.
 * Pure JS so it runs inside the frame worklet; ~37k pixels for 192x192.
 */
export function sampleCrop(
  src: Uint8Array,
  srcSize: number,
  crop: CropRegion,
  dst: Uint8Array,
  dstSize: number,
): void {
  'worklet';
  const xs = new Int32Array(dstSize);
  for (let i = 0; i < dstSize; i++) {
    const v = Math.floor((crop.x + ((i + 0.5) / dstSize) * crop.size) * srcSize);
    xs[i] = v >= 0 && v < srcSize ? v * 3 : -1;
  }
  let d = 0;
  for (let row = 0; row < dstSize; row++) {
    const sy = Math.floor((crop.y + ((row + 0.5) / dstSize) * crop.size) * srcSize);
    if (sy < 0 || sy >= srcSize) {
      for (let k = 0; k < dstSize * 3; k++) dst[d++] = 0;
      continue;
    }
    const rowBase = sy * srcSize * 3;
    for (let col = 0; col < dstSize; col++) {
      const sx = xs[col];
      if (sx < 0) {
        dst[d++] = 0;
        dst[d++] = 0;
        dst[d++] = 0;
      } else {
        const o = rowBase + sx;
        dst[d++] = src[o];
        dst[d++] = src[o + 1];
        dst[d++] = src[o + 2];
      }
    }
  }
}

/** Map model output (y, x, score relative to the crop) to square-normalized [x, y, score] * 17. */
export function cropOutputToSquare(output: ArrayLike<number>, crop: CropRegion): number[] {
  'worklet';
  const res: number[] = new Array(51);
  for (let i = 0; i < 17; i++) {
    res[i * 3] = crop.x + output[i * 3 + 1] * crop.size;
    res[i * 3 + 1] = crop.y + output[i * 3] * crop.size;
    res[i * 3 + 2] = output[i * 3 + 2];
  }
  return res;
}
