import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const fail = (message: string, status = 400) => json({ detail: message }, status);

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function signedInUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  return error ? null : data.user;
}
async function membership(userId: string, organizationId: string) {
  const { data } = await admin.from("organization_members").select("role")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const path = new URL(req.url).pathname.replace(/^.*\/monitoring-api/, "") || "/";
  if (req.method === "GET" && path === "/health") return json({ status: "ok", service: "elite-monitoring-api", version: "1.0.0" });

  if (req.method === "POST" && path === "/enrollment-tokens") {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const body = await req.json();
    const organizationId = String(body.organization_id || "");
    const siteId = String(body.site_id || "");
    const member = await membership(user.id, organizationId);
    if (!member || !["owner", "admin", "operator"].includes(member.role)) return fail("You do not have permission to enroll devices", 403);
    const { data: site } = await admin.from("sites").select("id").eq("id", siteId).eq("organization_id", organizationId).maybeSingle();
    if (!site) return fail("Site not found in this workspace", 404);
    const token = randomToken(36);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("enrollment_tokens").insert({
      organization_id: organizationId, site_id: siteId, token_hash: await hashToken(token),
      label: String(body.label || "Agent enrollment").slice(0, 100), expires_at: expiresAt,
    });
    if (error) return fail("Could not create enrollment token", 500);
    return json({ token, expires_at: expiresAt, site_id: siteId, warning: "Copy this token now. It will not be shown again." });
  }

  if (req.method === "POST" && path === "/agents/enroll") {
    const body = await req.json();
    const token = String(body.enrollment_token || "");
    const siteId = String(body.site_id || "");
    const hostname = String(body.hostname || "").trim();
    if (token.length < 24 || !siteId || !hostname) return fail("Enrollment token, site and hostname are required");
    const { data: enrollment } = await admin.from("enrollment_tokens").select("id,organization_id,site_id,expires_at,revoked_at")
      .eq("token_hash", await hashToken(token)).maybeSingle();
    if (!enrollment) return fail("Invalid enrollment token", 401);
    if (enrollment.revoked_at || (enrollment.expires_at && new Date(enrollment.expires_at).getTime() <= Date.now())) return fail("Enrollment token expired or revoked", 401);
    if (enrollment.site_id !== siteId) return fail("Token is not authorized for this site", 403);
    const consumedAt = new Date().toISOString();
    const { data: consumed } = await admin.from("enrollment_tokens").update({ revoked_at: consumedAt })
      .eq("id", enrollment.id).is("revoked_at", null).gt("expires_at", consumedAt).select("id").maybeSingle();
    if (!consumed) return fail("Enrollment token has already been used, expired, or revoked", 401);
    const deviceToken = randomToken(48);
    const { data: device, error: deviceError } = await admin.from("devices").insert({
      organization_id: enrollment.organization_id, site_id: siteId, hostname: hostname.slice(0, 255),
      device_type: String(body.device_type || "unknown").slice(0, 80),
      os_name: body.os_name ? String(body.os_name).slice(0, 120) : null,
      os_version: body.os_version ? String(body.os_version).slice(0, 120) : null,
      ip_address: body.ip_address || null, mac_addresses: Array.isArray(body.mac_addresses) ? body.mac_addresses.slice(0, 16) : [],
      status: "online", last_seen_at: new Date().toISOString(),
    }).select("id,hostname").single();
    if (deviceError || !device) return fail("Device registration failed", 500);
    const { error: credentialError } = await admin.from("device_credentials").insert({ device_id: device.id, token_hash: await hashToken(deviceToken) });
    if (credentialError) {
      await admin.from("devices").delete().eq("id", device.id);
      return fail("Could not create device credential", 500);
    }
    return json({ device, device_token: deviceToken, warning: "Store this device token securely. It is only returned once." });
  }

  const heartbeatMatch = path.match(/^\/agents\/([0-9a-f-]+)\/heartbeat$/i);
  if (req.method === "POST" && heartbeatMatch) {
    const deviceId = heartbeatMatch[1];
    const auth = req.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return fail("Bearer device token required", 401);
    const deviceToken = auth.slice(7).trim();
    const { data: credential } = await admin.from("device_credentials").select("device_id,revoked_at")
      .eq("device_id", deviceId).eq("token_hash", await hashToken(deviceToken)).maybeSingle();
    if (!credential || credential.revoked_at) return fail("Invalid or revoked device credential", 401);
    const { data: device } = await admin.from("devices").select("id,organization_id,hostname").eq("id", deviceId).maybeSingle();
    if (!device) return fail("Device not found", 404);
    const body = await req.json();
    const numeric = (v: unknown) => v == null ? null : Number(v);
    for (const key of ["cpu_percent", "memory_percent", "disk_percent"]) {
      const v = numeric(body[key]);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) return fail("Invalid metric value");
    }
    const now = new Date().toISOString();
    const metrics = {
      organization_id: device.organization_id, device_id: deviceId,
      cpu_percent: numeric(body.cpu_percent), memory_percent: numeric(body.memory_percent),
      disk_percent: numeric(body.disk_percent), bytes_sent: body.bytes_sent == null ? null : String(body.bytes_sent),
      bytes_recv: body.bytes_recv == null ? null : String(body.bytes_recv), recorded_at: now,
    };
    const [{ error: metricError }, { error: deviceError }, { error: credentialUpdateError }] = await Promise.all([
      admin.from("device_metrics").insert(metrics),
      admin.from("devices").update({ status: body.status === "degraded" ? "degraded" : "online", last_seen_at: now, archived_at: null }).eq("id", deviceId),
      admin.from("device_credentials").update({ last_used_at: now }).eq("device_id", deviceId),
    ]);
    if (metricError || deviceError || credentialUpdateError) return fail("Could not persist device telemetry", 500);
    const { data: rules } = await admin.from("alert_rules").select("id,name,metric,operator,threshold")
      .eq("organization_id", device.organization_id).eq("enabled", true);
    for (const rule of rules || []) {
      const value = metrics[rule.metric as "cpu_percent" | "memory_percent" | "disk_percent"];
      if (value == null || rule.threshold == null) continue;
      const breached = rule.operator === "gte" ? value >= rule.threshold : value > rule.threshold;
      if (!breached) {
        await admin.from("alert_events").update({ status: "resolved", resolved_at: now }).eq("device_id", deviceId)
          .eq("rule_id", rule.id).in("status", ["open", "acknowledged"]);
        continue;
      }
      const { data: active } = await admin.from("alert_events").select("id").eq("device_id", deviceId)
        .eq("rule_id", rule.id).in("status", ["open", "acknowledged"]).limit(1);
      if (!active?.length) {
        await admin.from("alert_events").insert({
          organization_id: device.organization_id, device_id: deviceId, rule_id: rule.id,
          severity: value >= Math.min(100, rule.threshold + 15) ? "critical" : "warning",
          title: rule.name + ": " + device.hostname,
          message: rule.metric + " reached " + value.toFixed(1) + "% (threshold " + rule.threshold + "%).",
        });
      }
    }
    const { data: commands } = await admin.from("pending_agent_commands").select("id,command").eq("device_id", deviceId).eq("status", "queued").order("created_at").limit(5);
    if (commands?.length) {
      await admin.from("pending_agent_commands").update({ status: "delivered", delivered_at: now }).in("id", commands.map((c) => c.id)).eq("status", "queued");
      if (commands.some((command) => command.command === "uninstall")) {
        await admin.from("device_credentials").update({ revoked_at: now }).eq("device_id", deviceId).is("revoked_at", null);
      }
    }
    return json({ ok: true, device_id: deviceId, recorded_at: now, commands: commands || [] });
  }

  const snmpMatch = path.match(/^\/agents\/([0-9a-f-]+)\/snmp\/report$/i);
  if (req.method === "POST" && snmpMatch) {
    const agentId = snmpMatch[1];
    const auth = req.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return fail("Bearer agent token required", 401);
    const { data: credential } = await admin.from("device_credentials").select("device_id,revoked_at")
      .eq("device_id", agentId).eq("token_hash", await hashToken(auth.slice(7).trim())).maybeSingle();
    if (!credential || credential.revoked_at) return fail("Invalid or revoked agent credential", 401);
    const { data: agentDevice } = await admin.from("devices").select("organization_id,site_id").eq("id", agentId).maybeSingle();
    if (!agentDevice) return fail("Agent not found", 404);
    const body = await req.json();
    const ip = String(body.ip_address || "");
    if (!ip || ip.length > 64) return fail("A valid SNMP target IP is required");
    const type = body.device_type === "switch" ? "switch" : "router";
    const now = new Date().toISOString();
    const { data: existing } = await admin.from("devices").select("id")
      .eq("organization_id", agentDevice.organization_id).eq("site_id", agentDevice.site_id)
      .eq("ip_address", ip).limit(1).maybeSingle();
    let targetDevice = existing;
    if (targetDevice) {
      await admin.from("devices").update({
        hostname: String(body.hostname || ip).slice(0, 255), device_type: type,
        os_name: body.sys_descr ? String(body.sys_descr).slice(0, 120) : null,
        status: "online", last_seen_at: now,
      }).eq("id", targetDevice.id);
    } else {
      const { data: created, error } = await admin.from("devices").insert({
        organization_id: agentDevice.organization_id, site_id: agentDevice.site_id,
        hostname: String(body.hostname || ip).slice(0, 255), device_type: type,
        os_name: body.sys_descr ? String(body.sys_descr).slice(0, 120) : null,
        ip_address: ip, status: "online", last_seen_at: now,
      }).select("id").single();
      if (error || !created) return fail("Could not register SNMP device", 500);
      targetDevice = created;
    }
    const { error: metricError } = await admin.from("device_metrics").insert({
      organization_id: agentDevice.organization_id, device_id: targetDevice.id,
      bytes_recv: body.bytes_recv == null ? null : String(body.bytes_recv),
      bytes_sent: body.bytes_sent == null ? null : String(body.bytes_sent),
      recorded_at: now,
    });
    if (metricError) return fail("Could not save SNMP counters", 500);
    return json({ ok: true, device_id: targetDevice.id, ip_address: ip, recorded_at: now });
  }


  const deviceActionMatch = path.match(/^\/devices\/([0-9a-f-]+)\/(archive|restore|uninstall)$/i);
  if (req.method === "POST" && deviceActionMatch) {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const deviceId = deviceActionMatch[1], action = deviceActionMatch[2].toLowerCase();
    const { data: device } = await admin.from("devices").select("id,organization_id,last_seen_at,archived_at,device_type,os_name").eq("id", deviceId).maybeSingle();
    if (!device) return fail("Device not found", 404);
    const member = await membership(user.id, device.organization_id);
    if (!member || !["owner", "admin"].includes(member.role)) return fail("Only owners and admins can manage devices", 403);
    const online = Boolean(device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() <= 120000);
    if (action === "archive") {
      if (device.archived_at) return fail("Device is already archived", 409);
      if (online) return fail("Only offline devices can be archived", 409);
      const { error } = await admin.from("devices").update({ archived_at: new Date().toISOString() }).eq("id", deviceId);
      if (error) return fail("Could not archive device", 500);
      return json({ ok: true, archived: true, device_id: deviceId });
    }
    if (action === "restore") {
      if (!device.archived_at) return fail("Device is not archived", 409);
      const { error } = await admin.from("devices").update({ archived_at: null }).eq("id", deviceId);
      if (error) return fail("Could not restore device", 500);
      return json({ ok: true, archived: false, device_id: deviceId });
    }
    if (device.archived_at) return fail("Restore the device before uninstalling its agent", 409);
    if (!online) return fail("Remote uninstall requires an online device", 409);
    if (device.device_type !== "workstation" || device.os_name !== "Windows") return fail("Remote uninstall is only supported for Windows workstations", 400);
    const { data: pending } = await admin.from("pending_agent_commands").select("id").eq("device_id", deviceId).eq("command", "uninstall").in("status", ["queued", "delivered"]).limit(1);
    if (pending?.length) return fail("An uninstall command is already pending", 409);
    const { error } = await admin.from("pending_agent_commands").insert({ device_id: deviceId, command: "uninstall", requested_by: user.id });
    if (error) return fail("Could not queue uninstall command", 500);
    return json({ ok: true, device_id: deviceId, command: "uninstall", status: "queued" }, 202);
  }

  const revokeMatch = path.match(/^\/devices\/([0-9a-f-]+)\/revoke$/i);
  if (req.method === "POST" && revokeMatch) {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const deviceId = revokeMatch[1];
    const { data: device } = await admin.from("devices").select("id,organization_id").eq("id", deviceId).maybeSingle();
    if (!device) return fail("Device not found", 404);
    const member = await membership(user.id, device.organization_id);
    if (!member || !["owner", "admin"].includes(member.role)) return fail("Only owners and admins can revoke device credentials", 403);
    const now = new Date().toISOString();
    const { error } = await admin.from("device_credentials").update({ revoked_at: now }).eq("device_id", deviceId);
    if (error) return fail("Could not revoke device credential", 500);
    await admin.from("devices").update({ status: "offline" }).eq("id", deviceId);
    return json({ ok: true, device_id: deviceId, revoked_at: now });
  }

  if (req.method === "POST" && path === "/team/invite") {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const body = await req.json();
    const organizationId = String(body.organization_id || "");
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "viewer");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address");
    if (!["admin", "operator", "viewer"].includes(role)) return fail("Invalid workspace role");
    const member = await membership(user.id, organizationId);
    if (!member || !["owner", "admin"].includes(member.role)) return fail("Only owners and admins can invite members", 403);
    if (member.role === "admin" && role === "admin") return fail("Only the owner can grant admin access", 403);
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteError || !inviteData.user) return fail("Invitation could not be sent. Check Auth email/SMTP settings or whether this user already exists.", 502);
    const { error: memberError } = await admin.from("organization_members").insert({
      organization_id: organizationId, user_id: inviteData.user.id, role,
    });
    if (memberError) return fail("Invitation sent, but workspace membership could not be assigned. Contact the owner.", 500);
    return json({ ok: true, email, role });
  }

  return fail("Route not found", 404);
});
