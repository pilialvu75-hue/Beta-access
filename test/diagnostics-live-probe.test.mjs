import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifySyntheticArchive} from "../scripts/diagnostics-live-probe.mjs";

const installationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sample={
 schema:"ai-orchestrator.diagnostics.event.v2",
 producer:"wemuldroid",producer_version:"0.0.0-smoke",
 platform:"windows",instance:installationId,session:sessionId,
 timestamp:"2026-11-14T12:00:00.000Z",
 event:"APP_START",severity:"info",fields:{startup_ms:123}
};
const raw=x=>JSON.stringify(x)+"\n";

test("manual Diagnostics read-back validates one real sanitized event",()=>{
 assert.equal(verifySyntheticArchive(raw(sample),{installationId,sessionId}),true);
});

test("synthetic read-back rejects wrong device, session or extra fields",()=>{
 assert.throws(()=>verifySyntheticArchive(raw({...sample,instance:"another"}),{installationId,sessionId}));
 assert.throws(()=>verifySyntheticArchive(raw({...sample,session:"another"}),{installationId,sessionId}));
 assert.throws(()=>verifySyntheticArchive(raw({...sample,email:"private@example.test"}),{installationId,sessionId}));
 assert.throws(()=>verifySyntheticArchive(raw({...sample,fields:{startup_ms:123,password:"bad"}}),{installationId,sessionId}));
 assert.throws(()=>verifySyntheticArchive(raw(sample)+raw(sample),{installationId,sessionId}));
 assert.throws(()=>verifySyntheticArchive("not-json\n",{installationId,sessionId}));
});

test("live diagnostics workflow is opt-in, on main, and not a deploy",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/diagnostics-live-probe.yml",import.meta.url),"utf8");
 const script=readFileSync(new URL("../scripts/diagnostics-live-probe.mjs",import.meta.url),"utf8");
 assert.match(workflow,/^\s*workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^\s*(?:push|schedule|pull_request):/m);
 assert.match(workflow,/authorize_public_synthetic_event:/);
 assert.match(workflow,/default: false/);
 assert.match(workflow,/GITHUB_REF.*refs\/heads\/main/);
 assert.match(workflow,/AUTHORIZE.*true/);
 assert.doesNotMatch(workflow,/wrangler deploy/);
 assert.match(script,/private_pilot_enabled,false/);
 assert.match(script,/public_download_enabled,false/);
 assert.match(script,/VERSION="0\.0\.0-smoke"/);
 assert.match(script,/telemetry_consent:true/);
 assert.match(script,/method:"POST".*headers:deviceHeaders/);
 assert.match(script,/action:"revoke"/);
 assert.doesNotMatch(script,/console\.(?:log|error).*device_secret/);
});
