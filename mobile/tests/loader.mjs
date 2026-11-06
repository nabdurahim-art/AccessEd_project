// Redirects Expo's native modules to the stand-ins in tests/stubs, and lets
// imports without a file extension ('./db', './api') resolve like Metro does.
const STUBS = {
  'expo-sqlite': 'expo-sqlite.mjs',
  'expo-secure-store': 'expo-secure-store.mjs',
  'expo-crypto': 'expo-crypto.mjs',
  'expo-file-system/legacy': 'expo-file-system-legacy.mjs',
  'react-native': 'react-native.mjs',
};
const MISSING = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: new URL('./stubs/' + STUBS[specifier], import.meta.url).href, shortCircuit: true };
  }
  if (/^\.{1,2}\//.test(specifier) && !/\.(m?js|cjs|json)$/.test(specifier)) {
    for (const suffix of ['', '.js', '/index.js']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch (err) {
        if (!MISSING.has(err.code)) throw err;
      }
    }
  }
  return nextResolve(specifier, context);
}
