// One-time VAPID setup: keys travel only from GitHub Actions to Cloudflare Worker secrets.
import {generateKeyPairSync} from "node:crypto";
import {spawnSync} from "node:child_process";
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
 throw Error("Missing independent Beta Access Cloudflare credentials");
const list=spawnSync("npx",["wrangler","secret","list"],{encoding:"utf8",timeout:30000});
if(list.status!==0)throw Error("Cannot list existing Worker secrets");
let existing;
try{existing=JSON.parse(list.stdout);}catch(_){throw Error("Cannot safely parse existing Worker secrets");}
if(!Array.isArray(existing))throw Error("Unknown Worker secret list format");
const required=["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT"];
const present=new Set(existing.map(x=>x.name).filter(n=>required.includes(n)));
if(present.size===required.length) {
 console.log("Android Web Push already configured. Reusing existing VAPID keys without rotation.");
 process.exit(0);
}
if(present.size>0)
 throw Error("Partial VAPID credentials found; refusing to rotate or overwrite existing device subscriptions");
const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=pair.privateKey.export({format:"jwk"});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]).toString("base64url");
const privateKey=jwk.d;
const subject="https://aivexus-beta-access.aivexus-lab.workers.dev";
if(publicKey.length!==87||privateKey.length!==43)throw Error("Invalid VAPID generated keys");
for(const [name,value] of [
 ["VAPID_PUBLIC_KEY",publicKey],["VAPID_PRIVATE_KEY",privateKey],["VAPID_SUBJECT",subject]
]){
 const result=spawnSync("npx",["wrangler","secret","put",name],{
  input:value,encoding:"utf8",timeout:45000,stdio:["pipe","pipe","pipe"]
 });
 if(result.status!==0)throw Error("Failed to store "+name);
 console.log("Installed "+name+" (value hidden)");
}
console.log("Web Push configured; owner still needs to enable Android notifications.");
