const CACHE="beta-access-static-v1";
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/admin/","/admin/icon.svg","/manifest.webmanifest"])));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim());});
self.addEventListener("fetch",e=>{const url=new URL(e.request.url);
 if(e.request.method!=="GET" || url.origin!==self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/qr/") || url.pathname.startsWith("/d/") || url.pathname.startsWith("/download/"))return;
 e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
