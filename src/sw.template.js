/* 원본 틀: 빌드 때 dist/sw.js 로 나감 (직접 고치지 말고 이 파일을 고칠 것) */
/* 서비스 워커: 한 번 열면 헬스장에서 인터넷이 없어도 열림.
   - 화면(HTML)은 네트워크 먼저, 안 되면 저장본
   - 빌드 파일(assets, 아이콘)은 저장본 먼저 (파일 이름에 버전 해시가 있어 안전)
   - 새 버전은 자동으로 바꾸지 않고, 앱이 "새 버전 있음"을 보여 준 뒤 사용자가 누를 때만 적용 (운동 중 새로고침 방지) */
// 캐시 이름 = 앱 이름(서비스 워커 범위의 마지막 폴더) + ':' + 버전 (D-031).
// 같은 주소의 다른 앱(예: 미리 보기 판 workout-app-next)의 캐시를 지우지 않도록, 자기 앞머리('앱이름:')와 옛 이름만 지운다
const APP = new URL(self.registration.scope).pathname.split('/').filter(Boolean).pop() || 'app';
// 빌드 이름 (D-055): 빌드할 때 tools/sw_build.ts 가 버전+파일 해시로 바꿔 넣음. 브라우저는 sw.js 내용이 바뀌어야 새 버전을 설치하므로
// 배포마다 이 줄이 달라져 "새 버전 준비됨" 안내가 뜬다. 캐시 이름에도 넣어 옛 캐시를 정리한다
const BUILD = '__BUILD__';
const CACHE = APP + ':' + BUILD;
// 빌드 파일 전체 목록 (0.9.3): 화면을 나눠 받게 되어(lazy) HTML 에 없는 묶음도 있으므로, 빌드 때 tools/sw_build.ts 가 assets/ 목록을 넣는다.
// 설치(첫 화면 묶음) → 화면을 맡은(claim) 뒤에 나머지를 담는다: 설치가 길어지면 처음 설치 때의 한 번 새로 고침이 사용 도중에 일어나므로.
// 다 담기면 처음 연 뒤로는 한 번도 안 연 화면도 인터넷 없이 열림
const ASSETS = [/*__ASSETS__*/];
const OWN = (k) => k.startsWith(APP + ':') || k === APP + '-v1';
// 설치 때 화면(HTML)과 그 화면이 쓰는 빌드 파일(assets)까지 미리 담음: 새 버전으로 바뀐 직후 인터넷이 없어도 열리게
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    // HTTP 캐시의 옛 화면을 받지 않도록 새로 받아 옴
    await c.addAll([new Request('./', { cache: 'reload' }), './manifest.webmanifest', './icons/icon-192.png']);
    try {
      const html = await (await c.match('./')).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
      if (assets.length) await c.addAll(assets);
    } catch { /* 없으면 처음 열 때 담김 */ }
  }));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
// 나머지 묶음 채우기 (검토 R2): activate 의 waitUntil 밖에서 (활성화·화면 맡기·fetch 를 막지 않게).
// 활성화가 끝나면 한 번 시작하고, 워커가 그 전에 멈췄으면 다음 fetch 때 이어서 (fetch 응답은 기다리지 않음). 한 번에 하나만
let filling = null;
let filled = false;
function fillRest() {
  if (filled) return Promise.resolve();
  filling ??= caches.open(CACHE).then(async (c) => {
    const want = ASSETS.map((a) => new URL(a, self.registration.scope).href);
    const have = new Set((await c.keys()).map((r) => r.url));
    const missing = want.filter((u) => !have.has(u));
    if (missing.length) await c.addAll(missing);
    filled = true;
  }).catch(() => { /* 못 담은 것은 다음 기회에 */ }).finally(() => { filling = null; });
  return filling;
}
self.addEventListener('activate', (e) => {
  const done = caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && OWN(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim());
  e.waitUntil(done);
  done.then(() => setTimeout(() => { void fillRest(); }, 1000), () => undefined);
});
// D-056 실험: 휴식 끝 알림을 누르면 앱(운동 화면)으로
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '#/workout', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) return c.focus().then((f) => (f && 'navigate' in f ? f.navigate(url) : f)).catch(() => c.focus());
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // version.json (D-055): 항상 네트워크로만 (저장하면 새 버전 안내가 옛 내용을 보여 줌). 앱도 cache:'no-store' 로 읽음
  if (new URL(req.url).pathname.endsWith('/version.json')) return;
  if (!filled) e.waitUntil(fillRest()); // 응답과 따로 (워커가 살아 있게만, 응답은 기다리지 않음)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; })
      .catch(() => caches.match('./')));
    return;
  }
  // ignoreVary: 미리 담은 묶음(서비스 워커가 받음, Origin 머리글 없음)이 화면의 모듈 요청(Origin 있음)과도 맞게. 파일 이름에 내용 해시가 있어 안전
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
