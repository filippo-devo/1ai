import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildPrefetchHtml } from '../pose/web/poseHtml';
import { WEB_POSE_BASE_URL } from './WebPoseCamera';

let prefetched = false;

/**
 * Expo Go engine only: while the user is on the exercise list, an invisible WebView downloads
 * the MediaPipe library, WebAssembly and pose model into the WebView cache (no camera access).
 * When an exercise is opened the camera page then loads them from the cache instead of the network.
 */
export function PrefetchPoseAssets() {
  const [done, setDone] = useState(prefetched);
  const [html] = useState(() => buildPrefetchHtml());
  if (done) return null;
  const finish = () => {
    prefetched = true;
    setDone(true);
  };
  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView<object>
        source={{ html, baseUrl: WEB_POSE_BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={finish}
        onError={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
