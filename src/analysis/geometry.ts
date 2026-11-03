import { MIN_SEGMENT_PX } from './config';

export interface P {
  x: number;
  y: number;
}

/**
 * Angle ABC in degrees with the vertex at B:
 *   acos(clamp(dot(A−B, C−B) / (|A−B|·|C−B|), −1, 1))
 * Returns null (unavailable) for a missing point or a zero-length segment —
 * never a made-up angle. 180° = fully extended.
 * Points must be in a common (isotropic) scale, e.g. pixels (x·width, y·height).
 */
export function angle(a: P | null, b: P | null, c: P | null): number | null {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (!(n1 >= MIN_SEGMENT_PX) || !(n2 >= MIN_SEGMENT_PX)) return null;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function dist(a: P | null, b: P | null): number | null {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Elevation of the segment from → to above the horizontal, in degrees (−90…90):
 * positive when `to` is higher in the image than `from`. Independent of whether the
 * person faces left or right. Assumes an upright camera (gravity = image down).
 * Example: trunk hip → shoulder: 0° lying flat, 90° sitting upright.
 */
export function elevation(from: P | null, to: P | null): number | null {
  if (!from || !to) return null;
  const dx = Math.abs(to.x - from.x);
  const up = from.y - to.y;
  if (Math.hypot(dx, up) < MIN_SEGMENT_PX) return null;
  return (Math.atan2(up, dx) * 180) / Math.PI;
}

/** Inclination of a segment to the horizontal, folded to 0…90° (direction-agnostic). */
export function inclination(a: P | null, b: P | null): number | null {
  if (!a || !b) return null;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (Math.hypot(dx, dy) < MIN_SEGMENT_PX) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Signed distance of `p` from the line a → b, divided by |ab| (body length).
 * Positive = below the line (toward the floor: e.g. sagging hips),
 * negative = above the line (raised hips). The sign uses the image "down"
 * direction, so it does not depend on which side the person faces.
 */
export function signedDeviation(a: P | null, p: P | null, b: P | null): number | null {
  if (!a || !p || !b) return null;
  const lx = b.x - a.x;
  const ly = b.y - a.y;
  const len = Math.hypot(lx, ly);
  if (len < MIN_SEGMENT_PX) return null;
  // Unit normal; choose the one pointing down the image (y > 0).
  let nx = -ly / len;
  let ny = lx / len;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return ((p.x - a.x) * nx + (p.y - a.y) * ny) / len;
}

export function mid(a: P | null, b: P | null): P | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1));
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}
