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
async function storeChallenge(env,kind,challenge) {
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO admin_passkey_challenges(id,kind,challenge,expires_at) VALUES(?,?,?,?)")
  .bind(id,kind,challenge,deadline(5*60*1000)).run();
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
async function registerOptions(env) {
 if(!await openEnrollment(env))return error("Registrazione passkey chiusa: autorizzazione iniziale richiesta",403);
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
 const challenge_id=await storeChallenge(env,"register",options.challenge);
 return respond({challenge_id,options});
}
async function registerVerify(req,env) {
 if(!await openEnrollment(env))return error("Registrazione passkey chiusa",403);
 const body=await json(req);
 const expected=await readChallenge(env,body?.challenge_id,"register");
 if(!expected)return error("Registrazione scaduta o già usata",400);
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
export async function handlePasskey(req,env,path) {
 // Don't allow WebAuthn from a preview/custom origin without deliberate migration.
 if(!requireOrigin(req))return error("Origine non autorizzata",403);
 if(path==="/api/admin/passkey/register/options"&&req.method==="POST")return registerOptions(env);
 if(path==="/api/admin/passkey/register/verify"&&req.method==="POST")return registerVerify(req,env);
 if(path==="/api/admin/passkey/auth/options"&&req.method==="POST")return authOptions(env);
 if(path==="/api/admin/passkey/auth/verify"&&req.method==="POST")return authVerify(req,env);
 if(path==="/api/admin/passkey/logout"&&req.method==="POST")return logout(req,env);
 if(path==="/api/admin/passkey/session"&&req.method==="GET")
  return respond({authenticated:await passkeySessionAllowed(req,env)});
 return error("Not found",404);
}
