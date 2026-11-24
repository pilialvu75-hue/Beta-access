// Private VoiceBridge Windows OTA. No GitHub credentials are sent to the app.
// Separate tables preserve existing WEmulDroid enrollment and approval gates.
// Feature remains CLOSED unless VOICEBRIDGE_OTA_ENABLED=true AND a narrowly
// scoped VOICEBRIDGE_RELEASES_TOKEN is configured in Cloudflare Worker secrets.
import {UUID, HEX_SECRET, sha256hex, constantTimeEqual} from "./core.mjs";

const REPO = "pilialvu75-hue/AIVEXUS-VoiceBridge";
const RELEASES = "https://api.github.com/repos/" + REPO + "/releases?per_page=20";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const answer = (value,status=200) =>
  new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const fail = (error,status=400) => answer({error},status);
const now = () => new Date().toISOString();
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const shaPattern = /^sha256:[0-9a-fA-F]{64}$/;
const windowsAssetName = version =>
  "AIVEXUS-VoiceBridge-Setup-v" + version + "-Win11.exe";

async function readSmallJson(req) {
  const raw = await req.text();
  if(raw.length > 4096) throw Error("Payload too large");
  return JSON.parse(raw);
}
function mintToken() {
  const array = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...array)).replace(/\+/g,"-")
    .replace(/\//g,"_").replace(/=+$/g,"");
}
async function getDevice(req,env) {
  const id=(req.headers.get("x-device-id")||"").toLowerCase();
  const secret=req.headers.get("x-device-key")||"";
  if(!UUID.test(id)||!HEX_SECRET.test(secret))return null;
  const device=await env.DB.prepare(
    "SELECT * FROM voicebridge_ota_devices WHERE installation_id=?"
  ).bind(id).first();
  if(!device)return null;
  const digest=await sha256hex(secret.toLowerCase());
  if(!constantTimeEqual(digest,device.secret_sha256))return null;
  if(device.state!=="approved"||
      !device.approved_until||Date.parse(device.approved_until)<=Date.now())
    return null;
  return device;
}

export function selectVoiceBridgeRelease(releases) {
  if(!Array.isArray(releases))return null;
  const candidates=[];
  for(const r of releases){
    if(!r || r.draft || !r.prerelease)continue;
    const match=/^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(r.tag_name||"");
    if(!match)continue;
    const version=match.slice(1,4).join(".");
    const name=windowsAssetName(version);
    const assets=(r.assets||[]).filter(a=>a?.name===name);
    if(assets.length!==1)continue;
    const asset=assets[0];
    const expected="https://github.com/"+REPO+"/releases/download/"+r.tag_name+"/"+name;
    if(!Number.isSafeInteger(asset.id)||asset.id<1||
       !Number.isSafeInteger(asset.size)||asset.size<100000||asset.size>2000000000||
       !shaPattern.test(asset.digest||"")||asset.state!=="uploaded"||
       asset.browser_download_url!==expected)continue;
    candidates.push({
      version,tag:r.tag_name,versionNumbers:match.slice(1).map(Number),
      name,assetId:asset.id,size:asset.size,
      sha256:asset.digest.slice(7).toLowerCase(),
      changelog:(r.body||"").slice(0,2000),
    });
  }
  candidates.sort((a,b)=>{
    for(let i=0;i<4;i++)if(a.versionNumbers[i]!==b.versionNumbers[i])
      return b.versionNumbers[i]-a.versionNumbers[i];
    return 0;
  });
  return candidates[0]||null;
}

async function githubLatest(env,fetcher) {
  const token=env.VOICEBRIDGE_RELEASES_TOKEN||"";
  if(token.length<25)throw Error("Private release backend not configured");
  const response=await fetcher(RELEASES,{
    headers:{
      "Authorization":"Bearer "+token,
      "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"AIVEXUS-Beta-Access/1.0",
    },redirect:"manual",
  });
  if(!response.ok)throw Error("Private release catalog unavailable");
  const raw=await response.text();
  if(raw.length>350000)throw Error("Release catalog too large");
  return selectVoiceBridgeRelease(JSON.parse(raw));
}

export async function handleVoiceBridgeOta(req,env,{administrator=false,fetcher=fetch}={}){
  if(env.VOICEBRIDGE_OTA_ENABLED!=="true")return fail("VoiceBridge OTA disabled",404);
  if(!env.DB)return fail("Device registry unavailable",503);
  const url=new URL(req.url);
  const path=url.pathname.replace(/\/+$/,"");
  const method=req.method;
  // Passkey cookie routes need same-origin POST protection.
  // Native Windows enrollment sends no browser Origin, so it remains valid.
  const origin=req.headers.get("origin");
  if(method==="POST" && origin && origin!==url.origin)
    return fail("Cross-origin mutation refused",403);

  if(path==="/api/admin/voicebridge/invite"&&method==="POST"){
    if(!administrator)return fail("Administrator required",401);
    const raw=await readSmallJson(req);
    const days=raw?.expires_days;
    if(!Number.isInteger(days)||days<1||days>7)return fail("Invalid invite expiry");
    const token=mintToken(),digest=await sha256hex(token);
    const expires=new Date(Date.now()+days*86400000).toISOString();
    await env.DB.prepare(
      "INSERT INTO voicebridge_ota_invites(token_sha256,created_at,expires_at,claimed_installation_id) VALUES(?,?,?,NULL)"
    ).bind(digest,now(),expires).run();
    // One-time code: only this authenticated admin response contains it.
    return answer({app_id:"voicebridge",invite_token:token,expires_at:expires},201);
  }
  if(path==="/api/admin/voicebridge/devices"&&method==="GET"){
    if(!administrator)return fail("Administrator required",401);
    const rows=await env.DB.prepare(
      "SELECT installation_id,label,current_version,state,registered_at,approved_until,last_seen_at FROM voicebridge_ota_devices ORDER BY registered_at DESC LIMIT 100"
    ).all();
    return answer({devices:rows.results||[]});
  }
  const approve=/^\/api\/admin\/voicebridge\/devices\/([a-f0-9-]{36})\/decision$/i.exec(path);
  if(approve&&method==="POST"){
    if(!administrator)return fail("Administrator required",401);
    if(!UUID.test(approve[1]))return fail("Invalid device ID");
    const data=await readSmallJson(req);
    if(!["approved","revoked"].includes(data?.state))
      return fail("Invalid approval");
    const days=data?.days;
    if(data.state==="approved"&&(!Number.isInteger(days)||days<1||days>365))
      return fail("Invalid approval validity");
    const expiry=data.state==="approved"?
      new Date(Date.now()+days*86400000).toISOString():null;
    const update=await env.DB.prepare(
      "UPDATE voicebridge_ota_devices SET state=?,approved_until=? WHERE installation_id=?"
    ).bind(data.state,expiry,approve[1].toLowerCase()).run();
    if(update?.meta?.changes!==1)return fail("Unknown VoiceBridge device",404);
    return answer({state:data.state,approved_until:expiry});
  }
  if(path==="/api/voicebridge/v1/enroll"&&method==="POST"){
    const input=await readSmallJson(req);
    const id=(input?.installation_id||"").toLowerCase();
    const secret=(input?.device_secret||"").toLowerCase();
    const invite=input?.invite_token||"";
    if(!UUID.test(id)||!HEX_SECRET.test(secret)||!tokenPattern.test(invite)||
       typeof input?.label!=="string"||input.label.length<1||input.label.length>48||
       !versionPattern.test(input?.version||""))return fail("Invalid enrollment");
    const tokenHash=await sha256hex(invite);
    const existing=await env.DB.prepare(
      "SELECT installation_id,secret_sha256,state FROM voicebridge_ota_devices WHERE installation_id=?"
    ).bind(id).first();
    if(existing){
      // Idempotent retry for dropped HTTP response: same key and invite
      // must be bound to the same installation, never a second device.
      const registered=await env.DB.prepare(
        "SELECT claimed_installation_id FROM voicebridge_ota_invites WHERE token_sha256=?"
      ).bind(tokenHash).first();
      if(!registered||registered.claimed_installation_id!==id||
        !constantTimeEqual(existing.secret_sha256,await sha256hex(secret)))
        return fail("Device already registered with other credentials",409);
      return answer({state:existing.state,message:"Existing device enrollment"},200);
    }
    const invited=await env.DB.prepare(
      "UPDATE voicebridge_ota_invites SET claimed_installation_id=? WHERE token_sha256=? AND claimed_installation_id IS NULL AND expires_at>?"
    ).bind(id,tokenHash,now()).run();
    if(invited?.meta?.changes!==1)return fail("Invitation invalid or already used",403);
    try {
      await env.DB.prepare(
        "INSERT INTO voicebridge_ota_devices(installation_id,secret_sha256,label,current_version,state,registered_at) VALUES(?,?,?,?,'pending',?)"
      ).bind(id,await sha256hex(secret),input.label,input.version,now()).run();
    } catch(error) {
      await env.DB.prepare(
        "UPDATE voicebridge_ota_invites SET claimed_installation_id=NULL WHERE token_sha256=? AND claimed_installation_id=?"
      ).bind(tokenHash,id).run();
      throw error;
    }
    return answer({state:"pending",message:"Waiting for owner approval"},201);
  }
  if(path==="/api/voicebridge/v1/status"&&method==="GET"){
    const id=(req.headers.get("x-device-id")||"").toLowerCase();
    const secret=req.headers.get("x-device-key")||"";
    if(!UUID.test(id)||!HEX_SECRET.test(secret))
      return fail("Device credentials required",401);
    const row=await env.DB.prepare(
      "SELECT state,secret_sha256,approved_until FROM voicebridge_ota_devices WHERE installation_id=?"
    ).bind(id).first();
    if(!row||!constantTimeEqual(await sha256hex(secret.toLowerCase()),row.secret_sha256))
      return fail("Invalid device credentials",403);
    const effective = row.state==="approved" &&
      (!row.approved_until || Date.parse(row.approved_until)<=Date.now())
      ? "expired" : row.state;
    return answer({state:effective,approved_until:row.approved_until});
  }

  if(path==="/api/voicebridge/v1/update"&&method==="GET"){
    const device=await getDevice(req,env);
    if(!device)return fail("Device not approved",403);
    try {
      const latest=await githubLatest(env,fetcher);
      if(!latest)return fail("No verified VoiceBridge beta release",503);
      const assetUrl=new URL("/api/voicebridge/v1/asset/"+latest.assetId+"/"+latest.name,req.url);
      return answer({
        app_id:"voicebridge",
        version:latest.version,
        channel:"beta",
        min_supported:"0.5.0",
        windows_url:assetUrl.href,
        windows_file_name:latest.name,
        windows_size_bytes:latest.size,
        windows_sha256:latest.sha256,
        changelog:latest.changelog,
      });
    } catch(_) {
      return fail("Private release metadata temporarily unavailable",503);
    }
  }

  const match=/^\/api\/voicebridge\/v1\/asset\/(\d+)\/(AIVEXUS-VoiceBridge-Setup-v\d+\.\d+\.\d+-Win11\.exe)$/.exec(path);
  if(match&&method==="GET"){
    const device=await getDevice(req,env);
    if(!device)return fail("Device not approved",403);
    try {
      const latest=await githubLatest(env,fetcher);
      if(!latest||String(latest.assetId)!==match[1]||latest.name!==match[2])
        return fail("Unavailable private asset",404);
      const resp=await fetcher("https://api.github.com/repos/"+REPO+
        "/releases/assets/"+latest.assetId,{
        headers:{
          "Accept":"application/octet-stream",
          "Authorization":"Bearer "+env.VOICEBRIDGE_RELEASES_TOKEN,
          "User-Agent":"AIVEXUS-Beta-Access/1.0",
          "X-GitHub-Api-Version":"2022-11-28",
        },redirect:"manual",
      });
      // A 200 response may be a huge binary stream. Deliberately refuse it:
      // no full 1GB proxy through Cloudflare Worker Free limits.
      if(resp.status!==302)return fail("GitHub direct asset redirect unavailable",503);
      const location=resp.headers.get("location");
      const signed=location?new URL(location):null;
      if(!signed||signed.protocol!=="https:"||
          signed.hostname!=="release-assets.githubusercontent.com"||
          signed.username||signed.password)return fail("Unsafe asset redirect",503);
      return new Response(null,{status:302,headers:{
        location:signed.href,"cache-control":"no-store",
        "referrer-policy":"no-referrer","x-content-type-options":"nosniff",
      }});
    }catch(_){
      return fail("Private asset transfer temporarily unavailable",503);
    }
  }

  return fail("Not found",404);
}
