const CACHE="beta-access-static-v2";
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/admin/","/admin/icon.svg","/manifest.webmanifest"])));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim());});
self.addEventListener("fetch",e=>{const url=new URL(e.request.url);
 if(e.request.method!=="GET" || url.origin!==self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/qr/") || url.pathname.startsWith("/d/") || url.pathname.startsWith("/download/"))return;
 e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});

// Chrome/Android receives Web Push while the installed PWA is closed.
self.addEventListener("push",event=>{
 let data={};
 try{data=event.data?.json()||{};}catch(_){}
 const title="AIVEXUS Beta Access";
 event.waitUntil(self.registration.showNotification(title,{
  body:"Nuova richiesta WEmulDroid. Tocca per decidere.",
  icon:"/admin/icon-192.svg",badge:"/admin/icon.svg",
  tag:"beta-access-requests",renotify:true,data:{url:"/admin/"}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const destination=new URL("/admin/",self.location.origin).href;
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const windowClient of windows){
   if(new URL(windowClient.url).origin===self.location.origin){
    await windowClient.focus();
    if("navigate" in windowClient)await windowClient.navigate(destination);
    return;
   }
  }
  await self.clients.openWindow(destination);
 })());
});
