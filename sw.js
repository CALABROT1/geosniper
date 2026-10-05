/* GeoSniper — service worker simples (PWA).
   Objetivo: abrir mais rápido e mostrar o aplicativo mesmo sem rede por alguns instantes.
   NÃO guarda dados do usuário, respostas da API, mapas (Mapbox), meteorologia nem WebSocket:
   tudo isso sempre vai direto à rede (login, pontos, balística e mapas precisam de conexão).
   Páginas: rede primeiro (o usuário sempre recebe a versão nova quando há internet). */
const VERSAO = 'gs-2026-10-07';
const CACHE_APP = 'gs-app-' + VERSAO;
const CACHE_LIBS = 'gs-libs-1';
const APP = ['./', 'ballistics-engine.js', 'ajuda.js', 'ajuda-clips.js', 'mapas-config.js', 'manifest.webmanifest', 'icons/pwa/icon-192.png', 'icons/pwa/icon-512.png', 'icons/pwa/apple-touch-icon-180.png'];
const LIBS = ['unpkg.com', 'cdn.socket.io', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE_APP && k !== CACHE_LIBS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function redePrimeiro(req, cacheNome, timeoutMs) {
  return new Promise((resolve) => {
    let respondeu = false;
    const doCache = () => caches.match(req).then((r) => r || caches.match('./'));
    const t = setTimeout(() => { if (!respondeu) doCache().then((r) => { if (r && !respondeu) { respondeu = true; resolve(r); } }); }, timeoutMs);
    fetch(req).then((res) => {
      clearTimeout(t);
      if (res && res.ok) { const cp = res.clone(); caches.open(cacheNome).then((c) => c.put(req, cp)); }
      if (!respondeu) { respondeu = true; resolve(res); }
    }).catch(() => { clearTimeout(t); if (!respondeu) { respondeu = true; doCache().then((r) => resolve(r || Response.error())); } });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // bibliotecas públicas (versões fixas): cache primeiro
  if (LIBS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE_LIBS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }))));
    return;
  }
  // tudo o que não é do próprio site (API, Mapbox, meteorologia...) segue direto à rede
  if (url.origin !== self.location.origin) return;
  // páginas do app: rede primeiro, com cópia de reserva
  if (req.mode === 'navigate') { e.respondWith(redePrimeiro(req, CACHE_APP, 4000)); return; }
  // arquivos do próprio site (ícones, manifesto): rede primeiro também
  e.respondWith(redePrimeiro(req, CACHE_APP, 3000));
});
