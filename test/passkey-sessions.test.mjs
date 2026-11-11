import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {passkeySessionAllowed} from "../src/passkeys.mjs";
import worker from "../src/worker.mjs";

const origin="https://aivexus-beta-access.aivexus-lab.workers.dev";
const cookieSecret="a".repeat(64);
const hash=createHash("sha256").update(cookieSecret).digest("hex");

function env({allowed=true}={}) {
 return {DB:{prepare(q){const result={args:[],bind(...a){this.args=a;return this;},async first(){
  if(q.includes("admin_sessions"))return allowed&&this.args[0]===hash?{token_hash:hash}:null;
  throw Error("Unexpected SQL");
 }};return result;}}};
}
test("passkey sessions are opt-in only, and server verifies a stored approved credential",async()=>{
 const noCookie=new Request(origin+"/api/admin/requests");
 assert.equal(await passkeySessionAllowed(noCookie,env()),false);
 const unknown=new Request(origin+"/api/admin/requests",{headers:{cookie:"beta_admin_session="+cookieSecret}});
 assert.equal(await passkeySessionAllowed(unknown,env({allowed:false})),false);
 assert.equal(await passkeySessionAllowed(unknown,env()),true);
});
test("cross-origin POST cannot use admin passkey cookie",async()=>{
 const req=new Request(origin+"/api/admin/requests/id/decision",{
  method:"POST",headers:{Origin:"https://evil.example",cookie:"beta_admin_session="+cookieSecret}
 });
 assert.equal(await passkeySessionAllowed(req,env()),false);
});
test("pending passkey cannot bypass the existing administrator gate",async()=>{
 const response=await worker.fetch(new Request(origin+"/api/admin/requests"),{DB:{prepare:()=>{throw Error("Should not query DB");}}},{});
 assert.equal(response.status,401);
});
