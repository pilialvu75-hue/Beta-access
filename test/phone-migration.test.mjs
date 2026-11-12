import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {handlePasskey} from "../src/passkeys.mjs";

const origin="https://aivexus-beta-access.aivexus-lab.workers.dev";
const session="e".repeat(64),hash=createHash("sha256").update(session).digest("hex");
const request=(path,body,authorized=false)=>new Request(origin+path,{
 method:"POST",headers:{"Origin":origin,"Content-Type":"application/json",
 ...(authorized?{Cookie:"beta_admin_session="+session}:{})},
 body:JSON.stringify(body)
});
const db=()=>{
 const pairings=new Map(),challenges=new Map();
 const keys=[{claim_code:"123456789ABC",status:"approved",created_at:new Date().toISOString()},
  {claim_code:"C123ABCDEF45",status:"pending",created_at:new Date().toISOString()}];
 return {pairings,challenges,keys,prepare(q){
  let args=[];
  const p={
   bind(...values){args=values;return p;},
   async first(){
    if(q.includes("admin_sessions s JOIN admin_passkeys"))return args[0]===hash?{token_hash:hash}:null;
    if(q.includes("COUNT(*) AS n FROM admin_phone_pairings"))
     return {n:[...pairings.values()].filter(x=>!x.used_at&&x.expires_at>args[0]).length};
    if(q.startsWith("SELECT code_hash FROM admin_phone_pairings")){
     const x=pairings.get(args[0]);
     return x&&!x.used_at&&x.expires_at>args[1]?{code_hash:args[0]}:null;
    }
    if(q.includes("COUNT(*) AS n FROM admin_passkeys WHERE status='pending'"))return {n:keys.filter(x=>x.status==="pending").length};
    if(q.includes("COUNT(*) AS n FROM admin_passkeys WHERE status='approved'"))return {n:keys.filter(x=>x.status==="approved").length};
    throw Error("Unexpected .first SQL: "+q);
   },
   async run(){
    if(q.startsWith("INSERT INTO admin_phone_pairings")){
     pairings.set(args[0],{created_at:args[1],expires_at:args[2],used_at:null});
     return {meta:{changes:1}};
    }
    if(q.startsWith("INSERT INTO admin_passkey_challenges")){
     challenges.set(args[0],{kind:args[1],challenge:args[2],pairing_hash:args[4]});
     return {meta:{changes:1}};
    }
    if(q.startsWith("UPDATE admin_passkeys SET status='approved'")){
     const row=keys.find(x=>x.claim_code===args[1]&&x.status==="pending"&&x.created_at>args[2]);
     if(!row)return {meta:{changes:0}};
     row.status="approved";row.approved_at=args[0];return {meta:{changes:1}};
    }
    if(q.startsWith("UPDATE admin_passkeys SET status='revoked'")){
     const row=keys.find(x=>x.claim_code===args[0]&&x.status==="approved");
     if(!row)return {meta:{changes:0}};
     row.status="revoked";return {meta:{changes:1}};
    }
    throw Error("Unexpected .run SQL: "+q);
   },
   async all(){
    if(q.startsWith("SELECT claim_code,status,created_at"))return {results:keys};
    throw Error("Unexpected .all SQL: "+q);
   }
  };
  return p;
 }};
};
test("new phone invitation requires existing approved passkey session",async()=>{
 const DB=db(),env={DB,PASSKEY_ENROLLMENT_OPEN:"false"};
 const unauthorized=await handlePasskey(request("/api/admin/passkey/phone-pairings",{}),env,"/api/admin/passkey/phone-pairings");
 assert.equal(unauthorized.status,401);
 const issued=await handlePasskey(request("/api/admin/passkey/phone-pairings",{},true),env,"/api/admin/passkey/phone-pairings");
 assert.equal(issued.status,200);
 const data=await issued.json();
 assert.match(data.pairing_code,/^[a-f0-9]{32}$/);
 assert.equal(data.expires_in_minutes,15);
 assert.equal([...DB.pairings.keys()].length,1);
 assert.notEqual([...DB.pairings.keys()][0],data.pairing_code,"Database must only store hash");
 const wrong=await handlePasskey(request("/api/admin/passkey/register/options",{pairing_code:"f".repeat(32)}),env,"/api/admin/passkey/register/options");
 assert.equal(wrong.status,403);
 const accepted=await handlePasskey(request("/api/admin/passkey/register/options",{pairing_code:data.pairing_code}),env,"/api/admin/passkey/register/options");
 assert.equal(accepted.status,200);
 const response=await accepted.json();
 assert.ok(response.options.challenge);
 assert.equal(DB.challenges.get(response.challenge_id).pairing_hash,
  createHash("sha256").update(data.pairing_code).digest("hex"));
});
test("only logged-in old administrator can approve or revoke selected passkey",async()=>{
 const DB=db(),env={DB,PASSKEY_ENROLLMENT_OPEN:"false"};
 const bad=await handlePasskey(request("/api/admin/passkey/phone-approve",{claim_code:"C123ABCDEF45"}),env,"/api/admin/passkey/phone-approve");
 assert.equal(bad.status,401);
 const yes=await handlePasskey(request("/api/admin/passkey/phone-approve",{claim_code:"C123ABCDEF45"},true),env,"/api/admin/passkey/phone-approve");
 assert.equal(yes.status,200);
 assert.equal(DB.keys[1].status,"approved");
 const revoked=await handlePasskey(request("/api/admin/passkey/phone-revoke",{claim_code:"123456789ABC"},true),env,"/api/admin/passkey/phone-revoke");
 assert.equal(revoked.status,200);
 assert.equal(DB.keys[0].status,"revoked");
 const last=await handlePasskey(request("/api/admin/passkey/phone-revoke",{claim_code:"C123ABCDEF45"},true),env,"/api/admin/passkey/phone-revoke");
 assert.equal(last.status,409,"The final approved passkey must not be revocable");
});
