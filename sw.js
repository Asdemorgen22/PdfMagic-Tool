/* PdfMagicTool offline service worker — cache-first app shell, runtime-cache webfonts. */
var SHELL_CACHE = "pdfmagictool-shell-v1";
var FONT_CACHE = "pdfmagictool-fonts-v1";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./pdf-tool.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/pdf-lib.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/jszip.min.js",
  "./img/compare-sample-v3.jpg"
];

self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    var cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(function (u) {
      return cache.add(u).catch(function () {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      if (k !== SHELL_CACHE && k !== FONT_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    var fontLike = /\.(woff2|woff|ttf|otf)$/.test(url.pathname) ||
      url.hostname.indexOf("fonts.g") !== -1;
    if (!fontLike) return;
    e.respondWith((async function () {
      var cache = await caches.open(FONT_CACHE);
      var hit = await cache.match(req);
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })());
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith((async function () {
      try {
        var net = await fetch(req);
        var cache = await caches.open(SHELL_CACHE);
        cache.put("./index.html", net.clone());
        return net;
      } catch (err) {
        var c2 = await caches.open(SHELL_CACHE);
        return (await c2.match("./index.html")) || (await c2.match("./"));
      }
    })());
    return;
  }
  e.respondWith((async function () {
    var cache = await caches.open(SHELL_CACHE);
    var hit = await cache.match(req);
    if (hit) return hit;
    try {
      var net = await fetch(req);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch (err) {
      return hit;
    }
  })());
});
