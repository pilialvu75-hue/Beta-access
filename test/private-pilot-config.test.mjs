import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("../scripts/prepare-deploy.mjs",import.meta.url));
const source=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
const baseEnv={
 D1_DATABASE_ID:"00000000-0000-4000-8000-000000000001",
 ENABLE_TESTER_DOWNLOAD:"false",
 ENABLE_PRIVATE_PILOT:"false",
 APPROVED_BETA_TAG:"",
 GATED_BUILD_CONFIRMED:"false",
 DIAGNOSTICS_GITHUB_TOKEN:"test-only"
};
const run=(updates={})=>{
 const folder=mkdtempSync(join(tmpdir(),"beta-pilot-config-"));
 try{
  writeFileSync(join(folder,"wrangler.toml"),source);
  const result=spawnSync(process.execPath,[script],{
   cwd:folder,encoding:"utf8",
   env:{...process.env,...baseEnv,...updates}
  });
  return {status:result.status,text:readFileSync(join(folder,"wrangler.toml"),"utf8"),stderr:result.stderr,stdout:result.stdout};
 }finally{rmSync(folder,{recursive:true,force:true});}
};

test("production default leaves both public distribution and private pilot disabled",()=>{
 const r=run();
 assert.equal(r.status,0,r.stderr);
 assert.match(r.text,/PUBLIC_TESTERS_ENABLED = "false"/);
 assert.match(r.text,/PRIVATE_PILOT_ENROLLMENT_ENABLED = "false"/);
 assert.match(r.text,/APPROVED_BETA_TAG = ""/);
});
test("explicit invite-only pilot never enables public download or release tag",()=>{
 const r=run({ENABLE_PRIVATE_PILOT:"true"});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.text,/PRIVATE_PILOT_ENROLLMENT_ENABLED = "true"/);
 assert.match(r.text,/PUBLIC_TESTERS_ENABLED = "false"/);
 assert.match(r.text,/APPROVED_BETA_TAG = ""/);
});
test("private pilot requires Diagnostics and is incompatible with public sharing",()=>{
 let r=run({ENABLE_PRIVATE_PILOT:"true",DIAGNOSTICS_GITHUB_TOKEN:""});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Diagnostics token required for private pilot/);
 r=run({ENABLE_PRIVATE_PILOT:"true",ENABLE_TESTER_DOWNLOAD:"true",
  GATED_BUILD_CONFIRMED:"true",APPROVED_BETA_TAG:"v0.9.0-beta.11"});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Private pilot and public distribution must not be enabled together/);
});
