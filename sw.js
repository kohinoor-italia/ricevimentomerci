/* Service Worker — Registro Scarichi (KOH-I-NOOR)
   Strategii:
   - Pagina (HTML)         : network-first (timeout 4s) → cache
   - Supabase GET (date)   : network-first (timeout 6s) → cache
   - Fonturi / imagini     : stale-while-revalidate
   - Supabase POST/DELETE  : direct la rețea (nu se cachează)
*/
const VERSION = 'v1';
const CACHE_PAGE = `scarichi-page-${VERSION}`;
const CACHE_DATA = `scarichi-data-${VERSION}`;
const CACHE_ASSETS = `scarichi-assets-${VERSION}`;
const ALL_CACHES = [CACHE_PAGE, CACHE_DATA, CACHE_ASSETS];

const SUPABASE_HOST = 'fndjrfieitieqzafhyzz.supabase.co';

const PRECACHE_PAGE = ['./', './index.html'];
const PRECACHE_ASSETS = [
  'https://www.kin.it/img/logo_KIN_quadrato.jpg',
  'https://github.com/kohinoor-italia/ricevimentomerci/raw/refs/heads/main/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const page = await caches.open(CACHE_PAGE);
    // addAll ar eșua dacă un fișier lipsește → le încercăm individual
    await Promise.all(PRECACHE_PAGE.map((u) => page.add(u).catch(() => {})));

    const assets = await caches.open(CACHE_ASSETS);
    await Promise.all(PRECACHE_ASSETS.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { mode: 'no-cors' }));
        await assets.put(u, res);
      } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ─── helpers ────────────────────────────────────────────────────────────────
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(req, cacheName, timeoutMs, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetchWithTimeout(req, timeoutMs);
    if (res && res.ok) cache.put(cacheKey || req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(cacheKey || req, { ignoreSearch: false });
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

// ─── fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/DELETE către Supabase merg direct

  const url = new URL(req.url);

  // 1) Navigare (pagina HTML)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await networkFirst(req, CACHE_PAGE, 4000, './index.html');
      } catch (e) {
        const cache = await caches.open(CACHE_PAGE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // 2) Supabase REST (GET)
  if (url.hostname === SUPABASE_HOST) {
    // heartbeat-ul (limit=1) nu se cachează
    if (url.searchParams.get('limit') === '1') return;
    event.respondWith(
      networkFirst(req, CACHE_DATA, 6000).catch(() =>
        new Response(JSON.stringify({ message: 'offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 3) Fonturi Google + imagini externe (logo, icon)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'www.kin.it' ||
    url.hostname === 'github.com' ||
    url.hostname === 'raw.githubusercontent.com' ||
    req.destination === 'image' || req.destination === 'font' || req.destination === 'style'
  ) {
    event.respondWith(staleWhileRevalidate(req, CACHE_ASSETS));
    return;
  }

  // 4) Același origin (sw.js, manifest etc.)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, CACHE_PAGE));
  }
});

// Permite forțarea update-ului din pagină: reg.waiting.postMessage('SKIP_WAITING')
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
