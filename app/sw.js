/* 최소 서비스워커: 앱 셸 캐시, 시세 API는 항상 네트워크 */
const CACHE = 'coinchart-v2';
const SHELL = ['.', 'index.html', 'style.css', 'app.js', 'manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API·CDN은 네트워크 직행
  // network-first: 배포 후 구버전 셸이 고착되지 않게. 오프라인일 때만 캐시.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
