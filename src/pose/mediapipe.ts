/**
 * MediaPipe Pose Landmarker (33 landmarks) -> the app's 17 COCO keypoints.
 * Used by the Expo Go path (src/camera/WebPoseCamera.tsx), where pose estimation
 * runs inside a WebView with MediaPipe Tasks Vision (WebAssembly, on device).
 *
 * MediaPipe landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */
import { NUM_KEYPOINTS } from './types';

/** COCO keypoint order (see types.ts KEYPOINT_NAMES) -> MediaPipe landmark index. */
export const COCO_FROM_MEDIAPIPE: readonly number[] = [
  0, // nose
  2, // left_eye
  5, // right_eye
  7, // left_ear
  8, // right_ear
  11, // left_shoulder
  12, // right_shoulder
  13, // left_elbow
  14, // right_elbow
  15, // left_wrist
  16, // right_wrist
  23, // left_hip
  24, // right_hip
  25, // left_knee
  26, // right_knee
  27, // left_ankle
  28, // right_ankle
];

export const MEDIAPIPE_LANDMARKS = 33;

/**
 * @param landmarks flat [x, y, visibility] * 33, x/y normalized to the video frame
 * @returns flat [x, y, score] * 17 in the app's keypoint order
 */
export function mediapipeToCoco(landmarks: ArrayLike<number>): number[] {
  if (landmarks.length < MEDIAPIPE_LANDMARKS * 3) {
    throw new Error(`Expected ${MEDIAPIPE_LANDMARKS * 3} values, got ${landmarks.length}`);
  }
  const out: number[] = new Array(NUM_KEYPOINTS * 3);
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    const m = COCO_FROM_MEDIAPIPE[i];
    out[i * 3] = landmarks[m * 3];
    out[i * 3 + 1] = landmarks[m * 3 + 1];
    const v = landmarks[m * 3 + 2];
    out[i * 3 + 2] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  return out;
}
