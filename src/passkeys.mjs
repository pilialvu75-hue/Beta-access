// Admin passkeys on the dedicated Beta Access origin. No legacy key is sent to the browser.
// A NEW credential is always pending until the Cloudflare account owner explicitly approves it in D1.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from "@simplewebauthn/server";
import {sha256hex} from "./core.mjs";

const RP_ID="aivexus-beta-access.aivexus-lab.workers.dev";
const ORIGIN="https://"+RP_ID;
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const respond=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...HEADERS,...extra}});
const error=(message,status=400)=>respond({error:message},status);
const now=()=>new Date().toISOString();
const deadline=ms=>new Date(Date.now()+ms).toISOString();
const bytesToB64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const b64urlToBytes=value=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const randomSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");

async function json(req) {
  const raw=await req.text();
  if(raw.length>12000)throw Error("Passkey payload too large");
  return JSON.parse(raw);
}
function requireOrigin(req) {
  const url=new URL(req.url);
  if(url.origin!==ORIGIN) return false;
  const origin=req.headers.get("origin");
  return origin===null || origin===ORIGIN;
}
const cookieValue=req=>{
 const value=req.headers.get("cookie")??"";
 const match=/(?:^|;\s*)beta_admin_session=([a-f0-9]{64})(?:;|$)/.exec(value);
 return match?.[1]??null;
};
export async function passkeySessionAllowed(req,env) {
 // A cookie-backed admin session must not authorize an off-origin write.
 if(req.method!=="GET" && !requireOrigin(req))return false;
 if(!env.DB)return false;
 const credential=cookieValue(req);
 if(!credential)return false;
 const hash=await sha256hex(credential);
 const row=await env.DB.prepare(
  "SELECT s.token_hash FROM admin_sessions s JOIN admin_passkeys p ON s.passkey_id=p.id WHERE s.token_hash=? AND s.expires_at>? AND p.status='approved'"
 ).bind(hash,now()).first();
 return !!row;
}
async function readChallenge(env,id,type) {
 if(typeof id!=="string"||! /^[a-f0-9-]{36}$/i.test(id))return null;
 const item=await env.DB.prepare("SELECT * FROM admin_passkey_challenges WHERE id=? AND kind=? AND expires_at>?").bind(id,type,now()).first();
 if(item) await env.DB.prepare("DELETE FROM admin_passkey_challenges WHERE id=?").bind(id).run(); // One use.
 return item;
}
async function storeChallenge(env,kind,challenge,pairingHash=null) {
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO admin_passkey_challenges(id,kind,challenge,expires_at,pairing_hash) VALUES(?,?,?,?,?)")
  .bind(id,kind,challenge,deadline(5*60*1000),pairingHash).run();
 return id;
}
async function activePasskeys(env) {
 const result=await env.DB.prepare("SELECT id,transports_json FROM admin_passkeys WHERE status='approved' LIMIT 10").all();
 return result.results??[];
}
async function openEnrollment(env) {
 if(env.PASSKEY_ENROLLMENT_OPEN!=="true")return false;
 const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkeys WHERE status='approved'").first();
 return Number(count?.n||0)===0;
}
async function registerOptions(req,env) {
 // Initial provisioning is restricted to an empty admin database.
 // Later phones need a short-lived invitation from an already authorized administrator.
 const admins=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkeys WHERE status='approved'").first();
 const alreadyInitialized=Number(admins?.n||0)>0;
 let pairingHash=null;
 if(alreadyInitialized) {
  let input;
  try {input=await json(req);}catch(_){return error("Codice di collegamento non valido",400);}
  const pairingCode=typeof input?.pairing_code==="string"?input.pairing_code.trim().toUpperCase():"";
  if(!/^[A-F0-9]{24}$/.test(pairingCode))return error("Codice di collegamento richiesto",403);
  pairingHash=await sha256hex(pairingCode);
  const invite=await env.DB.prepare("SELECT code_hash FROM admin_device_pairings WHERE code_hash=? AND used_at IS NULL AND expires_at>?")
    .bind(pairingHash,now()).first();
  if(!invite)return error("Codice scaduto, già utilizzato o non autorizzato",403);
 }else if(!(await openEnrollment(env))) {
  return error("Registrazione iniziale chiusa",403);
 }
 const recent=new Date(Date.now()-30*60000).toISOString();
 const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkeys WHERE status='pending' AND created_at>?").bind(recent).first();
 if(Number(pending?.n||0)>=5)return error("Troppe richieste recenti. Riprovare più tardi",429);
 const options=await generateRegistrationOptions({
  rpName:"AIVEXUS Beta Access",rpID:RP_ID,userName:"Amministratore Beta Access",
  userDisplayName:"Amministratore",userID:new TextEncoder().encode("aivexus-beta-access-owner-v1"),
  attestationType:"none",supportedAlgorithmIDs:[-7,-257],
  authenticatorSelection:{residentKey:"required",userVerification:"required"},
  preferredAuthenticatorType:"localDevice"
 });
 const challenge_id=await storeChallenge(env,"register",options.challenge,pairingHash);
 return respond({challenge_id,options});
}
async function registerVerify(req,env) {
 const body=await json(req);
 const expected=await readChallenge(env,body?.challenge_id,"register");
 if(!expected)return error("Registrazione scaduta o già usata",400);
 const isPairing=Boolean(expected.pairing_hash);
 if(isPairing){
  const valid=await env.DB.prepare("SELECT code_hash FROM admin_device_pairings WHERE code_hash=? AND used_at IS NULL AND expires_at>?")
   .bind(expected.pairing_hash,now()).first();
  if(!valid)return error("Collegamento scaduto o già utilizzato",403);
 }else if(!(await openEnrollment(env))) {
  return error("Registrazione iniziale chiusa",403);
 }
 let verified;
 try {
  verified=await verifyRegistrationResponse({
   response:body.credential,expectedChallenge:expected.challenge,
   expectedOrigin:ORIGIN,expectedRPID:RP_ID,requireUserVerification:true
  });
 }catch(_){return error("Passkey non verificata",400);}
 if(!verified.verified||!verified.registrationInfo?.credential)return error("Passkey non verificata",400);
 const info=verified.registrationInfo.credential;
 const claimCode=crypto.randomUUID().replaceAll("-","").slice(0,12).toUpperCase();
 const publicKey=bytesToB64url(info.publicKey);
 const existing=await env.DB.prepare("SELECT id FROM admin_passkeys WHERE id=?").bind(info.id).first();
 if(existing)return error("Passkey già registrata",409);
 if(isPairing) {
  // Atomic one-time consumption. A concurrent second claim must not enroll a new admin key.
  const used=await env.DB.prepare(
   "UPDATE admin_device_pairings SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?"
  ).bind(now(),expected.pairing_hash,now()).run();
  if(used?.meta?.changes!==1)return error("Codice di collegamento già utilizzato",403);
 }
 await env.DB.prepare(
  "INSERT INTO admin_passkeys(id,public_key,counter,transports_json,status,claim_code,created_at) VALUES(?,?,?,?, 'pending', ?, ?)"
 ).bind(info.id,publicKey,info.counter,JSON.stringify(info.transports??[]),claimCode,now()).run();
 return respond({status:"pending",claim_code:claimCode,
  message:"Passkey creata sul telefono. Attendi la conferma del proprietario Cloudflare."});
}
async function authOptions(env) {
 const passkeys=await activePasskeys(env);
 if(!passkeys.length)return error("Nessuna passkey amministratore ancora autorizzata",409);
 const options=await generateAuthenticationOptions({
  rpID:RP_ID,userVerification:"required",
  allowCredentials:passkeys.map(k=>({id:k.id,transports:JSON.parse(k.transports_json||"[]")}))
 });
 const challenge_id=await storeChallenge(env,"authenticate",options.challenge);
 return respond({challenge_id,options});
}
async function authVerify(req,env) {
 const body=await json(req);
 const expected=await readChallenge(env,body?.challenge_id,"authenticate");
 if(!expected)return error("Autenticazione scaduta o già utilizzata",400);
 const keyId=body?.credential?.id;
 if(typeof keyId!=="string"||keyId.length>1024)return error("Passkey non valida",400);
 const key=await env.DB.prepare("SELECT * FROM admin_passkeys WHERE id=? AND status='approved'").bind(keyId).first();
 if(!key)return error("Passkey non autorizzata",403);
 let verification;
 try {
  verification=await verifyAuthenticationResponse({
   response:body.credential,expectedChallenge:expected.challenge,
   expectedOrigin:ORIGIN,expectedRPID:RP_ID,requireUserVerification:true,
   credential:{id:key.id,publicKey:b64urlToBytes(key.public_key),
    counter:Number(key.counter),transports:JSON.parse(key.transports_json)}
  });
 }catch(_){return error("Impronta o PIN non verificati",403);}
 if(!verification.verified)return error("Autenticazione non riuscita",403);
 await env.DB.prepare("UPDATE admin_passkeys SET counter=? WHERE id=?")
  .bind(verification.authenticationInfo.newCounter,key.id).run();
 const secret=randomSecret(),hash=await sha256hex(secret);
 await env.DB.prepare("INSERT INTO admin_sessions(token_hash,passkey_id,expires_at) VALUES(?,?,?)")
  .bind(hash,key.id,deadline(8*60*60*1000)).run();
 // The cookie is HttpOnly: neither the passkey nor its private key reaches JS.
 return respond({authenticated:true,expires_in_hours:8},200,{
  "Set-Cookie":"beta_admin_session="+secret+"; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=28800"
 });
}
async function logout(req,env) {
 const value=cookieValue(req);
 if(value)await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256hex(value)).run();
 return respond({authenticated:false},200,{
  "Set-Cookie":"beta_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0"
 });
}

async function createDevicePairing(env) {
 const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_device_pairings WHERE created_at>?")
  .bind(new Date(Date.now()-3600000).toISOString()).first();
 if(Number(recent?.n||0)>=5)return error("Troppi collegamenti recenti, riprova più tardi",429);
 // 96-bit one-time invitation. Only its SHA-256 is stored in D1.
 const code=randomSecret().slice(0,24).toUpperCase();
 const digest=await sha256hex(code);
 const expires=deadline(10*60*1000);
 await env.DB.prepare("INSERT INTO admin_device_pairings(code_hash,created_at,expires_at) VALUES(?,?,?)")
  .bind(digest,now(),expires).run();
 return respond({pairing_code:code,expires_at:expires,
  message:"Copia questo codice sul nuovo telefono. Scade tra 10 minuti ed è monouso."});
}
async function pendingAdminDevices(env) {
 const rows=await env.DB.prepare(
  "SELECT id,claim_code,created_at FROM admin_passkeys WHERE status='pending' ORDER BY created_at DESC LIMIT 15"
 ).all();
 return respond({requests:rows.results??[]});
}
async function approvedAdminDevices(env) {
 const rows=await env.DB.prepare(
  "SELECT id,created_at,approved_at FROM admin_passkeys WHERE status='approved' ORDER BY approved_at DESC LIMIT 15"
 ).all();
 return respond({devices:rows.results??[]});
}
async function approveAdminDevice(req,env) {
 let input;
 try {input=await json(req);}catch(_){return error("Richiesta non valida",400);}
 const code=typeof input?.claim_code==="string"?input.claim_code.trim().toUpperCase():"";
 if(!/^[A-F0-9]{12}$/.test(code))return error("Codice richiesta non valido",400);
 const changed=await env.DB.prepare(
  "UPDATE admin_passkeys SET status='approved',approved_at=? WHERE claim_code=? AND status='pending'"
 ).bind(now(),code).run();
 if(changed?.meta?.changes!==1)return error("Richiesta non trovata o già decisa",404);
 return respond({approved:true,claim_code:code});
}
async function revokeAdminDevice(req,env) {
 let input;
 try {input=await json(req);}catch(_){return error("Richiesta non valida",400);}
 const id=input?.credential_id;
 if(typeof id!=="string"||id.length<10||id.length>1024||!/^[A-Za-z0-9_-]+$/.test(id))
  return error("Dispositivo non valido",400);
 const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkeys WHERE status='approved'").first();
 if(Number(count?.n||0)<=1)return error("Non puoi revocare l'ultimo telefono autorizzato",409);
 const updated=await env.DB.prepare("UPDATE admin_passkeys SET status='revoked' WHERE id=? AND status='approved'")
  .bind(id).run();
 if(updated?.meta?.changes!==1)return error("Telefono non trovato",404);
 await env.DB.prepare("DELETE FROM admin_sessions WHERE passkey_id=?").bind(id).run();
 return respond({revoked:true});
}
export async function handlePasskey(req,env,path,authenticateAdmin=async()=>false) {
 // Don't allow WebAuthn from a preview/custom origin without deliberate migration.
 if(!requireOrigin(req))return error("Origine non autorizzata",403);
 if(path.startsWith("/api/admin/passkey/pairing/")||path.startsWith("/api/admin/passkey/devices/")) {
  if(!(await authenticateAdmin()))return error("Accesso amministratore richiesto",401);
  if(path==="/api/admin/passkey/pairing/create"&&req.method==="POST")return createDevicePairing(env);
  if(path==="/api/admin/passkey/devices/pending"&&req.method==="GET")return pendingAdminDevices(env);
  if(path==="/api/admin/passkey/devices/approved"&&req.method==="GET")return approvedAdminDevices(env);
  if(path==="/api/admin/passkey/devices/approve"&&req.method==="POST")return approveAdminDevice(req,env);
  if(path==="/api/admin/passkey/devices/revoke"&&req.method==="POST")return revokeAdminDevice(req,env);
  return error("Not found",404);
 }
 if(path==="/api/admin/passkey/register/options"&&req.method==="POST")return registerOptions(req,env);
 if(path==="/api/admin/passkey/register/verify"&&req.method==="POST")return registerVerify(req,env);
 if(path==="/api/admin/passkey/auth/options"&&req.method==="POST")return authOptions(env);
 if(path==="/api/admin/passkey/auth/verify"&&req.method==="POST")return authVerify(req,env);
 if(path==="/api/admin/passkey/logout"&&req.method==="POST")return logout(req,env);
 if(path==="/api/admin/passkey/session"&&req.method==="GET")
  return respond({authenticated:await passkeySessionAllowed(req,env)});
 return error("Not found",404);
}
