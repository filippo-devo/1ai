// Static config lives in app.json. This file only adjusts it when publishing the
// EAS Update that Expo Go can open (EXPO_GO_UPDATE=1, see .github/workflows/eas-update.yml):
// Expo Go loads updates whose runtime version is "exposdk:<SDK major>.0.0".
module.exports = ({ config }) => {
  if (process.env.EXPO_GO_UPDATE !== '1') return config;
  const sdkMajor = require('expo/package.json').version.split('.')[0];
  return { ...config, runtimeVersion: `exposdk:${sdkMajor}.0.0` };
};
