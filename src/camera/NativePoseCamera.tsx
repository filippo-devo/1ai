import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, type CameraRef } from 'react-native-vision-camera';
import { SkeletonOverlay } from '../components/SkeletonOverlay';
import { LEG_VISIBILITY, VISIBILITY } from '../analysis/config';
import { gpuResizerSupported, usePoseDetection, type DetectedPose as NativePose } from '../hooks/usePoseDetection';
import type { Point } from '../pose/types';
import { DetectionSpinner, LoadingCover } from './LoadingCover';
import { cameraStyles as styles } from './styles';
import type { PoseCameraProps } from './types';

/** VisionCamera v5 + GPU Resizer + MoveNet (TFLite). Requires a development/preview build. */
export function NativePoseCamera({ position, active, highlight, onPose, onSwitchCamera }: PoseCameraProps) {
  const permission = useCameraPermission();
  const device = useCameraDevice(position);
  const cameraRef = useRef<CameraRef>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [resizerSupported] = useState(() => gpuResizerSupported());
  const [previewStarted, setPreviewStarted] = useState(false);
  const previewSeen = useRef(false);
  const [overlay, setOverlay] = useState<{ points: (Point | null)[]; scores: number[] } | null>(null);

  const handlePose = useCallback(
    (pose: NativePose) => {
      if (!previewSeen.current) {
        previewSeen.current = true;
        setPreviewStarted(true);
      }
      onPose({
        keypoints: pose.keypoints,
        width: pose.width,
        height: pose.height,
        timestamp: pose.timestamp,
        source: 'movenet',
        inferenceMs: pose.inferenceMs,
        cropSize: pose.crop.size,
      });
      const cam = cameraRef.current;
      const points: (Point | null)[] = [];
      for (let i = 0; i < 17; i++) {
        try {
          points.push(
            cam ? cam.convertCameraPointToViewPoint({ x: pose.cameraPoints[i * 2], y: pose.cameraPoints[i * 2 + 1] }) : null,
          );
        } catch {
          points.push(null);
        }
      }
      setOverlay({ points, scores: Array.from({ length: 17 }, (_, i) => pose.keypoints[i * 3 + 2]) });
    },
    [onPose],
  );
  const onDetectorError = useCallback((message: string) => setDetectorError(message), []);
  const { frameOutput, status } = usePoseDetection(handlePose, onDetectorError);
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  if (!permission.hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Aplikacja potrzebuje dostępu do kamery, aby liczyć powtórzenia.</Text>
        <Text style={styles.small}>Obraz jest analizowany tylko na telefonie — nic nie jest nagrywane ani wysyłane.</Text>
        {permission.canRequestPermission ? (
          <Pressable style={styles.primary} onPress={() => permission.requestPermission()}>
            <Text style={styles.primaryText}>Zezwól na dostęp do kamery</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.msg}>Dostęp do kamery został odmówiony. Włącz go w ustawieniach systemu.</Text>
            <Pressable style={styles.primary} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryText}>Otwórz ustawienia</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }
  if (!resizerSupported) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>
          To urządzenie nie obsługuje przetwarzania obrazu na GPU wymaganego do wykrywania pozy (Vulkan na Androidzie).
        </Text>
      </View>
    );
  }
  if (device == null) {
    // Briefly null while the camera list loads; the top bar has a "switch camera" button.
    return <LoadingCover />;
  }

  const fatal = cameraError ?? (status.state === 'error' ? status.message : null) ?? detectorError;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        outputs={outputs}
        resizeMode="cover"
        orientationSource="interface"
        onPreviewStarted={() => setPreviewStarted(true)}
        onPreviewStopped={() => {
          previewSeen.current = false;
          setPreviewStarted(false);
        }}
        onError={(e) => setCameraError(`Błąd kamery: ${e.message}`)}
      />
      {overlay && (
        <SkeletonOverlay points={overlay.points} scores={overlay.scores} minScore={VISIBILITY.movenet} legMinScore={LEG_VISIBILITY.movenet} highlight={highlight} />
      )}
      {/* Picture as soon as the preview runs; the model may still be loading (small spinner). */}
      {!fatal && !previewStarted && <LoadingCover />}
      {!fatal && previewStarted && status.state === 'loading' && <DetectionSpinner />}
      {fatal && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerText}>{fatal}</Text>
        </View>
      )}
    </View>
  );
}
