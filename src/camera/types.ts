import type { Pose } from '../pose/types';

export interface DetectedPose extends Pose {
  /** Time spent on pose estimation for this frame, ms. */
  inferenceMs: number;
  /** Smart-crop size relative to the frame (native engine only). */
  cropSize?: number;
}

export interface PoseCameraProps {
  position: 'back' | 'front';
  /** false = camera and processing stopped (screen not focused / app in background). */
  active: boolean;
  /** Draw the skeleton overlay. */
  debug: boolean;
  /** COCO keypoint indices (src/pose/types.ts) used by the current exercise, highlighted in the overlay. */
  highlight: number[];
  onPose: (pose: DetectedPose) => void;
  onSwitchCamera: () => void;
}
