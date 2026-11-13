// Manual, owner-authorized production probe. Not run by CI or any deploy.
// A single synthetic, privacy-filtered event is published to the PUBLIC
// Ai-orchestrator-diagnostics GitHub repository after an explicit Actions opt-in.
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const WORKER="https://aivexus-beta-access.aivexus-lab.workers.dev";
const DIAG_REPO="pilialvu75-hue/Ai-orchestrator-diagnostics";
const GH="https://api.github.com/repos/"+DIAG_REPO;
export const PROBE_LABEL="AUTOTEST DIAGNOSTICS (synthetic)";
const VERSION="0.0.0-smoke"; // The Worker explicitly suppresses push notifications for this version.
const INTERVAL_MS=12000,MAX_POLLS=45;
const EXPECTED_KEYS=["event","fields","instance","platform","producer","producer_version","schema","session","severity","timestamp"];

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ghHeaders=token=>({
 "Authorization":"Bearer "+token,
 "Accept":"application/vnd.github+json",
 "X-GitHub-Api-Version":"2022-11-28",
 "User-Agent":"Aivexus-Beta-Access-Diagnostics-Probe/1.0"
});
function assertState(result,status,state) {
 assert.equal(result.status,status,"Unexpected HTTP status");
 if(state!==undefined)assert.equal(result.body?.state,state,"Unexpected activation status");
}
async function jsonRequest(url,{method="GET",headers={},body}={}) {
 const reply=await fetch(url,{
  method,headers,redirect:"error",signal:AbortSignal.timeout(30000),
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const data=await reply.json().catch(()=>null);
 return {status:reply.status,body:data};
}
export function verifySyntheticArchive(raw,{installationId,sessionId}) {
 assert.equal(typeof raw,"string");
 assert.ok(Buffer.byteLength(raw,"utf8")<4096,"Unexpectedly large diagnostic asset");
 const lines=raw.trimEnd().split("\n");
 assert.equal(lines.length,1,"The synthetic installation should have exactly one archived event");
 const event=JSON.parse(lines[0]);
 assert.deepEqual(Object.keys(event).sort(),EXPECTED_KEYS);
 assert.equal(event.schema,"ai-orchestrator.diagnostics.event.v2");
 assert.equal(event.producer,"wemuldroid");
 assert.equal(event.producer_version,VERSION);
 assert.equal(event.platform,"windows");
 assert.equal(event.instance,installationId);
 assert.equal(event.session,sessionId);
 assert.equal(event.event,"APP_START");
 assert.equal(event.severity,"info");
 assert.ok(Number.isFinite(Date.parse(event.timestamp)),"Invalid archive timestamp");
 assert.deepEqual(event.fields,{startup_ms:123});
 return true;
}

export async function runOwnerAuthorizedProbe() {
 const admin=process.env.BETA_ADMIN_TOKEN||"";
 const githubToken=process.env.DIAGNOSTICS_GITHUB_TOKEN||"";
 assert.ok(admin.length>=48,"BETA_ADMIN_TOKEN not configured");
 assert.ok(githubToken.length>=16,"DIAGNOSTICS_GITHUB_TOKEN not configured");
 const adminHeaders={"Authorization":"Bearer "+admin,"Content-Type":"application/json"};
 const githubHeaders=ghHeaders(githubToken);
 const id=randomUUID(),key=randomBytes(32).toString("hex");
 const sessionId=randomUUID(),eventId=randomUUID();
 const tag="diagnostics-wemuldroid-v1-"+id;
 const deviceHeaders={"X-Device-Key":key,"Content-Type":"application/json"};
 let created=false,archiveVerified=false,revocationFailed=false;
 // Validate the instance is unique before adding anything to the real database.
 const existing=await jsonRequest(GH+"/releases/tags/"+tag,{headers:githubHeaders});
 assert.equal(existing.status,404,"Unexpected existing synthetic Diagnostics release");
 console.log("PROBE: verifying closed public and private pilot gates");
 const ready=await jsonRequest(WORKER+"/api/admin/pilot/readiness",{headers:adminHeaders});
 assert.equal(ready.status,200,"Owner authentication failed");
 assert.equal(ready.body?.infrastructure_checks_pass,true,"Pilot infrastructure is not ready");
 assert.equal(ready.body?.public_download_enabled,false,"Public downloads must remain OFF");
 assert.equal(ready.body?.private_pilot_enabled,false,"Private pilot must remain OFF");
 assert.equal(ready.body?.diagnostics_configured,true);
 const enroll={
  app_id:"wemuldroid",installation_id:id,device_secret:key,
  platform:"windows",version:VERSION,
  label:PROBE_LABEL,
  telemetry_consent:true
 };
 const decision=WORKER+"/api/admin/requests/"+id+"/decision";
 try {
  const uninvited=await jsonRequest(WORKER+"/api/v1/enroll",{
   method:"POST",headers:{"Content-Type":"application/json"},body:enroll
  });
  assert.equal(uninvited.status,403,"Public enrollment unexpectedly allowed");
  console.log("PROBE: creating one synthetic admin-only installation (no notifications)");
  assertState(await jsonRequest(WORKER+"/api/v1/enroll",{
   method:"POST",headers:adminHeaders,body:enroll
  }),200,"pending");
  created=true;
  assertState(await jsonRequest(decision,{
   method:"POST",headers:adminHeaders,body:{action:"approve",duration_days:1}
  }),200,"approved");
  const status=await jsonRequest(WORKER+"/api/v1/status?installation_id="+id,{headers:deviceHeaders});
  assertState(status,200,"approved");
  assert.equal(status.body?.telemetry_consent,true);
  console.log("PROBE: posting one non-personal technical event with explicit synthetic consent");
  const pushed=await jsonRequest(WORKER+"/api/v1/telemetry",{
   method:"POST",headers:deviceHeaders,body:{
    installation_id:id,event_id:eventId,session:sessionId,
    event:"APP_START",severity:"info",
    producer_version:VERSION,fields:{startup_ms:123}
   }
  });
  assert.equal(pushed.status,200,"Worker rejected the synthetic telemetry event");
  assert.equal(pushed.body?.accepted,true);
  console.log("PROBE: waiting for the scheduled Worker relay and GitHub read-back (up to 9 minutes)");
  for(let attempt=0;attempt<MAX_POLLS;attempt++) {
   const remote=await jsonRequest(GH+"/releases/tags/"+tag,{headers:githubHeaders});
   assert.ok([200,404].includes(remote.status),"GitHub could not read the synthetic release");
   if(remote.status===200) {
    assert.equal(remote.body?.tag_name,tag);
    const assets=remote.body?.assets||[];
    for(const asset of assets) {
     if(!/^wemuldroid-diag-[a-f0-9]{64}\.jsonl$/.test(asset.name||""))continue;
     assert.equal(asset.state,"uploaded");
     assert.ok(asset.size>0&&asset.size<4096,"Unexpected asset size");
     const expectedPrefix="https://github.com/"+DIAG_REPO+"/releases/download/"+tag+"/";
     assert.ok(asset.browser_download_url?.startsWith(expectedPrefix),"Unexpected asset host/path");
     const file=await fetch(asset.browser_download_url,{
      redirect:"follow",signal:AbortSignal.timeout(30000)
     });
     assert.equal(file.status,200,"Unable to read back GitHub asset");
     const raw=await file.text();
     verifySyntheticArchive(raw,{installationId:id,sessionId});
     archiveVerified=true;
     console.log("PROBE PASS: Worker -> Cloudflare D1 -> GitHub release asset -> JSONL read-back");
     console.log("PUBLIC SYNTHETIC EVIDENCE: "+remote.body.html_url);
     return;
    }
   }
   if(attempt<MAX_POLLS-1)await sleep(INTERVAL_MS);
  }
  throw new Error("Diagnostics publication/read-back not confirmed within the retry window");
 }finally{
  if(created){
   try{
    assertState(await jsonRequest(decision,{
     method:"POST",headers:adminHeaders,body:{action:"revoke"}
    }),200,"revoked");
    console.log("PROBE: synthetic installation revoked");
   }catch(_){
    revocationFailed=true;
    console.error("PROBE WARNING: synthetic installation revocation failed; inspect owner inbox");
   }
  }
  // A queued event may publish after a timeout. The manually authorized
  // synthetic release is deliberately retained as public technical evidence.
  if(revocationFailed || !archiveVerified){
   console.error("PROBE: real publication remains unverified; do not enable the external pilot");
   if(revocationFailed)process.exitCode=1;
  }
 }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 await runOwnerAuthorizedProbe();
}
