const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

// The DOM-free modules of the web client are imported directly (see src/shared/web.ts)
// so the two clients share one copy of protocol, negotiation and backoff logic.
const webLib = path.resolve(__dirname, "../internal/web/assets/lib");

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [webLib],
  resolver: {
    // Files under watchFolders resolve packages from the app's node_modules.
    nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
  },
});
