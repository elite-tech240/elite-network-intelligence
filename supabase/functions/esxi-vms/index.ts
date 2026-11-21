// Reports the VMs living on an already-enrolled ESXi host device.
// The host itself enrolls and sends its own heartbeat through the normal
// /agents/enroll and /agents/:id/heartbeat endpoints in monitoring-api — nothing
// ESXi-specific there. This function only handles the one thing monitoring-api
// doesn't know how to do: fan one host's report out into N child "devices",
// one per VM, so each VM gets its own status, history and charts for free.
// Kept separate so the large monitoring-api function stays untouched.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Authenticate exactly as monitoring-api does: Bearer <device_token> for this device id.
async function hostDevice(req: Request, deviceId: string) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data: credential } = await admin.from("device_credentials")
    .select("device_id,revoked_at").eq("device_id", deviceId)
    .eq("token_hash", await hashToken(auth.slice(7).trim())).maybeSingle();
  if (!credential || credential.revoked_at) return null;
  const { data: device } = await admin.from("devices")
    .select("id,organization_id,site_id,device_type").eq("id", deviceId).maybeSingle();
  if (!device) return null;
  await admin.from("device_credentials").update({ last_used_at: new Date().toISOString() }).eq("device_id", deviceId);
  return device;
}

const numeric = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (n: number | null) => n === null ? null : Math.min(100, Math.max(0, n));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const match = url.pathname.match(/\/esxi-vms\/([0-9a-f-]{36})$/i);
  if (req.method !== "POST" || !match) return fail("Not found", 404);
  const hostId = match[1];

  const host = await hostDevice(req, hostId);
  if (!host) return fail("Invalid or revoked device token", 401);

  let body: any;
  try { body = await req.json(); } catch { return fail("Invalid JSON body"); }
  const vms = Array.isArray(body?.vms) ? body.vms.slice(0, 500) : [];
  const now = new Date().toISOString();
  let reported = 0;
  const errors: string[] = [];

  for (const vm of vms) {
    const moid = String(vm?.moid || "").slice(0, 120);
    const name = String(vm?.name || moid || "unknown-vm").slice(0, 255);
    if (!moid) { errors.push("a VM was skipped: missing moid"); continue; }
    const powerState = String(vm?.power_state || "").toLowerCase();
    const status = powerState === "poweredon" ? "online" : powerState === "poweredoff" ? "offline" : "unknown";

    const { data: existing } = await admin.from("devices")
      .select("id").eq("parent_device_id", hostId).eq("esxi_moid", moid).maybeSingle();

    let vmDeviceId = existing?.id as string | undefined;
    if (!vmDeviceId) {
      const { data: created, error } = await admin.from("devices").insert({
        organization_id: host.organization_id, site_id: host.site_id, parent_device_id: hostId,
        esxi_moid: moid, hostname: name, device_type: "esxi_vm", os_name: vm?.os_name ? String(vm.os_name).slice(0, 120) : null,
        status, last_seen_at: now,
      }).select("id").single();
      if (error || !created) { errors.push(`${name}: could not register`); continue; }
      vmDeviceId = created.id;
    } else {
      await admin.from("devices").update({ hostname: name, status, last_seen_at: now, archived_at: null }).eq("id", vmDeviceId);
    }

    const { error: metricError } = await admin.from("device_metrics").insert({
      organization_id: host.organization_id, device_id: vmDeviceId,
      cpu_percent: clamp(numeric(vm?.cpu_percent)), memory_percent: clamp(numeric(vm?.memory_percent)),
      disk_percent: null, bytes_sent: null, bytes_recv: null, recorded_at: now,
    });
    if (metricError) { errors.push(`${name}: metric not saved`); continue; }
    reported++;
  }

  return json({ reported, total: vms.length, errors: errors.slice(0, 10) });
});
