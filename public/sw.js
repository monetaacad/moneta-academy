/* 모네타 아카데미 서비스 워커: 홈 화면에 설치(웹앱)할 수 있게 하고, 서버에 닿지 않을 때 마지막으로 받은 화면을 보여 준다.
   게임 정보(/api/)는 절대 저장하지 않는다. 화면 파일은 언제나 서버의 새 것을 먼저 받는다(network-first). */
const CACHE = 'moneta-shell-v3';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/net.js', '/draw.js', '/sound.js', '/shared/data.js', '/shared/rules.js', '/logo.png', '/favicon.png', '/manifest.webmanifest', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/admin')) return;   // 게임 정보 · 운영실은 그대로 서버로
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (SHELL.indexOf(u.pathname) >= 0 || e.request.mode === 'navigate')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request)));
});
