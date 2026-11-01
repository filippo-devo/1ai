// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// MoveNet model is bundled as an asset and loaded by react-native-fast-tflite.
config.resolver.assetExts.push('tflite');

module.exports = config;
