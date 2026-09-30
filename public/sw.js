const CACHE_NAME = 'ai-hanzi-tutor-v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/apple-touch-icon.png'];
const MAX_CACHE_ENTRIES = 120;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_ENTRIES) {
    await cache.delete(keys[0]);
    return trimCache(cache);
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // 只缓存同源静态资源：绝不缓存跨域的 AI 模型接口（Gemini/OpenAI），
  // 避免把模型返回和可能含 Key 的 URL 写进 CacheStorage
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        if (response.ok && response.type === 'basic') {
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy).then(() => trimCache(cache)));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/')))
  );
});
