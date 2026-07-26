/**
 * Skyward — service worker
 *
 * The game is a single self-contained HTML file: Tailwind and both webfonts are
 * inlined, so there are no sub-resources to fetch at runtime. This worker
 * therefore has one job — keep a copy of the document (plus the manifest and
 * icons) so a cold start with no connection still works, and so the browser
 * treats the game as installable.
 *
 * Strategy:
 *   navigations  -> network-first, falling back to cache
 *                   (so a redeploy is picked up, but offline still loads)
 *   everything else -> cache-first, falling back to network
 *                   (icons and the manifest never change within a version)
 *
 * Bump CACHE whenever you ship a new build; the activate handler deletes every
 * older cache, so users get the new version on their second visit.
 */

const CACHE = 'skyward-v2-4';

/**
 * Paths are relative so the worker works from a sub-path such as
 * https://user.github.io/skyward/ as well as from a domain root.
 */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',

  // Fonts were previously inlined as base64 inside index.html. They now ship as
  // real files, so they must be precached explicitly or a cold offline start
  // would fall back to system fonts.
  './fonts/Inter-400.woff2',
  './fonts/Inter-500.woff2',
  './fonts/Inter-600.woff2',
  './fonts/Outfit-400.woff2',
  './fonts/Outfit-500.woff2',
  './fonts/Outfit-600.woff2',
  './fonts/Outfit-700.woff2',
  './fonts/Outfit-800.woff2'
];

self.addEventListener('install', (event) => {
  // Take over as soon as the new worker is ready rather than waiting for
  // every old tab to close.
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll() rejects the whole batch if any single request 404s, which
      // would leave us with no cache at all. Add individually and tolerate
      // misses so a renamed icon can never break offline support.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            /* optional asset unavailable — skip it */
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never interfere with non-GET or cross-origin traffic.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // ---- Navigations: prefer the network so updates land, fall back to cache ----
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches
            .match('./index.html', { ignoreSearch: true })
            .then((hit) => hit || caches.match('./'))
            .then(
              (hit) =>
                hit ||
                new Response(
                  '<!doctype html><meta charset="utf-8">' +
                    '<title>Skyward — offline</title>' +
                    '<body style="background:#070B14;color:#96A3B8;font:16px system-ui;' +
                    'display:grid;place-items:center;height:100vh;margin:0">' +
                    '<p>Skyward isn\u2019t cached yet. Reconnect once to install it.</p>',
                  { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                )
            )
        )
    );
    return;
  }

  // ---- Everything else: cache-first ----
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // Only cache complete, same-origin responses.
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => Response.error());
    })
  );
});

/** Lets the page trigger an immediate update via postMessage. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
