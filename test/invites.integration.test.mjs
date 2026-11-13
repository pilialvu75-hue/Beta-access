import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";
import {validInviteToken,validTesterEmail,validInviteFields,inviteUsable} from "../src/invites.mjs";

const origin="https://beta.test.local";
const auth={"Authorization":"Bearer "+"A".repeat(64)};
const userId="e12d4a17-5e3f-44f1-8f23-f3cb7596bd51";
const otherId="b71f08a9-7ccf-4d42-9d76-6870b6a5abc1";
const secret="e".repeat(64);
const hash=s=>createHash("sha256").update(s).digest("hex");
const request=(path,method="GET",body,headers={})=>new Request(origin+path,{
 method,headers:{"Content-Type":"application/json","Origin":origin,...headers},
 body:body===undefined?undefined:JSON.stringify(body)
});
function fakeDB(){
 const invites=new Map(),installs=new Map();
 return {invites,installs,
 prepare(sql){
  let args=[];
  return {
   bind(...x){args=x;return this;},
   async first(){
    if(sql.startsWith("SELECT COUNT(*) AS n FROM tester_invites")){
     return {n:[...invites.values()].filter(i=>i.created_at>args[0]).length};
    }
    if(sql.startsWith("SELECT id,app_id,status,expires_at,claimed_installation_id FROM tester_invites")){
     return [...invites.values()].find(i=>i.token_sha256===args[0])??null;
    }
    if(sql.startsWith("SELECT id,claimed_installation_id FROM tester_invites")){
     return invites.get(args[0])??null;
    }
    if(sql.startsWith("SELECT COUNT(*) AS n FROM installations")){
     return {n:[...installs.values()].filter(i=>i.state==="pending").length};
    }
    if(sql.startsWith("SELECT * FROM installations"))return installs.get(args[0])??null;
    if(sql.startsWith("SELECT state,approved_until")){
     const x=installs.get(args[0]);return x?{state:x.state,approved_until:x.approved_until}:null;
    }
    if(sql.startsWith("SELECT id FROM installations")){
     const x=installs.get(args[0]);return x?{id:x.id}:null;
    }
    throw Error("Unexpected D1 first: "+sql);
   },
   async all(){
    if(sql.startsWith("SELECT id,app_id,tester_name,tester_email")){
     return {results:[...invites.values()].map(i=>({
      id:i.id,app_id:i.app_id,tester_name:i.tester_name,tester_email:i.tester_email,
      status:i.status,created_at:i.created_at,expires_at:i.expires_at,
      claimed_at:i.claimed_at,claimed_installation_id:i.claimed_installation_id
     }))};
    }
    if(sql.includes("FROM installations AS i LEFT JOIN tester_invites")){
     return {results:[...installs.values()]};
    }
    throw Error("Unexpected D1 all: "+sql);
   },
   async run(){
    let changes=0;
    if(sql.startsWith("INSERT INTO tester_invites")){
     const [id,app_id,token_sha256,tester_name,tester_email,created_at,expires_at]=args;
     invites.set(id,{id,app_id,token_sha256,tester_name,tester_email,created_at,expires_at,status:"active",claimed_at:null,claimed_installation_id:null});
     changes=1;
    } else if(sql.startsWith("UPDATE tester_invites SET claimed_installation_id")){
     const x=invites.get(args[2]);
     if(x&&x.status==="active"&&!x.claimed_installation_id&&x.expires_at>args[3]){
      x.claimed_installation_id=args[0];x.claimed_at=args[1];changes=1;
     }
    } else if(sql.startsWith("UPDATE tester_invites SET status='revoked'")){
     const x=invites.get(args[0]);
     if(x){x.status="revoked";changes=1;}
    } else if(sql.startsWith("INSERT INTO installations")){
     const [id,app_id,secret_sha256,label,platform,version,requested_at,telemetry_consent,last_seen_at,invite_id]=args;
     installs.set(id,{id,app_id,secret_sha256,label,platform,version,requested_at,telemetry_consent,last_seen_at,invite_id,state:"pending",approved_until:null});
     changes=1;
    } else if(sql.startsWith("DELETE FROM installations")){
     installs.delete(args[0]);changes=1;
    } else if(sql.startsWith("UPDATE installations SET state='pending'")){
     const x=installs.get(args[5]);if(x){x.state="pending";x.approved_until=null;changes=1;}
    } else if(sql.startsWith("UPDATE installations SET version=")){
     const x=installs.get(args[2]);if(x){x.version=args[0];changes=1;}
    } else if(sql.startsWith("UPDATE installations SET state='revoked'")){
     const x=installs.get(args[1]);if(x){x.state="revoked";x.approved_until=null;changes=1;}
    } else if(sql.startsWith("UPDATE installations SET state=?")){
     const x=installs.get(args[3]);if(x){x.state=args[0];x.approved_until=args[2];changes=1;}
    } else {
     throw Error("Unexpected D1 write: "+sql);
    }
    return {success:true,meta:{changes}};
   }
  };
 }};
}
const env=()=>({DB:fakeDB(),ADMIN_TOKEN:"A".repeat(64),PUBLIC_TESTERS_ENABLED:"true"});
const inviteFields={app_id:"wemuldroid",tester_name:"Tester Uno",tester_email:"tester@example.org",expires_days:7};
const enroll=(token,id=userId)=>({
 app_id:"wemuldroid",installation_id:id,device_secret:secret,platform:"windows",
 version:"0.9.0-beta.11",label:"PC Test",telemetry_consent:false,invite_token:token
});
test("invalid app, email and expiry are rejected",()=>{
 assert.equal(validTesterEmail("tester@example.org"),true);
 assert.equal(validTesterEmail("bad@not"),false);
 assert.equal(validInviteFields(inviteFields),true);
 assert.equal(validInviteFields({...inviteFields,app_id:"other-app"}),false);
 assert.equal(validInviteFields({...inviteFields,expires_days:0}),false);
 assert.equal(validInviteToken("A".repeat(43)),true);
 assert.equal(validInviteToken("not secure"),false);
});
test("private invitations are admin-authenticated, unverified recipient and one-use",async()=>{
 const e=env();
 let resp=await worker.fetch(request("/api/admin/invites","POST",inviteFields),e,{});
 assert.equal(resp.status,401);
 resp=await worker.fetch(request("/api/admin/invites","POST",inviteFields,auth),e,{});
 assert.equal(resp.status,201);
 const invite=await resp.json();
 assert.equal(invite.identity_verified,false);
 assert.equal(invite.tester_email,"tester@example.org");
 const token=invite.invite_url.split("/i/")[1];
 assert.equal(validInviteToken(token),true);
 assert.equal([...e.DB.invites.values()][0].token_sha256,hash(token));
 assert.equal(JSON.stringify([...e.DB.invites.values()]).includes(token),false);
 resp=await worker.fetch(request("/i/"+token),e,{});
 assert.equal(resp.status,200);
 const landing=await resp.text();
 assert.match(landing,/Download tester ancora disattivati/);
 assert.equal(landing.includes("tester@example.org"),false,"Do not expose intended email in public invitation page");
 resp=await worker.fetch(request("/qr/invite/"+token+".svg"),e,{});
 assert.equal(resp.status,200);
 assert.equal(resp.headers.get("cache-control"),"no-store");
 assert.match(resp.headers.get("content-type"),/image\/svg\+xml/);
 assert.match(await resp.text(),/<svg/);
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll("invalid")),e,{});
 assert.equal(resp.status,403);
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll(token)),e,{});
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).state,"pending");
 assert.equal(e.DB.installs.get(userId).invite_id,invite.id);
 assert.equal(e.DB.invites.get(invite.id).claimed_installation_id,userId);
 // A redeemed QR is no longer available for forwarding to a new tester.
 resp=await worker.fetch(request("/qr/invite/"+token+".svg"),e,{});
 assert.equal(resp.status,404);
 // Same invite token cannot authorize another installation (even though IDs are valid).
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll(token,otherId)),e,{});
 assert.equal(resp.status,403);
 assert.equal(e.DB.installs.has(otherId),false);
 // Admin can inspect but public cannot read intended recipient details.
 resp=await worker.fetch(request("/api/admin/invites"),e,{});
 assert.equal(resp.status,401);
 resp=await worker.fetch(request("/api/admin/invites","GET",undefined,auth),e,{});
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).invites.length,1);
 resp=await worker.fetch(request("/api/admin/invites/"+invite.id+"/revoke","POST",{},auth),e,{});
 assert.equal(resp.status,200);
 const revoked=await resp.json();
 assert.equal(revoked.installation_revoked,true);
 assert.equal(e.DB.installs.get(userId).state,"revoked");
 resp=await worker.fetch(request("/i/"+token),e,{});
 assert.equal(resp.status,410);
});
test("expired, revoked and other-app invitations are not usable",()=>{
 const future=new Date(Date.now()+60000).toISOString();
 const expired=new Date(Date.now()-60000).toISOString();
 const row={id:crypto.randomUUID(),app_id:"wemuldroid",status:"active",expires_at:future,claimed_installation_id:null};
 assert.equal(inviteUsable(row,userId),true);
 assert.equal(inviteUsable({...row,app_id:"other"},userId),false);
 assert.equal(inviteUsable({...row,expires_at:expired},userId),false);
 assert.equal(inviteUsable({...row,status:"revoked"},userId),false);
 assert.equal(inviteUsable({...row,claimed_installation_id:otherId},userId),false);
});

test("public download and QR cannot bypass invitations when sharing is enabled",async()=>{
 const e=env();
 for(const path of ["/d/wemuldroid","/download/wemuldroid","/qr/wemuldroid.svg",
  "/download/invite/invalid"]){
  const response=await worker.fetch(request(path),e,{});
  assert.equal(response.status,403,path);
 }
 const catalog=await worker.fetch(request("/api/catalog"),{...e,PUBLIC_TESTERS_ENABLED:"false"},{});
 const body=await catalog.json();
 assert.equal(body.available,false);
 assert.equal(body.share_url,null);
});


test("invite-only weekend pilot accepts exactly one invited installation without public downloads",async()=>{
 const e=env();
 e.PUBLIC_TESTERS_ENABLED="false";
 // Turning on the public release flag is never required for an invite-only pilot.
 let resp=await worker.fetch(request("/api/v1/enroll","POST",enroll("invalid")),e,{});
 assert.equal(resp.status,403);
 const created=await worker.fetch(request("/api/admin/invites","POST",inviteFields,auth),e,{});
 assert.equal(created.status,201);
 const token=(await created.json()).invite_url.split("/i/")[1];
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll(token)),e,{});
 assert.equal(resp.status,403,"Private pilot must stay off by default");
 assert.equal(e.DB.installs.size,0);
 e.PRIVATE_PILOT_ENROLLMENT_ENABLED="true";
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll("invalid")),e,{});
 assert.equal(resp.status,403,"Uninvited devices remain blocked with the pilot enabled");
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll(token)),e,{});
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).state,"pending","No one can automatically approve their own invitation");
 assert.equal(e.DB.installs.get(userId).state,"pending");
 assert.equal(e.DB.installs.get(userId).invite_id,[...e.DB.invites.values()][0].id);
 resp=await worker.fetch(request("/api/v1/enroll","POST",enroll(token,otherId)),e,{});
 assert.equal(resp.status,403,"A second device cannot reuse the invite");
 for(const url of ["/d/wemuldroid","/download/wemuldroid","/download/invite/"+token]){
  const r=await worker.fetch(request(url),e,{});
  assert.equal(r.status,503,"Pilot cannot expose a public download: "+url);
 }
 const catalog=await worker.fetch(request("/api/catalog"),e,{});
 const data=await catalog.json();
 assert.equal(data.available,false);
 assert.equal(data.share_url,null);
});
