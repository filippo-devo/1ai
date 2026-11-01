import { StyleSheet } from 'react-native';

export const cameraStyles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: 'white' },
  msg: { fontSize: 17, textAlign: 'center' },
  small: { fontSize: 13, color: '#555', textAlign: 'center' },
  primary: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10 },
  primaryText: { color: 'white', fontSize: 17, fontWeight: '600' },
  banner: { position: 'absolute', top: 8, left: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 8 },
  bannerError: { backgroundColor: 'rgba(185,28,28,0.9)' },
  bannerText: { color: 'white', fontSize: 14 },
});
