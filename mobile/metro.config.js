// Metro bundler settings. The web build of expo-sqlite runs SQLite as a
// WebAssembly (.wasm) file, so Metro must treat .wasm as a bundled asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// The browser only allows SharedArrayBuffer (needed by SQLite on the web)
// when these two headers are sent. This covers the dev server only; a
// hosted site must send the same headers (see web/README or nginx notes).
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
