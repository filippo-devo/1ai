import { useCallback, useEffect, useRef, useState } from 'react';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { isResizerAvailable, useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';
import { computeCropRegion, cropOutputToSquare, sampleCrop, type CropRegion } from '../pose/crop';
import {
  MOVENET_INPUT_SIZE,
  RESIZER_SIZE,
  squareToUpright,
  uprightSize,
  uprightToRawFrame,
  type FrameOrientation,
} from '../pose/movenet';
import type { Pose } from '../pose/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/movenet_singlepose_lightning_int8_v4.tflite');

export interface DetectedPose extends Pose {
  /**
   * Keypoints in the Camera coordinate system ([x0, y0, x1, y1, ...]) for the
   * skeleton overlay; convert with the preview's convertCameraPointToViewPoint().
   */
  cameraPoints: number[];
  inferenceMs: number;
  crop: CropRegion;
}

export type DetectorStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

interface WorkletState {
  session: number;
  prevSquare: number[] | null;
  input: Uint8Array;
}

let sessionCounter = 0;

/**
 * Real-time pose estimation on the camera's frame thread, fully on device:
 *   Frame -> GPU Resizer (upright RGB, letterboxed 384x384)
 *         -> smart crop around the person (192x192, see pose/crop.ts)
 *         -> MoveNet Lightning (TFLite, CPU/XNNPACK)
 *         -> keypoints delivered to the JS thread via scheduleOnRN().
 * Frames are never stored or sent anywhere; each Frame is disposed right away.
 */
export function usePoseDetection(onPose: (pose: DetectedPose) => void, onError?: (message: string) => void) {
  const model = useTensorflowModel(MODEL_ASSET, []);
  const resizerState = useResizer({
    width: RESIZER_SIZE,
    height: RESIZER_SIZE,
    channelOrder: 'rgb',
    dataType: 'uint8',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });

  // Keep the latest callbacks without re-creating the frame worklet.
  const onPoseRef = useRef(onPose);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onPoseRef.current = onPose;
    onErrorRef.current = onError;
  }, [onPose, onError]);
  const deliver = useCallback((pose: DetectedPose) => onPoseRef.current(pose), []);
  const deliverError = useCallback((message: string) => onErrorRef.current?.(message), []);

  const tflite = model.state === 'loaded' ? model.model : undefined;
  const resizer = resizerState.resizer;
  // New id per mounted detector: resets the crop tracking kept in the worklet runtime.
  const [session] = useState(() => ++sessionCounter);

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        if (tflite == null || resizer == null) return;
        const t0 = Date.now();
        const g = globalThis as unknown as { __repCounterPose?: WorkletState };
        let st = g.__repCounterPose;
        if (st == null || st.session !== session) {
          st = { session, prevSquare: null, input: new Uint8Array(MOVENET_INPUT_SIZE * MOVENET_INPUT_SIZE * 3) };
          g.__repCounterPose = st;
        }
        const orientation = frame.orientation as FrameOrientation;
        const up = uprightSize(frame.width, frame.height, orientation);
        const crop = st.prevSquare ? computeCropRegion(st.prevSquare) : { x: 0, y: 0, size: 1 };

        const resized = resizer.resize(frame);
        try {
          const pixels = new Uint8Array(resized.getPixelBuffer());
          sampleCrop(pixels, RESIZER_SIZE, crop, st.input, MOVENET_INPUT_SIZE);
        } finally {
          resized.dispose();
        }

        const outputs = tflite.runSync([st.input.buffer as ArrayBuffer]);
        const square = cropOutputToSquare(new Float32Array(outputs[0]), crop);
        st.prevSquare = square;
        const keypoints = squareToUpright(square, up.width, up.height);

        const cameraPoints: number[] = new Array(34);
        for (let i = 0; i < 17; i++) {
          const raw = uprightToRawFrame(keypoints[i * 3], keypoints[i * 3 + 1], orientation, frame.isMirrored);
          const p = frame.convertFramePointToCameraPoint({ x: raw.x * frame.width, y: raw.y * frame.height });
          cameraPoints[i * 2] = p.x;
          cameraPoints[i * 2 + 1] = p.y;
        }

        scheduleOnRN(deliver, {
          keypoints,
          width: up.width,
          height: up.height,
          timestamp: t0,
          cameraPoints,
          inferenceMs: Date.now() - t0,
          crop,
        });
      } catch (e) {
        scheduleOnRN(deliverError, String(e));
      } finally {
        frame.dispose();
      }
    },
    [tflite, resizer, session, deliver, deliverError],
  );

  const frameOutput = useFrameOutput({
    // The Resizer needs a GPU-backed YUV frame; it converts to RGB itself (see VisionCamera docs).
    pixelFormat: 'yuv',
    // Small 4:3 stream (full sensor field of view); the model input is 192x192 anyway.
    targetResolution: CommonResolutions.VGA_4_3,
    dropFramesWhileBusy: true,
    enablePhysicalBufferRotation: false,
    onFrame,
  });

  let status: DetectorStatus;
  if (model.state === 'error') status = { state: 'error', message: `Nie udało się wczytać modelu: ${model.error.message}` };
  else if (resizerState.state === 'error')
    status = { state: 'error', message: `Resizer GPU niedostępny: ${resizerState.error.message}` };
  else if (model.state === 'loading' || resizerState.state === 'loading') status = { state: 'loading' };
  else status = { state: 'ready' };

  return { frameOutput, status };
}

/** Synchronous capability check (GPU resize pipeline: Metal on iOS, Vulkan on Android 8+). */
export function gpuResizerSupported(): boolean {
  try {
    return isResizerAvailable();
  } catch {
    return false;
  }
}
