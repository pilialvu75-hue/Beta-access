import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

const id="de34cfa7-ceda-4d2c-94a5-98a1478748af";
const session="fcb94525-76e8-4305-a6b8-d9f313869a24";
const eventId="ca2f3c43-86ae-4d18-b22f-aadbd0d0313d";
const key="d".repeat(64);
const adminKey="A".repeat(64);
const sha=x=>createHash("sha256").update(x).digest("hex");

function db() {
 const rows=new Map(), events=new Map();
 return {
  rows,events,
  prepare(query){
   let args=[];
   return {
    bind(...params){args=params;return this;},
    async first(){
     if(query.includes("COUNT(*) AS n FROM installations"))return {n:[...rows.values()].filter(r=>r.state==="pending").length};
     if(query.includes("COUNT(*) AS n FROM telemetry_outbox"))return {n:[...events.values()].filter(x=>x.installation_id===args[0]).length};
     if(query.startsWith("SELECT id FROM installations")){const r=rows.get(args[0]);return r?{id:r.id}:null;}
     if(query.startsWith("SELECT state,approved_until")){const r=rows.get(args[0]);return r?{state:r.state,approved_until:r.approved_until}:null;}
     if(query.startsWith("SELECT * FROM installations"))return rows.get(args[0])??null;
     throw new Error("Unexpected .first SQL: "+query);
    },
    async run(){
     if(query.startsWith("INSERT INTO installations")) {
       const [id,app_id,secret_sha256,label,platform,version,requested_at,telemetry_consent,last_seen_at,invite_id]=args;
       rows.set(id,{id,app_id,secret_sha256,label,platform,version,requested_at,telemetry_consent,last_seen_at,invite_id,state:"pending",approved_until:null,decided_at:null});
     }else if(query.startsWith("UPDATE installations SET state='pending'")) {
       const r=rows.get(args[5]);
       Object.assign(r,{state:"pending",approved_until:null,decided_at:null,requested_at:args[0],label:args[1],version:args[2],telemetry_consent:args[3],last_seen_at:args[4]});
     }else if(query.startsWith("UPDATE installations SET version=")){
       const r=rows.get(args[2]);Object.assign(r,{version:args[0],last_seen_at:args[1]});
     }else if(query.startsWith("UPDATE installations SET last_seen_at")){
       rows.get(args[1]).last_seen_at=args[0];
     }else if(query.startsWith("UPDATE installations SET state=?")){
       const r=rows.get(args[3]);Object.assign(r,{state:args[0],decided_at:args[1],approved_until:args[2]});
     }else if(query.startsWith("INSERT OR IGNORE INTO telemetry_outbox")){
       const [event_id,installation_id,payload_json,received_at]=args;
       if(!events.has(event_id))events.set(event_id,{event_id,installation_id,payload_json,received_at});
     }else throw new Error("Unexpected .run SQL: "+query);
     return {success:true};
    },
    async all(){
     if(query.includes("FROM installations AS i LEFT JOIN tester_invites"))return {results:[...rows.values()].map(({secret_sha256,...r})=>r)};
     throw new Error("Unexpected .all SQL: "+query);
    }
   };
  }
 };
}
function request(path,method="GET",payload=null,headers={}) {
 return new Request("https://beta.example.test"+path,{
  method,headers:{"Content-Type":"application/json",...headers},
  body:payload?JSON.stringify(payload):undefined
 });
}
const enrollBody=(consent=true)=>({
 app_id:"wemuldroid",installation_id:id,device_secret:key,platform:"windows",version:"0.9.0-beta.11",label:"PC Test",
 telemetry_consent:consent
});
const status=env=>worker.fetch(request("/api/v1/status?installation_id="+id,"GET",null,{"X-Device-Key":key}),env,{});
const send=async(env,path,body,headers={})=>worker.fetch(request(path,"POST",body,headers),env,{});

test("full approval lifecycle, expiry, revocation and opt-in telemetry",async()=>{
 const DB=db(), env={DB,ADMIN_TOKEN:adminKey,PUBLIC_TESTERS_ENABLED:"true"};
 let r=await send(env,"/api/v1/enroll",enrollBody(),{"Authorization":"Bearer "+adminKey});
 assert.equal(r.status,200);
 assert.equal((await r.json()).state,"pending");
 assert.equal(DB.rows.get(id).secret_sha256,sha(key));
 assert.equal(DB.rows.get(id).secret_sha256.includes(key),false);
 r=await status(env);assert.equal((await r.json()).state,"pending");
 r=await send(env,"/api/admin/requests/"+id+"/decision",{action:"approve",duration_days:7},{"Authorization":"Bearer "+adminKey});
 assert.equal(r.status,200);const granted=await r.json();
 assert.equal(granted.state,"approved");assert.ok(Date.parse(granted.approved_until)>Date.now());
 r=await status(env);assert.equal((await r.json()).state,"approved");
 const e={installation_id:id,event_id:eventId,event:"PERF_SAMPLE",severity:"info",
  producer_version:"0.9.0-beta.11",session,fields:{ram_mb:700,cpu_pct:30,uptime_sec:60}};
 r=await send(env,"/api/v1/telemetry",e,{"X-Device-Key":key});
 assert.equal(r.status,200);assert.equal((await r.json()).accepted,true);
 assert.equal(DB.events.size,1);
 // Same event ID is idempotent in the database, not duplicated.
 await send(env,"/api/v1/telemetry",e,{"X-Device-Key":key});
 assert.equal(DB.events.size,1);
 r=await send(env,"/api/admin/requests/"+id+"/decision",{action:"revoke"},{"Authorization":"Bearer "+adminKey});
 assert.equal((await r.json()).state,"revoked");
 r=await status(env);assert.equal((await r.json()).state,"revoked");
 r=await send(env,"/api/v1/telemetry",{...e,event_id:session},{"X-Device-Key":key});
 assert.equal(r.status,403);
 // A revoked device can request fresh approval, never auto-authorizes itself.
 r=await send(env,"/api/v1/enroll",enrollBody(),{"Authorization":"Bearer "+adminKey});
 assert.equal((await r.json()).state,"pending");
 r=await status(env);assert.equal((await r.json()).state,"pending");
 assert.equal(DB.rows.get(id).state,"pending");
});

test("admin secret, duration and device-secret boundaries",async()=>{
 const DB=db(),env={DB,ADMIN_TOKEN:adminKey,PUBLIC_TESTERS_ENABLED:"true"};
 let r=await send(env,"/api/v1/enroll",enrollBody(false),{"Authorization":"Bearer "+adminKey});assert.equal(r.status,200);
 r=await send(env,"/api/admin/requests/"+id+"/decision",{action:"approve",duration_days:0},{"Authorization":"Bearer "+adminKey});
 assert.equal(r.status,400);
 r=await send(env,"/api/admin/requests/"+id+"/decision",{action:"approve",duration_days:365},{"Authorization":"Bearer "+"A".repeat(63)});
 assert.equal(r.status,401);
 r=await worker.fetch(request("/api/v1/status?installation_id="+id,"GET",null,{"X-Device-Key":"b".repeat(64)}),env,{});
 assert.equal(r.status,403);
 r=await send(env,"/api/admin/requests/"+id+"/decision",{action:"approve",duration_days:1},{"Authorization":"Bearer "+adminKey});
 assert.equal(r.status,200);
 r=await send(env,"/api/v1/telemetry",{installation_id:id,event_id:eventId,event:"APP_START",
  producer_version:"0.9.0-beta.11",severity:"info",session,fields:{startup_ms:100}},{"X-Device-Key":key});
 assert.equal(r.status,403); // No diagnostic consent
 DB.rows.get(id).approved_until="2001-01-01T00:00:00.000Z";
 r=await status(env);assert.equal((await r.json()).state,"expired");
});
