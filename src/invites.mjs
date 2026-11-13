// Privately addressed, app-scoped invitations. A link proves possession
// of a bearer capability, NOT ownership of the claimed email address.
import {APP,UUID,sha256hex} from "./core.mjs";
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const error=(message,status=400)=>answer({error:message},status);
const now=()=>new Date().toISOString();
const invitePattern=/^[A-Za-z0-9_-]{43}$/;
export const validInviteToken=value=>typeof value==="string" && invitePattern.test(value);
export const validTesterEmail=value=>typeof value==="string"&&value.length<=254&&
  /^[^\s@<>]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)&&!value.includes("..");
export function validInviteFields(body){
 return !!body && body.app_id===APP &&
  typeof body.tester_name==="string" && body.tester_name.trim().length>=2 && body.tester_name.trim().length<=64 &&
  validTesterEmail(body.tester_email)&&
  Number.isInteger(body.expires_days)&&body.expires_days>=1&&body.expires_days<=30;
}
const sameOrigin=req=>!req.headers.get("origin")||req.headers.get("origin")===new URL(req.url).origin;
async function bodyJson(req){
 const raw=await req.text();
 if(raw.length>2048)throw Error("Request too large");
 return JSON.parse(raw);
}
function randomToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function htmlPage(title,content,status=200){
 const body='<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>body{font-family:system-ui;background:#101624;color:#f5f7ff;max-width:600px;margin:8vh auto;padding:22px;line-height:1.6}a{color:#91c8ff}code{overflow-wrap:anywhere;background:#26324a;padding:4px 8px;border-radius:6px}</style><h1>'+title+'</h1>'+content+'<p><small>Beta Access è indipendente da AIVEXUS. Non inviare credenziali o dati personali non richiesti.</small></p></html>';
 return new Response(body,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
}
export async function createInvite(req,env){
 if(!sameOrigin(req))return error("Origine non autorizzata",403);
 let body;
 try{body=await bodyJson(req);}catch(_){return error("Dati invito non validi");}
 if(!validInviteFields(body))return error("Scegli WEmulDroid, nome tester, email valida e scadenza da 1 a 30 giorni");
 const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM tester_invites WHERE created_at>?")
  .bind(new Date(Date.now()-86400000).toISOString()).first();
 if(Number(recent?.n||0)>=100)return error("Limite inviti giornaliero raggiunto",429);
 const id=crypto.randomUUID(), token=randomToken(), hash=await sha256hex(token);
 const expires=new Date(Date.now()+body.expires_days*86400000).toISOString();
 await env.DB.prepare("INSERT INTO tester_invites(id,app_id,token_sha256,tester_name,tester_email,status,created_at,expires_at) VALUES(?,?,?,?,?,'active',?,?)")
  .bind(id,APP,hash,body.tester_name.trim(),body.tester_email.trim().toLowerCase(),now(),expires).run();
 return answer({id,app_id:APP,tester_name:body.tester_name.trim(),tester_email:body.tester_email.trim().toLowerCase(),
  expires_at:expires,invite_url:new URL("/i/"+token,req.url).href,identity_verified:false},201);
}
export async function listInvites(env){
 const records=await env.DB.prepare("SELECT id,app_id,tester_name,tester_email,status,created_at,expires_at,claimed_at,claimed_installation_id FROM tester_invites ORDER BY created_at DESC LIMIT 100").all();
 return answer({invites:(records.results??[]).map(x=>({...x,identity_verified:false}))});
}
export async function revokeInvite(req,env,id){
 if(!sameOrigin(req))return error("Origine non autorizzata",403);
 if(!UUID.test(id))return error("Invito non valido",400);
 const invite=await env.DB.prepare("SELECT id,claimed_installation_id FROM tester_invites WHERE id=?").bind(id).first();
 if(!invite)return error("Invito non trovato",404);
 await env.DB.prepare("UPDATE tester_invites SET status='revoked' WHERE id=?").bind(id).run();
 // Revoking a used invitation also revokes the corresponding app installation.
 if(invite.claimed_installation_id)
  await env.DB.prepare("UPDATE installations SET state='revoked',approved_until=NULL,decided_at=? WHERE id=?")
   .bind(now(),invite.claimed_installation_id).run();
 return answer({revoked:true,installation_revoked:!!invite.claimed_installation_id});
}
export async function lookupInvite(env,token){
 if(!validInviteToken(token))return null;
 const hash=await sha256hex(token);
 return env.DB.prepare("SELECT id,app_id,status,expires_at,claimed_installation_id FROM tester_invites WHERE token_sha256=?")
  .bind(hash).first();
}
export function inviteUsable(row,id){
 if(!row||row.app_id!==APP||row.status!=="active"||!Number.isFinite(Date.parse(row.expires_at))||
  Date.parse(row.expires_at)<=Date.now())return false;
 if(row.claimed_installation_id && row.claimed_installation_id!==id)return false;
 return true;
}
export async function verifyEnrollmentInvite(env,token,installationId){
 if(!validInviteToken(token))return null;
 const row=await lookupInvite(env,token);
 return inviteUsable(row,installationId)?row:null;
}
export async function claimEnrollmentInvite(env,row,id){
 if(row.claimed_installation_id===id)return true;
 const change=await env.DB.prepare("UPDATE tester_invites SET claimed_installation_id=?,claimed_at=? WHERE id=? AND claimed_installation_id IS NULL AND status='active' AND expires_at>?")
  .bind(id,now(),row.id,now()).run();
 return change?.meta?.changes===1;
}
export async function getInviteLanding(req,env,token){
 const record=await lookupInvite(env,token);
 if(!record)return htmlPage("Invito non trovato","<p>Questo invito non esiste o non è valido.</p>",404);
 if(record.claimed_installation_id||!inviteUsable(record,""))
  return htmlPage("Invito non disponibile","<p>Questo invito è scaduto, revocato o già utilizzato.</p>",410);
 const releaseReady=env.PUBLIC_TESTERS_ENABLED==="true"&&/^v\d+\.\d+\.\d+-beta\.\d+$/.test(env.APPROVED_BETA_TAG||"");
 // Never treat a token as proof of an email address; email verification is future work.
 const status=releaseReady?
 '<p><a href="/download/invite/'+token+'">Scarica la beta privata WEmulDroid</a>. La versione deve contenere il gate Beta Access.</p>':
 '<p>Download tester ancora disattivati: nessuna beta protetta è stata autorizzata per la distribuzione.</p>';
 return htmlPage("Invito WEmulDroid",'<p>Invito individuale per una installazione Windows, valido fino al '+record.expires_at.slice(0,10)+'.</p>'+status+'<p>Codice da inserire nella finestra di attivazione WEmulDroid:</p><p><code>'+token+'</code></p><p>Conserva il codice e non condividerlo. Anche dopo la richiesta, serve l’approvazione dell’amministratore.</p>');
}
