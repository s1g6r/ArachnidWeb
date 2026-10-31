/* VEX Scan offline cache: the app and the plate reader are cached for good
   (venue wifi is bad); team data is fetched fresh when there's a connection
   and served from the cache when there isn't. */
const VERSION = "vexscan-2";
const SHELL = ["./", "index.html", "scan.css", "scan.js", "ocr.js", "manifest.webmanifest", "icons/icon-192.png",
  "vendor/tesseract/tesseract.min.js", "vendor/tesseract/worker.min.js", "data/scan-override.json"];
const READER = ["vendor/tesseract/tesseract-core-simd-lstm.wasm.js", "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/eng.traineddata.gz"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isData = url.pathname.endsWith("/scan.json") || url.pathname.includes("/data/");
  const sameApp = url.origin === location.origin && !url.pathname.startsWith("/web/");
  if (isData) {
    // network first, cache as the fallback
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
  } else if (sameApp) {
    // cache first; the reader's big files get cached the first time they're used
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok && (READER.some(p => url.pathname.endsWith(p)) || SHELL.some(p => url.pathname.endsWith(p.replace("./", "/"))))) {
        const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c));
      }
      return r;
    })));
  }
});
