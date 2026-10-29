const workboxBuild = require('workbox-build');

const buildSW = () => {
  return workboxBuild.generateSW({
    globDirectory: 'dist',
    globPatterns: [
      '**/*.{html,json,js,css,png,svg,webmanifest}'
    ],
    swDest: 'dist/sw.js',
    navigateFallback: '/index.html',
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true
  }).then(({count, size, warnings}) => {
    warnings.forEach(console.warn);
    console.log(`[PWA] Successfully generated sw.js, which will precache ${count} files, totaling ${size} bytes.`);
  }).catch(console.error);
};

buildSW();
