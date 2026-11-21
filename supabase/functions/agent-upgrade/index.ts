// Serves the agent its upgrade instructions and records the outcome.
// Kept separate from monitoring-api so the large heartbeat function stays untouched.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const AGENT_REPO = "elite-tech240/elite-network-intelligence";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Authenticate the calling agent by its device token, exactly as monitoring-api does.
async function agentDevice(req: Request, deviceId: string) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data: credential } = await admin.from("device_credentials")
    .select("device_id,revoked_at").eq("device_id", deviceId)
    .eq("token_hash", await hashToken(auth.slice(7).trim())).maybeSingle();
  if (!credential || credential.revoked_at) return null;
  const { data: device } = await admin.from("devices")
    .select("id,organization_id,hostname,os_name").eq("id", deviceId).maybeSingle();
  return device ?? null;
}

// Choose the installer that suits this device.
function assetFor(assets: any[], osName: string | null | undefined) {
  const os = String(osName || "").toLowerCase();
  const pick = (re: RegExp) => assets.find((a) => re.test(String(a?.name || "")));
  if (os.includes("windows")) return pick(/\.(exe|msi)$/i) ?? null;
  return pick(/install\.sh$/i) ?? pick(/\.tar\.gz$/i) ?? null;
}

// Publishing a GitHub release is all it should take to roll out a new agent.
async function refreshRelease() {
  const res = await fetch(`https://api.github.com/repos/${AGENT_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "elite-network-intelligence" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const body = await res.json();
  if (!body?.tag_name || body?.draft) return { updated: false, reason: "no published release" };
  const version = String(body.tag_name).replace(/^[A-Za-z-]*v?/, "");
  if (!version) return { updated: false, reason: "tag has no version" };
  const assets = (body.assets || []).map((a: any) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
  const { error } = await admin.from("agent_releases").upsert({
    id: true, version, published_at: body.published_at ?? null,
    notes: String(body.body || "").slice(0, 2000), assets, fetched_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { updated: true, version, assets: assets.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/agent-upgrade/, "") || "/";

  // Cron: refresh the published release.
  if (req.method === "POST" && path === "/refresh") {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: valid } = await admin.rpc("check_cron_secret", { p_secret: secret });
    if (valid !== true) return fail("Forbidden", 403);
    try { return json({ ok: true, ...(await refreshRelease()) }); }
    catch (error) { return fail(String((error as Error)?.message || error), 502); }
  }

  const match = path.match(/^\/([0-9a-f-]{36})$/i);
  if (!match) return fail("Not found", 404);
  const deviceId = match[1];
  const device = await agentDevice(req, deviceId);
  if (!device) return fail("Invalid or revoked device credential", 401);

  // The agent asks what it should install.
  if (req.method === "GET") {
    const { data: command } = await admin.from("pending_agent_commands")
      .select("id,status,parameters").eq("device_id", deviceId).eq("command", "upgrade")
      .in("status", ["queued", "delivered"]).order("created_at").limit(1).maybeSingle();
    const { data: release } = await admin.from("agent_releases").select("version,assets").eq("id", true).maybeSingle();
    if (!command) return json({ upgrade: null, latest_agent_version: release?.version ?? null });
    const asset = assetFor((release?.assets as any[]) ?? [], device.os_name);
    return json({
      upgrade: {
        id: command.id,
        target_version: release?.version ?? (command.parameters as any)?.target_version ?? null,
        download_url: asset?.url ?? null,
        asset_name: asset?.name ?? null,
      },
      latest_agent_version: release?.version ?? null,
    });
  }

  // The agent reports how it went.
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch { return fail("Invalid JSON body"); }
    const id = String(body?.id || "");
    const status = String(body?.status || "");
    if (!id || !["running", "completed", "failed"].includes(status)) return fail("Unknown command result");
    const patch: Record<string, unknown> = { status };
    if (status !== "running") patch.completed_at = new Date().toISOString();
    if (body?.result) patch.result = String(body.result).slice(0, 500);
    if (body?.error) patch.error = String(body.error).slice(0, 500);
    const { error } = await admin.from("pending_agent_commands")
      .update(patch).eq("id", id).eq("device_id", deviceId).eq("command", "upgrade");
    if (error) return fail("Could not record the result", 500);
    return json({ ok: true });
  }

  return fail("Method not allowed", 405);
});
