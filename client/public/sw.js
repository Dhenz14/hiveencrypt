/**
 * Service Worker for Hive Messenger PWA
 * Provides offline support and caching for 100% decentralized operation
 */

const CACHE_NAME = 'hive-messenger-v12';
const RUNTIME_CACHE = 'hive-messenger-runtime-v12';

// Skip precaching on install - let runtime caching handle assets
// This avoids path issues on subdirectory deployments like GitHub Pages
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(self.skipWaiting());
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[ServiceWorker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests and Hive blockchain API calls
  if (url.origin !== location.origin) {
    return;
  }

  // Handle navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // Return cached index.html for offline support
        return caches.match(request).then(r => r || caches.match('./index.html'));
      })
    );
    return;
  }

  // Cache-first strategy for assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, responseToCache);
        });

        return response;
      });
    })
  );
});

// Background sync for offline message queue (future feature)
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync:', event.tag);
});

// Push notifications (future feature)
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push notification received');
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New Message';
  const options = {
    body: data.body || 'You have a new message',
    icon: './favicon.png',
    badge: './favicon.png',
    data: { url: data.url || './' },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification clicked');
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || './')
  );
});

console.log('[ServiceWorker] Loaded and ready!');
