import { StyleSheet } from 'react-native';
import { colors, radius } from '../ui/theme';

export const cameraStyles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
    backgroundColor: colors.bg,
  },
  msg: { fontSize: 17, lineHeight: 24, textAlign: 'center', color: colors.text },
  small: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  primary: { backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 22, borderRadius: radius.md },
  primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  banner: {
    position: 'absolute',
    top: '42%',
    left: 24,
    right: 24,
    backgroundColor: colors.overlay,
    padding: 14,
    borderRadius: radius.md,
  },
  bannerError: { backgroundColor: 'rgba(185,28,28,0.92)' },
  bannerText: { color: colors.text, fontSize: 15, textAlign: 'center' },
});
