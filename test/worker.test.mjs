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

test("enrollment is closed when public beta distribution is disabled",async()=>{
 const q=new Request("https://beta.example.test/api/v1/enroll",{method:"POST",
  headers:{"content-type":"application/json"},body:JSON.stringify({app_id:"wemuldroid"})});
 const blocked=await worker.fetch(q,env,{});
 assert.equal(blocked.status,403);
 const badAdmin=new Request("https://beta.example.test/api/v1/enroll",{method:"POST",
  headers:{"authorization":"Bearer WRONG","content-type":"application/json"},body:"{}"});
 assert.equal((await worker.fetch(badAdmin,{...env,ADMIN_TOKEN:"a".repeat(64)},{})).status,403);
 const goodAdmin=new Request("https://beta.example.test/api/v1/enroll",{method:"POST",
  headers:{"authorization":"Bearer "+"a".repeat(64),"content-type":"application/json"},body:"{}"});
 assert.equal((await worker.fetch(goodAdmin,{...env,ADMIN_TOKEN:"a".repeat(64)},{})).status,400);
 const publicRequest=new Request("https://beta.example.test/api/v1/enroll",{method:"POST",
  headers:{"content-type":"application/json"},body:"{}"});
 assert.equal((await worker.fetch(publicRequest,{...env,PUBLIC_TESTERS_ENABLED:"true"},{})).status,400);
});

test("new passkey enrollment stays closed until the account owner opens it",async()=>{
 const req=new Request("https://aivexus-beta-access.aivexus-lab.workers.dev/api/admin/passkey/register/options",{method:"POST",headers:{"Origin":"https://aivexus-beta-access.aivexus-lab.workers.dev"}});
 const response=await worker.fetch(req,{PASSKEY_ENROLLMENT_OPEN:"false"}, {});
 assert.equal(response.status,403);
});
test("untrusted origin cannot open passkey registration",async()=>{
 const req=new Request("https://aivexus-beta-access.aivexus-lab.workers.dev/api/admin/passkey/register/options",{method:"POST",headers:{"Origin":"https://evil.test"}});
 const response=await worker.fetch(req,{PASSKEY_ENROLLMENT_OPEN:"true"},{});
 assert.equal(response.status,403);
});
