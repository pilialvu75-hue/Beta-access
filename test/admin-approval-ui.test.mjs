import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const ui=readFileSync(new URL("../public/admin/index.html",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/worker.mjs",import.meta.url),"utf8");
const bootstrap=readFileSync(new URL("../scripts/bootstrap-vapid.mjs",import.meta.url),"utf8");

test("Android admin PWA remains syntactically valid after permission and request UI changes",()=>{
 const match=ui.match(/<script>([\s\S]+?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new Script(match[1]));
 for(const id of ["pushHelp","requestSearch","requestApp","requestState","requestsSummary","requests","enablePush"]){
  assert.ok(ui.includes('id="'+id+'"'),"Missing control: "+id);
 }
});
test("denied permissions give recovery guidance without automatically showing a prompt",()=>{
 assert.ok(ui.includes('Notification.permission==="denied"'));
 assert.ok(ui.includes('"pushHelp").open=true'));
 assert.ok(ui.includes("Impostazioni sito"));
 assert.ok(ui.includes("Google Chrome"));
 assert.ok(ui.includes("await Notification.requestPermission()"));
});
test("approvals clearly distinguish the app, claimed tester and actual installation",()=>{
 assert.ok(ui.includes("Tester dichiarato: "));
 assert.ok(ui.includes("identità non verificata"));
 assert.ok(ui.includes("readableApp(r.app_id)"));
 assert.ok(ui.includes('r.version||"sconosciuta"'));
 assert.ok(ui.includes("0.0.0-smoke"));
 assert.ok(worker.includes("ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,requested_at DESC LIMIT 200"));
});
test("VAPID init reuses a complete key set, but refuses destructive partial rotation",()=>{
 assert.ok(bootstrap.includes("present.size===required.length"));
 assert.ok(bootstrap.includes("process.exit(0)"));
 assert.ok(bootstrap.includes("if(present.size>0)"));
 assert.ok(bootstrap.includes("refusing to rotate or overwrite"));
});
