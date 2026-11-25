/* ZED Scholar - sw.js v28
 * Service Worker for ZED Scholar PWA.
 * Deploy this file NEXT TO ZED-SCHOLAR-fixed.html on Cloudflare Pages,
 * at the site root, so ./sw.js resolves. The HTML registers ./sw.js?v=27.
 *
 * What v27 does for this update:
 * - Chat relay + notifications: when the page is hidden, the page calls
 *   reg.showNotification(). This worker handles notificationclick so tapping
 *   a notification focuses / opens the app instead of doing nothing.
 * - Background sync: 'zed-sync' (registered when the phone comes back
 *   online) and periodic sync 'zed-content-sync' wake the worker, which
 *   tells any open page to run its relay sync + notification check.
 * - Push: 'push' handler is here so a future push server (Firebase / VAPID)
 *   can deliver true closed-app pushes. Without VAPID keys + a push server,
 *   no push will ever arrive - the handler alone cannot create pushes.
 * - Offline shell: cache-first for same-origin static assets, network-first
 *   for navigations. Supabase / Gemini API calls are NEVER cached.
 */

var CACHE_NAME = 'zed-scholar-v2';
var CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS).catch(function () { return null; });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME && k.indexOf('zed-scholar-') === 0) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiRequest(url) {
  return url.indexOf('supabase.co') !== -1 ||
    url.indexOf('googleapis.com') !== -1 ||
    url.indexOf('generativelanguage.googleapis.com') !== -1;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Never cache API / Supabase / Gemini - always network, otherwise chats
  // and quiz answers would go stale.
  if (isApiRequest(req.url)) return;
  // Navigation: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put('./', copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match('./').then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }
  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        });
      })
    );
  }
});

// --- Push (true closed-app push) ---
// Needs VAPID keys + a push server to SEND. This handler only DISPLAYS
// a push when one arrives. Payload: { title, body, tag, url }
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (_e) {}
  }
  var title = data.title || 'ZED Scholar';
  var options = {
    body: data.body || 'You have a new message.',
    tag: data.tag || 'zed-general',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './', tag: data.tag || 'zed-general' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// --- Notification tap: focus existing app window, or open it ---
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || './';
  var tag = (event.notification.data && event.notification.data.tag) || '';
  // If it's a chat notification, open the app at the root - the page itself
  // will open Chats from its own notification-check logic.
  if (tag === 'zed-chat') targetUrl = './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});

// --- Background sync + periodic sync: nudge open pages to sync relay ---
function nudgeClients() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    list.forEach(function (client) {
      try { client.postMessage({ type: 'zed-sync-now' }); } catch (e) {}
    });
    return null;
  });
}

self.addEventListener('sync', function (event) {
  if (event.tag === 'zed-sync') {
    event.waitUntil(nudgeClients());
  }
});

self.addEventListener('periodicsync', function (event) {
  if (event.tag === 'zed-content-sync') {
    event.waitUntil(nudgeClients());
  }
});
