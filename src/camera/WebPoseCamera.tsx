import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LEG_VISIBILITY, VISIBILITY } from '../analysis/config';
import { COCO_FROM_MEDIAPIPE } from '../pose/mediapipe';
import { webMessageToPose, type WebPoseMessage } from '../pose/web/messages';
import { buildPoseHtml, DEFAULT_ASSETS_BASE, DEFAULT_LITE_MODEL_URL, DEFAULT_MODEL_URL } from '../pose/web/poseHtml';
import { DetectionSpinner, LoadingCover } from './LoadingCover';
import { cameraStyles as styles } from './styles';
import type { PoseCameraProps } from './types';

/** Same origin for the camera page and the prefetch page, so they share the WebView cache. */
export const WEB_POSE_BASE_URL = 'https://repcounter.local/';

type WebStatus = 'loading' | 'camera' | 'ready' | 'denied' | 'error';

type PageMessage =
  | ({ type: 'pose'; ms: number } & WebPoseMessage)
  | { type: 'status'; state: 'loading' | 'camera' | 'ready' | 'model'; delegate?: string; model?: string }
  | { type: 'error'; code?: string; message: string };

/**
 * Expo Go engine: camera (getUserMedia) + MediaPipe Pose Landmarker inside a WebView.
 * Frames stay inside the WebView on the device; only landmark coordinates are posted out.
 */
export function WebPoseCamera({ position, active, highlight, onPose }: PoseCameraProps) {
  const [status, setStatus] = useState<WebStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const html = useMemo(
    () =>
      buildPoseHtml({
        assetsBase: DEFAULT_ASSETS_BASE,
        modelUrl: DEFAULT_MODEL_URL,
        liteModelUrl: DEFAULT_LITE_MODEL_URL,
        facingMode: position === 'front' ? 'user' : 'environment',
        highlight: highlight.map((i) => COCO_FROM_MEDIAPIPE[i]),
        minScore: VISIBILITY.mediapipe,
        legMinScore: LEG_VISIBILITY.mediapipe,
      }),
    [position, highlight],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    let msg: PageMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as PageMessage;
    } catch {
      return;
    }
    if (msg.type === 'pose') {
      onPose({ ...webMessageToPose(msg), inferenceMs: msg.ms });
    } else if (msg.type === 'status') {
      if (msg.state === 'model') return; // background upgrade to the full model
      setStatus(msg.state);
      if (msg.state === 'ready') setError(null);
    } else if (msg.type === 'error') {
      setStatus(msg.code === 'camera-denied' ? 'denied' : 'error');
      setError(msg.message);
    }
  };

  if (!active) return <LoadingCover />;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* react-native-webview's typings default P to undefined (props become `never`); pass `object`. */}
      <WebView<object>
        key={position}
        style={{ flex: 1, backgroundColor: 'black' }}
        // iOS would otherwise inset the page by the status-bar area: a black strip at the top.
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        source={{ html, baseUrl: WEB_POSE_BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onMessage={onMessage}
        onError={(e: { nativeEvent: { description: string } }) => {
          setStatus('error');
          setError(e.nativeEvent.description);
        }}
      />
      {status === 'loading' && <LoadingCover />}
      {status === 'camera' && <DetectionSpinner />}
      {status === 'denied' && (
        <View style={styles.center}>
          <Text style={styles.msg}>Brak dostępu do kamery. Włącz dostęp do kamery dla Expo Go w ustawieniach systemu.</Text>
          <Pressable style={styles.primary} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryText}>Otwórz ustawienia</Text>
          </Pressable>
        </View>
      )}
      {status === 'error' && error && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerText}>Błąd wykrywania pozy: {error}</Text>
        </View>
      )}
    </View>
  );
}
