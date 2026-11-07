import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, withAlpha } from '../ui/theme';
import { cameraStyles } from './styles';

/** Black screen with a spinner: nothing of the camera is visible until it is ready. */
export function LoadingCover() {
  return (
    <View style={cameraStyles.loading} accessibilityLabel="Uruchamianie kamery" accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

/** Small spinner shown over the live picture while the pose model is still being prepared. */
export function DetectionSpinner() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.chip, { top: insets.top + 66 }]} accessibilityLabel="Wczytywanie wykrywania sylwetki">
      <ActivityIndicator size="small" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.bg, 0.7),
  },
});
