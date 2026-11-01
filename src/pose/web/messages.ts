import { mediapipeToCoco } from '../mediapipe';
import { NUM_KEYPOINTS, type Pose } from '../types';

/** Pose message posted by the WebView page (src/pose/web/poseHtml.ts). */
export interface WebPoseMessage {
  t: number;
  w: number;
  h: number;
  /** [x, y, visibility] * 33 or null when no person is detected. */
  lm: number[] | null;
}

/** Converts a WebView pose message into the app's Pose (17 COCO keypoints). */
export function webMessageToPose(m: WebPoseMessage): Pose {
  return {
    keypoints: m.lm ? mediapipeToCoco(m.lm) : new Array<number>(NUM_KEYPOINTS * 3).fill(0),
    width: m.w,
    height: m.h,
    timestamp: m.t,
  };
}
