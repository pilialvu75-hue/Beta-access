// Production API smoke test. CI-only admin secret. Never print credentials.
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";

const origin="https://aivexus-beta-access.aivexus-lab.workers.dev";
const admin=process.env.BETA_ADMIN_TOKEN ?? "";
if (admin.length < 48) throw Error("Missing BETA_ADMIN_TOKEN action secret");

const id=randomUUID(), deviceKey=randomBytes(32).toString("hex");
const headers={"Content-Type":"application/json"};
const authorization={"Authorization":"Bearer "+admin};
const deviceAuth={"X-Device-Key":deviceKey};
const endpoint=(path,method="GET",payload,auth={})=>
  fetch(new URL(path,origin),{
    method,
    headers:{...headers,...auth},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
    redirect:"error",
    signal:AbortSignal.timeout(30000)
  });
async function request(path,method="GET",payload,auth={}) {
 const response=await endpoint(path,method,payload,auth);
 const data=await response.json().catch(()=>null);
 return {code:response.status,data};
}
function check(reply,code,state=null){
 assert.equal(reply.code,code,"Unexpected HTTP status");
 if(state!==null)assert.equal(reply.data?.state,state,"Unexpected activation state");
}
const enroll={app_id:"wemuldroid",installation_id:id,device_secret:deviceKey,
 platform:"windows",version:"0.0.0-smoke",label:"AUTOTEST CI (revocato)",telemetry_consent:false};
const rowPath="/api/admin/requests/"+id+"/decision";
const statusPath="/api/v1/status?installation_id="+id;
let created=false,revoked=false;
try{
 console.log("SMOKE: checking closed public enrollment");
 check(await request("/api/v1/enroll","POST",enroll),403);
 console.log("SMOKE: creating synthetic installation using admin-only authorization");
 check(await request("/api/v1/enroll","POST",enroll,authorization),200,"pending");
 created=true;
 check(await request(statusPath,"GET",undefined,deviceAuth),200,"pending");
 console.log("SMOKE: verifying protected administrator inbox");
 check(await request("/api/admin/requests"),401);
 const inbox=await request("/api/admin/requests","GET",undefined,authorization);
 check(inbox,200);
 assert.ok(inbox.data?.requests?.some(x=>x.id===id && x.state==="pending"),"Missing synthetic request");
 console.log("SMOKE: denial and renewed request");
 check(await request(rowPath,"POST",{action:"deny"},authorization),200,"denied");
 check(await request(statusPath,"GET",undefined,deviceAuth),200,"denied");
 check(await request("/api/v1/enroll","POST",enroll,authorization),200,"pending");
 console.log("SMOKE: approval with explicit duration");
 const approved=await request(rowPath,"POST",{action:"approve",duration_days:1},authorization);
 check(approved,200,"approved");
 assert.ok(Date.parse(approved.data?.approved_until)>Date.now(),"Missing expiry");
 check(await request(statusPath,"GET",undefined,deviceAuth),200,"approved");
 console.log("SMOKE: device credentials and telemetry consent remain enforced");
 check(await request(statusPath,"GET",undefined,{"X-Device-Key":randomBytes(32).toString("hex")}),403);
 const event={installation_id:id,event_id:randomUUID(),session:randomUUID(),
  event:"APP_START",severity:"info",producer_version:"0.0.0-smoke",fields:{startup_ms:123}};
 check(await request("/api/v1/telemetry","POST",event,deviceAuth),403);
 console.log("SMOKE: revoke and verify the device cannot resume access");
 check(await request(rowPath,"POST",{action:"revoke"},authorization),200,"revoked");
 revoked=true;
 check(await request(statusPath,"GET",undefined,deviceAuth),200,"revoked");
 console.log("LIVE SMOKE PASS: no beta download enabled and no diagnostics event uploaded");
} finally {
 if(created&&!revoked) {
  try {
   const res=await request(rowPath,"POST",{action:"revoke"},authorization);
   console.log(res.code===200?"SMOKE cleanup: synthetic access revoked":"SMOKE cleanup: failed to revoke synthetic access");
  }catch(_){console.log("SMOKE cleanup: revocation failed; inspect admin list");}
 }
}
