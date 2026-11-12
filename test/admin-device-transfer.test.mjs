import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

const origin="https://aivexus-beta-access.aivexus-lab.workers.dev";
const adminKey="G".repeat(64);
const hash=s=>createHash("sha256").update(s).digest("hex");
const post=(path,body={},headers={})=>new Request(origin+path,{
 method:"POST",headers:{"Origin":origin,"Content-Type":"application/json",...headers},body:JSON.stringify(body)
});
function mockDB() {
 const pairings=new Map(), challenges=new Map(), devices=new Map();
 const result={
  pairings,challenges,devices,
  prepare(sql){
   let args=[];
   return {
    bind(...values){args=values;return this;},
    async first(){
     if(sql.includes("COUNT(*) AS n FROM admin_passkeys"))return {n:1};
     if(sql.includes("COUNT(*) AS n FROM admin_device_pairings")){
      return {n:[...pairings.values()].filter(p=>p.created_at>args[0]).length};
     }
     if(sql.includes("COUNT(*) AS n FROM admin_passkeys WHERE status='pending'"))return {n:0};
     if(sql.includes("SELECT code_hash FROM admin_device_pairings")){
      const p=pairings.get(args[0]);
      return p&&!p.used_at&&p.expires_at>args[1]?{code_hash:args[0]}:null;
     }
     if(sql.includes("SELECT id FROM admin_passkeys"))return null;
     throw Error("Unexpected mock D1 first query: "+sql);
    },
    async all(){
     if(sql.includes("WHERE status='pending' ORDER BY"))return {results:[]};
     if(sql.includes("WHERE status='approved' ORDER BY"))return {results:[]};
     throw Error("Unexpected mock D1 all query: "+sql);
    },
    async run(){
     if(sql.startsWith("INSERT INTO admin_device_pairings")){
      pairings.set(args[0],{created_at:args[1],expires_at:args[2],used_at:null});
      return {success:true,meta:{changes:1}};
     }
     if(sql.startsWith("INSERT INTO admin_passkey_challenges")){
      challenges.set(args[0],{kind:args[1],challenge:args[2],expires_at:args[3],pairing_hash:args[4]});
      return {success:true,meta:{changes:1}};
     }
     if(sql.startsWith("UPDATE admin_passkeys SET status='approved'")){
      const row=devices.get(args[1]);
      if(row?.status==="pending"){row.status="approved";return {meta:{changes:1}};}
      return {meta:{changes:0}};
     }
     if(sql.startsWith("UPDATE admin_passkeys SET status='revoked'"))return {meta:{changes:0}};
     if(sql.startsWith("DELETE FROM admin_sessions"))return {meta:{changes:0}};
     throw Error("Unexpected mock D1 run query: "+sql);
    }
   };
  }
 };
 return result;
}

test("only an authenticated administrator can issue a new-phone one-time pairing code",async()=>{
 const DB=mockDB(),env={DB,ADMIN_TOKEN:adminKey,PASSKEY_ENROLLMENT_OPEN:"false"};
 const p="/api/admin/passkey/pairing/create";
 let resp=await worker.fetch(post(p),env,{});
 assert.equal(resp.status,401);
 resp=await worker.fetch(post(p,{},{"Authorization":"Bearer "+adminKey}),env,{});
 assert.equal(resp.status,200);
 const record=await resp.json();
 assert.match(record.pairing_code,/^[A-F0-9]{24}$/);
 assert.equal(DB.pairings.size,1);
 assert.equal(DB.pairings.has(hash(record.pairing_code)),true);
 // The one-time code itself must never be stored in the D1 row.
 assert.equal(JSON.stringify([...DB.pairings.values()]).includes(record.pairing_code),false);
});

test("second phone requires a valid unused pairing code, even if bootstrap is closed",async()=>{
 const DB=mockDB(),env={DB,ADMIN_TOKEN:adminKey,PASSKEY_ENROLLMENT_OPEN:"false"};
 const p="/api/admin/passkey/register/options";
 let denied=await worker.fetch(post(p,{pairing_code:"00112233445566778899AABB"}),env,{});
 assert.equal(denied.status,403);
 const granted=await worker.fetch(post("/api/admin/passkey/pairing/create",{},
  {"Authorization":"Bearer "+adminKey}),env,{});
 const code=(await granted.json()).pairing_code;
 const response=await worker.fetch(post(p,{pairing_code:code}),env,{});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.ok(data.challenge_id);
 const challenge=DB.challenges.get(data.challenge_id);
 assert.equal(challenge.kind,"register");
 assert.equal(challenge.pairing_hash,hash(code));
 DB.pairings.get(hash(code)).used_at=new Date().toISOString();
 denied=await worker.fetch(post(p,{pairing_code:code}),env,{});
 assert.equal(denied.status,403);
});

test("existing owner explicitly approves a matching pending phone; cannot revoke last admin key",async()=>{
 const DB=mockDB(),env={DB,ADMIN_TOKEN:adminKey};
 const code="ABCDEF123456",p="/api/admin/passkey/devices/approve";
 DB.devices.set(code,{status:"pending"});
 let res=await worker.fetch(post(p,{claim_code:code}),env,{});
 assert.equal(res.status,401);
 res=await worker.fetch(post(p,{claim_code:code},{"Authorization":"Bearer "+adminKey}),env,{});
 assert.equal(res.status,200);
 assert.equal((await res.json()).approved,true);
 assert.equal(DB.devices.get(code).status,"approved");
 res=await worker.fetch(post(p,{claim_code:code},{"Authorization":"Bearer "+adminKey}),env,{});
 assert.equal(res.status,404);
 const revoke="/api/admin/passkey/devices/revoke";
 res=await worker.fetch(post(revoke,{credential_id:"some-test-passkey-id"},
  {"Authorization":"Bearer "+adminKey}),env,{});
 assert.equal(res.status,409);
});
