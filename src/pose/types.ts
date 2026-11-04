/**
 * MoveNet (COCO) keypoint order. The model returns exactly these 17 points.
 */
export const KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

export type KeypointName = (typeof KEYPOINT_NAMES)[number];

export const KP = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

export const NUM_KEYPOINTS = 17;

/** Bones drawn by the skeleton overlay. */
export const SKELETON_EDGES: readonly (readonly [number, number])[] = [
  [KP.leftShoulder, KP.rightShoulder],
  [KP.leftShoulder, KP.leftElbow],
  [KP.leftElbow, KP.leftWrist],
  [KP.rightShoulder, KP.rightElbow],
  [KP.rightElbow, KP.rightWrist],
  [KP.leftShoulder, KP.leftHip],
  [KP.rightShoulder, KP.rightHip],
  [KP.leftHip, KP.rightHip],
  [KP.leftHip, KP.leftKnee],
  [KP.leftKnee, KP.leftAnkle],
  [KP.rightHip, KP.rightKnee],
  [KP.rightKnee, KP.rightAnkle],
  [KP.nose, KP.leftEye],
  [KP.nose, KP.rightEye],
  [KP.leftEye, KP.leftEar],
  [KP.rightEye, KP.rightEar],
];

/**
 * One detected pose.
 *
 * `keypoints` is a flat array `[x0, y0, score0, x1, y1, score1, ...]` (17 * 3).
 * x/y are normalized to 0..1 relative to the *upright* camera image
 * (x to the right, y down) as fed into the model, `width`/`height` are that
 * upright image's pixel size, so `x * width`, `y * height` gives isotropic
 * pixel coordinates (required for correct angles).
 */
export interface Pose {
  keypoints: number[];
  width: number;
  height: number;
  /** Milliseconds, monotonic within a session (real frame/processing time, not a frame count). */
  timestamp: number;
  /**
   * Which model produced the pose. Scores are NOT comparable between models
   * (MoveNet "score" vs MediaPipe "visibility"), so visibility thresholds are
   * configured per source. Default: 'movenet'.
   */
  source?: PoseSource;
  /**
   * Foot landmarks available only from MediaPipe (MoveNet has none):
   * flat [x, y, score] * 4 in FOOT_LANDMARKS order, normalized like `keypoints`.
   */
  feet?: number[];
}

export type PoseSource = 'movenet' | 'mediapipe';

/** Order of `Pose.feet`. */
export const FOOT_LANDMARKS = ['left_heel', 'right_heel', 'left_toe', 'right_toe'] as const;
export const FOOT = { leftHeel: 0, rightHeel: 1, leftToe: 2, rightToe: 3 } as const;

export interface Point {
  x: number;
  y: number;
}
