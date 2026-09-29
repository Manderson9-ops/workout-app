/* 서비스 워커: 한 번 열면 헬스장에서 인터넷이 없어도 열림.
   - 화면(HTML)은 네트워크 먼저, 안 되면 저장본
   - 빌드 파일(assets, 아이콘)은 저장본 먼저 (파일 이름에 버전 해시가 있어 안전)
   - 새 버전은 자동으로 바꾸지 않고, 앱이 "새 버전 있음"을 보여 준 뒤 사용자가 누를 때만 적용 (운동 중 새로고침 방지) */
const CACHE = 'workout-app-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; })
      .catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
