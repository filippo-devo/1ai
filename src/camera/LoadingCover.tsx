import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../ui/theme';
import { cameraStyles } from './styles';

/** Black screen with a spinner: nothing of the camera is visible until it is ready. */
export function LoadingCover() {
  return (
    <View style={cameraStyles.loading} accessibilityLabel="Uruchamianie kamery" accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}
