/* 主屏 App 的 Service Worker
   - 页面外壳（HTML/CSS/JS/图标）：HTML 网络优先，断网才用缓存；带 ?v= 的脚本样式按版本缓存
   - 数据（所有 .json 和 ESPN 接口）：网络优先，有网永远用最新；只有拿不到网络时才返回上次缓存，并加 x-sw-cache（缓存时间），页面据此显示红色“⚠ 数据已旧”
   - version.json 只走网络；发新版时这个文件的 VER 会被提交钩子改掉，SW 立即接管（skipWaiting + clients.claim） */
var VER = "59e16d3b95";
var SHELL = "shell-" + VER, DATA = "data-v1", lastPut = {};
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return fetch("./", { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (h) {
      var urls = ["manifest.json", "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/icon.svg"];
      (h.match(/(?:src|href)="([^"]+\?v=[^"]+)"/g) || []).forEach(function (m) { urls.push(m.replace(/^(?:src|href)="|"$/g, "")); });
      return c.put("./", new Response(h, { headers: { "content-type": "text/html; charset=utf-8" } })).then(function () { return c.addAll(urls); });
    });
  }).catch(function () {}));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
function dataKey(u) { var x = new URL(u); x.searchParams.delete("t"); return x.toString(); }
self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var u = new URL(req.url), same = u.origin === self.location.origin;
  if (req.mode === "navigate") { // 页面：网络优先
    e.respondWith(fetch(req, { cache: "no-store" }).then(function (r) { if (r.ok) { var cp = r.clone(); caches.open(SHELL).then(function (c) { c.put("./", cp); }); } return r; }).catch(function () { return caches.match("./"); }));
    return;
  }
  if (same && /\/version\.json$/.test(u.pathname)) return; // 版本号只走网络
  if ((same && /\.json$/.test(u.pathname)) || u.hostname === "site.api.espn.com") { // 数据：网络优先，断网才用缓存并标时间
    var key = dataKey(req.url);
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok && Date.now() - (lastPut[key] || 0) > 30000) { // 同一个地址最多 30 秒存一次，省手机读写
        lastPut[key] = Date.now(); var cp = r.clone();
        cp.blob().then(function (b) { return caches.open(DATA).then(function (c) { return c.put(key, new Response(b, { headers: { "content-type": "application/json", "x-sw-time": String(Date.now()) } })); }); }).catch(function () {});
      }
      return r;
    }).catch(function (err) {
      return caches.open(DATA).then(function (c) { return c.match(key); }).then(function (m) {
        if (!m) throw err;
        return m.blob().then(function (b) { return new Response(b, { status: 200, headers: { "content-type": "application/json", "x-sw-cache": m.headers.get("x-sw-time") || "0" } }); });
      });
    }));
    return;
  }
  if (same) { // 外壳静态文件：带版本号的按版本缓存；其余缓存优先、后台更新
    e.respondWith(caches.open(SHELL).then(function (c) { return c.match(req).then(function (m) {
      var net = fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; });
      return m || net;
    }); }));
  }
});
