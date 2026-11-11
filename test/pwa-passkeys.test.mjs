import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const html=readFileSync(new URL("../public/admin/index.html",import.meta.url),"utf8");
test("PWA passkey script has valid browser JavaScript syntax",()=>{
 const match=html.match(/<script>([\s\S]+?)<\/script>/);
 assert.ok(match,"Inline app script missing");
 assert.doesNotThrow(()=>new Script(match[1]));
 for(const id of ["passkeyLogin","passkeyRegister","notice","login","logout"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing control "+id);
 }
 assert.ok(html.includes("navigator.credentials.create"));
 assert.ok(html.includes("navigator.credentials.get"));
});
