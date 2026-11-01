module.exports = function (api) {
  const isTest = api.env('test');
  api.cache.using(() => isTest);
  return {
    // babel-preset-expo automatically adds the react-native-worklets plugin
    // (needed for VisionCamera frame callbacks). In Jest we only test pure
    // logic, so the worklets transform is disabled there.
    presets: [['babel-preset-expo', isTest ? { worklets: false, reanimated: false } : {}]],
  };
};
