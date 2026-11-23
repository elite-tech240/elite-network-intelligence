// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Elite Monitoring <onboarding@resend.dev>";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://elite-network-intelligence.vercel.app";
const API_VERSION = "1.1.0";
const LATEST_AGENT_VERSION = "0.4.0";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
class BlockedTarget extends Error {}

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
async function readJson(req: Request, maxChars = 512_000): Promise<any> {
  const text = await req.text();
  if (text.length > maxChars) throw new HttpError(413, "Payload too large");
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Invalid JSON body"); }
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
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return null;
  const { data } = await admin.from("organization_members").select("role,custom_role_id")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  return data;
}
async function requireMember(req: Request, organizationId: string, roles: string[]) {
  const user = await signedInUser(req);
  if (!user) throw new HttpError(401, "Valid user session required");
  const member = await membership(user.id, organizationId);
  if (!member) throw new HttpError(403, "You do not have access to this workspace");
  if (!roles.includes(member.role)) throw new HttpError(403, "Your role does not allow this action");
  return { user, role: member.role as string };
}
// Granular-permissions check, backed by the has_permission() Postgres function.
// Must run as the calling user (not the service role) so auth.uid() resolves inside it -
// same reasoning as list_organization_members below.
async function requirePermission(req: Request, organizationId: string, resource: string, action: string) {
  const user = await signedInUser(req);
  if (!user) throw new HttpError(401, "Valid user session required");
  const member = await membership(user.id, organizationId);
  if (!member) throw new HttpError(403, "You do not have access to this workspace");
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed, error } = await userClient.rpc("has_permission", { p_org: organizationId, p_resource: resource, p_action: action });
  if (error || !allowed) throw new HttpError(403, "Your role does not allow this action");
  return { user, role: member.role as string, customRoleId: member.custom_role_id as string | null };
}
async function agentAuth(req: Request, deviceId: string) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Bearer device token required");
  const { data: credential } = await admin.from("device_credentials").select("device_id,revoked_at")
    .eq("device_id", deviceId).eq("token_hash", await hashToken(auth.slice(7).trim())).maybeSingle();
  if (!credential || credential.revoked_at) throw new HttpError(401, "Invalid or revoked device credential");
  const { data: device } = await admin.from("devices").select("id,organization_id,site_id,hostname,mac_addresses").eq("id", deviceId).maybeSingle();
  if (!device) throw new HttpError(404, "Device not found");
  return device as any;
}
async function audit(organizationId: string, actorType: "user" | "agent" | "system", actorUserId: string | null, action: string, resourceType: string, resourceId: string | null, details: Record<string, unknown> = {}, outcome = "success") {
  try {
    await admin.from("audit_logs").insert({
      organization_id: organizationId, actor_user_id: actorUserId, actor_type: actorType, action,
      resource_type: resourceType, resource_id: resourceId, outcome, details,
    });
  } catch { /* auditing must never break the request */ }
}
async function platformEvent(level: "info" | "warning" | "error", source: string, message: string, organizationId: string | null = null) {
  try { await admin.from("platform_events").insert({ organization_id: organizationId, level, source, message: message.slice(0, 500) }); } catch { /* ignore */ }
}
async function inMaintenance(organizationId: string, at = new Date()) {
  const { data } = await admin.from("maintenance_windows").select("id").eq("organization_id", organizationId)
    .lte("starts_at", at.toISOString()).gte("ends_at", at.toISOString()).limit(1);
  return Boolean(data?.length);
}

// ---------------------------------------------------------------------------------------------
// Outbound target safety (uptime checks and webhooks may only reach public internet hosts)
// ---------------------------------------------------------------------------------------------
function isPrivateIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function isPrivateIPv6(ip: string) {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return isPrivateIPv4(s.slice(7));
  return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}
async function assertPublicHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h || h === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) throw new BlockedTarget("Private or local hostnames are not allowed");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) { if (isPrivateIPv4(h)) throw new BlockedTarget("Private IP addresses are not allowed"); return; }
  if (h.includes(":")) { if (isPrivateIPv6(h)) throw new BlockedTarget("Private IP addresses are not allowed"); return; }
  let v4: string[] = [], v6: string[] = [];
  try {
    [v4, v6] = await Promise.all([
      Deno.resolveDns(h, "A").catch(() => [] as string[]),
      Deno.resolveDns(h, "AAAA").catch(() => [] as string[]),
    ]);
  } catch { return; /* DNS API unavailable in this runtime: literal checks above still applied */ }
  if (!v4.length && !v6.length) throw new BlockedTarget("Host did not resolve");
  if (v4.some(isPrivateIPv4) || v6.some(isPrivateIPv6)) throw new BlockedTarget("Host resolves to a private address");
}

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------
const severityRank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
type Notice = { title: string; text: string; severity: string; kind: "alert" | "resolved" | "report" | "test"; html?: string };

async function deliver(channel: any, notice: Notice): Promise<{ status: "sent" | "failed" | "skipped"; detail: string }> {
  try {
    if (channel.channel_type === "email") {
      if (!RESEND_API_KEY) return { status: "skipped", detail: "RESEND_API_KEY is not configured" };
      const to = String(channel.config?.to || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: "failed", detail: "Invalid email recipient" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: notice.title.slice(0, 200), text: notice.text, html: notice.html }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { status: "sent", detail: "Email accepted" } : { status: "failed", detail: `Resend responded ${res.status}` };
    }
    if (channel.channel_type === "telegram") {
      if (!TELEGRAM_BOT_TOKEN) return { status: "skipped", detail: "TELEGRAM_BOT_TOKEN is not configured" };
      const chatId = String(channel.config?.chat_id || "").trim();
      if (!/^-?\d{1,20}$/.test(chatId)) return { status: "failed", detail: "Invalid Telegram chat id" };
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `${notice.title}\n\n${notice.text}`.slice(0, 4000) }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { status: "sent", detail: "Telegram accepted" } : { status: "failed", detail: `Telegram responded ${res.status}` };
    }
    if (channel.channel_type === "webhook") {
      const target = new URL(String(channel.config?.url || ""));
      if (target.protocol !== "https:") return { status: "failed", detail: "Webhook URL must use https" };
      await assertPublicHost(target.hostname);
      const res = await fetch(target.toString(), {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "manual",
        body: JSON.stringify({ event: notice.kind, severity: notice.severity, title: notice.title, message: notice.text, text: `${notice.title}\n${notice.text}`, sent_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
      });
      return res.status < 400 ? { status: "sent", detail: `Webhook responded ${res.status}` } : { status: "failed", detail: `Webhook responded ${res.status}` };
    }
    return { status: "failed", detail: "Unknown channel type" };
  } catch (error) {
    return { status: "failed", detail: error instanceof BlockedTarget ? error.message : "Delivery error: " + String((error as Error)?.message || error).slice(0, 120) };
  }
}
async function logDelivery(organizationId: string, channelId: string, alertEventId: string | null, kind: string, result: { status: string; detail: string }) {
  await admin.from("notification_deliveries").insert({ organization_id: organizationId, channel_id: channelId, alert_event_id: alertEventId, kind, status: result.status, detail: result.detail.slice(0, 300) });
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Shared branded wrapper for every outbound email (alerts, resolved, test, weekly report).
// Plain Arial with no shell reads as spam; this at least carries the mark and the accent color.
const SEVERITY_COLOR: Record<string, string> = { critical: "#e5484d", warning: "#f5630f", info: "#3b82f6" };
function emailShell(preheader: string, bodyHtml: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0b0d10;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d10;padding:32px 0">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#14181e;border-radius:12px;overflow:hidden;border:1px solid #23272f">
<tr><td style="padding:20px 28px;border-bottom:3px solid #f5630f">
<img src="${esc(APP_URL)}/apple-touch-icon.png" width="26" height="26" style="border-radius:6px;vertical-align:middle;display:inline-block"/>
<span style="color:#ffffff;font-size:15px;font-weight:700;margin-left:10px;vertical-align:middle">Elite Network Intelligence</span>
</td></tr>
<tr><td style="padding:28px;color:#dce5f3;font-size:14px;line-height:1.65">${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #23272f;color:#6f7a89;font-size:12px">Elite Tech &middot; <a href="${esc(APP_URL)}" style="color:#ff9a5c;text-decoration:none">${esc(APP_URL)}</a></td></tr>
</table></td></tr></table></body></html>`;
}
function emailButton(label: string, href: string) {
  return `<p style="margin:22px 0 0"><a href="${esc(href)}" style="background:#f5630f;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;display:inline-block">${esc(label)}</a></p>`;
}
function severityBadge(severity: string, label: string) {
  const color = SEVERITY_COLOR[severity] || "#71819a";
  return `<span style="background:${color}22;color:${color};font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:4px 9px;border-radius:20px;display:inline-block;margin-bottom:12px">${esc(label)}</span>`;
}

async function dispatchAlertNotifications(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ data: fresh }, { data: resolved }] = await Promise.all([
    admin.from("alert_events").select("id,organization_id,severity,title,message,status").is("notified_at", null).gte("triggered_at", since).order("triggered_at").limit(40),
    admin.from("alert_events").select("id,organization_id,severity,title,message").eq("status", "resolved").is("resolved_notified_at", null).not("notified_at", "is", null).gte("resolved_at", since).order("resolved_at").limit(40),
  ]);
  const items = [
    ...(fresh || []).map((e: any) => ({ ...e, kind: "alert" as const })),
    ...(resolved || []).map((e: any) => ({ ...e, kind: "resolved" as const })),
  ];
  if (!items.length) return 0;
  const orgs = [...new Set(items.map((i) => i.organization_id))];
  const { data: channels } = await admin.from("notification_channels").select("id,organization_id,channel_type,config,min_severity").in("organization_id", orgs).eq("enabled", true);
  let sent = 0;
  for (const item of items) {
    const targets = (channels || []).filter((c: any) => c.organization_id === item.organization_id && severityRank[item.severity] >= severityRank[c.min_severity]);
    const notice: Notice = item.kind === "alert"
      ? { kind: "alert", severity: item.severity, title: `[${item.severity.toUpperCase()}] ${item.title}`, text: `${item.message}\n\nOpen the dashboard: ${APP_URL}/alerts`,
          html: emailShell(item.title, `${severityBadge(item.severity, `${item.severity} alert`)}<h2 style="margin:0 0 10px;color:#fff;font-size:17px">${esc(item.title)}</h2><p style="margin:0;color:#aebdd2">${esc(item.message)}</p>${emailButton("Open the dashboard", `${APP_URL}/alerts`)}`) }
      : { kind: "resolved", severity: item.severity, title: `[RESOLVED] ${item.title}`, text: `This alert has cleared.\n${item.message}\n\n${APP_URL}/alerts`,
          html: emailShell(`Resolved: ${item.title}`, `${severityBadge("info", "resolved")}<h2 style="margin:0 0 10px;color:#fff;font-size:17px">${esc(item.title)}</h2><p style="margin:0;color:#aebdd2">This alert has cleared.<br/>${esc(item.message)}</p>${emailButton("Open the dashboard", `${APP_URL}/alerts`)}`) };
    for (const channel of targets) {
      const result = await deliver(channel, notice);
      await logDelivery(item.organization_id, channel.id, item.id, item.kind, result);
      if (result.status === "sent") sent += 1;
    }
    await admin.from("alert_events").update(item.kind === "alert" ? { notified_at: new Date().toISOString() } : { resolved_notified_at: new Date().toISOString() }).eq("id", item.id);
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------
async function buildReport(organizationId: string, days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  const { data, error } = await admin.rpc("report_summary", { p_org: organizationId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw new Error("Report query failed");
  return { days, ...data };
}
function reportText(orgName: string, r: any) {
  const lines = [`Weekly monitoring report - ${orgName}`, `Period: ${r.period.from.slice(0, 10)} to ${r.period.to.slice(0, 10)}`, ""];
  lines.push(`Devices (${r.devices.length}):`);
  for (const d of r.devices) lines.push(` - ${d.hostname}: availability ${d.availability_percent}% | CPU avg ${d.cpu_avg ?? "-"}% | memory avg ${d.memory_avg ?? "-"}% | disk max ${d.disk_max ?? "-"}%`);
  lines.push("", `Alerts: ${r.alerts.total} in period, ${r.alerts.open} open now`);
  for (const t of r.alerts.top) lines.push(` - ${t.title}: ${t.count}`);
  if (r.uptime_checks.length) {
    lines.push("", "Uptime checks:");
    for (const c of r.uptime_checks) lines.push(` - ${c.name}: ${c.availability_percent ?? "no data"}%${c.avg_latency_ms ? ` | ${c.avg_latency_ms} ms avg` : ""}`);
  }
  lines.push("", `Full report: ${APP_URL}/reports`);
  return lines.join("\n");
}
function reportHtml(orgName: string, r: any) {
  const rows = r.devices.map((d: any) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #23272f;color:#dce5f3">${esc(d.hostname)}</td><td style="padding:8px 10px;border-bottom:1px solid #23272f;color:#9eacc0">${esc(d.availability_percent)}%</td><td style="padding:8px 10px;border-bottom:1px solid #23272f;color:#9eacc0">${esc(d.cpu_avg ?? "-")}%</td><td style="padding:8px 10px;border-bottom:1px solid #23272f;color:#9eacc0">${esc(d.memory_avg ?? "-")}%</td><td style="padding:8px 10px;border-bottom:1px solid #23272f;color:#9eacc0">${esc(d.disk_max ?? "-")}%</td></tr>`).join("");
  const body = `<h2 style="margin:0 0 4px;color:#fff;font-size:17px">Weekly monitoring report</h2><p style="margin:0 0 18px;color:#8594aa">${esc(orgName)} &middot; ${esc(r.period.from.slice(0, 10))} to ${esc(r.period.to.slice(0, 10))}</p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr style="background:#1a1e26"><th align="left" style="padding:8px 10px;font-size:11px;color:#6f8099;text-transform:uppercase">Device</th><th align="left" style="padding:8px 10px;font-size:11px;color:#6f8099;text-transform:uppercase">Availability</th><th align="left" style="padding:8px 10px;font-size:11px;color:#6f8099;text-transform:uppercase">CPU avg</th><th align="left" style="padding:8px 10px;font-size:11px;color:#6f8099;text-transform:uppercase">Memory avg</th><th align="left" style="padding:8px 10px;font-size:11px;color:#6f8099;text-transform:uppercase">Disk max</th></tr>${rows}</table>` +
    `<p style="margin:18px 0 0;color:#aebdd2"><b style="color:#fff">Alerts:</b> ${esc(r.alerts.total)} in period, ${esc(r.alerts.open)} open now.</p>${emailButton("Open full report", `${APP_URL}/reports`)}`;
  return emailShell(`Weekly monitoring report for ${orgName}`, body);
}
async function sendWeeklyReports(): Promise<number> {
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 6) return 0;
  const { data: channels } = await admin.from("notification_channels").select("id,organization_id,channel_type,config").eq("enabled", true).eq("channel_type", "email");
  let sent = 0;
  for (const orgId of [...new Set((channels || []).map((c: any) => c.organization_id))]) {
    const { data: recent } = await admin.from("notification_deliveries").select("id").eq("organization_id", orgId).eq("kind", "report").gte("created_at", new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString()).limit(1);
    if (recent?.length) continue;
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const report = await buildReport(orgId as string, 7);
    const orgName = org?.name || "Workspace";
    for (const channel of (channels || []).filter((c: any) => c.organization_id === orgId)) {
      const result = await deliver(channel, { kind: "report", severity: "info", title: `Weekly monitoring report - ${orgName}`, text: reportText(orgName, report), html: reportHtml(orgName, report) });
      await logDelivery(orgId as string, channel.id, null, "report", result);
      if (result.status === "sent") sent += 1;
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------------------------
async function detectOfflineDevices(): Promise<number> {
  const { data: rules } = await admin.from("alert_rules").select("id,organization_id,name,threshold").eq("metric", "device_offline").eq("enabled", true);
  let flagged = 0;
  for (const rule of rules || []) {
    const minutes = Number(rule.threshold) > 0 ? Number(rule.threshold) : 5;
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const { data: stale } = await admin.from("devices").select("id,hostname,last_seen_at").eq("organization_id", rule.organization_id).is("archived_at", null).lt("last_seen_at", cutoff).limit(200);
    if (!stale?.length) continue;
    const maintenance = await inMaintenance(rule.organization_id);
    for (const device of stale) {
      await admin.from("devices").update({ status: "offline" }).eq("id", device.id).neq("status", "offline");
      if (maintenance) continue;
      const { data: active } = await admin.from("alert_events").select("id").eq("device_id", device.id).eq("rule_id", rule.id).in("status", ["open", "acknowledged"]).limit(1);
      if (active?.length) continue;
      const { error } = await admin.from("alert_events").insert({
        organization_id: rule.organization_id, device_id: device.id, rule_id: rule.id, source: "offline", severity: "critical",
        title: `${rule.name}: ${device.hostname}`, message: `No heartbeat for more than ${minutes} minutes (last seen ${device.last_seen_at}).`,
      });
      if (!error) flagged += 1;
    }
  }
  return flagged;
}

async function detectInterfaceIssues(): Promise<number> {
  const { data: rules } = await admin.from("alert_rules").select("id,organization_id,name,metric,threshold")
    .in("metric", ["interface_errors", "interface_down"]).eq("enabled", true);
  let flagged = 0;
  const nowIso = new Date().toISOString();
  for (const rule of rules || []) {
    const maintenance = await inMaintenance(rule.organization_id);
    const byDevice = new Map<string, string>();
    if (rule.metric === "interface_down") {
      const { data: ifaces } = await admin.from("device_interfaces").select("device_id,name")
        .eq("organization_id", rule.organization_id).eq("is_physical", true).eq("oper_status", "down")
        .gte("last_seen_at", new Date(Date.now() - 15 * 60000).toISOString()).limit(500);
      const names = new Map<string, string[]>();
      for (const i of ifaces || []) { const arr = names.get(i.device_id) || []; arr.push(i.name); names.set(i.device_id, arr); }
      for (const [deviceId, list] of names) byDevice.set(deviceId, `Interface(s) down: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}.`);
    } else {
      const since = new Date(Date.now() - 10 * 60000).toISOString();
      const { data: ifaces } = await admin.from("device_interfaces").select("id,device_id").eq("organization_id", rule.organization_id);
      const ifaceIds = (ifaces || []).map((i: any) => i.id);
      const deviceOf = new Map((ifaces || []).map((i: any) => [i.id, i.device_id]));
      if (ifaceIds.length) {
        const { data: metrics } = await admin.from("interface_metrics").select("interface_id,in_errors,out_errors,in_discards,out_discards").in("interface_id", ifaceIds).gte("recorded_at", since);
        const totals = new Map<string, number>();
        for (const m of metrics || []) {
          const n = (Number(m.in_errors) || 0) + (Number(m.out_errors) || 0) + (Number(m.in_discards) || 0) + (Number(m.out_discards) || 0);
          const deviceId = deviceOf.get(m.interface_id) as string;
          totals.set(deviceId, (totals.get(deviceId) || 0) + n);
        }
        for (const [deviceId, total] of totals) {
          if (rule.threshold != null && total < rule.threshold) continue;
          byDevice.set(deviceId, `${total} interface errors/discards in the last 10 minutes (threshold ${rule.threshold}).`);
        }
      }
    }
    for (const [deviceId, message] of byDevice) {
      const { data: active } = await admin.from("alert_events").select("id").eq("device_id", deviceId).eq("rule_id", rule.id).in("status", ["open", "acknowledged"]).limit(1);
      if (active?.length || maintenance) continue;
      const { data: dev } = await admin.from("devices").select("hostname").eq("id", deviceId).maybeSingle();
      const { error } = await admin.from("alert_events").insert({
        organization_id: rule.organization_id, device_id: deviceId, rule_id: rule.id, source: "interface",
        severity: "warning", title: `${rule.name}: ${dev?.hostname ?? "device"}`, message,
      });
      if (!error) flagged += 1;
    }
    const { data: openAlerts } = await admin.from("alert_events").select("id,device_id").eq("rule_id", rule.id).in("status", ["open", "acknowledged"]);
    for (const a of openAlerts || []) {
      if (!byDevice.has(a.device_id)) await admin.from("alert_events").update({ status: "resolved", resolved_at: nowIso }).eq("id", a.id);
    }
  }
  return flagged;
}

async function detectOutdatedAgents(): Promise<number> {
  const { data: rules } = await admin.from("alert_rules").select("id,organization_id,name").eq("metric", "agent_outdated").eq("enabled", true);
  let flagged = 0;
  const nowIso = new Date().toISOString();
  for (const rule of rules || []) {
    if (await inMaintenance(rule.organization_id)) continue;
    const { data: devices } = await admin.from("devices").select("id,hostname,agent_version")
      .eq("organization_id", rule.organization_id).is("archived_at", null).eq("device_type", "workstation").eq("status", "online").limit(500);
    const outdated = (devices || []).filter((d: any) => d.agent_version && d.agent_version !== LATEST_AGENT_VERSION);
    const current = new Set(outdated.map((d: any) => d.id));
    for (const device of outdated) {
      const { data: active } = await admin.from("alert_events").select("id").eq("device_id", device.id).eq("rule_id", rule.id).in("status", ["open", "acknowledged"]).limit(1);
      if (active?.length) continue;
      const { error } = await admin.from("alert_events").insert({
        organization_id: rule.organization_id, device_id: device.id, rule_id: rule.id, source: "agent_version",
        severity: "info", title: `${rule.name}: ${device.hostname}`,
        message: `Running agent ${device.agent_version}, latest is ${LATEST_AGENT_VERSION}.`,
      });
      if (!error) flagged += 1;
    }
    const { data: openAlerts } = await admin.from("alert_events").select("id,device_id").eq("rule_id", rule.id).in("status", ["open", "acknowledged"]);
    for (const a of openAlerts || []) {
      if (!current.has(a.device_id)) await admin.from("alert_events").update({ status: "resolved", resolved_at: nowIso }).eq("id", a.id);
    }
  }
  return flagged;
}

async function runCheck(check: any): Promise<{ status: "up" | "down"; latency_ms: number | null; status_code: number | null; error: string | null }> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    if (check.check_type === "http" || check.check_type === "keyword" || check.check_type === "json") {
      const url = new URL(check.target);
      await assertPublicHost(url.hostname);
      const res = await fetch(url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(check.timeout_ms), headers: { "User-Agent": "EliteMonitoring/1.0" } });
      if (res.status >= 400) { await res.body?.cancel(); return { status: "down", latency_ms: elapsed(), status_code: res.status, error: `HTTP ${res.status}` }; }
      if (check.check_type === "keyword") {
        const body = (await res.text()).slice(0, 2_000_000);
        const needle = String(check.match_text || "");
        if (needle && !body.includes(needle)) return { status: "down", latency_ms: elapsed(), status_code: res.status, error: `Expected text not found: "${needle.slice(0, 60)}"` };
        return { status: "up", latency_ms: elapsed(), status_code: res.status, error: null };
      }
      if (check.check_type === "json") {
        let data: any;
        try { data = JSON.parse((await res.text()).slice(0, 2_000_000)); } catch { return { status: "down", latency_ms: elapsed(), status_code: res.status, error: "Response was not valid JSON" }; }
        const path = String(check.json_path || "").split(".").filter(Boolean);
        let value: any = data;
        for (const key of path) value = value == null ? undefined : value[key];
        const expected = check.json_expected == null || check.json_expected === "" ? null : String(check.json_expected);
        if (expected !== null && String(value) !== expected) return { status: "down", latency_ms: elapsed(), status_code: res.status, error: `${check.json_path || "value"} was "${value}", expected "${expected}"` };
        if (expected === null && value === undefined) return { status: "down", latency_ms: elapsed(), status_code: res.status, error: `${check.json_path || "value"} was missing from the response` };
        return { status: "up", latency_ms: elapsed(), status_code: res.status, error: null };
      }
      await res.body?.cancel();
      return { status: "up", latency_ms: elapsed(), status_code: res.status, error: null };
    }
    if (check.check_type === "ssl") {
      const url = new URL(check.target);
      await assertPublicHost(url.hostname);
      const conn = await Promise.race([
        Deno.connectTls({ hostname: url.hostname, port: url.port ? Number(url.port) : 443 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connection timed out")), check.timeout_ms)),
      ]);
      try {
        const cert = conn.getPeerCertificate?.();
        conn.close();
        const notAfter = cert?.validTo ? new Date(cert.validTo) : null;
        if (!notAfter || Number.isNaN(notAfter.getTime())) return { status: "up", latency_ms: elapsed(), status_code: null, error: null };
        const daysLeft = Math.floor((notAfter.getTime() - Date.now()) / 86_400_000);
        const warnDays = Number(check.ssl_warn_days) > 0 ? Number(check.ssl_warn_days) : 14;
        if (daysLeft < 0) return { status: "down", latency_ms: elapsed(), status_code: null, error: "Certificate has expired" };
        if (daysLeft <= warnDays) return { status: "down", latency_ms: elapsed(), status_code: null, error: `Certificate expires in ${daysLeft} day(s)` };
        return { status: "up", latency_ms: elapsed(), status_code: null, error: null };
      } catch { conn.close(); return { status: "up", latency_ms: elapsed(), status_code: null, error: null }; }
    }
    if (check.check_type === "dns") {
      await assertPublicHost(check.target);
      const [v4, v6] = await Promise.all([
        Deno.resolveDns(check.target, "A").catch(() => [] as string[]),
        Deno.resolveDns(check.target, "AAAA").catch(() => [] as string[]),
      ]);
      return v4.length || v6.length
        ? { status: "up", latency_ms: elapsed(), status_code: null, error: null }
        : { status: "down", latency_ms: elapsed(), status_code: null, error: "No DNS records found" };
    }
    if (check.check_type === "ping") {
      // Edge functions cannot send raw ICMP packets, so this is a reachability check:
      // can we open a TCP connection to the host at all (443, then 80 as a fallback).
      await assertPublicHost(check.target);
      for (const port of [443, 80]) {
        try {
          const conn = await Promise.race([
            Deno.connect({ hostname: check.target, port }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), Math.min(check.timeout_ms, 4000))),
          ]);
          conn.close();
          return { status: "up", latency_ms: elapsed(), status_code: null, error: null };
        } catch { /* try the next port */ }
      }
      return { status: "down", latency_ms: null, status_code: null, error: "Host did not respond on 443 or 80" };
    }
    // tcp
    await assertPublicHost(check.target);
    const conn = await Promise.race([
      Deno.connect({ hostname: check.target, port: check.port }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connection timed out")), check.timeout_ms)),
    ]);
    conn.close();
    return { status: "up", latency_ms: elapsed(), status_code: null, error: null };
  } catch (error) {
    const message = error instanceof BlockedTarget ? error.message : String((error as Error)?.message || error).slice(0, 200);
    return { status: "down", latency_ms: null, status_code: null, error: message };
  }
}
async function applyCheckResult(check: any, result: Awaited<ReturnType<typeof runCheck>>) {
  const now = new Date().toISOString();
  await admin.from("uptime_results").insert({ organization_id: check.organization_id, check_id: check.id, status: result.status, latency_ms: result.latency_ms, status_code: result.status_code, error: result.error, checked_at: now });
  const failures = result.status === "down" ? (check.consecutive_failures || 0) + 1 : 0;
  const nextStatus = result.status === "up" ? "up" : failures >= 2 ? "down" : check.status === "unknown" ? "unknown" : check.status;
  const changed = nextStatus !== check.status && nextStatus !== "unknown";
  await admin.from("uptime_checks").update({ consecutive_failures: failures, status: nextStatus, last_checked_at: now, ...(changed ? { last_status_change_at: now } : {}) }).eq("id", check.id);
  if (nextStatus === "down" && check.status !== "down" && !(await inMaintenance(check.organization_id))) {
    const { data: active } = await admin.from("alert_events").select("id").eq("uptime_check_id", check.id).eq("source", "uptime").in("status", ["open", "acknowledged"]).limit(1);
    if (!active?.length) {
      await admin.from("alert_events").insert({ organization_id: check.organization_id, uptime_check_id: check.id, source: "uptime", severity: "critical", title: `${check.name} is down`, message: `${check.check_type.toUpperCase()} check on ${check.target}${check.port ? ":" + check.port : ""} failed: ${result.error ?? "no response"}.` });
    }
  }
  if (result.status === "up") {
    await admin.from("alert_events").update({ status: "resolved", resolved_at: now }).eq("uptime_check_id", check.id).eq("source", "uptime").in("status", ["open", "acknowledged"]);
  }
  // A separate, lighter alert for a check that's up but answering too slowly.
  if (check.latency_alert_ms && result.status === "up" && result.latency_ms !== null && !(await inMaintenance(check.organization_id))) {
    if (result.latency_ms > check.latency_alert_ms) {
      const { data: active } = await admin.from("alert_events").select("id").eq("uptime_check_id", check.id).eq("source", "uptime_latency").in("status", ["open", "acknowledged"]).limit(1);
      if (!active?.length) {
        await admin.from("alert_events").insert({ organization_id: check.organization_id, uptime_check_id: check.id, source: "uptime_latency", severity: "warning", title: `${check.name} is slow`, message: `Responded in ${result.latency_ms}ms, above the ${check.latency_alert_ms}ms limit.` });
      }
    } else {
      await admin.from("alert_events").update({ status: "resolved", resolved_at: now }).eq("uptime_check_id", check.id).eq("source", "uptime_latency").in("status", ["open", "acknowledged"]);
    }
  }
}
async function runDueChecks(): Promise<number> {
  const { data: checks } = await admin.from("uptime_checks").select("*").eq("enabled", true).limit(300);
  const due = (checks || []).filter((c: any) => !c.last_checked_at || Date.now() - new Date(c.last_checked_at).getTime() >= (c.interval_seconds - 5) * 1000);
  for (let i = 0; i < due.length; i += 20) {
    await Promise.allSettled(due.slice(i, i + 20).map(async (check: any) => applyCheckResult(check, await runCheck(check))));
  }
  return due.length;
}

async function handleTick(req: Request) {
  const secret = req.headers.get("x-cron-secret") || "";
  const { data: valid } = await admin.rpc("check_cron_secret", { p_secret: secret });
  if (valid !== true) return fail("Forbidden", 403);
  const started = Date.now();
  const stats: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<number>) => {
    try { stats[name] = await fn(); } catch (error) { errors.push(`${name}: ${String((error as Error)?.message || error).slice(0, 120)}`); await platformEvent("error", "tick", `${name} failed: ${String((error as Error)?.message || error)}`); }
  };
  await Promise.all([step("offline_flagged", detectOfflineDevices), step("uptime_checked", runDueChecks), step("interface_issues_flagged", detectInterfaceIssues), step("outdated_agents_flagged", detectOutdatedAgents)]);
  await step("notifications_sent", dispatchAlertNotifications);
  await step("reports_sent", sendWeeklyReports);
  const summary = { ...stats, errors, duration_ms: Date.now() - started, ok: errors.length === 0 };
  await admin.from("platform_state").upsert({ key: "last_tick", value: summary, updated_at: new Date().toISOString() });
  return json(summary);
}

// ---------------------------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------------------------
const uuidPart = "([0-9a-f-]{36})";
const validLevels = new Set(["critical", "error", "warning", "info", "audit_failure"]);
const ipv4Pattern = /^(\d{1,3})(\.\d{1,3}){3}$/;

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/monitoring-api/, "") || "/";
  if (req.method === "GET" && path === "/health") return json({ status: "ok", service: "elite-monitoring-api", version: API_VERSION, latest_agent_version: LATEST_AGENT_VERSION });

  if (req.method === "POST" && path === "/jobs/tick") return await handleTick(req);

  if (req.method === "POST" && path === "/enrollment-tokens") {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const siteId = String(body.site_id || "");
    await requirePermission(req, organizationId, "devices", "create");
    const { data: site } = await admin.from("sites").select("id").eq("id", siteId).eq("organization_id", organizationId).maybeSingle();
    if (!site) return fail("Site not found in this workspace", 404);
    const token = randomToken(36);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("enrollment_tokens").insert({
      organization_id: organizationId, site_id: siteId, token_hash: await hashToken(token),
      label: String(body.label || "Agent enrollment").slice(0, 100), expires_at: expiresAt,
    });
    if (error) return fail("Could not create enrollment token", 500);
    await audit(organizationId, "user", user.id, "create", "enrollment_token", null, { site_id: siteId });
    return json({ token, expires_at: expiresAt, site_id: siteId, warning: "Copy this token now. It will not be shown again." });
  }

  if (req.method === "POST" && path === "/agents/enroll") {
    const body = await readJson(req);
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
      agent_version: body.agent_version ? String(body.agent_version).slice(0, 40) : null,
    }).select("id,hostname").single();
    if (deviceError || !device) return fail("Device registration failed", 500);
    const { error: credentialError } = await admin.from("device_credentials").insert({ device_id: device.id, token_hash: await hashToken(deviceToken) });
    if (credentialError) {
      await admin.from("devices").delete().eq("id", device.id);
      return fail("Could not create device credential", 500);
    }
    await audit(enrollment.organization_id, "agent", null, "enroll", "device", device.id, { hostname: device.hostname });
    return json({ device, device_token: deviceToken, warning: "Store this device token securely. It is only returned once." });
  }

  const heartbeatMatch = path.match(new RegExp(`^/agents/${uuidPart}/heartbeat$`, "i"));
  if (req.method === "POST" && heartbeatMatch) {
    const deviceId = heartbeatMatch[1];
    const device = await agentAuth(req, deviceId);
    const body = await readJson(req);
    const numeric = (v: unknown) => v == null ? null : Number(v);
    for (const key of ["cpu_percent", "memory_percent", "disk_percent"]) {
      const v = numeric(body[key]);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) return fail("Invalid metric value");
    }
    const rate = (v: unknown) => { const n = numeric(v); return n !== null && Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null; };
    const uptime = numeric(body.uptime_seconds);
    const processes = Array.isArray(body.top_processes) ? body.top_processes.slice(0, 10).map((p: any) => ({
      name: String(p?.name || "unknown").slice(0, 80),
      cpu: Math.min(100, Math.max(0, Number(p?.cpu) || 0)),
      memory_mb: Math.min(10_000_000, Math.max(0, Math.round(Number(p?.memory_mb) || 0))),
    })) : null;
    const now = new Date().toISOString();
    const metrics: Record<string, any> = {
      organization_id: device.organization_id, device_id: deviceId,
      cpu_percent: numeric(body.cpu_percent), memory_percent: numeric(body.memory_percent),
      disk_percent: numeric(body.disk_percent), bytes_sent: body.bytes_sent == null ? null : String(body.bytes_sent),
      bytes_recv: body.bytes_recv == null ? null : String(body.bytes_recv), recorded_at: now,
      uptime_seconds: uptime !== null && Number.isFinite(uptime) && uptime >= 0 ? Math.round(uptime) : null,
      net_sent_bps: rate(body.net_sent_bps), net_recv_bps: rate(body.net_recv_bps), top_processes: processes,
    };
    const deviceUpdate: Record<string, any> = { status: body.status === "degraded" ? "degraded" : "online", last_seen_at: now, archived_at: null };
    if (body.agent_version) deviceUpdate.agent_version = String(body.agent_version).slice(0, 40);
    const [{ error: metricError }, { error: deviceError }, { error: credentialUpdateError }] = await Promise.all([
      admin.from("device_metrics").insert(metrics),
      admin.from("devices").update(deviceUpdate).eq("id", deviceId),
      admin.from("device_credentials").update({ last_used_at: now }).eq("device_id", deviceId),
    ]);
    if (metricError || deviceError || credentialUpdateError) { await platformEvent("error", "heartbeat", "Could not persist device telemetry", device.organization_id); return fail("Could not persist device telemetry", 500); }
    // The device is reporting again: clear any open offline alert.
    await admin.from("alert_events").update({ status: "resolved", resolved_at: now }).eq("device_id", deviceId).eq("source", "offline").in("status", ["open", "acknowledged"]);
    const { data: rules } = await admin.from("alert_rules").select("id,name,metric,operator,threshold")
      .eq("organization_id", device.organization_id).eq("enabled", true).in("metric", ["cpu_percent", "memory_percent", "disk_percent", "net_sent_bps", "net_recv_bps"]);
    let maintenance: boolean | null = null;
    const isRate = (m: string) => m === "net_sent_bps" || m === "net_recv_bps";
    const fmtRate = (n: number) => n >= 1_000_000_000 ? (n / 1_000_000_000).toFixed(1) + " Gbps" : n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + " Mbps" : (n / 1000).toFixed(0) + " Kbps";
    for (const rule of rules || []) {
      const value = metrics[rule.metric as string] as number | null;
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
        if (maintenance === null) maintenance = await inMaintenance(device.organization_id);
        if (maintenance) continue;
        const critical = isRate(rule.metric) ? value >= rule.threshold * 1.5 : value >= Math.min(100, rule.threshold + 15);
        await admin.from("alert_events").insert({
          organization_id: device.organization_id, device_id: deviceId, rule_id: rule.id, source: "metric",
          severity: critical ? "critical" : "warning",
          title: rule.name + ": " + device.hostname,
          message: isRate(rule.metric)
            ? rule.metric + " reached " + fmtRate(value) + " (threshold " + fmtRate(rule.threshold) + ")."
            : rule.metric + " reached " + value.toFixed(1) + "% (threshold " + rule.threshold + "%).",
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
    return json({ ok: true, device_id: deviceId, recorded_at: now, commands: commands || [], latest_agent_version: LATEST_AGENT_VERSION });
  }

  const logsMatch = path.match(new RegExp(`^/agents/${uuidPart}/logs$`, "i"));
  if (req.method === "POST" && logsMatch) {
    const device = await agentAuth(req, logsMatch[1]);
    const body = await readJson(req);
    const items = Array.isArray(body.logs) ? body.logs.slice(0, 100) : [];
    const nowMs = Date.now();
    const rows: any[] = [];
    for (const item of items) {
      const source = String(item?.source || "").trim().slice(0, 80);
      const message = String(item?.message || "").trim().slice(0, 2000);
      const loggedAt = new Date(String(item?.logged_at || ""));
      if (!source || !message || Number.isNaN(loggedAt.getTime()) || loggedAt.getTime() > nowMs + 5 * 60000 || loggedAt.getTime() < nowMs - 30 * 24 * 3600 * 1000) continue;
      const eventId = Number.isInteger(Number(item.event_id)) ? Number(item.event_id) : null;
      const recordId = /^\d{1,19}$/.test(String(item.record_id ?? "")) ? String(item.record_id) : null;
      rows.push({
        organization_id: device.organization_id, device_id: device.id, source,
        level: validLevels.has(item.level) ? item.level : "info", event_id: eventId,
        provider: item.provider ? String(item.provider).slice(0, 160) : null, message,
        dedupe_key: (recordId ? `${source}:${recordId}` : `${source}:${eventId ?? 0}:${loggedAt.toISOString()}`).slice(0, 200),
        logged_at: loggedAt.toISOString(),
      });
    }
    if (rows.length) {
      const { error } = await admin.from("device_logs").upsert(rows, { onConflict: "device_id,dedupe_key", ignoreDuplicates: true });
      if (error) { await platformEvent("error", "logs", "Could not store device logs", device.organization_id); return fail("Could not store logs", 500); }
    }
    // Repeated failed sign-ins on one device become an alert; it clears once they stop.
    // The threshold comes from an org's "failed_signins" rule when it has one enabled, else the old default of 5.
    const { data: signinRule } = await admin.from("alert_rules").select("threshold").eq("organization_id", device.organization_id).eq("metric", "failed_signins").eq("enabled", true).maybeSingle();
    const signinThreshold = Number(signinRule?.threshold) > 0 ? Number(signinRule!.threshold) : 5;
    const windowStart = new Date(nowMs - 10 * 60000).toISOString();
    const { count } = await admin.from("device_logs").select("id", { count: "exact", head: true }).eq("device_id", device.id).eq("level", "audit_failure").gte("logged_at", windowStart);
    const { data: openLogAlert } = await admin.from("alert_events").select("id,triggered_at").eq("device_id", device.id).eq("source", "log").in("status", ["open", "acknowledged"]).limit(1);
    if ((count || 0) >= signinThreshold && !openLogAlert?.length && !(await inMaintenance(device.organization_id))) {
      await admin.from("alert_events").insert({ organization_id: device.organization_id, device_id: device.id, source: "log", severity: "warning", title: `Repeated failed sign-ins: ${device.hostname}`, message: `${count} failed sign-in attempts in the last 10 minutes.` });
    } else if ((count || 0) < signinThreshold && openLogAlert?.length && Date.now() - new Date(openLogAlert[0].triggered_at).getTime() > 15 * 60000) {
      await admin.from("alert_events").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", openLogAlert[0].id);
    }
    return json({ ok: true, accepted: rows.length });
  }

  const discoveryMatch = path.match(new RegExp(`^/agents/${uuidPart}/discovery$`, "i"));
  if (req.method === "POST" && discoveryMatch) {
    const device = await agentAuth(req, discoveryMatch[1]);
    const body = await readJson(req);
    const seen = new Map<string, string>();
    for (const host of (Array.isArray(body.hosts) ? body.hosts.slice(0, 256) : [])) {
      const ip = String(host?.ip || "").trim();
      const mac = String(host?.mac || "").trim().toLowerCase().replaceAll("-", ":");
      if (!ipv4Pattern.test(ip) || ip.split(".").some((n) => Number(n) > 255) || ip.endsWith(".255") || ip.startsWith("224.") || ip.startsWith("239.") || ip === "0.0.0.0") continue;
      if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) || mac === "ff:ff:ff:ff:ff:ff" || mac === "00:00:00:00:00:00" || mac.startsWith("01:00:5e") || mac.startsWith("33:33")) continue;
      seen.set(mac, ip);
    }
    if (!seen.size) return json({ ok: true, accepted: 0, new_hosts: 0 });
    const siteFilter = { organization_id: device.organization_id, site_id: device.site_id };
    const [{ count: siteTotal }, { data: existing }, { data: orgDevices }] = await Promise.all([
      admin.from("discovered_hosts").select("id", { count: "exact", head: true }).match(siteFilter),
      admin.from("discovered_hosts").select("mac_address,state,first_seen_at").match(siteFilter).in("mac_address", [...seen.keys()]),
      admin.from("devices").select("id,hostname,mac_addresses").eq("organization_id", device.organization_id),
    ]);
    const baseline = (siteTotal || 0) === 0; // first report from a site only establishes what is already there
    const knownByMac = new Map<string, string>();
    for (const d of orgDevices || []) for (const m of (d.mac_addresses || [])) knownByMac.set(String(m).toLowerCase().replaceAll("-", ":"), d.id);
    const existingByMac = new Map((existing || []).map((h: any) => [String(h.mac_address).toLowerCase(), h]));
    const now = new Date().toISOString();
    const rows: any[] = [];
    const fresh: { ip: string; mac: string }[] = [];
    for (const [mac, ip] of seen) {
      const prior = existingByMac.get(mac);
      const matched = knownByMac.get(mac) ?? null;
      rows.push({
        ...siteFilter, reported_by_device_id: device.id, device_id: matched, ip_address: ip, mac_address: mac,
        state: prior ? prior.state : baseline || matched ? "known" : "new",
        first_seen_at: prior ? prior.first_seen_at : now, last_seen_at: now,
      });
      if (!prior && !baseline && !matched) fresh.push({ ip, mac });
    }
    const { error } = await admin.from("discovered_hosts").upsert(rows, { onConflict: "organization_id,site_id,mac_address" });
    if (error) { await platformEvent("error", "discovery", "Could not store discovered hosts", device.organization_id); return fail("Could not store discovery results", 500); }
    if (fresh.length && !(await inMaintenance(device.organization_id))) {
      for (const host of fresh.slice(0, 5)) {
        await admin.from("alert_events").insert({ organization_id: device.organization_id, source: "discovery", severity: "warning", title: `New device on network: ${host.ip}`, message: `A previously unseen device (MAC ${host.mac}) appeared on the network of ${device.hostname}. Review it under Devices > Discovered.` });
      }
      if (fresh.length > 5) await admin.from("alert_events").insert({ organization_id: device.organization_id, source: "discovery", severity: "warning", title: `${fresh.length - 5} more new devices on network`, message: `Reported by ${device.hostname}. Review them under Devices > Discovered.` });
    }
    return json({ ok: true, accepted: rows.length, new_hosts: fresh.length });
  }

  const interfacesMatch = path.match(new RegExp(`^/agents/${uuidPart}/interfaces/report$`, "i"));
  if (req.method === "POST" && interfacesMatch) {
    const agentId = interfacesMatch[1];
    const device = await agentAuth(req, agentId);
    const body = await readJson(req);
    if (!Array.isArray(body.interfaces) || body.interfaces.length > 64) return fail("A maximum of 64 interfaces is accepted");
    const counter = (value: unknown) => /^\d{1,19}$/.test(String(value ?? "")) ? String(value) : null;
    let accepted = 0;
    for (const item of body.interfaces) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.name || "").trim().slice(0, 128);
      if (!name) continue;
      const macRaw = String(item.mac || "");
      const mac = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(macRaw) ? macRaw.replaceAll("-", ":").toLowerCase() : null;
      const speedMbps = Number(item.speed_mbps);
      const mtu = Number(item.mtu);
      const isUp = item.is_up === true ? "up" : item.is_up === false ? "down" : "unknown";
      const { data: iface, error: interfaceError } = await admin.from("device_interfaces").upsert({
        organization_id: device.organization_id, device_id: agentId, name,
        interface_index: accepted + 1, description: null, mac_address: mac,
        admin_status: "unknown", oper_status: isUp,
        speed_bps: Number.isFinite(speedMbps) && speedMbps > 0 && speedMbps <= 1000000000 ? Math.round(speedMbps * 1000000) : null,
        mtu: Number.isInteger(mtu) && mtu >= 576 && mtu <= 9216 ? mtu : null,
        is_physical: !/^(lo|loopback|utun|tun|tap|docker|veth|br-)/i.test(name),
        last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "device_id,name" }).select("id").single();
      if (interfaceError || !iface) return fail("Could not save interface inventory", 500);
      const { error: metricError } = await admin.from("interface_metrics").insert({
        organization_id: device.organization_id, interface_id: iface.id,
        in_octets: counter(item.in_octets), out_octets: counter(item.out_octets),
        in_errors: counter(item.in_errors), out_errors: counter(item.out_errors),
        in_discards: counter(item.in_discards), out_discards: counter(item.out_discards),
        recorded_at: new Date().toISOString(),
      });
      if (metricError) return fail("Could not save interface counters", 500);
      accepted += 1;
    }
    return json({ ok: true, device_id: agentId, accepted, recorded_at: new Date().toISOString() });
  }

  const snmpMatch = path.match(new RegExp(`^/agents/${uuidPart}/snmp/report$`, "i"));
  if (req.method === "POST" && snmpMatch) {
    const agentId = snmpMatch[1];
    const agentDevice = await agentAuth(req, agentId);
    const body = await readJson(req);
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

  const deviceActionMatch = path.match(new RegExp(`^/devices/${uuidPart}/(archive|restore|uninstall)$`, "i"));
  if (req.method === "POST" && deviceActionMatch) {
    const deviceId = deviceActionMatch[1], action = deviceActionMatch[2].toLowerCase();
    const { data: device } = await admin.from("devices").select("id,organization_id,hostname,last_seen_at,archived_at,device_type,os_name").eq("id", deviceId).maybeSingle();
    if (!device) return fail("Device not found", 404);
    const permAction = action === "uninstall" ? "delete" : "edit";
    const { user } = await requirePermission(req, device.organization_id, "devices", permAction);
    const online = Boolean(device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() <= 120000);
    if (action === "archive") {
      if (device.archived_at) return fail("Device is already archived", 409);
      if (online) return fail("Only offline devices can be archived", 409);
      const { error } = await admin.from("devices").update({ archived_at: new Date().toISOString() }).eq("id", deviceId);
      if (error) return fail("Could not archive device", 500);
      await audit(device.organization_id, "user", user.id, "archive", "device", deviceId, { hostname: device.hostname });
      return json({ ok: true, archived: true, device_id: deviceId });
    }
    if (action === "restore") {
      if (!device.archived_at) return fail("Device is not archived", 409);
      const { error } = await admin.from("devices").update({ archived_at: null }).eq("id", deviceId);
      if (error) return fail("Could not restore device", 500);
      await audit(device.organization_id, "user", user.id, "restore", "device", deviceId, { hostname: device.hostname });
      return json({ ok: true, archived: false, device_id: deviceId });
    }
    if (device.archived_at) return fail("Restore the device before uninstalling its agent", 409);
    if (!online) return fail("Remote uninstall requires an online device", 409);
    if (device.device_type !== "workstation" || device.os_name !== "Windows") return fail("Remote uninstall is only supported for Windows workstations", 400);
    const { data: pending } = await admin.from("pending_agent_commands").select("id").eq("device_id", deviceId).eq("command", "uninstall").in("status", ["queued", "delivered"]).limit(1);
    if (pending?.length) return fail("An uninstall command is already pending", 409);
    const { error } = await admin.from("pending_agent_commands").insert({ device_id: deviceId, command: "uninstall", requested_by: user.id });
    if (error) return fail("Could not queue uninstall command", 500);
    await audit(device.organization_id, "user", user.id, "uninstall_requested", "device", deviceId, { hostname: device.hostname });
    return json({ ok: true, device_id: deviceId, command: "uninstall", status: "queued" }, 202);
  }

  const revokeMatch = path.match(new RegExp(`^/devices/${uuidPart}/revoke$`, "i"));
  if (req.method === "POST" && revokeMatch) {
    const deviceId = revokeMatch[1];
    const { data: device } = await admin.from("devices").select("id,organization_id,hostname").eq("id", deviceId).maybeSingle();
    if (!device) return fail("Device not found", 404);
    const { user } = await requirePermission(req, device.organization_id, "devices", "delete");
    const now = new Date().toISOString();
    const { error } = await admin.from("device_credentials").update({ revoked_at: now }).eq("device_id", deviceId);
    if (error) return fail("Could not revoke device credential", 500);
    await admin.from("devices").update({ status: "offline" }).eq("id", deviceId);
    await audit(device.organization_id, "user", user.id, "revoke_credential", "device", deviceId, { hostname: device.hostname });
    return json({ ok: true, device_id: deviceId, revoked_at: now });
  }

  if (req.method === "POST" && path === "/team/invite") {
    const user = await signedInUser(req);
    if (!user) return fail("Valid user session required", 401);
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const email = String(body.email || "").trim().toLowerCase();
    const roleRaw = String(body.role || "viewer");
    const isCustomRoleId = /^[0-9a-f-]{36}$/i.test(roleRaw);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address");
    if (!isCustomRoleId && !["admin", "operator", "viewer"].includes(roleRaw)) return fail("Invalid workspace role");
    const { role: callerRole } = await requirePermission(req, organizationId, "team", "create");
    if (roleRaw === "admin" && callerRole !== "owner") return fail("Only the owner can grant admin access", 403);
    let customRoleId: string | null = null;
    let role: string = roleRaw;
    if (isCustomRoleId) {
      const { data: customRole } = await admin.from("custom_roles").select("id,name").eq("id", roleRaw).eq("organization_id", organizationId).maybeSingle();
      if (!customRole) return fail("Custom role not found in this workspace", 404);
      customRoleId = customRole.id;
      role = "custom";
    }
    // redirectTo matters: without it Supabase falls back to the Site URL configured in the
    // Auth dashboard, which may not point anywhere that shows a "set your password" screen -
    // the invited person would otherwise land signed-in-but-passwordless on a generic page.
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL });
    if (inviteError || !inviteData.user) return fail("Invitation could not be sent. Check Auth email/SMTP settings or whether this user already exists.", 502);
    const { error: memberError } = await admin.from("organization_members").insert({
      organization_id: organizationId, user_id: inviteData.user.id, role, custom_role_id: customRoleId,
    });
    if (memberError) return fail("Invitation sent, but workspace membership could not be assigned. Contact the owner.", 500);
    await audit(organizationId, "user", user.id, "invite_member", "organization_member", inviteData.user.id, { role, custom_role_id: customRoleId });
    return json({ ok: true, email, role, custom_role_id: customRoleId });
  }

  if (req.method === "GET" && path === "/team/members") {
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "team", "view");
    // list_organization_members checks auth.uid() itself, so it must run as the calling user,
    // not as the service role (which has no auth.uid() and would always fail that check).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("list_organization_members", { p_org: organizationId });
    if (error) return fail("Could not load the member list", 500);
    const { data: customInfo } = await admin.from("organization_members").select("user_id,custom_role_id,custom_roles(name)").eq("organization_id", organizationId);
    const byUser = new Map((customInfo || []).map((r: any) => [r.user_id, { custom_role_id: r.custom_role_id, custom_role_name: r.custom_roles?.name ?? null }]));
    const members = (data || []).map((m: any) => ({ ...m, ...(byUser.get(m.user_id) || { custom_role_id: null, custom_role_name: null }) }));
    return json({ members });
  }

  if (req.method === "POST" && path === "/team/members/role") {
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const targetUserId = String(body.user_id || "");
    const newRoleRaw = String(body.role || "");
    const isCustomRoleId = /^[0-9a-f-]{36}$/i.test(newRoleRaw);
    if (!isCustomRoleId && !["owner", "admin", "operator", "viewer"].includes(newRoleRaw)) return fail("Invalid workspace role");
    const { user, role: callerRole } = await requirePermission(req, organizationId, "team", "edit");
    if (targetUserId === user.id) return fail("You cannot change your own role", 400);
    const { data: target } = await admin.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", targetUserId).maybeSingle();
    if (!target) return fail("That person is not a member of this workspace", 404);
    let customRoleId: string | null = null;
    let newRole: string = newRoleRaw;
    if (isCustomRoleId) {
      const { data: customRole } = await admin.from("custom_roles").select("id,name").eq("id", newRoleRaw).eq("organization_id", organizationId).maybeSingle();
      if (!customRole) return fail("Custom role not found in this workspace", 404);
      customRoleId = customRole.id;
      newRole = "custom";
    }
    if (callerRole !== "owner") {
      if (["owner", "admin"].includes(target.role)) return fail("Only the owner can change an admin's role", 403);
      if (["owner", "admin"].includes(newRole)) return fail("Only the owner can grant admin access", 403);
    }
    if (target.role === "owner" && newRole !== "owner") {
      const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("role", "owner");
      if ((count || 0) <= 1) return fail("A workspace needs at least one owner", 409);
    }
    const { error } = await admin.from("organization_members").update({ role: newRole, custom_role_id: customRoleId }).eq("organization_id", organizationId).eq("user_id", targetUserId);
    if (error) return fail("Could not update that member's role", 500);
    await audit(organizationId, "user", user.id, "update_member_role", "organization_member", targetUserId, { role: newRole, custom_role_id: customRoleId });
    return json({ ok: true, user_id: targetUserId, role: newRole, custom_role_id: customRoleId });
  }

  if (req.method === "POST" && path === "/team/members/remove") {
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const targetUserId = String(body.user_id || "");
    const { user, role: callerRole } = await requirePermission(req, organizationId, "team", "delete");
    if (targetUserId === user.id) return fail("You cannot remove yourself from the workspace", 400);
    const { data: target } = await admin.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", targetUserId).maybeSingle();
    if (!target) return fail("That person is not a member of this workspace", 404);
    if (callerRole !== "owner" && ["owner", "admin"].includes(target.role)) return fail("Only the owner can remove an owner or admin", 403);
    if (target.role === "owner") {
      const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("role", "owner");
      if ((count || 0) <= 1) return fail("A workspace needs at least one owner", 409);
    }
    const { error } = await admin.from("organization_members").delete().eq("organization_id", organizationId).eq("user_id", targetUserId);
    if (error) return fail("Could not remove that member", 500);
    await audit(organizationId, "user", user.id, "remove_member", "organization_member", targetUserId, {});
    return json({ ok: true, user_id: targetUserId });
  }

  const PERMISSION_RESOURCES = ["devices", "sites", "networks", "alerts", "maintenance", "uptime", "notifications", "team", "platform", "assets", "tickets"];
  const PERMISSION_ACTIONS = ["can_view", "can_create", "can_edit", "can_delete"] as const;

  if (req.method === "GET" && path === "/team/roles") {
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "team", "view");
    const { data: roles, error } = await admin.from("custom_roles").select("id,name,created_at").eq("organization_id", organizationId).order("name");
    if (error) return fail("Could not load custom roles", 500);
    const ids = (roles || []).map((r: any) => r.id);
    const { data: perms } = ids.length ? await admin.from("role_permissions").select("role_id,resource,can_view,can_create,can_edit,can_delete").in("role_id", ids) : { data: [] as any[] };
    const byRole = new Map<string, any[]>();
    for (const p of perms || []) { const arr = byRole.get(p.role_id) || []; arr.push(p); byRole.set(p.role_id, arr); }
    return json({ roles: (roles || []).map((r: any) => ({ ...r, permissions: byRole.get(r.id) || [] })) });
  }

  if (req.method === "POST" && path === "/team/roles") {
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "team", "create");
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return fail("Role name is required");
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const { data: role, error } = await admin.from("custom_roles").insert({ organization_id: organizationId, name }).select("id,name,created_at").single();
    if (error || !role) return fail(error?.code === "23505" ? "A role with that name already exists" : "Could not create role", error?.code === "23505" ? 409 : 500);
    const rows = permissions
      .filter((p: any) => PERMISSION_RESOURCES.includes(String(p?.resource)))
      .map((p: any) => ({
        role_id: role.id, resource: String(p.resource),
        can_view: Boolean(p.can_view), can_create: Boolean(p.can_create), can_edit: Boolean(p.can_edit), can_delete: Boolean(p.can_delete),
      }));
    if (rows.length) {
      const { error: permError } = await admin.from("role_permissions").insert(rows);
      if (permError) { await admin.from("custom_roles").delete().eq("id", role.id); return fail("Could not save role permissions", 500); }
    }
    await audit(organizationId, "user", user.id, "create_role", "custom_role", role.id, { name });
    return json({ ok: true, role: { ...role, permissions: rows } }, 201);
  }

  const roleIdMatch = path.match(new RegExp(`^/team/roles/${uuidPart}$`, "i"));
  if (req.method === "PUT" && roleIdMatch) {
    const roleId = roleIdMatch[1];
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "team", "edit");
    const { data: role } = await admin.from("custom_roles").select("id").eq("id", roleId).eq("organization_id", organizationId).maybeSingle();
    if (!role) return fail("Custom role not found in this workspace", 404);
    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return fail("Role name is required");
      const { error } = await admin.from("custom_roles").update({ name }).eq("id", roleId);
      if (error) return fail(error.code === "23505" ? "A role with that name already exists" : "Could not rename role", error.code === "23505" ? 409 : 500);
    }
    if (Array.isArray(body.permissions)) {
      const rows = body.permissions
        .filter((p: any) => PERMISSION_RESOURCES.includes(String(p?.resource)))
        .map((p: any) => ({
          role_id: roleId, resource: String(p.resource),
          can_view: Boolean(p.can_view), can_create: Boolean(p.can_create), can_edit: Boolean(p.can_edit), can_delete: Boolean(p.can_delete),
        }));
      await admin.from("role_permissions").delete().eq("role_id", roleId);
      if (rows.length) {
        const { error: permError } = await admin.from("role_permissions").insert(rows);
        if (permError) return fail("Could not save role permissions", 500);
      }
    }
    await audit(organizationId, "user", user.id, "update_role", "custom_role", roleId, {});
    return json({ ok: true, role_id: roleId });
  }

  if (req.method === "DELETE" && roleIdMatch) {
    const roleId = roleIdMatch[1];
    const organizationId = url.searchParams.get("organization_id") || "";
    const { user } = await requirePermission(req, organizationId, "team", "delete");
    const { data: role } = await admin.from("custom_roles").select("id").eq("id", roleId).eq("organization_id", organizationId).maybeSingle();
    if (!role) return fail("Custom role not found in this workspace", 404);
    const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("custom_role_id", roleId);
    if ((count || 0) > 0) return fail("Reassign the members using this role before deleting it", 409);
    const { error } = await admin.from("custom_roles").delete().eq("id", roleId);
    if (error) return fail("Could not delete role", 500);
    await audit(organizationId, "user", user.id, "delete_role", "custom_role", roleId, {});
    return json({ ok: true, role_id: roleId });
  }

  if (req.method === "POST" && path === "/auth/reset-password") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address");
    // Reject up front for an email with no account, rather than the usual Supabase default of
    // silently "succeeding" either way - the person explicitly wants the honest answer here,
    // trading the (minor, since this is an internal tool, not a public signup page) email-
    // enumeration risk for clearer feedback when someone mistypes their work email.
    const { data: exists, error: existsError } = await admin.rpc("public_user_exists", { p_email: email });
    if (existsError) return fail("Could not check that email right now", 500);
    if (!exists) return fail("No account found with that email", 404);
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
    if (error) return fail("Could not send the reset email", 502);
    return json({ ok: true });
  }

  // ---- Monitoring features used by the dashboard --------------------------------------------
  if (req.method === "POST" && path === "/uptime-checks/run") {
    const body = await readJson(req);
    const { data: check } = await admin.from("uptime_checks").select("*").eq("id", String(body.check_id || "")).maybeSingle();
    if (!check) return fail("Check not found", 404);
    await requirePermission(req, check.organization_id, "uptime", "edit");
    const result = await runCheck(check);
    await applyCheckResult(check, result);
    return json({ ok: true, ...result });
  }

  if (req.method === "POST" && path === "/notification-channels/test") {
    const body = await readJson(req);
    const { data: channel } = await admin.from("notification_channels").select("id,organization_id,channel_type,config").eq("id", String(body.channel_id || "")).maybeSingle();
    if (!channel) return fail("Channel not found", 404);
    const { user } = await requirePermission(req, channel.organization_id, "notifications", "edit");
    const result = await deliver(channel, { kind: "test", severity: "info", title: "[TEST] Elite Network Intelligence notification", text: "This is a test notification. If you can read it, this channel works.",
      html: emailShell("Test notification", `${severityBadge("info", "test")}<h2 style="margin:0 0 10px;color:#fff;font-size:17px">Channel works</h2><p style="margin:0;color:#aebdd2">This is a test notification. If you can read it, this channel is wired up correctly.</p>${emailButton("Open the dashboard", APP_URL)}`) });
    await logDelivery(channel.organization_id, channel.id, null, "test", result);
    await audit(channel.organization_id, "user", user.id, "test_notification", "notification_channel", channel.id, { status: result.status });
    return json({ ok: result.status === "sent", ...result }, result.status === "failed" ? 502 : 200);
  }

  if (req.method === "GET" && path === "/reports/summary") {
    const organizationId = url.searchParams.get("organization_id") || "";
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
    await requirePermission(req, organizationId, "reports", "view");
    return json(await buildReport(organizationId, days));
  }

  if (req.method === "GET" && path === "/platform/status") {
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "platform", "view");
    const [{ data: overview, error }, { data: events }, { data: deliveries }] = await Promise.all([
      admin.rpc("platform_overview", { p_org: organizationId }),
      admin.from("platform_events").select("id,level,source,message,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(20),
      admin.from("notification_deliveries").select("status").eq("organization_id", organizationId).gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
    ]);
    if (error) return fail("Could not read platform status", 500);
    const tally: Record<string, number> = { sent: 0, failed: 0, skipped: 0 };
    for (const d of deliveries || []) tally[d.status] = (tally[d.status] || 0) + 1;
    return json({ ...overview, api_version: API_VERSION, latest_agent_version: LATEST_AGENT_VERSION, events: events || [], notifications_7d: tally, integrations: { email: Boolean(RESEND_API_KEY), telegram: Boolean(TELEGRAM_BOT_TOKEN) } });
  }

  // Lightweight member directory for assignment dropdowns (Assets/Tickets "assigned to").
  // Any workspace member can see who else is in the workspace to assign things to them -
  // this intentionally does not require the "team" permission, which only owners/admins have.
  if (req.method === "GET" && path === "/org/members") {
    const organizationId = url.searchParams.get("organization_id") || "";
    const { user } = await requireMember(req, organizationId, ["owner", "admin", "operator", "viewer", "custom"]);
    void user;
    const { data: rows, error } = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId);
    if (error) return fail("Could not load members", 500);
    const members: { user_id: string; email: string }[] = [];
    for (const r of rows || []) {
      const { data: u } = await admin.auth.admin.getUserById(r.user_id);
      if (u?.user?.email) members.push({ user_id: r.user_id, email: u.user.email });
    }
    members.sort((a, b) => a.email.localeCompare(b.email));
    return json({ members });
  }

  // ---- Assets (Snipe-IT style inventory) -----------------------------------------------------
  if (req.method === "GET" && path === "/assets") {
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "assets", "view");
    const { data, error } = await admin.from("assets").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
    if (error) return fail("Could not load assets", 500);
    return json({ assets: data || [] });
  }

  if (req.method === "POST" && path === "/assets") {
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "assets", "create");
    const assetTag = String(body.asset_tag || "").trim();
    const name = String(body.name || "").trim();
    if (!assetTag || !name) return fail("Asset tag and name are required");
    const row = {
      organization_id: organizationId, asset_tag: assetTag, name,
      category: String(body.category || "other"), status: String(body.status || "ready_to_deploy"),
      assigned_to: body.assigned_to ? String(body.assigned_to).trim() : null,
      assigned_user_id: body.assigned_user_id || null,
      device_id: body.device_id || null, site_id: body.site_id || null,
      location: body.location ? String(body.location).trim() : null,
      vendor: body.vendor ? String(body.vendor).trim() : null,
      serial_number: body.serial_number ? String(body.serial_number).trim() : null,
      purchase_date: body.purchase_date || null, warranty_expires: body.warranty_expires || null,
      notes: body.notes ? String(body.notes).trim() : null,
    };
    const { data, error } = await admin.from("assets").insert(row).select("*").single();
    if (error) return fail(error.code === "23505" ? "An asset with that tag already exists" : "Could not create asset", error.code === "23505" ? 409 : 500);
    await audit(organizationId, "user", user.id, "create_asset", "asset", data.id, { asset_tag: assetTag });
    return json({ ok: true, asset: data }, 201);
  }

  const assetIdMatch = path.match(new RegExp(`^/assets/${uuidPart}$`, "i"));
  if (req.method === "PUT" && assetIdMatch) {
    const assetId = assetIdMatch[1];
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "assets", "edit");
    const { data: existing } = await admin.from("assets").select("id").eq("id", assetId).eq("organization_id", organizationId).maybeSingle();
    if (!existing) return fail("Asset not found in this workspace", 404);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["asset_tag", "name", "category", "status", "assigned_to", "assigned_user_id", "device_id", "site_id", "location", "vendor", "serial_number", "purchase_date", "warranty_expires", "notes"]) {
      if (body[k] !== undefined) patch[k] = typeof body[k] === "string" ? body[k].trim() || null : body[k];
    }
    const { data, error } = await admin.from("assets").update(patch).eq("id", assetId).select("*").single();
    if (error) return fail(error.code === "23505" ? "An asset with that tag already exists" : "Could not update asset", error.code === "23505" ? 409 : 500);
    await audit(organizationId, "user", user.id, "update_asset", "asset", assetId, {});
    return json({ ok: true, asset: data });
  }

  if (req.method === "DELETE" && assetIdMatch) {
    const assetId = assetIdMatch[1];
    const organizationId = url.searchParams.get("organization_id") || "";
    const { user } = await requirePermission(req, organizationId, "assets", "delete");
    const { data: existing } = await admin.from("assets").select("id").eq("id", assetId).eq("organization_id", organizationId).maybeSingle();
    if (!existing) return fail("Asset not found in this workspace", 404);
    const { error } = await admin.from("assets").delete().eq("id", assetId);
    if (error) return fail("Could not delete asset", 500);
    await audit(organizationId, "user", user.id, "delete_asset", "asset", assetId, {});
    return json({ ok: true, asset_id: assetId });
  }

  // ---- Tickets (GLPI style helpdesk) ----------------------------------------------------------
  if (req.method === "GET" && path === "/tickets") {
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "tickets", "view");
    const { data, error } = await admin.from("tickets").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
    if (error) return fail("Could not load tickets", 500);
    return json({ tickets: data || [] });
  }

  if (req.method === "POST" && path === "/tickets") {
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "tickets", "create");
    const title = String(body.title || "").trim();
    if (!title) return fail("Title is required");
    const row = {
      organization_id: organizationId, title, description: body.description ? String(body.description).trim() : null,
      priority: String(body.priority || "medium"), requester_email: body.requester_email ? String(body.requester_email).trim() : null,
      device_id: body.device_id || null, assigned_user_id: body.assigned_user_id || null, created_by: user.id,
    };
    const { data, error } = await admin.from("tickets").insert(row).select("*").single();
    if (error) return fail("Could not create ticket", 500);
    await audit(organizationId, "user", user.id, "create_ticket", "ticket", data.id, { title });
    return json({ ok: true, ticket: data }, 201);
  }

  const ticketIdMatch = path.match(new RegExp(`^/tickets/${uuidPart}$`, "i"));
  if (req.method === "PUT" && ticketIdMatch) {
    const ticketId = ticketIdMatch[1];
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "tickets", "edit");
    const { data: existing } = await admin.from("tickets").select("id,status").eq("id", ticketId).eq("organization_id", organizationId).maybeSingle();
    if (!existing) return fail("Ticket not found in this workspace", 404);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["title", "description", "status", "priority", "requester_email", "assigned_user_id", "device_id"]) {
      if (body[k] !== undefined) patch[k] = typeof body[k] === "string" ? body[k].trim() || null : body[k];
    }
    if (patch.status === "resolved" && existing.status !== "resolved") patch.resolved_at = new Date().toISOString();
    if (patch.status && patch.status !== "resolved") patch.resolved_at = existing.status === "resolved" ? null : undefined;
    const { data, error } = await admin.from("tickets").update(patch).eq("id", ticketId).select("*").single();
    if (error) return fail("Could not update ticket", 500);
    await audit(organizationId, "user", user.id, "update_ticket", "ticket", ticketId, { status: body.status });
    return json({ ok: true, ticket: data });
  }

  if (req.method === "DELETE" && ticketIdMatch) {
    const ticketId = ticketIdMatch[1];
    const organizationId = url.searchParams.get("organization_id") || "";
    const { user } = await requirePermission(req, organizationId, "tickets", "delete");
    const { data: existing } = await admin.from("tickets").select("id").eq("id", ticketId).eq("organization_id", organizationId).maybeSingle();
    if (!existing) return fail("Ticket not found in this workspace", 404);
    const { error } = await admin.from("tickets").delete().eq("id", ticketId);
    if (error) return fail("Could not delete ticket", 500);
    await audit(organizationId, "user", user.id, "delete_ticket", "ticket", ticketId, {});
    return json({ ok: true, ticket_id: ticketId });
  }

  const ticketCommentsMatch = path.match(new RegExp(`^/tickets/${uuidPart}/comments$`, "i"));
  if (req.method === "GET" && ticketCommentsMatch) {
    const ticketId = ticketCommentsMatch[1];
    const organizationId = url.searchParams.get("organization_id") || "";
    await requirePermission(req, organizationId, "tickets", "view");
    const { data: ticket } = await admin.from("tickets").select("id").eq("id", ticketId).eq("organization_id", organizationId).maybeSingle();
    if (!ticket) return fail("Ticket not found in this workspace", 404);
    const { data, error } = await admin.from("ticket_comments").select("id,author_user_id,body,created_at").eq("ticket_id", ticketId).order("created_at");
    if (error) return fail("Could not load comments", 500);
    const authorIds = [...new Set((data || []).map((c: any) => c.author_user_id).filter(Boolean))];
    const emails = new Map<string, string>();
    if (authorIds.length) {
      const { data: members } = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).in("user_id", authorIds);
      for (const m of members || []) {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        if (u?.user?.email) emails.set(m.user_id, u.user.email);
      }
    }
    return json({ comments: (data || []).map((c: any) => ({ ...c, author_email: emails.get(c.author_user_id) || null })) });
  }

  if (req.method === "POST" && ticketCommentsMatch) {
    const ticketId = ticketCommentsMatch[1];
    const body = await readJson(req);
    const organizationId = String(body.organization_id || "");
    const { user } = await requirePermission(req, organizationId, "tickets", "edit");
    const bodyText = String(body.body || "").trim();
    if (!bodyText) return fail("Comment text is required");
    const { data: ticket } = await admin.from("tickets").select("id").eq("id", ticketId).eq("organization_id", organizationId).maybeSingle();
    if (!ticket) return fail("Ticket not found in this workspace", 404);
    const { data, error } = await admin.from("ticket_comments").insert({ ticket_id: ticketId, organization_id: organizationId, author_user_id: user.id, body: bodyText }).select("id,author_user_id,body,created_at").single();
    if (error) return fail("Could not add comment", 500);
    await admin.from("tickets").update({ updated_at: new Date().toISOString() }).eq("id", ticketId);
    return json({ ok: true, comment: { ...data, author_email: user.email || null } }, 201);
  }

  return fail("Route not found", 404);
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status);
    await platformEvent("error", "api", `Unhandled error: ${String((error as Error)?.message || error)}`);
    return fail("Unexpected server error", 500);
  }
});
