import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const origin="https://beta.example.test";
const path="/api/admin/pilot/diagnostics-access";
const adminToken="A".repeat(64);
const diagToken="test-fine-grained-github-token-not-real";
const env={ADMIN_TOKEN:adminToken,DIAGNOSTICS_GITHUB_TOKEN:diagToken};
const request=(authenticated=true)=>new Request(origin+path,{headers:authenticated?{authorization:"Bearer "+adminToken}:{}});
const check=async()=>worker.fetch(request(),env,{});

test("owner-only diagnostics probe never exposes GitHub credentials",async()=>{
 const denied=await worker.fetch(request(false),env,{});
 assert.equal(denied.status,401);
 const omitted=await worker.fetch(request(),{ADMIN_TOKEN:adminToken},{});
 assert.equal(omitted.status,200);
 const noToken=await omitted.json();
 assert.equal(noToken.status,"missing_token");
 assert.equal(noToken.remote_upload_tested,false);
 assert.equal(JSON.stringify(noToken).includes(diagToken),false);
});

test("Diagnostics GitHub probe distinguishes write, read-only and unavailable without upload",async()=>{
 const original=globalThis.fetch;
 const seen=[];
 try {
  globalThis.fetch=async(url,options)=>{
   seen.push({url,options});
   return Response.json({
    full_name:"pilialvu75-hue/Ai-orchestrator-diagnostics",
    permissions:{pull:true,push:true}
   });
  };
  let r=await check();
  let data=await r.json();
  assert.equal(data.status,"write_reported");
  assert.equal(data.repository_accessible,true);
  assert.equal(data.write_permission_reported,true);
  assert.equal(data.remote_upload_tested,false);
  assert.equal(JSON.stringify(data).includes(diagToken),false);
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,"https://api.github.com/repos/pilialvu75-hue/Ai-orchestrator-diagnostics");
  assert.equal(seen[0].options.headers.Authorization,"Bearer "+diagToken);
  assert.equal(seen[0].options.method??"GET","GET","Probe must not upload or mutate repository");
  assert.equal(seen[0].options.cache,"no-store");

  globalThis.fetch=async()=>Response.json({
   full_name:"pilialvu75-hue/Ai-orchestrator-diagnostics",
   permissions:{push:false}
  });
  data=await (await check()).json();
  assert.equal(data.status,"read_only");
  assert.equal(data.write_permission_reported,false);

  globalThis.fetch=async()=>Response.json({
   full_name:"pilialvu75-hue/Ai-orchestrator-diagnostics"
  });
  data=await (await check()).json();
  assert.equal(data.status,"write_unknown","Missing permissions must not count as write");
  assert.equal(data.write_permission_reported,null);

  globalThis.fetch=async()=>new Response("not found",{status:404});
  data=await (await check()).json();
  assert.equal(data.status,"repository_not_accessible");

  globalThis.fetch=async()=>new Response("expired",{status:401});
  data=await (await check()).json();
  assert.equal(data.status,"invalid_token");

  globalThis.fetch=async()=>{throw Error("offline");};
  data=await (await check()).json();
  assert.equal(data.status,"network_unavailable");
 }finally{globalThis.fetch=original;}
});

test("Galaxy readiness report describes permissions without reporting live delivery",async()=>{
 const fs=await import("node:fs");
 const ui=fs.readFileSync(new URL("../public/admin/index.html",import.meta.url),"utf8");
 assert.match(ui,/\/api\/admin\/pilot\/diagnostics-access/);
 assert.match(ui,/scrittura dichiarata/);
 assert.match(ui,/invio reale NON ancora testato/);
 assert.match(ui,/Pubblicazione reale Diagnostics: NON ANCORA COLLAUDATA/);
 const start=ui.indexOf("pilotReport=[");
 const end=ui.indexOf("].join(\"\\n\");",start);
 assert.ok(start>=0&&end>start);
 const reportBody=ui.slice(start,end);
 for(const secret of ["DIAGNOSTICS_GITHUB_TOKEN","VAPID_PRIVATE_KEY","invite_token","tester_email"]){
  assert.ok(!reportBody.includes(secret),"Do not print secret in report: "+secret);
 }
});
