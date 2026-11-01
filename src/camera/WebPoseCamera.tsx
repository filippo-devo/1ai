import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { TRACKING } from '../counting/config';
import { COCO_FROM_MEDIAPIPE } from '../pose/mediapipe';
import { webMessageToPose, type WebPoseMessage } from '../pose/web/messages';
import { buildPoseHtml, DEFAULT_ASSETS_BASE, DEFAULT_MODEL_URL } from '../pose/web/poseHtml';
import { cameraStyles as styles } from './styles';
import type { PoseCameraProps } from './types';

type WebStatus = 'loading' | 'ready' | 'denied' | 'error';

type PageMessage =
  | ({ type: 'pose'; ms: number } & WebPoseMessage)
  | { type: 'status'; state: 'loading' | 'ready'; delegate?: string }
  | { type: 'error'; code?: string; message: string };

/**
 * Expo Go engine: camera (getUserMedia) + MediaPipe Pose Landmarker inside a WebView.
 * Frames stay inside the WebView on the device; only landmark coordinates are posted out.
 */
export function WebPoseCamera({ position, active, debug, highlight, onPose }: PoseCameraProps) {
  // react-native-webview's typings default P to undefined (props become `never`); pass `object`.
  const webRef = useRef<WebView<object>>(null);
  const [status, setStatus] = useState<WebStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [initialDebug] = useState(debug);
  const debugRef = useRef(debug);

  const html = useMemo(
    () =>
      buildPoseHtml({
        assetsBase: DEFAULT_ASSETS_BASE,
        modelUrl: DEFAULT_MODEL_URL,
        facingMode: position === 'front' ? 'user' : 'environment',
        debug: initialDebug,
        highlight: highlight.map((i) => COCO_FROM_MEDIAPIPE[i]),
        minScore: TRACKING.minKeypointScore,
      }),
    [position, highlight, initialDebug],
  );

  useEffect(() => {
    debugRef.current = debug;
    webRef.current?.injectJavaScript(`window.__rc && window.__rc.setDebug(${debug ? 'true' : 'false'}); true;`);
  }, [debug]);

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
      setStatus(msg.state);
      if (msg.state === 'ready') setError(null);
    } else if (msg.type === 'error') {
      setStatus(msg.code === 'camera-denied' ? 'denied' : 'error');
      setError(msg.message);
    }
  };

  if (!active) return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'black' }]} />;

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView<object>
        key={position}
        ref={webRef}
        style={{ flex: 1, backgroundColor: 'black' }}
        source={{ html, baseUrl: 'https://repcounter.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onMessage={onMessage}
        onLoadEnd={() =>
          webRef.current?.injectJavaScript(
            `window.__rc && window.__rc.setDebug(${debugRef.current ? 'true' : 'false'}); true;`,
          )
        }
        onError={(e: { nativeEvent: { description: string } }) => {
          setStatus('error');
          setError(e.nativeEvent.description);
        }}
      />
      {status === 'loading' && (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.bannerText}>
            Ładowanie modelu pozy… (pierwsze uruchomienie pobiera ok. 10 MB, potem z pamięci podręcznej)
          </Text>
        </View>
      )}
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
