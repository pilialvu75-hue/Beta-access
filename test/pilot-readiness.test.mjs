import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const url="https://beta.example.test/api/admin/pilot/readiness";
const adminToken="A".repeat(64);
const makeDB=(missing=[])=>({
 prepare(sql){
  return {async first(){
   const tables=["tester_invites","admin_passkeys","admin_push_subscriptions","telemetry_outbox"];
   const table=tables.find(x=>sql.includes("FROM "+x));
   if(!table)throw Error("Unexpected SQL in readiness: "+sql);
   if(missing.includes(table))throw Error("NO_SUCH_TABLE_TEST_ONLY");
   return {n:table==="admin_push_subscriptions"?1:0};
  }};
 }
});
const fetchReady=(env,authenticated=true)=>worker.fetch(new Request(url,{
 headers:authenticated?{Authorization:"Bearer "+adminToken}:{}
}),env,{});

test("pilot readiness endpoint refuses unauthenticated requests",async()=>{
 const r=await fetchReady({ADMIN_TOKEN:adminToken,DB:makeDB()},false);
 assert.equal(r.status,401);
});

test("readiness is an observation, not an authorization to enable public releases",async()=>{
 const env={
  ADMIN_TOKEN:adminToken,DB:makeDB(),
  VAPID_PUBLIC_KEY:"test-public",VAPID_PRIVATE_KEY:"test-private",
  VAPID_SUBJECT:"https://example.org",DIAGNOSTICS_GITHUB_TOKEN:"test-diagnostics",
  PUBLIC_TESTERS_ENABLED:"false",PRIVATE_PILOT_ENROLLMENT_ENABLED:"false"
 };
 let r=await fetchReady(env);
 assert.equal(r.status,200);
 let x=await r.json();
 assert.equal(x.infrastructure_checks_pass,true);
 assert.equal(x.can_accept_private_invites,false);
 assert.equal(x.public_download_enabled,false);
 assert.equal(x.windows_real_test_verified,false);
 assert.equal(JSON.stringify(x).includes("test-private"),false);
 assert.equal(JSON.stringify(x).includes("test-diagnostics"),false);
 env.PRIVATE_PILOT_ENROLLMENT_ENABLED="true";
 r=await fetchReady(env);
 x=await r.json();
 assert.equal(x.can_accept_private_invites,true);
 env.PUBLIC_TESTERS_ENABLED="true";
 r=await fetchReady(env);
 x=await r.json();
 assert.equal(x.infrastructure_checks_pass,false);
 assert.equal(x.can_accept_private_invites,false);
});

test("missing migration, diagnostics or push subscription fails closed",async()=>{
 const common={ADMIN_TOKEN:adminToken,PUBLIC_TESTERS_ENABLED:"false",
  PRIVATE_PILOT_ENROLLMENT_ENABLED:"true",
  VAPID_PUBLIC_KEY:"key",VAPID_PRIVATE_KEY:"key",VAPID_SUBJECT:"https://example.org"};
 for(const changes of [
  {DB:makeDB(["tester_invites"]),DIAGNOSTICS_GITHUB_TOKEN:"token"},
  {DB:makeDB(),DIAGNOSTICS_GITHUB_TOKEN:""},
  {DB:makeDB(["admin_push_subscriptions"]),DIAGNOSTICS_GITHUB_TOKEN:"token"}
 ]){
  const r=await fetchReady({...common,...changes});
  assert.equal(r.status,200);
  const x=await r.json();
  assert.equal(x.infrastructure_checks_pass,false);
  assert.equal(x.can_accept_private_invites,false);
 }
});
