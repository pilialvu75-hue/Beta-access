// Web Push for an owner-approved Android PWA. No device secrets or tester PII in payloads.
import {buildPushPayload} from "@block65/webcrypto-web-push";
import {sha256hex} from "./core.mjs";

const allowedPushHosts = new Set(["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com"]);
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const now=()=>new Date().toISOString();

export function validPushEndpoint(endpoint) {
 if(typeof endpoint!=="string"||endpoint.length>2200)return false;
 try {
  const u=new URL(endpoint);
  return u.protocol==="https:" && allowedPushHosts.has(u.hostname) &&
   !u.username && !u.password && !u.hash && u.port==="" && u.pathname.length>1;
 }catch(_){return false;}
}
export function validPushSubscription(sub) {
 if(!sub||typeof sub!=="object"||Array.isArray(sub))return false;
 const k=sub.keys;
 return validPushEndpoint(sub.endpoint)&&k&&typeof k==="object" &&
   typeof k.p256dh==="string"&&/^[A-Za-z0-9_-]{85,100}$/.test(k.p256dh) &&
   typeof k.auth==="string"&&/^[A-Za-z0-9_-]{20,32}$/.test(k.auth);
}
export function pushConfigured(env) {
 return typeof env.VAPID_PUBLIC_KEY==="string"&&/^[A-Za-z0-9_-]{85,100}$/.test(env.VAPID_PUBLIC_KEY) &&
  typeof env.VAPID_PRIVATE_KEY==="string"&&/^[A-Za-z0-9_-]{40,50}$/.test(env.VAPID_PRIVATE_KEY) &&
  typeof env.VAPID_SUBJECT==="string"&&/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(env.VAPID_SUBJECT);
}
function sameOrigin(req) {
 const origin=req.headers.get("origin");
 return !origin || origin===new URL(req.url).origin;
}
async function readJson(req) {
 const raw=await req.text();
 if(raw.length>4096)throw Error("Payload too large");
 return JSON.parse(raw);
}
export async function handleAdminPush(req,env,path) {
 if(!sameOrigin(req))return reply({error:"Invalid origin"},403);
 if(path==="/api/admin/push/config"&&req.method==="GET")
  return reply({available:pushConfigured(env),publicKey:pushConfigured(env)?env.VAPID_PUBLIC_KEY:null});
 if(path==="/api/admin/push/test"&&req.method==="POST") {
  if(!pushConfigured(env))return reply({error:"Web Push not configured"},503);
  const records=await env.DB.prepare("SELECT endpoint_hash,endpoint,p256dh,auth FROM admin_push_subscriptions LIMIT 5").all();
  if(!(records.results??[]).length)return reply({error:"No registered Android push devices"},409);
  const vapid={subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY};
  const payload=JSON.stringify({title:"AIVEXUS Beta Access",body:"Notifica di prova",url:"/admin/"});
  let accepted=0;
  for(const sub of records.results) {
   if(!validPushEndpoint(sub.endpoint))continue;
   try {
    const request=await buildPushPayload({data:payload,options:{ttl:120}},
     {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth},expirationTime:null},vapid);
    const result=await fetch(sub.endpoint,{...request,redirect:"manual",signal:AbortSignal.timeout(7000)});
    if(result.ok)accepted++;
    if(result.status===404||result.status===410)
     await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE endpoint_hash=?").bind(sub.endpoint_hash).run();
   }catch(_){}
  }
  return reply({accepted,subscriptions:records.results.length});
 }
 if(path==="/api/admin/push/keep-current"&&req.method==="POST") {
  let input;
  try{input=await readJson(req);}catch(_){return reply({error:"Invalid request"},400);}
  if(!validPushEndpoint(input?.endpoint))return reply({error:"Invalid current phone subscription"},400);
  const hash=await sha256hex(input.endpoint);
  const current=await env.DB.prepare("SELECT endpoint_hash FROM admin_push_subscriptions WHERE endpoint_hash=?").bind(hash).first();
  if(!current)return reply({error:"Enable push on this phone first"},409);
  // Only an authenticated administrator can retire other phone notification endpoints.
  // This does not revoke WebAuthn credentials, which must be managed independently.
  const result=await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE endpoint_hash<>?").bind(hash).run();
  return reply({current_only:true,removed:Number(result?.meta?.changes??0)});
 }
 if(path==="/api/admin/push/subscriptions"&&req.method==="POST") {
  if(!pushConfigured(env))return reply({error:"Web Push not configured"},503);
  let sub;
  try{sub=await readJson(req);}catch(_){return reply({error:"Invalid subscription"},400);}
  if(!validPushSubscription(sub))return reply({error:"Invalid push endpoint or keys"},400);
  const digest=await sha256hex(sub.endpoint);
  const limit=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_push_subscriptions").first();
  const existing=await env.DB.prepare("SELECT endpoint_hash FROM admin_push_subscriptions WHERE endpoint_hash=?").bind(digest).first();
  if(!existing&&Number(limit?.n||0)>=5)return reply({error:"Maximum number of admin devices reached"},429);
  await env.DB.prepare(
   "INSERT INTO admin_push_subscriptions(endpoint_hash,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth"
  ).bind(digest,sub.endpoint,sub.keys.p256dh,sub.keys.auth,now()).run();
  return reply({subscribed:true});
 }
 if(path==="/api/admin/push/subscriptions"&&req.method==="DELETE") {
  let input;
  try{input=await readJson(req);}catch(_){return reply({error:"Invalid subscription"},400);}
  if(!validPushEndpoint(input?.endpoint))return reply({error:"Invalid endpoint"},400);
  const digest=await sha256hex(input.endpoint);
  await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE endpoint_hash=?").bind(digest).run();
  return reply({subscribed:false});
 }
 return reply({error:"Not found"},404);
}
export async function enqueuePushRequest(env,installationId) {
 if(!pushConfigured(env))return;
 // Limit notification floods even if public enrollment is later opened.
 const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_notification_outbox WHERE created_at>=?")
  .bind(new Date(Date.now()-3600000).toISOString()).first();
 if(Number(recent?.n||0)>=20)return;
 const uuid=crypto.randomUUID();
 await env.DB.prepare(
  "INSERT INTO admin_notification_outbox(id,installation_id,app_id,created_at,attempts) VALUES(?,?,?, ?,0)"
 ).bind(uuid,installationId,"wemuldroid",now()).run();
}
export async function deliverPendingPush(env) {
 if(!pushConfigured(env))return;
 const subs=await env.DB.prepare("SELECT endpoint_hash,endpoint,p256dh,auth FROM admin_push_subscriptions LIMIT 5").all();
 if(!(subs.results??[]).length)return;
 const jobs=await env.DB.prepare(
  "SELECT id,app_id,created_at FROM admin_notification_outbox WHERE sent_at IS NULL AND attempts<10 AND created_at>? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at ASC LIMIT 10"
 ).bind(new Date(Date.now()-24*3600000).toISOString(),now()).all();
 const vapid={subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY};
 for(const job of jobs.results??[]) {
  let delivered=false;
  const payload=JSON.stringify({title:"AIVEXUS Beta Access",body:"Nuova richiesta WEmulDroid. Tocca per decidere.",url:"/admin/",tag:"beta-access-requests"});
  for(const sub of subs.results??[]) {
   try {
    // Never follow a redirect supplied by a push service: only approved endpoints.
    if(!validPushEndpoint(sub.endpoint))continue;
    const request=await buildPushPayload({data:payload,options:{ttl:300}},
      {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth},expirationTime:null},vapid);
    const response=await fetch(sub.endpoint,{...request,redirect:"manual",signal:AbortSignal.timeout(7000)});
    if(response.ok)delivered=true;
    if(response.status===404||response.status===410)
     await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE endpoint_hash=?").bind(sub.endpoint_hash).run();
   }catch(_){ /* best effort; cron will retry pending jobs */ }
  }
  if(delivered) {
   await env.DB.prepare("UPDATE admin_notification_outbox SET sent_at=?,attempts=attempts+1 WHERE id=?").bind(now(),job.id).run();
  }else{
   await env.DB.prepare("UPDATE admin_notification_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=?")
    .bind(new Date(Date.now()+5*60000).toISOString(),job.id).run();
  }
 }
 // Keep only 24h of previously sent notifications; no tester names are stored.
 await env.DB.prepare("DELETE FROM admin_notification_outbox WHERE created_at<?").bind(new Date(Date.now()-24*3600000).toISOString()).run();
}
