// GitHub Actions only: assemble deployment config; never print secrets.
import {readFileSync,writeFileSync} from "node:fs";
const id=process.env.D1_DATABASE_ID||"";
const enabled=process.env.ENABLE_TESTER_DOWNLOAD==="true";
const pilot=process.env.ENABLE_PRIVATE_PILOT==="true";
const tag=(process.env.APPROVED_BETA_TAG||"").trim();
if(!/^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$/.test(id))throw Error("Invalid D1 UUID");
if(enabled&&!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag))throw Error("Approved gated beta tag required");
if(enabled&&process.env.GATED_BUILD_CONFIRMED!=="true")throw Error("Physical gated-build confirmation required");
if(enabled&&!process.env.DIAGNOSTICS_GITHUB_TOKEN)throw Error("Diagnostics token required for public testing");
if(enabled&&pilot)throw Error("Private pilot and public distribution must not be enabled together");
if(pilot&&!process.env.DIAGNOSTICS_GITHUB_TOKEN)throw Error("Diagnostics token required for private pilot");
let text=readFileSync("wrangler.toml","utf8");
for(const [key,oldValue,value] of [
  ["database_id","REPLACE_WITH_REAL_D1_DATABASE_ID",id],
  ["PUBLIC_TESTERS_ENABLED","false",String(enabled)],
  ["PRIVATE_PILOT_ENROLLMENT_ENABLED","false",String(pilot)],
  ["APPROVED_BETA_TAG","",enabled?tag:""]
]){
 const anchor=key+' = "'+oldValue+'"';
 if(!text.includes(anchor))throw Error("Missing config key "+key);
 text=text.replace(anchor,key+' = "'+value+'"');
}
writeFileSync("wrangler.toml",text,"utf8");
console.log("Deployment config prepared, public tester sharing: "+(enabled?"enabled":"disabled")+", invite-only pilot: "+(pilot?"enabled":"disabled"));
