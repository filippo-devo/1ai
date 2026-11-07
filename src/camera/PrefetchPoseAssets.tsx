import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildPrefetchHtml } from '../pose/web/poseHtml';
import { WEB_POSE_BASE_URL } from './WebPoseCamera';

let prefetched = false;

/**
 * Expo Go engine only: while the user is on the exercise list, an invisible WebView downloads
 * the MediaPipe library, WebAssembly and pose model into a persistent cache (no camera access).
 * When an exercise is opened the camera page loads them from there instead of the network.
 * Mount it only while the list is on screen: leaving it stops the prefetch, so it never
 * competes with the camera page for bandwidth (finished files stay cached).
 */
export function PrefetchPoseAssets() {
  const [done, setDone] = useState(prefetched);
  const [html] = useState(() => buildPrefetchHtml());
  if (done) return null;
  const finish = (ok: boolean) => {
    if (ok) prefetched = true;
    setDone(true);
  };
  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView<object>
        source={{ html, baseUrl: WEB_POSE_BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(e) => {
          try {
            finish((JSON.parse(e.nativeEvent.data) as { ok?: boolean }).ok === true);
          } catch {
            finish(false);
          }
        }}
        onError={() => finish(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
