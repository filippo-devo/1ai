import { KP, type Point, type Pose } from '../pose/types';
import { TRACKING, type ExerciseId } from './config';
import { angleDeg, dist, inclinationFromHorizontalDeg } from './geometry';

export type BodyPart = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';

export const BODY_PART_PL: Record<BodyPart, string> = {
  shoulder: 'barki',
  elbow: 'łokcie',
  wrist: 'nadgarstki',
  hip: 'biodra',
  knee: 'kolana',
  ankle: 'kostki',
};

const PART_INDEX: Record<BodyPart, { left: number; right: number }> = {
  shoulder: { left: KP.leftShoulder, right: KP.rightShoulder },
  elbow: { left: KP.leftElbow, right: KP.rightElbow },
  wrist: { left: KP.leftWrist, right: KP.rightWrist },
  hip: { left: KP.leftHip, right: KP.rightHip },
  knee: { left: KP.leftKnee, right: KP.rightKnee },
  ankle: { left: KP.leftAnkle, right: KP.rightAnkle },
};

/** Keypoints that must be visible (on at least one body side) per exercise. */
export const REQUIRED_PARTS: Record<ExerciseId, BodyPart[]> = {
  pushup: ['shoulder', 'elbow', 'wrist', 'hip'],
  squat: ['shoulder', 'hip', 'knee', 'ankle'],
  pullup: ['shoulder', 'elbow', 'wrist'],
  situp: ['shoulder', 'hip', 'knee', 'ankle'],
  bench: ['shoulder', 'elbow', 'wrist', 'hip'],
  jumprope: ['shoulder', 'hip', 'knee', 'ankle'],
  plank: ['shoulder', 'elbow', 'hip', 'ankle'],
};

/**
 * 'best': use the single most confident body side (push-ups are filmed from
 * the side, the far arm is occluded and its keypoints are unreliable).
 * 'average': average both sides when both are visible (front/back views).
 */
const SIDE_STRATEGY: Record<ExerciseId, 'best' | 'average'> = {
  pushup: 'best',
  squat: 'average',
  pullup: 'average',
  situp: 'best',
  bench: 'best',
  jumprope: 'average',
  plank: 'best',
};

export type Side = 'left' | 'right' | 'both';

export interface Features {
  /** All required keypoints visible with enough confidence. */
  valid: boolean;
  /** Required parts not visible (for the "Ustaw się w kadrze" message). */
  missing: BodyPart[];
  /** Mean score of the keypoints used (0..1). */
  confidence: number;
  side: Side | null;
  /** Primary joint angle in degrees (large = start, small = target). */
  primary: number;
  /** Aux position in pixels (see config.ts for what it means per exercise). */
  auxRaw: number;
  /** Segment length in pixels used to normalize aux displacement. */
  scale: number;
  /** +1: displacement = (aux - ref) / scale, -1: displacement = (ref - aux) / scale. */
  auxDirection: 1 | -1;
  postureOk: boolean;
  /** Values shown in debug mode. */
  debug: Record<string, number>;
}

interface SideGeometry {
  shoulder: Point;
  elbow: Point;
  wrist: Point;
  hip: Point;
  knee: Point;
  ankle: Point;
  minScore: number;
  meanScore: number;
}

function kpPoint(pose: Pose, index: number): Point {
  return { x: pose.keypoints[index * 3] * pose.width, y: pose.keypoints[index * 3 + 1] * pose.height };
}

function kpVisible(pose: Pose, index: number, minScore: number): boolean {
  const x = pose.keypoints[index * 3];
  const y = pose.keypoints[index * 3 + 1];
  const s = pose.keypoints[index * 3 + 2];
  return s >= minScore && x >= -0.01 && x <= 1.01 && y >= -0.01 && y <= 1.01;
}

function sideGeometry(pose: Pose, side: 'left' | 'right', parts: BodyPart[]): SideGeometry {
  let minScore = 1;
  let sum = 0;
  for (const p of parts) {
    const s = pose.keypoints[PART_INDEX[p][side] * 3 + 2];
    minScore = Math.min(minScore, s);
    sum += s;
  }
  const g = (p: BodyPart) => kpPoint(pose, PART_INDEX[p][side]);
  return {
    shoulder: g('shoulder'),
    elbow: g('elbow'),
    wrist: g('wrist'),
    hip: g('hip'),
    knee: g('knee'),
    ankle: g('ankle'),
    minScore,
    meanScore: sum / parts.length,
  };
}

function sideVisible(pose: Pose, side: 'left' | 'right', parts: BodyPart[], minScore: number): boolean {
  return parts.every((p) => kpVisible(pose, PART_INDEX[p][side], minScore));
}

function invalid(missing: BodyPart[], confidence: number, auxDirection: 1 | -1): Features {
  return {
    valid: false,
    missing,
    confidence,
    side: null,
    primary: Number.NaN,
    auxRaw: Number.NaN,
    scale: Number.NaN,
    auxDirection,
    postureOk: false,
    debug: {},
  };
}

interface PerSide {
  primary: number;
  auxRaw: number;
  scale: number;
  postureOk: boolean;
  debug: Record<string, number>;
}

function computeSide(exercise: ExerciseId, g: SideGeometry): PerSide {
  switch (exercise) {
    case 'pushup': {
      const elbow = angleDeg(g.shoulder, g.elbow, g.wrist);
      const arm = dist(g.shoulder, g.elbow) + dist(g.elbow, g.wrist);
      const torsoIncl = inclinationFromHorizontalDeg(g.shoulder, g.hip);
      // Shoulders above the hands (image y grows downward).
      const shoulderAboveWrist = g.wrist.y - g.shoulder.y;
      const postureOk = torsoIncl <= 50 && shoulderAboveWrist > -0.1 * arm;
      return {
        primary: elbow,
        auxRaw: shoulderAboveWrist,
        scale: arm,
        postureOk,
        debug: { elbowDeg: elbow, torsoInclDeg: torsoIncl },
      };
    }
    case 'squat': {
      const knee = angleDeg(g.hip, g.knee, g.ankle);
      const hipAngle = angleDeg(g.shoulder, g.hip, g.knee);
      const thigh = dist(g.hip, g.knee);
      const torsoIncl = inclinationFromHorizontalDeg(g.shoulder, g.hip);
      const postureOk = torsoIncl >= 25 && g.shoulder.y < g.hip.y && g.hip.y < g.ankle.y;
      return {
        primary: knee,
        auxRaw: g.hip.y,
        scale: thigh,
        postureOk,
        debug: { kneeDeg: knee, hipDeg: hipAngle, torsoInclDeg: torsoIncl },
      };
    }
    case 'pullup': {
      const elbow = angleDeg(g.shoulder, g.elbow, g.wrist);
      const arm = dist(g.shoulder, g.elbow) + dist(g.elbow, g.wrist);
      // Hands above the shoulders (hanging from a bar).
      const shoulderBelowWrist = g.shoulder.y - g.wrist.y;
      const postureOk = shoulderBelowWrist > -0.15 * arm;
      return {
        primary: elbow,
        auxRaw: shoulderBelowWrist,
        scale: arm,
        postureOk,
        debug: { elbowDeg: elbow },
      };
    }
    case 'situp': {
      const hip = angleDeg(g.shoulder, g.hip, g.knee);
      const knee = angleDeg(g.hip, g.knee, g.ankle);
      const torso = dist(g.shoulder, g.hip);
      const legs = dist(g.hip, g.knee) + dist(g.knee, g.ankle);
      // On the floor: hips and feet at about the same height, knees bent.
      const postureOk = Math.abs(g.ankle.y - g.hip.y) < 0.35 * legs && knee < 150;
      return {
        primary: hip,
        // Shoulders above the hips (image y grows downward): grows while sitting up.
        auxRaw: g.shoulder.y - g.hip.y,
        scale: torso,
        postureOk,
        debug: { hipDeg: hip, kneeDeg: knee },
      };
    }
    case 'bench': {
      const elbow = angleDeg(g.shoulder, g.elbow, g.wrist);
      const arm = dist(g.shoulder, g.elbow) + dist(g.elbow, g.wrist);
      const torsoIncl = inclinationFromHorizontalDeg(g.shoulder, g.hip);
      // Lying on the bench, hands (bar) above the shoulders.
      const wristAboveShoulder = g.shoulder.y - g.wrist.y;
      const postureOk = torsoIncl <= 35 && wristAboveShoulder > -0.1 * arm;
      return {
        primary: elbow,
        auxRaw: wristAboveShoulder,
        scale: arm,
        postureOk,
        debug: { elbowDeg: elbow, torsoInclDeg: torsoIncl },
      };
    }
    case 'jumprope': {
      const knee = angleDeg(g.hip, g.knee, g.ankle);
      const legs = dist(g.hip, g.knee) + dist(g.knee, g.ankle);
      const torsoIncl = inclinationFromHorizontalDeg(g.shoulder, g.hip);
      const postureOk = torsoIncl >= 60 && g.shoulder.y < g.hip.y && g.hip.y < g.ankle.y;
      return {
        primary: knee,
        // Vertical position of the body (image y grows downward): mean of hips and feet.
        auxRaw: (g.hip.y + g.ankle.y) / 2,
        scale: legs,
        postureOk,
        debug: { kneeDeg: knee, torsoInclDeg: torsoIncl },
      };
    }
    case 'plank': {
      const body = angleDeg(g.shoulder, g.hip, g.ankle);
      const bodyLen = dist(g.shoulder, g.hip) + dist(g.hip, g.ankle);
      const incl = inclinationFromHorizontalDeg(g.shoulder, g.ankle);
      // Shoulders raised above the feet (not lying flat) and supported by the arms.
      const elevation = (g.ankle.y - g.shoulder.y) / bodyLen;
      const postureOk = incl <= 40 && elevation >= 0.06 && g.elbow.y > g.shoulder.y;
      return {
        primary: body,
        auxRaw: 0,
        scale: bodyLen,
        postureOk,
        debug: { bodyDeg: body, inclDeg: incl, elevation },
      };
    }
  }
}

const AUX_DIRECTION: Record<ExerciseId, 1 | -1> = {
  pushup: -1,
  squat: 1,
  pullup: -1,
  situp: -1,
  bench: -1,
  jumprope: -1,
  plank: 1,
};

export function extractFeatures(
  exercise: ExerciseId,
  pose: Pose,
  minScore: number = TRACKING.minKeypointScore,
): Features {
  const parts = REQUIRED_PARTS[exercise];
  const auxDirection = AUX_DIRECTION[exercise];
  const leftOk = sideVisible(pose, 'left', parts, minScore);
  const rightOk = sideVisible(pose, 'right', parts, minScore);
  const left = sideGeometry(pose, 'left', parts);
  const right = sideGeometry(pose, 'right', parts);

  if (!leftOk && !rightOk) {
    // Report parts missing on the better side.
    const better: 'left' | 'right' = left.meanScore >= right.meanScore ? 'left' : 'right';
    const missing = parts.filter((p) => !kpVisible(pose, PART_INDEX[p][better], minScore));
    return invalid(missing, Math.max(left.meanScore, right.meanScore), auxDirection);
  }

  let side: Side;
  let result: PerSide;
  let confidence: number;
  if (leftOk && rightOk && SIDE_STRATEGY[exercise] === 'average') {
    const l = computeSide(exercise, left);
    const r = computeSide(exercise, right);
    side = 'both';
    result = {
      primary: (l.primary + r.primary) / 2,
      auxRaw: (l.auxRaw + r.auxRaw) / 2,
      scale: (l.scale + r.scale) / 2,
      postureOk: l.postureOk && r.postureOk,
      debug: Object.fromEntries(
        Object.keys(l.debug).map((k) => [k, (l.debug[k] + r.debug[k]) / 2]),
      ),
    };
    confidence = (left.meanScore + right.meanScore) / 2;
  } else {
    const useLeft = leftOk && (!rightOk || left.meanScore >= right.meanScore);
    side = useLeft ? 'left' : 'right';
    const g = useLeft ? left : right;
    result = computeSide(exercise, g);
    confidence = g.meanScore;
  }

  if (!Number.isFinite(result.primary) || !Number.isFinite(result.scale) || result.scale < 1) {
    return invalid([], confidence, auxDirection);
  }

  return {
    valid: true,
    missing: [],
    confidence,
    side,
    primary: result.primary,
    auxRaw: result.auxRaw,
    scale: result.scale,
    auxDirection,
    postureOk: result.postureOk,
    debug: result.debug,
  };
}

/** For the setup checklist: is each required body part visible on at least one side? */
export function visibleParts(
  exercise: ExerciseId,
  pose: Pose,
  minScore: number = TRACKING.minKeypointScore,
): { part: BodyPart; visible: boolean }[] {
  return REQUIRED_PARTS[exercise].map((part) => ({
    part,
    visible: kpVisible(pose, PART_INDEX[part].left, minScore) || kpVisible(pose, PART_INDEX[part].right, minScore),
  }));
}

/** Keypoint indices (both sides) used by an exercise, for highlighting in the overlay. */
export function requiredKeypointIndices(exercise: ExerciseId): number[] {
  return REQUIRED_PARTS[exercise].flatMap((p) => [PART_INDEX[p].left, PART_INDEX[p].right]);
}
