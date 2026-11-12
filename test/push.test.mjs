import test from "node:test";
import assert from "node:assert/strict";
import {validPushEndpoint,validPushSubscription,pushConfigured,handleAdminPush} from "../src/push.mjs";

const keys={p256dh:"A".repeat(87),auth:"b".repeat(22)};
test("only trusted HTTPS push service endpoints are accepted, not SSRF/private hosts",()=>{
 for(const endpoint of ["http://fcm.googleapis.com/fcm/send/x",
  "https://localhost/fcm/send/x","https://127.0.0.1/x",
  "https://fcm.googleapis.com.evil.invalid/x","https://evil.invalid/x",
  "https://user:password@fcm.googleapis.com/send/x"])
  assert.equal(validPushEndpoint(endpoint),false,endpoint);
 assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/sample"),true);
 assert.equal(validPushSubscription({endpoint:"https://fcm.googleapis.com/fcm/send/sample",keys}),true);
 assert.equal(validPushSubscription({endpoint:"https://evil.invalid/",keys}),false);
 assert.equal(validPushSubscription({endpoint:"https://fcm.googleapis.com/fcm/send/sample",keys:{auth:"",p256dh:""}}),false);
});
test("push config requires VAPID keys and is safe when unconfigured",async()=>{
 assert.equal(pushConfigured({}),false);
 const req=new Request("https://beta.example.test/api/admin/push/config");
 const answer=await handleAdminPush(req,{},"/api/admin/push/config");
 assert.equal(answer.status,200);
 assert.deepEqual(await answer.json(),{available:false,publicKey:null});
 const invalid=new Request("https://beta.example.test/api/admin/push/subscriptions",{
  method:"POST",headers:{"origin":"https://evil.invalid"},body:"{}"});
 assert.equal((await handleAdminPush(invalid,{},"/api/admin/push/subscriptions")).status,403);
});

test("Web Push can encrypt an actual RFC 8291 notification with generated P-256 keys",async()=>{
 const {generateKeyPairSync,randomBytes}=await import("node:crypto");
 const {buildPushPayload}=await import("@block65/webcrypto-web-push");
 const server=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({format:"jwk"});
 const device=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({format:"jwk"});
 const pub=jwk=>Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]).toString("base64url");
 const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/mock-token",expirationTime:null,
  keys:{p256dh:pub(device),auth:randomBytes(16).toString("base64url")}};
 const vapid={subject:"https://aivexus-beta-access.aivexus-lab.workers.dev",publicKey:pub(server),privateKey:server.d};
 const payload=await buildPushPayload({data:'{"title":"Beta Access","body":"Nuova richiesta"}',options:{ttl:300}},subscription,vapid);
 assert.ok(payload&&payload.headers);
 const headers=new Headers(payload.headers);
 assert.ok(headers.get("authorization"));
 assert.ok(payload.body);
});

test("unconfigured test-push route does not send to arbitrary endpoints",async()=>{
 const req=new Request("https://beta.example.test/api/admin/push/test",{
  method:"POST",headers:{"Origin":"https://beta.example.test"},body:"{}"});
 const result=await handleAdminPush(req,{},"/api/admin/push/test");
 assert.equal(result.status,503);
});
