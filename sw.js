var CACHE_NAME = 'zed-scholar-v26';
var RUNTIME_CACHE = 'zed-scholar-runtime-v26';
var PDF_CACHE = 'zed-scholar-pdfs-v26';
var WIDGET_CACHE = 'zed-widget-v26';
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      var chain = Promise.resolve();
      PRECACHE_URLS.forEach(function (url) {
        chain = chain.then(function () {
          return cache.add(url).catch(function () {});
        });
      });
      return chain;
    })
  );
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.map(function (name) {
          if (name !== CACHE_NAME && name !== RUNTIME_CACHE && name !== PDF_CACHE && name !== WIDGET_CACHE) {
            return caches.delete(name);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== MERGED PWA ADDITIONS - PWABuilder: periodic background sync =====
// Registered by the page as 'zed-content-sync' (see v11 HTML).
// Chrome decides when to run it (needs installed PWA + permission).
// It only revalidates the tiny shell + manifest - it does NOT download PDFs,
// so it never eats the user's data. Your PDF / runtime / navigate logic below is untouched.
self.addEventListener('periodicsync', function (event) {
  if (event.tag === 'zed-content-sync') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        var chain = Promise.resolve();
        ['/', '/index.html', '/manifest.json'].forEach(function (url) {
          chain = chain.then(function () {
            return cache.add(url).catch(function () {});
          });
        });
        return chain;
      }).catch(function () {})
    );
  }
});

// ===== PWABuilder: Background Sync (one-time) + Push Notifications =====
// Background Sync: when the page was offline and comes back online, it registers
// 'zed-sync'. The SW then retries the shell refresh. This is DIFFERENT from
// periodicsync (daily) — this one runs when connection returns.
self.addEventListener('sync', function (event) {
  if (event.tag === 'zed-sync') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.add('/manifest.json').catch(function () {});
      }).catch(function () {})
    );
  }
});

// Push: show a notification even if the app is closed.
// To actually SEND pushes you need a server + VAPID keys (see v13 HTML comment).
// This handler alone is what PWABuilder checks for, and it works once you send a push.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { try { data = { body: event.data.text() }; } catch (e2) {} }
  var title = data.title || 'ZED SCHOLAR';
  var options = {
    body: data.body || 'New ECZ past paper or quiz is ready.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: (data.url || data.actionUrl) || '/?source=push' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Zed Continue widget: serve the last-saved continue data first (saved by the page
  // into WIDGET_CACHE), else network, else built-in default. Never fails the widget.
  if (url.pathname === '/widgets/zed-continue.json') {
    event.respondWith(
      caches.open(WIDGET_CACHE).then(function (wcache) {
        return wcache.match('/widgets/zed-continue.json').then(function (saved) {
          if (saved) return saved;
          return fetch(request).then(function (net) {
            if (net && net.status === 200) {
              var copy = net.clone();
              wcache.put('/widgets/zed-continue.json', copy).catch(function () {});
            }
            return net;
          }).catch(function () {
            return new Response(JSON.stringify({ title: 'Continue studying - ECZ Past Papers', subtitle: 'Form 1-6 & Grade 10-12 - Marking schemes - Works offline', actionTitle: 'Open Zed Scholar', actionUrl: '/?source=widget' }), { headers: { 'Content-Type': 'application/json' } });
          });
        });
      })
    );
    return;
  }
  if (
    url.hostname.indexOf('googlesyndication') !== -1 ||
    url.hostname.indexOf('youtube') !== -1 ||
    url.hostname.indexOf('google-analytics') !== -1 ||
    url.hostname.indexOf('googletagmanager') !== -1
  ) return;
  if (
    url.hostname.indexOf('supabase.co') !== -1 &&
    (url.pathname.indexOf('/auth/') !== -1 || url.pathname.indexOf('/rest/') !== -1)
  ) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (net) {
        var copy = net.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy).catch(function () {});
        }).catch(function () {});
        return net;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          return caches.match('/').then(function (home) {
            if (home) return home;
            return caches.match('/index.html');
          });
        }).then(function (cached) {
          if (cached) return cached;
          return new Response(
            '<!doctype html><title>ZED SCHOLAR - Offline</title>' +
            '<body style="font-family:sans-serif;background:#04101F;color:#F5F1E8;padding:32px;text-align:center">' +
            '<h1>ZED SCHOLAR</h1><p>You are offline.</p>' +
            '<p>Open the app once while online, then it works offline.</p>' +
            '<button onclick="location.reload()" style="padding:12px 20px;border-radius:10px;background:#E8C15A;border:none;font-weight:800">Retry</button>' +
            '</body>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
    return;
  }
  if (url.hostname.indexOf('supabase.co') !== -1 && url.pathname.indexOf('/storage/') !== -1) {
    event.respondWith(
      fetch(request).then(function (net) {
        var copy = net.clone();
        caches.open(PDF_CACHE).then(function (cache) {
          cache.put(request, copy).catch(function () {});
        }).catch(function () {});
        return net;
      }).catch(function () {
        return caches.match(request);
      })
    );
    return;
  }
  if (
    url.origin === self.location.origin ||
    url.hostname.indexOf('cdnjs.cloudflare.com') !== -1 ||
    url.hostname.indexOf('fonts.googleapis.com') !== -1 ||
    url.hostname.indexOf('fonts.gstatic.com') !== -1
  ) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        var fetchPromise = fetch(request).then(function (net) {
          if (net && net.status === 200) {
            var copy = net.clone();
            caches.open(RUNTIME_CACHE).then(function (cache) {
              cache.put(request, copy).catch(function () {});
            }).catch(function () {});
          }
          return net;
        }).catch(function () { return null; });
        if (cached) { fetchPromise.catch(function () {}); return cached; }
        return fetchPromise.then(function (net) {
          if (net) return net;
          throw new Error('offline');
        });
      })
    );
    return;
  }
  event.respondWith(
    fetch(request).catch(function () { return caches.match(request); })
  );
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
