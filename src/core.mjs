export const APP = "wemuldroid";
export const REPO = "pilialvu75-hue/WEmulDroid";
export const DIAGNOSTICS_REPO = "pilialvu75-hue/Ai-orchestrator-diagnostics";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HEX_SECRET = /^[a-f0-9]{64}$/i;
export const allowedEvents = new Set(["APP_START","APP_EXIT","APP_ERROR","EMULATOR_ERROR","INSTALLER_ERROR","PERF_SAMPLE"]);
export const allowedSeverity = new Set(["info","warning","error","critical"]);
const numericFields = new Set(["cpu_pct","ram_mb","gpu_pct","fps","startup_ms","duration_ms","io_mb","network_kb","uptime_sec"]);
export const allowedMetricFields = new Set([...numericFields,"error_code"]);

export function latestInstaller(releases) {
  if (!Array.isArray(releases)) return null;
  const candidates = [];
  for (const r of releases) {
    if (!r || r.draft || !r.prerelease) continue;
    const match = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(r.tag_name ?? "");
    if (!match) continue;
    const name = "WEmulDroid-Setup-" + r.tag_name + ".exe";
    const exe = (r.assets ?? []).filter(a => a.name === name);
    const sha = (r.assets ?? []).filter(a => a.name === name + ".sha256");
    if (exe.length !== 1 || sha.length !== 1) continue;
    const prefix = "https://github.com/" + REPO + "/releases/download/" + r.tag_name + "/";
    if (exe[0].browser_download_url !== prefix + name || sha[0].browser_download_url !== prefix + name + ".sha256") continue;
    candidates.push({ tag: r.tag_name, download: exe[0].browser_download_url, checksum: sha[0].browser_download_url, order: match.slice(1).map(Number) });
  }
  candidates.sort((a,b) => {
    for (let i=0;i<4;i++) if (a.order[i] !== b.order[i]) return b.order[i]-a.order[i];
    return 0;
  });
  return candidates[0] ?? null;
}
export function validEnrollment(x) {
  return !!x && x.app_id === APP && UUID.test(x.installation_id ?? "") && HEX_SECRET.test(x.device_secret ?? "") &&
    x.platform === "windows" && typeof x.version === "string" && /^[a-zA-Z0-9.+_-]{1,40}$/.test(x.version) &&
    typeof x.label === "string" && x.label.length <= 48 && x.label.length > 0 &&
    typeof x.telemetry_consent === "boolean";
}
export function expiry(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Duration must be 1–365 days");
  return new Date(now.getTime() + days * 86400000).toISOString();
}
export function effectiveState(record, now = new Date()) {
  if (!record) return "unknown";
  if (record.state === "approved" && (!record.approved_until || Date.parse(record.approved_until) <= now.getTime())) return "expired";
  return record.state;
}
export function sanitizeTelemetry(x, installationId, now = new Date()) {
  if (!x || !UUID.test(x.event_id ?? "") || !allowedEvents.has(x.event) || !allowedSeverity.has(x.severity) ||
      typeof x.producer_version !== "string" || !/^[a-zA-Z0-9.+_-]{1,40}$/.test(x.producer_version) ||
      !UUID.test(x.session ?? "")) throw new Error("Invalid event header");
  const input = x.fields ?? {};
  if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).length > 12) throw new Error("Invalid metrics");
  const fields = {};
  for (const [key,value] of Object.entries(input)) {
    if (!allowedMetricFields.has(key)) throw new Error("Unapproved field: " + key);
    if (key === "error_code") {
      if (typeof value !== "string" || !/^[A-Z0-9_-]{1,48}$/.test(value)) throw new Error("Invalid error classification");
      fields[key] = value;
    } else {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000000) throw new Error("Invalid numeric metric");
      if ((key === "cpu_pct" || key === "gpu_pct") && value > 100) throw new Error("Invalid percentage");
      fields[key] = value;
    }
  }
  return {
    schema: "ai-orchestrator.diagnostics.event.v2",
    producer: APP,
    producer_version: x.producer_version,
    platform: "windows",
    instance: installationId,
    session: x.session,
    timestamp: now.toISOString(),
    event: x.event,
    severity: x.severity,
    fields
  };
}
export async function sha256hex(s) {
  const data = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
}
export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i=0;i<len;i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
