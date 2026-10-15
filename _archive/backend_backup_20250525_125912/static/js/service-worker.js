/**
 * Service Worker for Expresso Coffee Ordering System
 * Provides offline functionality for barista interface
 */

// Cache names
const CACHE_NAME = 'expresso-barista-cache-v1';
const RUNTIME_CACHE = 'expresso-runtime-cache';

// Resources to cache on install
const PRECACHE_URLS = [
  '/', // Alias for index.html
  '/barista',
  '/static/css/base.css',
  '/static/css/barista.css',
  '/static/js/barista.js',
  '/static/js/offline-manager.js',
  '/static/audio/notification.mp3',
  '/static/audio/order-ready.mp3',
  '/static/audio/scan-success.mp3',
  '/static/audio/payment.mp3',
  '/static/audio/error.mp3',
  '/static/images/logo.png',
  '/static/images/offline-placeholder.svg'
];

// Install event - cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching core assets');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting()) // Force activate on all clients
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
      })
      .then(cachesToDelete => {
        return Promise.all(cachesToDelete.map(cacheToDelete => {
          return caches.delete(cacheToDelete);
        }));
      })
      .then(() => self.clients.claim()) // Take control of all clients
  );
});

// Fetch event - respond with cached resources or fetch
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip Chrome extension URLs
  if (event.request.url.startsWith('chrome-extension://')) return;
  
  // Skip cross-origin requests
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) {
    // Special handling for CDN resources we need
    if (url.hostname === 'cdn.jsdelivr.net' || 
        url.hostname === 'unpkg.com' || 
        url.hostname === 'cdnjs.cloudflare.com') {
      // Network first, fallback to cache for CDN resources
      event.respondWith(
        fetch(event.request)
          .then(response => {
            // Cache the response
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            });
            return response;
          })
          .catch(() => {
            // Try the cache
            return caches.match(event.request);
          })
      );
    }
    return;
  }
  
  // Handle API requests differently
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/barista/update_status/') || 
      url.pathname.startsWith('/barista/mark_payment/')) {
    // Network only for API calls
    return;
  }
  
  // Handle HTML page requests
  if (event.request.headers.get('accept').includes('text/html')) {
    // Network first strategy for HTML
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the latest version
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              
              // Fallback to /offline page if available, or generic offline message
              return caches.match('/offline')
                .then(offlineResponse => {
                  if (offlineResponse) {
                    return offlineResponse;
                  }
                  
                  // Create a basic offline response
                  return new Response(
                    `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Offline - Expresso Coffee System</title>
                        <style>
                            body { font-family: sans-serif; padding: 20px; text-align: center; }
                            .offline-message { margin-top: 50px; }
                            h1 { color: #6f4e37; }
                        </style>
                    </head>
                    <body>
                        <div class="offline-message">
                            <h1>You are offline</h1>
                            <p>Please check your internet connection and try again.</p>
                            <button onclick="window.location.reload()">Retry</button>
                        </div>
                    </body>
                    </html>
                    `,
                    {
                      status: 503,
                      statusText: 'Service Unavailable',
                      headers: new Headers({
                        'Content-Type': 'text/html',
                        'Cache-Control': 'no-cache'
                      })
                    }
                  );
                });
            });
        })
    );
    return;
  }
  
  // Cache first strategy for assets (CSS, JS, images, etc.)
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached response immediately
          return cachedResponse;
        }
        
        // Otherwise, fetch and cache
        return caches.open(RUNTIME_CACHE)
          .then(cache => {
            return fetch(event.request)
              .then(response => {
                // Cache the new response
                cache.put(event.request, response.clone());
                return response;
              });
          });
      })
      .catch(() => {
        // Return nothing if both cache and network fail
        console.log('Fetch failed:', event.request.url);
        
        // For image requests, return a placeholder
        if (event.request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
          return caches.match('/static/images/offline-placeholder.svg');
        }
        
        return null;
      })
  );
});

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    
    // Show notification
    const notificationOptions = {
      body: data.message,
      icon: '/static/images/logo.png',
      badge: '/static/images/badge.png',
      data: data.data || {},
      vibrate: [100, 50, 100]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, notificationOptions)
    );
  } catch (error) {
    console.error('Error showing push notification:', error);
    
    // Fallback for plain text notifications
    event.waitUntil(
      self.registration.showNotification('Expresso Coffee System', {
        body: event.data.text(),
        icon: '/static/images/logo.png'
      })
    );
  }
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  // Handle action button clicks
  if (event.action === 'view_order' && event.notification.data.orderId) {
    // Open order details page
    event.waitUntil(
      clients.openWindow(`/barista/order/${event.notification.data.orderId}`)
    );
    return;
  }
  
  // Default click action - open or focus the app
  event.waitUntil(
    clients.matchAll({type: 'window'})
      .then(clientList => {
        // If we have a client already open, focus it
        for (const client of clientList) {
          if (client.url.includes('/barista') && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Otherwise open a new window
        return clients.openWindow('/barista');
      })
  );
});