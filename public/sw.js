/* 서비스 워커: 한 번 열면 헬스장에서 인터넷이 없어도 열림.
   - 화면(HTML)은 네트워크 먼저, 안 되면 저장본
   - 빌드 파일(assets, 아이콘)은 저장본 먼저 (파일 이름에 버전 해시가 있어 안전)
   - 새 버전은 자동으로 바꾸지 않고, 앱이 "새 버전 있음"을 보여 준 뒤 사용자가 누를 때만 적용 (운동 중 새로고침 방지) */
// 캐시 이름 = 앱 이름(서비스 워커 범위의 마지막 폴더) + ':' + 버전 (D-031).
// 같은 주소의 다른 앱(예: 미리 보기 판 workout-app-next)의 캐시를 지우지 않도록, 자기 앞머리('앱이름:')와 옛 이름만 지운다
const APP = new URL(self.registration.scope).pathname.split('/').filter(Boolean).pop() || 'app';
const CACHE = APP + ':v2';
const OWN = (k) => k.startsWith(APP + ':') || k === APP + '-v1';
// 설치 때 화면(HTML)과 그 화면이 쓰는 빌드 파일(assets)까지 미리 담음: 새 버전으로 바뀐 직후 인터넷이 없어도 열리게
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png']);
    try {
      const html = await (await c.match('./')).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
      if (assets.length) await c.addAll(assets);
    } catch { /* 없으면 처음 열 때 담김 */ }
  }));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && OWN(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
