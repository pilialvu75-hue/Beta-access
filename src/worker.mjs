import QRCode from "qrcode";
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
  // The public QR/installer is disabled until a verified, gated beta is ready.
  // Allow only an administrator to create synthetic enrollment checks meanwhile.
  if (env.PUBLIC_TESTERS_ENABLED !== "true" && !(await adminAllowed(req,env))) {
    return fail("Tester enrollment is not enabled",403);
  }
  const body = await readJson(req);
  if (!validEnrollment(body)) return fail("Invalid enrollment");
  const id = body.installation_id.toLowerCase();
  const secretHash = await sha256hex(body.device_secret.toLowerCase());
  const exists = await env.DB.prepare("SELECT * FROM installations WHERE id=?").bind(id).first();
  if (exists && !constantTimeEqual(exists.secret_sha256,secretHash)) return fail("Device key does not match",403);
  let newlyPending=false;
  if (!exists) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM installations WHERE state='pending'").first();
    if ((count?.n ?? 0) >= 500) return fail("Queue is temporarily full",429);
    await env.DB.prepare("INSERT INTO installations(id,app_id,secret_sha256,label,platform,version,state,requested_at,telemetry_consent,last_seen_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)")
      .bind(id,APP,secretHash,body.label,body.platform,body.version,iso(),body.telemetry_consent?1:0,iso()).run();
    newlyPending=true;
  } else {
    // An explicit new request may re-open a denied, revoked or expired installation.
    const state = effectiveState(exists);
    if (state !== "approved" && state !== "pending") {
      await env.DB.prepare("UPDATE installations SET state='pending',approved_until=NULL,decided_at=NULL,requested_at=?,label=?,version=?,telemetry_consent=?,last_seen_at=? WHERE id=?")
        .bind(iso(),body.label,body.version,body.telemetry_consent?1:0,iso(),id).run();
      newlyPending=true;
    } else {
      await env.DB.prepare("UPDATE installations SET version=?,last_seen_at=? WHERE id=?").bind(body.version,iso(),id).run();
    }
  }
  const row = await env.DB.prepare("SELECT state,approved_until FROM installations WHERE id=?").bind(id).first();
  if (newlyPending && body.version!=="0.0.0-smoke") {
    try {
      await enqueuePushRequest(env,id);
      if (ctx?.waitUntil) ctx.waitUntil(deliverPendingPush(env));
    } catch(_) { /* Notification delivery never blocks successful enrollment. */ }
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
async function adminRequests(env) {
  const data = await env.DB.prepare("SELECT id,app_id,label,platform,version,state,requested_at,decided_at,approved_until,telemetry_consent,last_seen_at FROM installations ORDER BY requested_at DESC LIMIT 200").all();
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
    if (req.method==="GET" && path==="/d/wemuldroid") return publicDownload(req,env);
    if (req.method==="GET" && path==="/download/wemuldroid") return download(env);
    if (req.method==="GET" && path==="/qr/wemuldroid.svg") {
      const svg=await QRCode.toString(publicOrigin(req,env)+"/d/wemuldroid",{type:"svg",errorCorrectionLevel:"M",margin:3});
      return new Response(svg,{headers:{"content-type":"image/svg+xml","cache-control":"public,max-age=300","x-content-type-options":"nosniff"}});
    }
    if (path==="/api/catalog" && req.method==="GET") {
      const release=await githubRelease(env);
      return response({app_id:APP,release:release?{tag:release.tag,download:release.download}:null,
        available:!!release,share_url:release?publicOrigin(req,env)+"/d/wemuldroid":null,
        message:release?null:"Inviti disattivati: manca una beta con attivazione autorizzata."});
    }
    if (path==="/api/v1/enroll" && req.method==="POST") return enroll(req,env,ctx);
    if (path==="/api/v1/status" && req.method==="GET") return status(req,env,url);
    if (path==="/api/v1/telemetry" && req.method==="POST") return telemetry(req,env);
    if (path.startsWith("/api/admin/passkey/"))
      return handlePasskey(req,env,path);
    if (path.startsWith("/api/admin/")) {
      if (!await adminAllowed(req,env)) return fail("Administrator credentials required",401);
      if (path.startsWith("/api/admin/push/")) return handleAdminPush(req,env,path);
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
