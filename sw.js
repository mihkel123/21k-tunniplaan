/* Offline-tugi. Rakenduse failid vahemälust, andmed võrgust (vahemälu varuks). */

// Töövoog asendab selle väljalaske numbriga. Kohapeal jääb 'dev'.
// Number muutub iga commitiga, seega uus väljalase kustutab vana vahemälu
// ja kest (app.js, styles.css) jõuab telefoni kohale — muidu võib
// teenusetöötleja vana versiooni edasi serveerida.
const VERSION = 'dev';
const SHELL = `tp-shell-${VERSION}`;
const DATA = `tp-data-${VERSION}`;

const SHELL_FILES = [
  '.', 'index.html', 'styles.css', 'app.js', 'schedule.js', 'bus.js', 'manifest.webmanifest',
  // Nimepäevad ja tähtpäevad ei muutu — need käivad kesta, mitte andmete alla,
  // muidu laeks 17 KB nimesid iga avamisega uuesti.
  'notabledays.json', 'namedays.json', 'overrides.json',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png',
];
const DATA_FILES = ['data.json', 'changes.json', 'holidays.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    const data = await caches.open(DATA);
    await data.addAll(DATA_FILES).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, DATA]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isData = DATA_FILES.some((f) => url.pathname.endsWith(f));

  if (isData) {
    // Värskus on tähtsam kui kiirus: võrk ees, vahemälu varuks.
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) (await caches.open(DATA)).put(request, fresh.clone());
        return fresh;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        throw new Error('offline ja vahemälus puudub');
      }
    })());
    return;
  }

  // Bussigraafikud (/bus/) satuvad siia samuti: vahemälust kohe, taustal uuenda.
  // Reaalajapäring läheb teise päritolu pihta ja on juba ülal välja filtreeritud.
  // Rakenduse failid: vahemälust kohe, taustal uuenda.
  e.respondWith((async () => {
    const hit = await caches.match(request);
    const network = fetch(request)
      .then(async (res) => {
        if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
        return res;
      })
      .catch(() => null);
    if (hit) { network; return hit; }
    const res = await network;
    if (res) return res;
    return (await caches.match('index.html')) ?? Response.error();
  })());
});
