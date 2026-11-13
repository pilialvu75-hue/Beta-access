import QRCode from "qrcode";
import {createInvite,listInvites,revokeInvite,getInviteLanding,verifyEnrollmentInvite,claimEnrollmentInvite} from "./invites.mjs";
import {handleAdminPush,enqueuePushRequest,deliverPendingPush} from "./push.mjs";
import {handlePasskey,passkeySessionAllowed} from "./passkeys.mjs";
import {APP, REPO, DIAGNOSTICS_REPO, UUID, HEX_SECRET, latestInstaller, validEnrollment, expiry, effectiveState, sanitizeTelemetry, sha256hex, constantTimeEqual} from "./core.mjs";

const GH_RELEASES = "https://api.github.com/repos/" + REPO + "/releases?per_page=30";
const JSON_HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const response = (obj,status=200) => new Response(JSON.stringify(obj),{status,headers:JSON_HEADERS});
const fail = (msg,status=400) => response({error:msg},status);
const iso = () => new Date().toISOString();
const notFound = () => fail("Not found",404);
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) throw new Error("Request too large");
  const body = await request.text();
  if (body.length > 4096) throw new Error("Request too large");
  return JSON.parse(body);
}
// An administrator must approve a newly built gated beta before the public QR works.
async function githubRelease(env) {
  if (env.PUBLIC_TESTERS_ENABLED !== "true") return null;
  const tag = (env.APPROVED_BETA_TAG || "").trim();
  if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag)) return null;
  const res = await fetch(GH_RELEASES,{headers:{"Accept":"application/vnd.github+json","User-Agent":"Aivexus-Beta-Access/1.0"},cf:{cacheTtl:120,cacheEverything:true}});
  if (!res.ok) throw new Error("GitHub catalog unavailable");
  const body = await res.text();
  if (body.length > 300000) throw new Error("GitHub catalog too large");
  const releases = JSON.parse(body);
  if (!Array.isArray(releases)) throw new Error("Unexpected release catalog");
  return latestInstaller(releases.filter(r => r?.tag_name === tag));
}
async function adminAllowed(req,env) {
  const candidate = req.headers.get("authorization") || "";
  if (env.ADMIN_TOKEN?.length >= 48 && candidate.startsWith("Bearer ")) {
    const a=await sha256hex(candidate.slice(7)), b=await sha256hex(env.ADMIN_TOKEN);
    if(constantTimeEqual(a,b))return true; // Existing recovery key remains unchanged.
  }
  return passkeySessionAllowed(req,env);
}
async function deviceRecord(req,env,id) {
  if (!UUID.test(id ?? "")) return null;
  const secret = req.headers.get("x-device-key") || "";
  if (!HEX_SECRET.test(secret)) return null;
  const row = await env.DB.prepare("SELECT * FROM installations WHERE id=? AND app_id=?").bind(id,APP).first();
  if (!row) return null;
  const dig = await sha256hex(secret.toLowerCase());
  return constantTimeEqual(dig,row.secret_sha256) ? row : null;
}
async function enroll(req,env,ctx) {
  // Enrollment remains disabled until a gated WEmulDroid build has been tested.
  // When enabled, every public enrollment requires a private app-specific invitation.
  const administrator=await adminAllowed(req,env);
  const publicEnrollment=env.PUBLIC_TESTERS_ENABLED==="true";
  // A deliberate private pilot can enroll a device with an owner-issued token
  // without exposing a public installer, QR or general tester registration.
  const privatePilot=env.PRIVATE_PILOT_ENROLLMENT_ENABLED==="true";
  if(!publicEnrollment&&!privatePilot&&!administrator)return fail("Tester enrollment is not enabled",403);
  const body=await readJson(req);
  if(!validEnrollment(body))return fail("Invalid enrollment");
  const id=body.installation_id.toLowerCase();
  const secretHash=await sha256hex(body.device_secret.toLowerCase());
  const inviteRequired=(publicEnrollment||privatePilot)&&!administrator;
  const invite=inviteRequired?await verifyEnrollmentInvite(env,body.invite_token,id):null;
  if(inviteRequired&&!invite)return fail("Valid private invitation required",403);
  const exists=await env.DB.prepare("SELECT * FROM installations WHERE id=?").bind(id).first();
  if(exists && !constantTimeEqual(exists.secret_sha256,secretHash))
    return fail("Device key does not match",403);
  if(inviteRequired&&exists&&exists.invite_id!==invite.id)
    return fail("This installation belongs to another invitation",403);
  let newlyPending=false;
  if(!exists){
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM installations WHERE state='pending'").first();
    if((count?.n??0)>=500)return fail("Queue is temporarily full",429);
    // Claim the invite *before* inserting the device so no unclaimed installation
    // can briefly appear in the admin queue during concurrent enrollment.
    if(inviteRequired&&!(await claimEnrollmentInvite(env,invite,id)))
      return fail("Invitation already used by another installation",403);
    try{
      await env.DB.prepare("INSERT INTO installations(id,app_id,secret_sha256,label,platform,version,state,requested_at,telemetry_consent,last_seen_at,invite_id) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)")
        .bind(id,APP,secretHash,body.label,body.platform,body.version,iso(),body.telemetry_consent?1:0,iso(),invite?.id??null).run();
    }catch(e){
      if(inviteRequired){
        // Recover the single-use token if a database insert failed. Restrict
        // the rollback to this exact invite + installation pair.
        try{
          await env.DB.prepare("UPDATE tester_invites SET claimed_installation_id=NULL,claimed_at=NULL WHERE id=? AND claimed_installation_id=?")
            .bind(invite.id,id).run();
        }catch(_){ /* Leave the invite unusable rather than loosen authorization. */ }
      }
      throw e;
    }
    newlyPending=true;
  }else{
    const state=effectiveState(exists);
    if(state!=="approved"&&state!=="pending"){
      await env.DB.prepare("UPDATE installations SET state='pending',approved_until=NULL,decided_at=NULL,requested_at=?,label=?,version=?,telemetry_consent=?,last_seen_at=? WHERE id=?")
        .bind(iso(),body.label,body.version,body.telemetry_consent?1:0,iso(),id).run();
      newlyPending=true;
    }else{
      await env.DB.prepare("UPDATE installations SET version=?,last_seen_at=? WHERE id=?").bind(body.version,iso(),id).run();
    }
  }
  const row=await env.DB.prepare("SELECT state,approved_until FROM installations WHERE id=?").bind(id).first();
  if(newlyPending&&body.version!=="0.0.0-smoke"){
    try {
      await enqueuePushRequest(env,id);
      if(ctx?.waitUntil)ctx.waitUntil(deliverPendingPush(env));
    }catch(_){ /* Notification failure does not block an otherwise valid request. */ }
  }
  return response({state:effectiveState(row),approved_until:row.approved_until});
}
async function status(req,env,url) {
  const row = await deviceRecord(req,env,url.searchParams.get("installation_id"));
  if (!row) return fail("Unknown installation or invalid credentials",403);
  await env.DB.prepare("UPDATE installations SET last_seen_at=? WHERE id=?").bind(iso(),row.id).run();
  return response({state:effectiveState(row),approved_until:row.approved_until,telemetry_consent:!!row.telemetry_consent});
}
async function telemetry(req,env) {
  const body = await readJson(req);
  const row = await deviceRecord(req,env,body?.installation_id);
  if (!row) return fail("Invalid device credentials",403);
  if (effectiveState(row)!=="approved") return fail("Activation required",403);
  if (!row.telemetry_consent) return fail("Diagnostics consent not granted",403);
  let event;
  try {event=sanitizeTelemetry(body,row.id);}catch(_){return fail("Invalid structured event");}
  const daily = await env.DB.prepare("SELECT COUNT(*) AS n FROM telemetry_outbox WHERE installation_id=? AND received_at>=?")
    .bind(row.id,new Date(Date.now()-86400000).toISOString()).first();
  if ((daily?.n ?? 0) >= 500) return fail("Daily diagnostics quota exceeded",429);
  await env.DB.prepare("INSERT OR IGNORE INTO telemetry_outbox(event_id,installation_id,payload_json,received_at) VALUES(?,?,?,?)")
    .bind(body.event_id,row.id,JSON.stringify(event),iso()).run();
  return response({accepted:true});
}
async function adminPilotReadiness(env) {
  // Only for an authenticated owner; never return actual token/endpoint values.
  const reports={};
  const checks=[
    ["private_invites_schema","SELECT COUNT(*) AS n FROM tester_invites"],
    ["admin_passkeys_schema","SELECT COUNT(*) AS n FROM admin_passkeys"],
    ["push_subscriptions_schema","SELECT COUNT(*) AS n FROM admin_push_subscriptions"],
    ["telemetry_schema","SELECT COUNT(*) AS n FROM telemetry_outbox"]
  ];
  for(const [key,sql] of checks){
    try {
      const row=await env.DB.prepare(sql).first();
      reports[key]={available:true,count:Number(row?.n||0)};
    }catch(_){reports[key]={available:false,count:0};}
  }
  const publicSharing=env.PUBLIC_TESTERS_ENABLED==="true";
  const privatePilot=env.PRIVATE_PILOT_ENROLLMENT_ENABLED==="true";
  const pushConfigured=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
  const diagnosticsConfigured=!!env.DIAGNOSTICS_GITHUB_TOKEN;
  const prerequisites=reports.private_invites_schema.available &&
    reports.admin_passkeys_schema.available && reports.push_subscriptions_schema.available &&
    reports.telemetry_schema.available && pushConfigured && diagnosticsConfigured &&
    reports.push_subscriptions_schema.count>0&&!publicSharing;
  return response({
    public_download_enabled:publicSharing,
    private_pilot_enabled:privatePilot,
    diagnostics_configured:diagnosticsConfigured,
    web_push_configured:pushConfigured,
    push_subscriptions:reports.push_subscriptions_schema.count,
    private_invites_schema_ready:reports.private_invites_schema.available,
    admin_passkeys_schema_ready:reports.admin_passkeys_schema.available,
    telemetry_schema_ready:reports.telemetry_schema.available,
    infrastructure_checks_pass:prerequisites,
    can_accept_private_invites:prerequisites&&privatePilot,
    windows_real_test_verified:false,
    explanation:"Controllo server e notifiche soltanto: installazione Windows, firma e Diagnostics end-to-end richiedono una prova reale."
  });
}
// Read-only GitHub probe. Detects a token with insufficient repository access
// before a tester arrives; it does NOT upload a diagnostic event or change GitHub.
async function adminDiagnosticsAccess(env) {
  const untested={remote_upload_tested:false};
  if(!env.DIAGNOSTICS_GITHUB_TOKEN)
    return response({...untested,status:"missing_token",repository_accessible:false,write_permission_reported:null});
  try {
    const r=await githubAPI(env,"",{signal:AbortSignal.timeout(6000),cache:"no-store"});
    if(r.status===401)return response({...untested,status:"invalid_token",repository_accessible:false,write_permission_reported:null});
    if(r.status===403)return response({...untested,status:"github_denied_or_rate_limited",repository_accessible:false,write_permission_reported:null});
    if(r.status===404)return response({...untested,status:"repository_not_accessible",repository_accessible:false,write_permission_reported:null});
    if(!r.ok)return response({...untested,status:"github_error",repository_accessible:false,write_permission_reported:null});
    const metadata=await r.json();
    if(metadata?.full_name!==DIAGNOSTICS_REPO)
      return response({...untested,status:"repository_mismatch",repository_accessible:false,write_permission_reported:null});
    const canPush=metadata?.permissions?.push;
    const reported=typeof canPush==="boolean"?canPush:null;
    const status=reported===true?"write_reported":reported===false?"read_only":"write_unknown";
    return response({...untested,status,repository_accessible:true,write_permission_reported:reported});
  }catch(_){
    return response({...untested,status:"network_unavailable",repository_accessible:false,write_permission_reported:null});
  }
}
async function adminRequests(env) {
  const data = await env.DB.prepare("SELECT i.id,i.app_id,i.label,i.platform,i.version,i.state,i.requested_at,i.decided_at,i.approved_until,i.telemetry_consent,i.last_seen_at,i.invite_id,t.tester_name AS intended_tester,t.tester_email AS intended_email FROM installations AS i LEFT JOIN tester_invites AS t ON i.invite_id=t.id ORDER BY CASE WHEN i.state='pending' THEN 0 ELSE 1 END,i.requested_at DESC LIMIT 200").all();
  return response({requests:(data.results ?? []).map(row=>({...row,state:effectiveState(row)}))});
}
async function adminDecision(req,env,id) {
  if (!UUID.test(id)) return fail("Invalid installation");
  const input = await readJson(req);
  if (!["approve","deny","revoke"].includes(input?.action)) return fail("Invalid decision");
  const row = await env.DB.prepare("SELECT id FROM installations WHERE id=?").bind(id).first();
  if (!row) return notFound();
  let state = "approved", until = null;
  if (input.action==="approve") {
    try {until=expiry(input.duration_days);}catch(_){return fail("Choose an integer from 1 to 365 days");}
  } else state=input.action==="deny"?"denied":"revoked";
  await env.DB.prepare("UPDATE installations SET state=?,decided_at=?,approved_until=? WHERE id=?")
    .bind(state,iso(),until,id).run();
  return response({id,state,approved_until:until});
}
function publicOrigin(req,env) {
  const origin = env.PUBLIC_BASE_URL || new URL(req.url).origin;
  const url = new URL(origin);
  if (url.protocol!=="https:") throw new Error("PUBLIC_BASE_URL must use HTTPS");
  return url.origin;
}
async function publicDownload(req,env) {
  const release = await githubRelease(env);
  if (!release) return fail("No approved gated WEmulDroid beta installer available",503);
  const safeTag=release.tag.replace(/[^a-zA-Z0-9.+-]/g,"");
  const html = '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WEmulDroid beta</title>' +
    '<style>body{font-family:system-ui;margin:12vh auto;max-width:620px;padding:20px;line-height:1.5;background:#101624;color:#f5f7ff}a{color:#91c8ff}.btn{display:inline-block;background:#3277e7;color:#fff;padding:15px 20px;border-radius:12px;text-decoration:none}small{color:#c1c8dc}</style>' +
    '<h1>WEmulDroid Beta</h1><p>Installer per Windows · versione '+safeTag+'</p><p>La versione beta può essere non firmata digitalmente. Non disattivare le protezioni Windows per installarla.</p>' +
    '<p><a class="btn" href="/download/wemuldroid">Scarica installer ufficiale</a></p><p><a href="'+release.checksum+'">Controlla SHA-256</a></p>' +
    '<small>Dopo l’installazione delle build Beta Access, avvia il programma e premi «Richiedi autorizzazione».</small></html>';
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'","x-content-type-options":"nosniff"}});
}
async function download(env) {
  const release = await githubRelease(env);
  if (!release) return fail("No approved gated installer available",503);
  return Response.redirect(release.download,302);
}
async function privateInviteDownload(env,token) {
  const inv=await verifyEnrollmentInvite(env,token,"");
  if(!inv || inv.claimed_installation_id)return fail("Invitation expired, revoked or already used",403);
  const release=await githubRelease(env);
  if(!release)return fail("No approved gated installer available",503);
  return Response.redirect(release.download,302);
}
async function githubAPI(env,path,opts={}) {
  const res = await fetch("https://api.github.com/repos/"+DIAGNOSTICS_REPO+path,{
    ...opts, headers:{
      "Authorization":"Bearer "+env.DIAGNOSTICS_GITHUB_TOKEN,
      "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"Aivexus-Beta-Access/1.0",
      ...(opts.headers ?? {})
    }
  });
  return res;
}
// Paginate only assets within the current WEmulDroid installation release.
async function listGithubAssets(env, releaseId) {
  const all=[];
  for(let page=1;page<=30;page++) {
    const r=await githubAPI(env,"/releases/"+releaseId+"/assets?per_page=100&page="+page);
    if(!r.ok) return null;
    const pageAssets=await r.json();
    if(!Array.isArray(pageAssets)) return null;
    all.push(...pageAssets);
    if(pageAssets.length < 100) return all;
  }
  return null; // Never infer completeness from a truncated asset list.
}
async function rotateOwnArchives(env,releaseId) {
  const assets=await listGithubAssets(env,releaseId);
  if(!assets) return;
  // No other producer can ever be deleted here: dedicated release + exact prefix.
  const owned=assets.filter(a => /^wemuldroid-diag-[a-f0-9]{64}\.jsonl$/.test(a.name||"") && a.state==="uploaded")
    .sort((a,b)=>Date.parse(b.created_at||"")-Date.parse(a.created_at||""));
  let bytes=0;
  for(const asset of owned) {
    if(bytes+asset.size <= 20*1024*1024) {bytes+=asset.size;continue;}
    await githubAPI(env,"/releases/assets/"+asset.id,{method:"DELETE"});
  }
}
async function flushDiagnostics(env) {
  if (!env.DIAGNOSTICS_GITHUB_TOKEN) return;
  const result = await env.DB.prepare("SELECT event_id,installation_id,payload_json FROM telemetry_outbox WHERE shipped_at IS NULL ORDER BY received_at LIMIT 25").all();
  const groups = new Map();
  for(const e of result.results ?? []) {
    if (!groups.has(e.installation_id)) groups.set(e.installation_id,[]);
    groups.get(e.installation_id).push(e);
  }
  for(const [id,entries] of groups) {
    if (!UUID.test(id)) continue;
    const tag = "diagnostics-wemuldroid-v1-"+id;
    let r = await githubAPI(env,"/releases/tags/"+tag);
    let release;
    if (r.status===404) {
      r=await githubAPI(env,"/releases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        tag_name:tag,name:"Diagnostica WEmulDroid "+id,draft:false,prerelease:false,
        body:"Eventi tecnici filtrati WEmulDroid. Nessun logcat, nome PC o account."
      })});
    }
    if (!r.ok) continue;
    release=await r.json();
    const payload=entries.map(e=>e.payload_json).join("\n")+"\n";
    const hash=await sha256hex(payload);
    const assetName="wemuldroid-diag-"+hash+".jsonl";
    if(new TextEncoder().encode(payload).length > 1024*1024) continue;
    const existing=await listGithubAssets(env,release.id);
    if(!existing) continue;
    let success=existing.some(a=>a.name===assetName && a.state==="uploaded" && a.size===new TextEncoder().encode(payload).length);
    if (!success) {
      const upload = await fetch("https://uploads.github.com/repos/"+DIAGNOSTICS_REPO+"/releases/"+release.id+"/assets?name="+encodeURIComponent(assetName),{
        method:"POST",headers:{"Authorization":"Bearer "+env.DIAGNOSTICS_GITHUB_TOKEN,"Content-Type":"application/x-ndjson","Accept":"application/vnd.github+json","User-Agent":"Aivexus-Beta-Access/1.0"},
        body:payload
      });
      success=upload.status===201;
    }
    if (success) {
      for(const e of entries) {
        await env.DB.prepare("UPDATE telemetry_outbox SET shipped_at=? WHERE event_id=? AND shipped_at IS NULL").bind(iso(),e.event_id).run();
      }
      try {await rotateOwnArchives(env,release.id);}catch(_){ /* retry next cron */ }
    }
  }
  // Only purge confirmed shipped local messages. GitHub keeps its own archive.
  await env.DB.prepare("DELETE FROM telemetry_outbox WHERE shipped_at IS NOT NULL AND shipped_at<?").bind(new Date(Date.now()-30*86400000).toISOString()).run();
}
export default {
 async fetch(req,env,ctx) {
   try {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/,"") || "/";
    if (path==="/") return Response.redirect(publicOrigin(req,env)+"/admin/",302);
    // Public legacy download paths must not bypass targeted invitation links.
    if (req.method==="GET" && path==="/d/wemuldroid" && env.PUBLIC_TESTERS_ENABLED!=="true") return publicDownload(req,env);
    if (req.method==="GET" && path==="/download/wemuldroid" && env.PUBLIC_TESTERS_ENABLED!=="true") return download(env);
    if (req.method==="GET" && (path==="/d/wemuldroid"||path==="/download/wemuldroid"))
      return fail("Use your private tester invitation link",403);
    if (req.method==="GET" && path.startsWith("/download/invite/"))
      return privateInviteDownload(env,path.slice("/download/invite/".length));
    if (req.method==="GET" && path.startsWith("/qr/invite/") && path.endsWith(".svg")) {
      const code=path.slice("/qr/invite/".length,-4);
      const invitation=await verifyEnrollmentInvite(env,code,"");
      if(!invitation||invitation.claimed_installation_id)return notFound();
      const svg=await QRCode.toString(publicOrigin(req,env)+"/i/"+code,{
        type:"svg",errorCorrectionLevel:"M",margin:3
      });
      return new Response(svg,{headers:{
        "content-type":"image/svg+xml","cache-control":"no-store",
        "x-content-type-options":"nosniff","referrer-policy":"no-referrer"
      }});
    }
    if (req.method==="GET" && path==="/qr/wemuldroid.svg") {
      if(env.PUBLIC_TESTERS_ENABLED==="true")return fail("Private invitation QR only",403);
      const svg=await QRCode.toString(publicOrigin(req,env)+"/d/wemuldroid",{type:"svg",errorCorrectionLevel:"M",margin:3});
      return new Response(svg,{headers:{"content-type":"image/svg+xml","cache-control":"public,max-age=300","x-content-type-options":"nosniff"}});
    }
    if (path==="/api/catalog" && req.method==="GET") {
      const release=await githubRelease(env);
      // A gated release alone never makes a shared, unrestricted QR/link valid.
      return response({app_id:APP,release:release?{tag:release.tag}:null,
        available:false,share_url:null,
        message:release?"Distribuzione con inviti privati: crea un link per il singolo tester.":"Inviti disattivati: manca una beta con attivazione autorizzata."});
    }
    if (req.method==="GET"&&path.startsWith("/i/"))return getInviteLanding(req,env,path.slice(3));
    if (path==="/api/v1/enroll" && req.method==="POST") return enroll(req,env,ctx);
    if (path==="/api/v1/status" && req.method==="GET") return status(req,env,url);
    if (path==="/api/v1/telemetry" && req.method==="POST") return telemetry(req,env);
    if (path.startsWith("/api/admin/passkey/"))
      return handlePasskey(req,env,path,()=>adminAllowed(req,env));
    if (path.startsWith("/api/admin/")) {
      if (!await adminAllowed(req,env)) return fail("Administrator credentials required",401);
      if (path==="/api/admin/pilot/readiness" && req.method==="GET")return adminPilotReadiness(env);
      if (path==="/api/admin/pilot/diagnostics-access" && req.method==="GET")return adminDiagnosticsAccess(env);
      if (path.startsWith("/api/admin/push/")) return handleAdminPush(req,env,path);
      if (path==="/api/admin/invites"&&req.method==="GET")return listInvites(env);
      if (path==="/api/admin/invites"&&req.method==="POST")return createInvite(req,env);
      const inviteRoute=/^\/api\/admin\/invites\/([a-f0-9-]+)\/revoke$/i.exec(path);
      if(inviteRoute&&req.method==="POST")return revokeInvite(req,env,inviteRoute[1]);
      if (path==="/api/admin/requests" && req.method==="GET") return adminRequests(env);
      const match=/^\/api\/admin\/requests\/([a-f0-9-]+)\/decision$/i.exec(path);
      if (match && req.method==="POST") return adminDecision(req,env,match[1]);
      return notFound();
    }
    // Do not normalize /admin/ to /admin, otherwise a redirect loop occurs.
    if (url.pathname==="/admin") return Response.redirect(publicOrigin(req,env)+"/admin/",302);
    if (env.ASSETS && req.method==="GET") return env.ASSETS.fetch(req);
    return notFound();
   }catch(e) {
    // Do not send exception details, DB data or secrets to clients.
    console.error("Beta Access request failed",e instanceof Error ? e.name : "unknown");
    return fail("Service temporarily unavailable",503);
   }
 },
 async scheduled(_event,env,ctx) {
  ctx.waitUntil(flushDiagnostics(env));
  ctx.waitUntil(deliverPendingPush(env));
}
};
