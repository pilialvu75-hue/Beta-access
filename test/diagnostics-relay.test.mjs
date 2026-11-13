import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {flushDiagnostics} from "../src/worker.mjs";

// No Cloudflare connection, real GitHub API or tester data is used here.
// The production relay is exercised against a deterministic D1/GitHub simulation.
const installationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const diagnosticsRepo="pilialvu75-hue/Ai-orchestrator-diagnostics";
const githubBase="https://api.github.com/repos/"+diagnosticsRepo;
const uploadBase="https://uploads.github.com/repos/"+diagnosticsRepo;
const token="ci-test-token-not-a-real-secret";
const event=JSON.stringify({
  schema:"ai-orchestrator-diagnostics/v1",
  installation_id:installationId,
  event_id:eventId,
  event:"APP_START",
  fields:{startup_ms:123}
});
const payload=event+"\n";
const assetName="wemuldroid-diag-"+createHash("sha256").update(payload).digest("hex")+".jsonl";

function createFixture({uploadStatus=201,assetAlreadyPresent=false,releaseStatus=201,invalidId=false,configured=true}={}) {
  const calls=[];
  const shipped=[];
  let dbReads=0;
  const existingAsset={name:assetName,state:"uploaded",size:Buffer.byteLength(payload),created_at:"2026-11-13T00:00:00Z"};
  const env={
    ...(configured?{DIAGNOSTICS_GITHUB_TOKEN:token}:{}),
    DB:{
      prepare(sql) {
        if(sql.startsWith("SELECT event_id,installation_id,payload_json FROM telemetry_outbox")) {
          return {all:async()=>{
            dbReads++;
            return {results:[{event_id:eventId,installation_id:invalidId?"invalid-device-id":installationId,payload_json:event}]};
          }};
        }
        if(sql.startsWith("UPDATE telemetry_outbox SET shipped_at=")) {
          return {bind:(_date,id)=>({run:async()=>{shipped.push(id);return {success:true};}})};
        }
        if(sql.startsWith("DELETE FROM telemetry_outbox WHERE shipped_at IS NOT NULL")) {
          return {bind:()=>({run:async()=>({success:true})})};
        }
        throw new Error("Unexpected D1 query in relay: "+sql);
      }
    }
  };
  const fakeFetch=async (url,options={})=>{
    const target=String(url);
    const method=options.method||"GET";
    calls.push({url:target,method,options});
    if(target===githubBase+"/releases/tags/diagnostics-wemuldroid-v1-"+installationId && method==="GET")
      return new Response(null,{status:404});
    if(target===githubBase+"/releases" && method==="POST")
      return releaseStatus===201?Response.json({id:42},{status:201}):new Response(null,{status:releaseStatus});
    if(target===githubBase+"/releases/42/assets?per_page=100&page=1" && method==="GET")
      return Response.json(assetAlreadyPresent?[existingAsset]:[]);
    if(target.startsWith(uploadBase+"/releases/42/assets?name=") && method==="POST")
      return uploadStatus===201?Response.json({state:"uploaded"},{status:201}):new Response(null,{status:uploadStatus});
    throw new Error("Unexpected network request: "+method+" "+target);
  };
  return {env,calls,shipped,fakeFetch,get dbReads(){return dbReads;}};
}

async function withMockedGitHub(fixture,run) {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=fixture.fakeFetch;
    return await run();
  }finally{
    globalThis.fetch=original;
  }
}

test("Diagnostics relay refuses missing token before reading D1 or contacting GitHub",async()=>{
  const fixture=createFixture({configured:false});
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  assert.equal(fixture.dbReads,0);
  assert.equal(fixture.calls.length,0);
  assert.deepEqual(fixture.shipped,[]);
});

test("successful relay archives sanitized JSONL, then acknowledges D1 only after HTTP 201",async()=>{
  const fixture=createFixture();
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  const upload=fixture.calls.find(x=>x.url.startsWith(uploadBase));
  assert.ok(upload,"Expected an upload to the dedicated Diagnostics repository");
  assert.equal(upload.method,"POST");
  assert.equal(upload.options.body,payload);
  assert.equal(upload.options.headers["Content-Type"],"application/x-ndjson");
  assert.equal(upload.options.headers.Authorization,"Bearer "+token);
  assert.ok(upload.url.endsWith(encodeURIComponent(assetName)));
  assert.ok(fixture.calls.some(x=>x.url===githubBase+"/releases"&&x.method==="POST"));
  assert.deepEqual(fixture.shipped,[eventId]);
  assert.equal(fixture.calls.some(x=>x.method==="DELETE"),false,"Small archived payload must not be rotated");
});

test("failed GitHub upload keeps D1 event queued for a later retry",async()=>{
  const fixture=createFixture({uploadStatus:403});
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  assert.ok(fixture.calls.some(x=>x.url.startsWith(uploadBase)));
  assert.deepEqual(fixture.shipped,[],"Never acknowledge a failed upload");
});

test("pre-existing uploaded asset with exact hash and size is idempotently acknowledged",async()=>{
  const fixture=createFixture({assetAlreadyPresent:true});
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  assert.equal(fixture.calls.some(x=>x.url.startsWith(uploadBase)),false,"Do not upload a duplicate");
  assert.deepEqual(fixture.shipped,[eventId]);
});

test("GitHub release permission failure leaves the event queued",async()=>{
  const fixture=createFixture({releaseStatus:403});
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  assert.equal(fixture.calls.some(x=>x.url.startsWith(uploadBase)),false);
  assert.deepEqual(fixture.shipped,[]);
});

test("malformed installation ID never creates a public diagnostics release",async()=>{
  const fixture=createFixture({invalidId:true});
  await withMockedGitHub(fixture,()=>flushDiagnostics(fixture.env));
  assert.equal(fixture.calls.length,0);
  assert.deepEqual(fixture.shipped,[]);
});
