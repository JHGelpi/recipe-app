// Generates dist/sw.js after `expo export` (ADR-0009). Build time only:
// nothing from Workbox is bundled into the app except this generated worker.
module.exports = {
  globDirectory: 'dist',
  // Metro puts package assets (fonts, router images) under
  // assets/__node_modules/.pnpm/…, and the glob skips dot-directories unless
  // a pattern names one.
  globPatterns: ['**/*', 'assets/__node_modules/.pnpm/**/*'],
  globIgnores: ['sw.js', 'workbox-*.js', '**/*.map'],
  swDest: 'dist/sw.js',
  // PowerSync's WebAssembly builds are up to 2.4 MB; all four are precached
  // rather than guessing which one a browser loads.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Any app path opens offline; Expo Router routes on the client.
  navigateFallback: '/index.html',
  // Services, not app pages: always the network.
  navigateFallbackDenylist: [
    /^\/auth\//,
    /^\/api\//,
    /^\/sync\//,
    /^\/email-templates\//,
    /^\/local-ca\.crt$/,
  ],
  // Take control on first install, so the app works offline straight away.
  clientsClaim: true,
  // A new version waits until the user taps Reload (UpdateBanner).
  skipWaiting: false,
  cleanupOutdatedCaches: true,
  sourcemap: false,
};
