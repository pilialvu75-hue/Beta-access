import test from "node:test";
import assert from "node:assert/strict";
import {latestInstaller, expiry, effectiveState, validEnrollment, sanitizeTelemetry, constantTimeEqual} from "../src/core.mjs";
const id = "de34cfa7-ceda-4d2c-94a5-98a1478748af";
const good = {app_id:"wemuldroid",installation_id:id,device_secret:"a".repeat(64),platform:"windows",version:"0.9.0-beta.10",label:"PC-test",telemetry_consent:true};
function release(n) {
  const tag = "v0.9.0-beta."+n, file = "WEmulDroid-Setup-"+tag+".exe";
  const prefix = "https://github.com/pilialvu75-hue/WEmulDroid/releases/download/"+tag+"/";
  return {tag_name:tag,draft:false,prerelease:true,assets:[{name:file,browser_download_url:prefix+file},{name:file+".sha256",browser_download_url:prefix+file+".sha256"}]};
}
test("selects beta.10 over beta.9, rejects unverified artifacts", () => {
 assert.equal(latestInstaller([release(9),release(10)]).tag, "v0.9.0-beta.10");
 const bad = release(11); bad.assets[0].browser_download_url = "https://untrusted.invalid/bad.exe";
 assert.equal(latestInstaller([bad,release(9)]).tag,"v0.9.0-beta.9");
 assert.equal(latestInstaller([bad]), null);
});
test("enrollment rejects missing consent or malformed device secret", () => {
 assert.equal(validEnrollment(good),true);
 assert.equal(validEnrollment({...good,device_secret:"abc"}),false);
 assert.equal(validEnrollment({...good,telemetry_consent:undefined}),false);
});
test("expiry requires finite bounded durations and expires approvals",()=>{
 assert.equal(expiry(7,new Date("2026-11-10T00:00:00Z")),"2026-11-17T00:00:00.000Z");
 assert.throws(()=>expiry(0));
 assert.throws(()=>expiry(366));
 assert.equal(effectiveState({state:"approved",approved_until:"2026-11-09T00:00:00Z"},new Date("2026-11-10T00:00:00Z")),"expired");
});
test("telemetry rejects secrets, free-text exceptions, and percentages above 100",()=>{
 const event={event_id:id,event:"PERF_SAMPLE",severity:"info",producer_version:"0.9.0",session:id,fields:{cpu_pct:35,ram_mb:500,fps:60}};
 assert.equal(sanitizeTelemetry(event,id).fields.fps,60);
 assert.throws(()=>sanitizeTelemetry({...event,fields:{api_key:"secret"}},id));
 assert.throws(()=>sanitizeTelemetry({...event,fields:{cpu_pct:120}},id));
 assert.throws(()=>sanitizeTelemetry({...event,fields:{error_code:"C:\\Users\\Tester\\secret.txt"}},id));
});
test("admin comparison does not match prefixes",()=>{
 assert.equal(constantTimeEqual("a".repeat(60),"a".repeat(60)),true);
 assert.equal(constantTimeEqual("foo","foobar"),false);
});
