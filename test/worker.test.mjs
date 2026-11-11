import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
const env={PUBLIC_TESTERS_ENABLED:"false",APPROVED_BETA_TAG:""};
const req=p=>new Request("https://beta.example.test"+p);
test("public QR and releases are disabled until a new gated beta is approved",async()=>{
 const catalog=await worker.fetch(req("/api/catalog"),env,{});
 const data=await catalog.json();
 assert.equal(catalog.status,200);
 assert.equal(data.available,false);
 assert.equal(data.release,null);
 assert.equal(data.share_url,null);
 for(const path of ["/d/wemuldroid","/download/wemuldroid"]){
  const r=await worker.fetch(req(path),env,{});
  assert.equal(r.status,503);
 }
});
test("admin API requires server-side secret",async()=>{
 const r=await worker.fetch(req("/api/admin/requests"),env,{});
 assert.equal(r.status,401);
});
test("Android PWA root is served, not a redirect loop",async()=>{
 const assetEnv={...env,ASSETS:{fetch:async request=>new Response("PWA OK",{status:200})}};
 const redirect=await worker.fetch(req("/admin"),assetEnv,{});
 assert.equal(redirect.status,302);
 assert.equal(redirect.headers.get("location"),"https://beta.example.test/admin/");
 const page=await worker.fetch(req("/admin/"),assetEnv,{});
 assert.equal(page.status,200);
 assert.equal(await page.text(),"PWA OK");
});
