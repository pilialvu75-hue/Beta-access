import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {handleVoiceBridgeOta,selectVoiceBridgeRelease} from "../src/voicebridge_ota.mjs";

const origin="https://aivexus-beta-access.aivexus-lab.workers.dev";
const id="550e8400-e29b-41d4-a716-446655440000";
const key="a".repeat(64);
const name="AIVEXUS-VoiceBridge-Setup-v0.5.8-Win11.exe";
const tag="v0.5.8-beta.1";
const expectedUrl="https://github.com/pilialvu75-hue/AIVEXUS-VoiceBridge/releases/download/"+tag+"/"+name;
const digest="sha256:"+"b".repeat(64);
const release={tag_name:tag,draft:false,prerelease:true,body:"owner beta",
  assets:[{id:12345,name,size:958050606,digest,state:"uploaded",browser_download_url:expectedUrl}]};

function env(state="approved") {
  const hashed=createHash("sha256").update(key).digest("hex");
  return {
    VOICEBRIDGE_OTA_ENABLED:"true",
    VOICEBRIDGE_RELEASES_TOKEN:"ghp_"+"b".repeat(45),
    DB:{
      prepare(sql){
        return {
          bind(...args) {
            return {
              async first(){
                if(sql.includes("voicebridge_ota_devices")){
                  return {installation_id:id,secret_sha256:hashed,state,
                    approved_until:new Date(Date.now()+86400000).toISOString()};
                }
                return null;
              },
            };
          },
        };
      },
    },
  };
}
function ghFetcher(accepted) {
  return async (url,init)=>{
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/pilialvu75-hue\/AIVEXUS-VoiceBridge/);
    assert.match(init.headers.Authorization,/^Bearer ghp_/);
    accepted.push(url);
    if(url.includes("/releases/assets/"))
      return new Response(null,{status:302,headers:{
        location:"https://release-assets.githubusercontent.com/signed?jwt=short-lived",
      }});
    return new Response(JSON.stringify([release]),{
      status:200,headers:{"content-type":"application/json"}});
  };
}
function request(path,headers={}) {
  return new Request(origin+path,{headers});
}
test("private OTA is fail-closed until explicitly enabled",async()=>{
  const res=await handleVoiceBridgeOta(request("/api/voicebridge/v1/update"),
    {...env(),VOICEBRIDGE_OTA_ENABLED:"false"});
  assert.equal(res.status,404);
});
test("unapproved or anonymous devices cannot read private update metadata",async()=>{
  const seen=[];
  const anonymous=await handleVoiceBridgeOta(
    request("/api/voicebridge/v1/update"),env(),
    {fetcher:ghFetcher(seen)});
  assert.equal(anonymous.status,403);
  const pending=await handleVoiceBridgeOta(request("/api/voicebridge/v1/update",{
    "x-device-id":id,"x-device-key":key}),env("pending"),
    {fetcher:ghFetcher(seen)});
  assert.equal(pending.status,403);
  assert.deepEqual(seen,[]);
});
test("server constructs strict update manifest for approved device",async()=>{
  const seen=[];
  const res=await handleVoiceBridgeOta(request("/api/voicebridge/v1/update",{
    "x-device-id":id,"x-device-key":key}),env(),{fetcher:ghFetcher(seen)});
  assert.equal(res.status,200);
  const json=await res.json();
  assert.equal(json.app_id,"voicebridge");
  assert.equal(json.version,"0.5.8");
  assert.equal(json.channel,"beta");
  assert.equal(json.windows_size_bytes,958050606);
  assert.equal(json.windows_sha256,"b".repeat(64));
  assert.equal(json.windows_url,
    origin+"/api/voicebridge/v1/asset/12345/"+name);
  assert.deepEqual(seen.length,1);
  assert.ok(!res.headers.get("cache-control").includes("public"));
});
test("download redirects to a short-lived CDN URL, not a 958 MB Worker proxy",async()=>{
  const seen=[];
  const res=await handleVoiceBridgeOta(request(
    "/api/voicebridge/v1/asset/12345/"+name,{
    "x-device-id":id,"x-device-key":key}),env(),{fetcher:ghFetcher(seen)});
  assert.equal(res.status,302);
  assert.equal(new URL(res.headers.get("location")).host,
    "release-assets.githubusercontent.com");
  assert.equal(seen.length,2);
  assert.equal(res.headers.get("cache-control"),"no-store");
});
test("wrong asset or forged GitHub release is not distributed",async()=>{
  const forged={...release,assets:[{...release.assets[0],
    browser_download_url:"https://evil.example/modified.exe"}]};
  assert.equal(selectVoiceBridgeRelease([forged]),null);
  assert.equal(selectVoiceBridgeRelease([{...release,draft:true}]),null);
  assert.equal(selectVoiceBridgeRelease([{...release,assets:[
    {...release.assets[0],digest:"sha256:bad"}]}]),null);
  const res=await handleVoiceBridgeOta(request(
    "/api/voicebridge/v1/asset/999/"+name,{
    "x-device-id":id,"x-device-key":key}),env(),{
    fetcher:async()=>new Response(JSON.stringify([release]),{status:200}),
  });
  assert.equal(res.status,404);
});
test("refuses to relay an unexpected GitHub 200 binary through Cloudflare",async()=>{
  const res=await handleVoiceBridgeOta(request(
    "/api/voicebridge/v1/asset/12345/"+name,{
    "x-device-id":id,"x-device-key":key}),env(),{
    fetcher:async (url)=>url.includes("/releases/assets/")?
      new Response("large installer",{status:200}):
      new Response(JSON.stringify([release]),{status:200}),
  });
  assert.equal(res.status,503);
});
test("rejects attacker-controlled redirect host even with valid release metadata",async()=>{
  const res=await handleVoiceBridgeOta(request(
    "/api/voicebridge/v1/asset/12345/"+name,{
    "x-device-id":id,"x-device-key":key}),env(),{
    fetcher:async (url)=>url.includes("/releases/assets/")?
      new Response(null,{status:302,headers:{location:"https://evil.example/collect"}}):
      new Response(JSON.stringify([release]),{status:200}),
  });
  assert.equal(res.status,503);
});
