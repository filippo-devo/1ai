import type React from 'react';
import { TurboModuleRegistry } from 'react-native';
import type { PoseCameraProps } from './types';

function nitroModulesAvailable(): boolean {
  try {
    return TurboModuleRegistry.get('NitroModules') != null;
  } catch {
    return false;
  }
}

/**
 * 'native': development/preview builds from EAS — VisionCamera + GPU resizer + MoveNet (TFLite).
 * 'web':    Expo Go, which does not contain those native modules — camera and MediaPipe
 *           Pose Landmarker inside a WebView (still processed on the device).
 * The native implementation is only required when its native modules exist, so importing
 * this file never touches them in Expo Go.
 */
export const POSE_ENGINE: 'native' | 'web' = nitroModulesAvailable() ? 'native' : 'web';

/* eslint-disable @typescript-eslint/no-require-imports */
export const PoseCamera: React.ComponentType<PoseCameraProps> =
  POSE_ENGINE === 'native' ? require('./NativePoseCamera').NativePoseCamera : require('./WebPoseCamera').WebPoseCamera;
/* eslint-enable @typescript-eslint/no-require-imports */
