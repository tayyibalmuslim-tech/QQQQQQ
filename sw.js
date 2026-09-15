/* ============================================================
   مصحف التنقل — خدمة العمل بدون إنترنت
   غيّر رقم VERSION عند أي تعديل على الملفات ليأخذ المستخدمون النسخة الجديدة.
   ============================================================ */
const VERSION   = "v5";
const SHELL     = `mushaf-shell-${VERSION}`;
const RUNTIME   = `mushaf-runtime-${VERSION}`;

// ملفات التطبيق الأساسية — تُخزَّن كاملة عند أول فتح
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./fonts/AmiriQuran.woff2",
  "./data/quran-data.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);

  // Firebase وقاعدة البيانات: الشبكة فقط، ولا تُخزَّن أبدًا
  if(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com\/identitytoolkit|firebaseapp\.com/.test(url.href)){
    return;
  }

  // الخطوط: نعطي المخزَّن فورًا ونحدّثه في الخلفية
  if(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.href)){
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // صفحات التنقّل: الشبكة أولًا، وعند انقطاعها نرجع للنسخة المخزَّنة
  if(req.mode === "navigate"){
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true }))
    );
    return;
  }

  // باقي ملفات التطبيق: المخزَّن أولًا (أسرع، ويعمل بلا اتصال)
  if(url.origin === self.location.origin){
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetchAndStore(req))
    );
  }
});

function fetchAndStore(req){
  return fetch(req).then(res => {
    if(res && res.status === 200 && res.type === "basic"){
      const copy = res.clone();
      caches.open(RUNTIME).then(c => c.put(req, copy));
    }
    return res;
  });
}

function staleWhileRevalidate(req){
  return caches.open(RUNTIME).then(cache =>
    cache.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if(res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
}


/* ============================================================
   رسائل من الصفحة: تحميل يدوي وفحص الجاهزية
   ============================================================ */
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if(d.type === "PRECACHE")      e.waitUntil(precacheAll(e.source));
  else if(d.type === "STATUS")   e.waitUntil(reportStatus(e.source));
});

async function precacheAll(client){
  const c = await caches.open(SHELL);
  let done = 0, failed = 0;
  for(const f of SHELL_FILES){
    try{
      // cache:"reload" يتخطّى كاش المتصفح ليضمن نسخة كاملة وحديثة
      await c.add(new Request(f, { cache: "reload" }));
    }catch(err){ failed++; }
    done++;
    if(client) client.postMessage({ type:"PRECACHE_PROGRESS", done, total: SHELL_FILES.length });
  }
  if(client) client.postMessage({ type:"PRECACHE_DONE", failed });
}

async function reportStatus(client){
  const c = await caches.open(SHELL);
  let have = 0;
  for(const f of SHELL_FILES){
    if(await c.match(f, { ignoreSearch:true })) have++;
  }
  if(client) client.postMessage({ type:"STATUS_RESULT", have, total: SHELL_FILES.length });
}
