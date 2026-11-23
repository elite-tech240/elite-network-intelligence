import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { supabase, api, fmtBps, fmtUptime, ago, LATEST_AGENT_VERSION, SELF_UPDATE_FROM, versionAtLeast, publishedAgentVersion, type Role } from './lib';
import { Maximize2, Pencil, Trash2, MessageSquare, Boxes, UserCheck, Archive, CircleAlert, Clock, CheckCircle2 } from 'lucide-react';
import { LineChart, Sparkline, type Point } from './Chart';
import { Flash, confirmDialog, Skeleton, Select, toast, LongText, Modal, Drawer, EmptyState, useTable, Th, Pager, Counter } from './ui';
import { Plus } from 'lucide-react';

type Dev = { id: string; hostname: string; agent_version?: string | null };
type OrgMember = { user_id: string; email: string };
const isOp = (r: Role) => ['owner', 'admin', 'operator'].includes(r);
const isAdmin = (r: Role) => ['owner', 'admin'].includes(r);
// Shared assignee directory for Assets/Tickets "assigned to" dropdowns - any workspace member
// can see who else is in the workspace (no "team" permission required, see backend /org/members).
function useOrgMembers(organizationId: string, token: string): OrgMember[] {
  const [members, setMembers] = useState<OrgMember[]>([]);
  useEffect(() => {
    let alive = true;
    api<{ members: OrgMember[] }>(`/org/members?organization_id=${organizationId}`, token)
      .then(r => { if (alive) setMembers(r.members); })
      .catch(() => { /* non-fatal: assignee dropdowns just show fewer options */ });
    return () => { alive = false; };
  }, [organizationId, token]);
  return members;
}
const StatCard = ({ icon, tone, label, value }: { icon: ReactNode; tone: 'blue' | 'green' | 'purple' | 'orange'; label: string; value: number }) =>
  <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong><Counter value={value}/></strong></div>;
const useTick = (fn: () => void, ms: number, deps: unknown[]) => {
  useEffect(() => { fn(); const t = window.setInterval(fn, ms); return () => window.clearInterval(t); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
};
const Tabs = ({ items, active, onChange }: { items: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) =>
  <div className="page-tabs" role="tablist">{items.map(v => <button key={v.id} type="button" role="tab" aria-selected={active === v.id} className={active === v.id ? 'page-tab active' : 'page-tab'} onClick={() => onChange(v.id)}>{v.label}</button>)}</div>;
const Sev = ({ level }: { level: string }) => <span className={`sev sev-${level}`}>{level.replace('_', ' ')}</span>;
const Empty = ({ cols, text }: { cols: number; text: string }) => <tr><td colSpan={cols} className="empty">{text}</td></tr>;

/* ------------------------------------------------------------------ Logs */
export function LogsPage({ organizationId, devices }: { organizationId: string; devices: Dev[] }) {
  const [rows, setRows] = useState<any[]>([]); const [device, setDevice] = useState('all'); const [level, setLevel] = useState('all');
  const [range, setRange] = useState('24'); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!supabase) return;
    let query = supabase.from('device_logs').select('id,device_id,source,level,event_id,provider,message,logged_at').eq('organization_id', organizationId)
      .gte('logged_at', new Date(Date.now() - Number(range) * 3600000).toISOString()).order('logged_at', { ascending: false }).limit(300);
    if (device !== 'all') query = query.eq('device_id', device);
    if (level !== 'all') query = query.eq('level', level);
    if (q.trim()) query = query.ilike('message', `%${q.trim().replace(/[%,]/g, '')}%`);
    const { data, error } = await query; if (error) setErr(error.message); else { setErr(''); setRows(data ?? []); }
  }, [organizationId, device, level, range, q]);
  useTick(() => { void load(); }, 1000, [load]);
  const name = (id: string) => devices.find(d => d.id === id)?.hostname ?? id.slice(0, 8);
  const t = useTable(rows, (r, k) => k === 'logged_at' ? new Date(r.logged_at).getTime() : k === 'device' ? name(r.device_id) : (r as any)[k]);
  return <div className="sites-workspace">
    <section className="panel page-panel"><div className="panel-head"><div><h3>Device logs</h3><p>Warnings, errors and failed sign-ins collected read-only from each device (kept 30 days).</p></div></div>
      <div className="filter-bar">
        <Select className="filter-select" value={device} onChange={e => setDevice(e.target.value)}><option value="all">All devices</option>{devices.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}</Select>
        <Select className="filter-select" value={level} onChange={e => setLevel(e.target.value)}><option value="all">All levels</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="audit_failure">Failed sign-in</option><option value="info">Info</option></Select>
        <Select className="filter-select" value={range} onChange={e => setRange(e.target.value)}><option value="1">Last hour</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option><option value="720">Last 30 days</option></Select>
        <input className="filter-input" placeholder="Search message…" value={q} onChange={e => setQ(e.target.value)}/>
        <button className="secondary-action" onClick={() => {
          const csv = ['time,device,level,source,event_id,message', ...rows.map(r => [r.logged_at, name(r.device_id), r.level, r.source, r.event_id ?? '', '"' + String(r.message).replace(/"/g, '""').replace(/\n/g, ' ') + '"'].join(','))].join('\n');
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'device-logs.csv'; a.click(); URL.revokeObjectURL(a.href);
        }} disabled={!rows.length}>Export CSV</button>
      </div>
      <Flash kind="error" msg={err}/>
      <div className="table-wrap"><table><thead><tr><Th t={t} k="logged_at">TIME</Th><Th t={t} k="device">DEVICE</Th><Th t={t} k="level">LEVEL</Th><Th t={t} k="source">SOURCE</Th><th>MESSAGE</th></tr></thead><tbody>
        {t.rows.map(r => <tr key={r.id}><td>{new Date(r.logged_at).toLocaleString()}</td><td>{name(r.device_id)}</td><td><Sev level={r.level}/></td><td>{r.source}{r.event_id ? ` · ${r.event_id}` : ''}</td><td className="wrap-cell"><LongText text={r.message}/></td></tr>)}
        {!t.rows.length && <Empty cols={5} text="No logs match. Logs appear once an agent v0.4.0+ is installed and reports warnings or errors."/>}
      </tbody></table></div><Pager t={t}/></section></div>;
}

/* ---------------------------------------------------------------- Uptime */
export function UptimePage({ organizationId, role, token, sites }: { organizationId: string; role: Role; token: string; sites: { id: string; name: string }[] }) {
  const [checks, setChecks] = useState<any[]>([]); const [spark, setSpark] = useState<Record<string, (number | null)[]>>({}); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState(''), [type, setType] = useState('http'), [target, setTarget] = useState('https://'), [port, setPort] = useState('443'), [interval, setIntervalS] = useState('300'), [busy, setBusy] = useState('');
  const [matchText, setMatchText] = useState(''), [jsonPath, setJsonPath] = useState(''), [jsonExpected, setJsonExpected] = useState(''), [sslWarnDays, setSslWarnDays] = useState('14'), [latencyMs, setLatencyMs] = useState('');
  const urlTypes = ['http', 'keyword', 'json', 'ssl'];
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('uptime_checks').select('*').eq('organization_id', organizationId).order('name'); setChecks(data ?? []);
    const { data: res } = await supabase.from('uptime_results').select('check_id,latency_ms,status').eq('organization_id', organizationId).gte('checked_at', new Date(Date.now() - 24 * 3600000).toISOString()).order('checked_at').limit(2000);
    const map: Record<string, (number | null)[]> = {}; (res ?? []).forEach((r: any) => { (map[r.check_id] ||= []).push(r.status === 'up' ? r.latency_ms : null); }); setSpark(map);
  }, [organizationId]);
  useTick(() => void load(), 20000, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!supabase) return; setBusy('add'); setErr(''); setMsg('');
    const row: any = { organization_id: organizationId, name: name.trim(), check_type: type, target: target.trim(), interval_seconds: Number(interval), timeout_ms: 5000, site_id: sites[0]?.id ?? null };
    if (type === 'tcp') row.port = Number(port);
    if (type === 'keyword') row.match_text = matchText.trim();
    if (type === 'json') { row.json_path = jsonPath.trim(); row.json_expected = jsonExpected.trim(); }
    if (type === 'ssl') row.ssl_warn_days = Number(sslWarnDays) || 14;
    if (latencyMs.trim()) row.latency_alert_ms = Number(latencyMs);
    const { error } = await supabase.from('uptime_checks').insert(row); setBusy('');
    if (error) setErr(error.message); else { setMsg('Check created. First result arrives within a minute.'); setName(''); setShowAdd(false); void load(); }
  };
  const run = async (id: string) => { setBusy(id); setErr(''); try { const r = await api('/uptime-checks/run', token, { method: 'POST', body: { check_id: id } }); setMsg(r.status === 'up' ? `Up · ${r.latency_ms} ms` : `Down · ${r.error}`); void load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const toggle = async (c: any) => { await supabase?.from('uptime_checks').update({ enabled: !c.enabled }).eq('id', c.id); void load(); };
  const del = async (c: any) => { if (!await confirmDialog(`Delete check "${c.name}"?`)) return; await supabase?.from('uptime_checks').delete().eq('id', c.id); void load(); };
  const t = useTable(checks, (c, k) => k === 'target' ? c.check_type + ' ' + c.target : k === 'last_checked_at' ? (c.last_checked_at ? new Date(c.last_checked_at).getTime() : 0) : (c as any)[k]);
  return <div className="sites-workspace">
    <Flash kind="success" msg={msg}/><Flash kind="error" msg={err}/>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Uptime checks</h3><p>Availability of websites and services, last 24 hours of latency.</p></div>{isOp(role) && <button className="primary-action" onClick={() => setShowAdd(true)}><Plus size={15}/>Add check</button>}</div>
      <div className="table-wrap"><table><thead><tr><Th t={t} k="name">CHECK</Th><Th t={t} k="target">TARGET</Th><Th t={t} k="status">STATUS</Th><th>LATENCY (24H)</th><Th t={t} k="last_checked_at">LAST RUN</Th><th></th></tr></thead><tbody>
        {t.rows.map(c => <tr key={c.id}><td><b>{c.name}</b>{!c.enabled && <span className="muted"> · paused</span>}</td><td>{c.check_type.toUpperCase()} {c.target}{c.port ? ':' + c.port : ''}</td>
          <td><span className={`status-pill ${c.status === 'up' ? 'online' : c.status === 'down' ? 'offline' : 'pending'}`}><i/>{c.status}</span></td>
          <td className="spark-cell"><Sparkline values={spark[c.id] ?? []}/></td><td>{ago(c.last_checked_at)}</td>
          <td>{isOp(role) && <div className="row-actions"><button className="secondary-action" disabled={busy === c.id} onClick={() => run(c.id)}>Run now</button><button className="secondary-action" onClick={() => toggle(c)}>{c.enabled ? 'Pause' : 'Resume'}</button><button className="danger-action" onClick={() => del(c)}>Delete</button></div>}</td></tr>)}
        {!t.rows.length && <Empty cols={6} text="No uptime checks yet. Add one to start monitoring a website or service."/>}
      </tbody></table></div><Pager t={t}/></section>
    {showAdd && <Modal title="Add uptime check" onClose={() => setShowAdd(false)}><form className="asset-form" onSubmit={add}>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="Company website"/></label>
      <label>Type<Select value={type} onChange={e => { setType(e.target.value); setTarget(urlTypes.includes(e.target.value) ? 'https://' : ''); }}>
        <option value="http">HTTP(S) page</option><option value="keyword">Keyword on page</option><option value="json">JSON / API health</option>
        <option value="ssl">SSL certificate</option><option value="tcp">TCP port</option><option value="ping">Ping (reachability)</option><option value="dns">DNS resolves</option>
      </Select></label>
      <label className="span-2">{urlTypes.includes(type) ? 'URL' : 'Host'}<input value={target} onChange={e => setTarget(e.target.value)} required placeholder={urlTypes.includes(type) ? 'https://example.com' : 'mail.example.com'}/></label>
      <label>Check every<Select value={interval} onChange={e => setIntervalS(e.target.value)}><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="3600">1 hour</option></Select></label>
      {type === 'tcp' && <label>Port<input type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} required/></label>}
      {type === 'keyword' && <label className="span-2">Text that must appear on the page<input value={matchText} onChange={e => setMatchText(e.target.value)} required placeholder="e.g. Add to cart"/></label>}
      {type === 'json' && <><label>JSON field (dot path)<input value={jsonPath} onChange={e => setJsonPath(e.target.value)} required placeholder="status"/></label><label>Expected value<input value={jsonExpected} onChange={e => setJsonExpected(e.target.value)} required placeholder="ok"/></label></>}
      {type === 'ssl' && <label>Warn when expiring within (days)<input type="number" min="1" max="365" value={sslWarnDays} onChange={e => setSslWarnDays(e.target.value)}/></label>}
      <label>Alert if slower than (ms, optional)<input type="number" min="50" max="60000" value={latencyMs} onChange={e => setLatencyMs(e.target.value)} placeholder="e.g. 2000"/></label>
      <p className="muted form-note span-2">Checks run from the cloud, so only public internet targets are allowed (private/local addresses are blocked). A check turns “down” after 2 failures in a row.</p>
      <div className="modal-actions span-2"><button type="button" className="secondary-action" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-action" disabled={busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Create check'}</button></div>
    </form></Modal>}</div>;
}

/* --------------------------------------------------------------- Reports */
export function ReportsPage({ organizationId, token }: { organizationId: string; token: string }) {
  const [days, setDays] = useState(7); const [r, setR] = useState<any>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { let on = true; setLoading(true); setErr(''); api(`/reports/summary?organization_id=${organizationId}&days=${days}`, token).then(d => on && setR(d)).catch(e => on && setErr(e.message)).finally(() => on && setLoading(false)); return () => { on = false; }; }, [organizationId, days, token]);
  const dt = useTable(r?.devices ?? [], (d: any, k) => (d as any)[k]);
  return <div className="sites-workspace report-page">
    <div className="tabs-row no-print"><p className="muted">Availability, usage and incidents for the selected period.</p><div className="sites-actions"><Select className="filter-select" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select><button className="primary-action" onClick={() => window.print()} disabled={!r}>Print / Save as PDF</button></div></div>
    <Flash kind="error" msg={err}/>{loading && <Skeleton rows={4}/>}
    {r && <>
      <section className="panel page-panel"><div className="panel-head"><div><h3>Devices</h3><p>{r.period.from.slice(0, 10)} → {r.period.to.slice(0, 10)}</p></div></div><div className="table-wrap"><table><thead><tr><Th t={dt} k="hostname">DEVICE</Th><Th t={dt} k="availability_percent">AVAILABILITY</Th><Th t={dt} k="cpu_avg">CPU AVG</Th><Th t={dt} k="memory_avg">MEMORY AVG</Th><Th t={dt} k="disk_max">DISK MAX</Th><Th t={dt} k="net_recv_bps_avg">AVG DOWNLOAD</Th><Th t={dt} k="net_sent_bps_avg">AVG UPLOAD</Th></tr></thead><tbody>
        {dt.rows.map((d: any) => <tr key={d.id ?? d.hostname}><td><b>{d.hostname}</b></td><td>{d.availability_percent}%</td><td>{d.cpu_avg ?? '—'}%</td><td>{d.memory_avg ?? '—'}%</td><td>{d.disk_max ?? '—'}%</td><td>{fmtBps(d.net_recv_bps_avg)}</td><td>{fmtBps(d.net_sent_bps_avg)}</td></tr>)}
        {!dt.rows.length && <Empty cols={7} text="No devices."/>}</tbody></table></div><Pager t={dt}/></section>
      <div className="two-col">
        <section className="panel page-panel"><div className="panel-head"><div><h3>Alerts</h3><p>{r.alerts.total} in period · {r.alerts.open} open now</p></div></div><div className="table-wrap"><table><tbody>{(r.alerts.top ?? []).map((t: any) => <tr key={t.title}><td className="wrap-cell"><LongText text={t.title}/></td><td><b>{t.count}</b></td></tr>)}{!r.alerts.top?.length && <Empty cols={2} text="No alerts in this period."/>}</tbody></table></div></section>
        <section className="panel page-panel"><div className="panel-head"><div><h3>Uptime checks</h3><p>Websites and services</p></div></div><div className="table-wrap"><table><tbody>{(r.uptime_checks ?? []).map((c: any) => <tr key={c.name}><td>{c.name}</td><td><b>{c.availability_percent ?? '—'}%</b></td><td>{c.avg_latency_ms ? Math.round(c.avg_latency_ms) + ' ms' : ''}</td></tr>)}{!r.uptime_checks?.length && <Empty cols={3} text="No uptime checks."/>}</tbody></table></div></section>
      </div>
      {r.logs && <p className="muted">Logs in period: {Object.entries(r.logs).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
    </>}</div>;
}

/* ----------------------------------------------------------------- Audit */
export function AuditPage({ organizationId }: { organizationId: string }) {
  const [rows, setRows] = useState<any[]>([]); const [action, setAction] = useState('all');
  const load = useCallback(async () => { if (!supabase) return; let q = supabase.from('audit_logs').select('id,actor_type,actor_user_id,action,resource_type,resource_id,outcome,details,occurred_at').eq('organization_id', organizationId).order('occurred_at', { ascending: false }).limit(200); if (action !== 'all') q = q.eq('resource_type', action); const { data } = await q; setRows(data ?? []); }, [organizationId, action]);
  useTick(() => void load(), 20000, [load]);
  const t = useTable(rows, (r, k) => k === 'occurred_at' ? new Date(r.occurred_at).getTime() : k === 'actor' ? (r.actor_type + (r.actor_user_id ? ' ' + r.actor_user_id : '')) : (r as any)[k]);
  return <div className="sites-workspace"><section className="panel page-panel"><div className="panel-head"><div><h3>Audit log</h3><p>Who changed what. Entries cannot be edited.</p></div><Select className="filter-select" value={action} onChange={e => setAction(e.target.value)}><option value="all">Everything</option><option value="device">Devices</option><option value="enrollment_token">Enrollment tokens</option><option value="alert_rules">Alert rules</option><option value="uptime_checks">Uptime checks</option><option value="notification_channels">Notification channels</option><option value="organization_member">Team</option></Select></div>
    <div className="table-wrap"><table><thead><tr><Th t={t} k="occurred_at">WHEN</Th><Th t={t} k="actor">ACTOR</Th><Th t={t} k="action">ACTION</Th><Th t={t} k="resource_type">RESOURCE</Th><Th t={t} k="outcome">RESULT</Th><th>DETAILS</th></tr></thead><tbody>
      {t.rows.map(r => <tr key={r.id}><td>{new Date(r.occurred_at).toLocaleString()}</td><td>{r.actor_type}{r.actor_user_id ? ' · ' + String(r.actor_user_id).slice(0, 8) : ''}</td><td><b>{r.action}</b></td><td>{r.resource_type}</td><td>{r.outcome}</td><td className="wrap-cell muted">{r.details && Object.keys(r.details).length ? JSON.stringify(r.details).slice(0, 140) : ''}</td></tr>)}
      {!t.rows.length && <Empty cols={6} text="No audit entries yet."/>}</tbody></table></div><Pager t={t}/></section></div>;
}

/* -------------------------------------------------------------- Platform */
export function PlatformPage({ organizationId, token }: { organizationId: string; token: string }) {
  const [s, setS] = useState<any>(null); const [err, setErr] = useState('');
  useTick(() => { api(`/platform/status?organization_id=${organizationId}`, token).then(setS).catch(e => setErr(e.message)); }, 30000, [organizationId, token]);
  const tick = s?.last_tick; const tickAge = tick?.updated_at ? (Date.now() - new Date(tick.updated_at).getTime()) / 1000 : null;
  const healthy = tickAge != null && tickAge < 180;
  const Row = ({ k, v, ok }: { k: string; v: React.ReactNode; ok?: boolean }) => <div className="setting-row"><span>{k}</span><b className={ok === undefined ? '' : ok ? 'txt-good' : 'txt-bad'}>{v}</b></div>;
  const et = useTable(s?.events ?? [], (e: any, k) => k === 'created_at' ? new Date(e.created_at).getTime() : (e as any)[k]);
  return <div className="sites-workspace"><Flash kind="error" msg={err}/>
    {s && <div className="two-col">
      <section className="panel settings-card"><h3>Monitoring engine</h3><p>Background jobs run every minute.</p>
        <Row k="Scheduler" v={healthy ? 'Running' : 'Stalled'} ok={healthy}/><Row k="Last run" v={tickAge == null ? 'never' : ago(tick.updated_at)}/><Row k="Last run duration" v={tick?.value?.duration_ms != null ? tick.value.duration_ms + ' ms' : '—'}/>
        <Row k="Last run errors" v={tick?.value?.errors?.length ? tick.value.errors.join('; ') : 'None'} ok={!tick?.value?.errors?.length}/><Row k="API version" v={s.api_version}/><Row k="Latest agent version" v={s.latest_agent_version}/></section>
      <section className="panel settings-card"><h3>Integrations & data</h3><p>What is connected and how much is stored.</p>
        <Row k="Email (Resend)" v={s.integrations?.email ? 'Configured' : 'Not configured'} ok={!!s.integrations?.email}/><Row k="Telegram" v={s.integrations?.telegram ? 'Configured' : 'Not configured'} ok={!!s.integrations?.telegram}/>
        <Row k="Notifications (7 days)" v={`${s.notifications_7d?.sent ?? 0} sent · ${s.notifications_7d?.failed ?? 0} failed · ${s.notifications_7d?.skipped ?? 0} skipped`}/>
        {s.database_size_mb != null && <Row k="Database size" v={Number(s.database_size_mb).toFixed(1) + ' MB'}/>}
        {s.tables && Object.entries(s.tables).map(([k, v]) => <Row key={k} k={`Rows · ${k}`} v={Number(v).toLocaleString()}/>)}</section></div>}
    {s && <section className="panel page-panel"><div className="panel-head"><div><h3>Platform events</h3><p>Errors raised by the monitoring service itself.</p></div></div><div className="table-wrap"><table><thead><tr><Th t={et} k="created_at">TIME</Th><Th t={et} k="level">LEVEL</Th><Th t={et} k="source">SOURCE</Th><th>MESSAGE</th></tr></thead><tbody>{et.rows.map((e: any) => <tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td><Sev level={e.level === 'error' ? 'error' : e.level}/></td><td>{e.source}</td><td className="wrap-cell"><LongText text={e.message}/></td></tr>)}{!et.rows.length && <Empty cols={4} text="No platform errors. All good."/>}</tbody></table></div><Pager t={et}/></section>}
  </div>;
}

/* ------------------------------------------- Notification channels + maintenance (Settings tabs) */
export function ChannelsPanel({ organizationId, role, token }: { organizationId: string; role: Role; token: string }) {
  const [rows, setRows] = useState<any[]>([]); const [deliveries, setDeliveries] = useState<any[]>([]); const [name, setName] = useState(''), [type, setType] = useState('email'), [dest, setDest] = useState(''), [sev, setSev] = useState('warning'), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const load = useCallback(async () => { if (!supabase) return; const [a, b] = await Promise.all([supabase.from('notification_channels').select('id,name,channel_type,config,min_severity,enabled').eq('organization_id', organizationId).order('created_at'), supabase.from('notification_deliveries').select('id,channel_id,kind,status,detail,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(15)]); setRows(a.data ?? []); setDeliveries(b.data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  if (!isAdmin(role)) return <section className="panel settings-card"><p className="muted">Only owners and admins can manage notification channels.</p></section>;
  const add = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setErr(''); setMsg(''); const config = type === 'email' ? { to: dest.trim() } : type === 'telegram' ? { chat_id: dest.trim() } : { url: dest.trim() }; const { error } = await supabase.from('notification_channels').insert({ organization_id: organizationId, name: name.trim(), channel_type: type, config, min_severity: sev, enabled: true }); if (error) setErr(error.message); else { setName(''); setDest(''); setMsg('Channel added. Press “Send test” to confirm it works.'); setShowAdd(false); void load(); } };
  const test = async (id: string) => { setBusy(id); setErr(''); setMsg(''); try { const r = await api('/notification-channels/test', token, { method: 'POST', body: { channel_id: id } }); setMsg(r.ok ? 'Test notification sent.' : 'Not sent: ' + r.detail); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); void load(); } };
  const del = async (id: string) => { if (await confirmDialog('Delete this channel?')) { await supabase?.from('notification_channels').delete().eq('id', id); void load(); } };
  const flip = async (c: any) => { await supabase?.from('notification_channels').update({ enabled: !c.enabled }).eq('id', c.id); void load(); };
  const shown = (c: any) => c.channel_type === 'email' ? c.config?.to : c.channel_type === 'telegram' ? 'chat ' + c.config?.chat_id : (() => { try { return new URL(c.config?.url).host; } catch { return 'webhook'; } })();
  const t = useTable(rows, (c, k) => k === 'destination' ? shown(c) : k === 'channel_type' ? c.channel_type : (c as any)[k]);
  return <div className="sites-workspace"><Flash kind="success" msg={msg}/><Flash kind="error" msg={err}/>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Notification channels</h3><p>Where alerts get sent.</p></div><button className="primary-action" onClick={() => setShowAdd(true)}><Plus size={15}/>Add channel</button></div>
      <div className="table-wrap"><table><thead><tr><Th t={t} k="name">CHANNEL</Th><Th t={t} k="channel_type">TYPE</Th><Th t={t} k="destination">DESTINATION</Th><Th t={t} k="min_severity">MIN. SEVERITY</Th><th></th></tr></thead><tbody>
      {t.rows.map(c => <tr key={c.id}><td><b>{c.name}</b>{!c.enabled && <span className="muted"> · off</span>}</td><td>{c.channel_type}</td><td>{shown(c)}</td><td>{c.min_severity}</td><td><div className="row-actions"><button className="secondary-action" disabled={busy === c.id} onClick={() => test(c.id)}>Send test</button><button className="secondary-action" onClick={() => flip(c)}>{c.enabled ? 'Turn off' : 'Turn on'}</button><button className="danger-action" onClick={() => del(c.id)}>Delete</button></div></td></tr>)}
      {!t.rows.length && <Empty cols={5} text="No channels yet. Without one, alerts only appear in the dashboard."/>}</tbody></table></div><Pager t={t}/></section>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Recent deliveries</h3></div></div><div className="table-wrap"><table><tbody>{deliveries.map(d => <tr key={d.id}><td>{new Date(d.created_at).toLocaleString()}</td><td>{d.kind}</td><td><span className={`status-pill ${d.status === 'sent' ? 'online' : d.status === 'failed' ? 'offline' : 'pending'}`}><i/>{d.status}</span></td><td className="wrap-cell muted"><LongText text={d.detail}/></td></tr>)}{!deliveries.length && <Empty cols={4} text="Nothing sent yet."/>}</tbody></table></div></section>
    {showAdd && <Modal title="Add notification channel" onClose={() => setShowAdd(false)}><form className="asset-form" onSubmit={add}>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} placeholder="IT team"/></label>
      <label>Type<Select value={type} onChange={e => { setType(e.target.value); setDest(''); }}><option value="email">Email</option><option value="telegram">Telegram</option><option value="webhook">Webhook (Slack, Teams, etc.)</option></Select></label>
      <label>{type === 'email' ? 'Email address' : type === 'telegram' ? 'Telegram chat ID' : 'HTTPS webhook URL'}<input value={dest} onChange={e => setDest(e.target.value)} required placeholder={type === 'email' ? 'it@company.com' : type === 'telegram' ? '123456789' : 'https://hooks.example.com/…'}/></label>
      <label>Send alerts from<Select value={sev} onChange={e => setSev(e.target.value)}><option value="info">Everything</option><option value="warning">Warning and above</option><option value="critical">Critical only</option></Select></label>
      <p className="muted form-note span-2">Email needs RESEND_API_KEY and Telegram needs TELEGRAM_BOT_TOKEN set on the server; until then sends show as “skipped”. Weekly reports go to email channels on Mondays.</p>
      <div className="modal-actions span-2"><button type="button" className="secondary-action" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-action">Add channel</button></div>
    </form></Modal>}</div>;
}

export function MaintenancePanel({ organizationId, role }: { organizationId: string; role: Role }) {
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState('Planned maintenance'); const [mins, setMins] = useState('60'); const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const load = useCallback(async () => { const { data } = await (supabase?.from('maintenance_windows').select('id,name,starts_at,ends_at').eq('organization_id', organizationId).order('starts_at', { ascending: false }).limit(20) ?? Promise.resolve({ data: [] })); setRows(data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  const start = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setErr(''); const now = Date.now(); const { error } = await supabase.from('maintenance_windows').insert({ organization_id: organizationId, name: name.trim(), starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + Number(mins) * 60000).toISOString() }); if (error) setErr(error.message); else { setShowAdd(false); void load(); } };
  const end = async (id: string) => { await supabase?.from('maintenance_windows').update({ ends_at: new Date().toISOString() }).eq('id', id); void load(); };
  const active = (w: any) => new Date(w.starts_at).getTime() <= Date.now() && new Date(w.ends_at).getTime() >= Date.now();
  const t = useTable(rows, (w, k) => (k === 'starts_at' || k === 'ends_at') ? new Date((w as any)[k]).getTime() : (w as any)[k]);
  return <div className="sites-workspace"><Flash kind="error" msg={err}/>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Maintenance windows</h3><p>Pause alerts and notifications during planned work.</p></div>{isOp(role) && <button className="primary-action" onClick={() => setShowAdd(true)}><Plus size={15}/>Start window</button>}</div>
      <div className="table-wrap"><table><thead><tr><Th t={t} k="name">WINDOW</Th><Th t={t} k="starts_at">FROM</Th><Th t={t} k="ends_at">UNTIL</Th><th></th></tr></thead><tbody>{t.rows.map(w => <tr key={w.id}><td><b>{w.name}</b> {active(w) && <span className="status-pill pending"><i/>active</span>}</td><td>{new Date(w.starts_at).toLocaleString()}</td><td>{new Date(w.ends_at).toLocaleString()}</td><td>{isOp(role) && active(w) && <button className="secondary-action" onClick={() => end(w.id)}>End now</button>}</td></tr>)}{!t.rows.length && <Empty cols={4} text="No maintenance windows."/>}</tbody></table></div><Pager t={t}/></section>
    {showAdd && <Modal title="Start a maintenance window" onClose={() => setShowAdd(false)}><form className="asset-form" onSubmit={start}>
      <label>Reason<input value={name} onChange={e => setName(e.target.value)} required maxLength={80}/></label>
      <label>For<Select value={mins} onChange={e => setMins(e.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="720">12 hours</option></Select></label>
      <p className="muted form-note span-2">While a window is active, new alerts and notifications are paused so planned work does not page anyone.</p>
      <div className="modal-actions span-2"><button type="button" className="secondary-action" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-action">Start now</button></div>
    </form></Modal>}</div>;
}

/* ------------------------------------------------- Discovery (Devices tab) */
export function DiscoveryPanel({ organizationId, role, sites }: { organizationId: string; role: Role; sites: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<any[]>([]); const [show, setShow] = useState('new');
  const load = useCallback(async () => { const { data } = await (supabase?.from('discovered_hosts').select('id,site_id,ip_address,mac_address,state,first_seen_at,last_seen_at,device_id').eq('organization_id', organizationId).order('first_seen_at', { ascending: false }).limit(300) ?? Promise.resolve({ data: [] })); setRows(data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  const set = async (id: string, state: string) => { await supabase?.from('discovered_hosts').update({ state }).eq('id', id); void load(); };
  const list = rows.filter(r => show === 'all' || r.state === show);
  const t = useTable(list, (r, k) => k === 'site' ? (sites.find(s => s.id === r.site_id)?.name ?? '') : (k === 'first_seen_at' || k === 'last_seen_at') ? new Date((r as any)[k]).getTime() : (r as any)[k]);
  return <section className="panel page-panel"><div className="panel-head"><div><h3>Discovered on your network</h3><p>Read from each agent's ARP table — nothing is scanned or probed. The first report from a site is treated as the baseline.</p></div><Select className="filter-select" value={show} onChange={e => setShow(e.target.value)}><option value="new">New</option><option value="known">Known</option><option value="ignored">Ignored</option><option value="all">All</option></Select></div>
    <div className="table-wrap"><table><thead><tr><Th t={t} k="ip_address">IP</Th><Th t={t} k="mac_address">MAC</Th><Th t={t} k="site">SITE</Th><Th t={t} k="first_seen_at">FIRST SEEN</Th><Th t={t} k="last_seen_at">LAST SEEN</Th><Th t={t} k="state">STATE</Th><th></th></tr></thead><tbody>
      {t.rows.map(r => <tr key={r.id}><td><b>{r.ip_address}</b></td><td><code>{r.mac_address}</code></td><td>{sites.find(s => s.id === r.site_id)?.name ?? '—'}</td><td>{new Date(r.first_seen_at).toLocaleString()}</td><td>{ago(r.last_seen_at)}</td><td><span className={`status-pill ${r.state === 'new' ? 'pending' : r.state === 'known' ? 'online' : 'offline'}`}><i/>{r.state}</span></td>
        <td>{isOp(role) && <div className="row-actions">{r.state !== 'known' && <button className="secondary-action" onClick={() => set(r.id, 'known')}>Mark known</button>}{r.state !== 'ignored' && <button className="secondary-action" onClick={() => set(r.id, 'ignored')}>Ignore</button>}</div>}</td></tr>)}
      {!t.rows.length && <Empty cols={7} text="Nothing here. Hosts appear once agents v0.4.0+ report."/>}</tbody></table></div><Pager t={t}/></section>;
}

/* ----------------------------------------- Device detail (charts + info) */
const RANGES: Record<string, { label: string; hours: number }> = { '1': { label: '1 hour', hours: 1 }, '24': { label: '24 hours', hours: 24 }, '168': { label: '7 days', hours: 168 }, '720': { label: '30 days', hours: 720 } };
export function DeviceDetail({ devices, initialId }: { devices: Dev[]; initialId?: string }) {
  const [id, setId] = useState(initialId ?? devices[0]?.id ?? ''); const [range, setRange] = useState('24'); const [pts, setPts] = useState<any[]>([]); const [latest, setLatest] = useState<any>(null); const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { if (!id && devices[0]) setId(devices[0].id); }, [devices, id]);
  const load = useCallback(async () => {
    if (!supabase || !id) return; const hours = RANGES[range].hours; const since = new Date(Date.now() - hours * 3600000).toISOString();
    if (hours <= 24) { const { data } = await supabase.from('device_metrics').select('recorded_at,cpu_percent,memory_percent,disk_percent,net_sent_bps,net_recv_bps').eq('device_id', id).gte('recorded_at', since).order('recorded_at', { ascending: false }).limit(3000); setPts([...(data ?? [])].reverse().map((r: any) => ({ t: new Date(r.recorded_at).getTime(), cpu: r.cpu_percent, mem: r.memory_percent, disk: r.disk_percent, up: r.net_sent_bps, down: r.net_recv_bps }))); }
    else { const { data } = await supabase.from('device_metrics_hourly').select('bucket,cpu_avg,memory_avg,disk_avg,net_sent_bps_avg,net_recv_bps_avg').eq('device_id', id).gte('bucket', since).order('bucket').limit(1000); setPts((data ?? []).map((r: any) => ({ t: new Date(r.bucket).getTime(), cpu: r.cpu_avg, mem: r.memory_avg, disk: r.disk_avg, up: r.net_sent_bps_avg, down: r.net_recv_bps_avg }))); }
    const { data: l } = await supabase.from('device_metrics').select('recorded_at,uptime_seconds,top_processes').eq('device_id', id).order('recorded_at', { ascending: false }).limit(1); setLatest(l?.[0] ?? null);
    const { data: lg } = await supabase.from('device_logs').select('id,level,message,logged_at').eq('device_id', id).order('logged_at', { ascending: false }).limit(6); setLogs(lg ?? []);
  }, [id, range]);
  useTick(() => void load(), 1000, [load]);
  // Append each new sample as it arrives, so the chart moves between refreshes.
  useEffect(() => {
    if (!supabase || !id || RANGES[range].hours > 24) return;
    const channel = supabase.channel('device-metrics-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'device_metrics', filter: 'device_id=eq.' + id },
        (payload: any) => {
          const r = payload.new;
          if (!r?.recorded_at) return;
          const cut = Date.now() - RANGES[range].hours * 3600000;
          setPts(prev => [...prev, { t: new Date(r.recorded_at).getTime(), cpu: r.cpu_percent, mem: r.memory_percent, disk: r.disk_percent, up: r.net_sent_bps, down: r.net_recv_bps }]
            .filter(p => p.t >= cut));
          setLatest((prev: any) => ({ ...(prev ?? {}), recorded_at: r.recorded_at, uptime_seconds: r.uptime_seconds ?? prev?.uptime_seconds, top_processes: r.top_processes ?? prev?.top_processes }));
        })
      .subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [id, range]);
  const dev = devices.find(d => d.id === id); const series = (k: string): Point[] => pts.map(p => ({ t: p.t, v: p[k] }));
  const [latestVersion, setLatestVersion] = useState(LATEST_AGENT_VERSION);
  const [upgrade, setUpgrade] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { void publishedAgentVersion().then(setLatestVersion); }, []);
  const loadUpgrade = useCallback(async () => {
    if (!supabase || !id) { setUpgrade(null); return; }
    const { data } = await supabase.from('pending_agent_commands').select('id,status,result,error,created_at')
      .eq('device_id', id).eq('command', 'upgrade').order('created_at', { ascending: false }).limit(1);
    setUpgrade(data?.[0] ?? null);
  }, [id]);
  useEffect(() => { void loadUpgrade(); }, [loadUpgrade]);
  useTick(() => void loadUpgrade(), 10000, [loadUpgrade]);
  // An agent that never reported its version is running something older than the published
  // build; one that did must be strictly older, not merely different - a dev/manual install can
  // legitimately be ahead of the published release and must not look "outdated".
  const outdated = !!dev && (!dev.agent_version || (dev.agent_version !== latestVersion && versionAtLeast(latestVersion, dev.agent_version)));
  // Older agents never learned the upgrade command, so queueing one would go nowhere.
  const canSelfUpdate = versionAtLeast(dev?.agent_version, SELF_UPDATE_FROM);
  const inFlight = upgrade && ['queued', 'delivered', 'running'].includes(upgrade.status);
  const startUpgrade = async () => {
    if (!supabase || !id) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('request_agent_upgrade', { p_device_id: id });
      if (error) throw error;
      toast(`Update to ${latestVersion} sent to ${dev?.hostname ?? 'the device'}`);
      await loadUpgrade();
    } catch (err: any) { toast(err?.message ?? 'Could not start the update'); }
    finally { setBusy(false); }
  };
  const pt = useTable(latest?.top_processes ?? [], (p: any, k) => (p as any)[k]);
  if (!devices.length) return <section className="panel empty-panel"><h3>No devices yet</h3><p>Enroll an agent to see charts here.</p></section>;
  return <div className="sites-workspace">
    <div className="filter-bar"><Select className="filter-select" value={id} onChange={e => setId(e.target.value)}>{devices.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}</Select>
      <Tabs items={Object.entries(RANGES).map(([k, v]) => ({ id: k, label: v.label }))} active={range} onChange={setRange}/></div>
    <div className="kpi-strip"><div className="panel mini-kpi"><span>Uptime</span><b>{fmtUptime(latest?.uptime_seconds)}</b></div><div className="panel mini-kpi"><span>Last report</span><b>{ago(latest?.recorded_at)}</b></div><div className="panel mini-kpi"><span>Agent</span><b>{dev?.agent_version ?? 'unknown'}</b>
      {inFlight
        ? <small className="txt-warn">{upgrade.status === 'running' ? `installing ${latestVersion}…` : `update queued (${latestVersion})`}</small>
        : outdated
          ? canSelfUpdate
            ? <><small className="txt-warn">update available ({latestVersion})</small><button className="primary-action sm agent-update" onClick={startUpgrade} disabled={busy}>{busy ? 'Sending…' : 'Update agent'}</button></>
            : <small className="txt-warn">{dev?.agent_version ? `on ${dev.agent_version}` : 'version unknown'} · run the installer once by hand to reach {SELF_UPDATE_FROM}, then updates happen from here</small>
          : upgrade?.status === 'failed'
            ? <small className="txt-bad">last update failed: {upgrade.error ?? 'unknown error'}</small>
            : <small className="txt-ok">up to date</small>}</div></div>
    <div className="two-col">
      <section className="panel chart-panel"><h3>CPU</h3><LineChart points={series('cpu')} max={100} unit="%"/></section>
      <section className="panel chart-panel"><h3>Memory</h3><LineChart points={series('mem')} max={100} unit="%" color="#4fa3ff"/></section>
      <section className="panel chart-panel"><h3>Disk</h3><LineChart points={series('disk')} max={100} unit="%" color="#e9a34e"/></section>
      <section className="panel chart-panel"><h3>Network (download)</h3><LineChart points={series('down')} format={fmtBps} color="#22a447"/><h3 className="sub-h">Network (upload)</h3><LineChart points={series('up')} format={fmtBps} color="#b48cff" height={80}/></section>
    </div>
    <div className="two-col">
      <section className="panel page-panel"><div className="panel-head"><div><h3>Top processes</h3><p>Latest sample · names only</p></div></div><div className="table-wrap"><table><thead><tr><Th t={pt} k="name">PROCESS</Th><Th t={pt} k="cpu">CPU</Th><Th t={pt} k="memory_mb">MEMORY</Th></tr></thead><tbody>{pt.rows.map((p: any, i: number) => <tr key={i}><td>{p.name}</td><td>{p.cpu}%</td><td>{p.memory_mb} MB</td></tr>)}{!pt.rows.length && <Empty cols={3} text="Needs agent v0.4.0+."/>}</tbody></table></div></section>
      <section className="panel page-panel"><div className="panel-head"><div><h3>Recent logs</h3></div></div><div className="table-wrap"><table><tbody>{logs.map(l => <tr key={l.id}><td><Sev level={l.level}/></td><td className="wrap-cell"><LongText text={l.message}/></td><td>{ago(l.logged_at)}</td></tr>)}{!logs.length && <Empty cols={3} text="No warnings or errors."/>}</tbody></table></div></section>
    </div></div>;
}

/* ---------------------------------------------------- NOC wall (full screen) */
export function NocWall({ devices, organizationId, onClose, embedded, onPresent }: { devices: { id: string; hostname: string; status: string; last_seen_at: string | null; ip_address?: string | null }[]; organizationId: string; onClose?: () => void; embedded?: boolean; onPresent?: () => void }) {
  const [filter, setFilter] = useState('all'); const [q, setQ] = useState('');
  const [alerts, setAlerts] = useState<any[]>([]); const [now, setNow] = useState(Date.now());
  useTick(() => { setNow(Date.now()); supabase?.from('alert_events').select('id,title,severity,triggered_at').eq('organization_id', organizationId).in('status', ['open', 'acknowledged']).order('triggered_at', { ascending: false }).limit(8).then(({ data }) => setAlerts(data ?? [])); }, 10000, [organizationId]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (embedded) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, embedded]);
  const state = (d: any) => !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 120000 ? 'offline' : d.status;
  const up = devices.filter(d => state(d) === 'online').length; const down = devices.length - up;
  const sorted = [...devices]
    .filter(d => (filter === 'all' || state(d) === filter) && (!q.trim() || d.hostname.toLowerCase().includes(q.trim().toLowerCase()) || (d.ip_address ?? '').includes(q.trim())))
    .sort((a, b) => Number(state(a) === 'online') - Number(state(b) === 'online') || a.hostname.localeCompare(b.hostname));
  const dense = devices.length > 24;
  const stats = <div className="noc2-stats"><div className="noc2-stat ok"><span>Online</span><strong>{up}</strong></div><div className={down ? 'noc2-stat bad' : 'noc2-stat'}><span>Offline</span><strong>{down}</strong></div><div className="noc2-stat"><span>Total devices</span><strong>{devices.length}</strong></div><div className={alerts.length ? 'noc2-stat warn' : 'noc2-stat'}><span>Open alerts</span><strong>{alerts.length}</strong></div></div>;
  const grid = <div className={dense ? 'noc2-grid dense' : 'noc2-grid'}>{sorted.map(d => <div key={d.id} className={`noc2-tile ${state(d)}`}><i/><div><b>{d.hostname}</b><small>{d.ip_address ?? state(d)}</small></div><span>{state(d)}</span></div>)}{!devices.length && <p className="muted">No devices enrolled yet.</p>}{devices.length > 0 && !sorted.length && <p className="muted">No device matches this filter.</p>}</div>;
  const alertList = alerts.length ? alerts.map(a => <div key={a.id} className={`noc2-alert sev-${a.severity}`}><b>{a.title}</b><small>{ago(a.triggered_at)}</small></div>) : <div className="noc2-clear">All clear</div>;
  if (embedded) return <div className="sites-workspace noc-page">
    {stats}
    <div className="filter-bar"><Tabs items={[{ id: 'all', label: `All (${devices.length})` }, { id: 'offline', label: `Offline (${down})` }, { id: 'online', label: `Online (${up})` }]} active={filter} onChange={setFilter}/>
      <input className="noc-search" placeholder="Search host or IP…" value={q} onChange={e => setQ(e.target.value)}/>
      <button className="secondary-action" onClick={onPresent}><Maximize2 size={15}/>Present fullscreen</button></div>
    <div className="two-col noc-split">
      <section className="panel page-panel"><div className="panel-head"><div><h3>Devices</h3><p>{devices.length ? `${up} online · ${down} offline` : 'Nothing enrolled yet'}</p></div></div><div className="noc-embed-grid">{grid}</div></section>
      <section className="panel page-panel"><div className="panel-head"><div><h3>Open alerts</h3><p>Needs a look</p></div></div><div className="noc-embed-alerts">{alertList}</div></section>
    </div></div>;
  return <div className="noc2" role="dialog" aria-label="NOC wall">
    <header className="noc2-head"><div className="noc2-brand"><img src="/elite-network-mark.svg" alt=""/><div><b>ELITE</b><span>NETWORK OPERATIONS CENTER</span></div></div>
      <div className="noc2-clock"><strong>{new Date(now).toLocaleTimeString()}</strong><span>{new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <button className="secondary-action" onClick={onClose}>Exit · Esc</button></header>
    {stats}
    <div className="noc2-body"><section><h2>Devices</h2>{grid}</section>
      <aside><h2>Open alerts</h2>{alertList}</aside></div>
  </div>;
}

/* ------------------------------------------------------------------ Assets */
const ASSET_CATEGORIES = [
  { value: 'laptop', label: 'Laptop' }, { value: 'desktop', label: 'Desktop' }, { value: 'monitor', label: 'Monitor' },
  { value: 'printer', label: 'Printer' }, { value: 'network_gear', label: 'Network gear' }, { value: 'mobile', label: 'Mobile' },
  { value: 'server', label: 'Server' }, { value: 'other', label: 'Other' },
];
// Snipe-IT's four fixed status types. "Deployed" is not one of them - it's a computed
// meta-status (see isCheckedOut below), shown whenever a "Ready to Deploy" asset actually
// has someone it's checked out to, exactly like Snipe-IT's own asset list.
const ASSET_STATUSES = [
  { value: 'ready_to_deploy', label: 'Ready to Deploy' }, { value: 'pending', label: 'Pending' },
  { value: 'undeployable', label: 'Undeployable' }, { value: 'archived', label: 'Archived' },
];
const isCheckedOut = (a: Pick<Asset, 'status' | 'assigned_user_id' | 'assigned_to'>) =>
  a.status === 'ready_to_deploy' && Boolean(a.assigned_user_id || a.assigned_to);
const assetStatusLabel = (a: Pick<Asset, 'status' | 'assigned_user_id' | 'assigned_to'>) =>
  isCheckedOut(a) ? 'Deployed' : ASSET_STATUSES.find(s => s.value === a.status)?.label ?? a.status;
type Asset = { id: string; asset_tag: string; name: string; category: string; status: string; assigned_to: string | null; assigned_user_id: string | null; device_id: string | null; site_id: string | null; location: string | null; vendor: string | null; serial_number: string | null; purchase_date: string | null; warranty_expires: string | null; notes: string | null };
export function AssetsPage({ organizationId, role, token, devices, sites }: { organizationId: string; role: Role; token: string; devices: Dev[]; sites: { id: string; name: string }[] }) {
  const members = useOrgMembers(organizationId, token);
  const [rows, setRows] = useState<Asset[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Asset | 'new' | null>(null); const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api<{ assets: Asset[] }>(`/assets?organization_id=${organizationId}`, token); setRows(r.assets); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load assets.'); }
    finally { setLoading(false); }
  }, [organizationId, token]);
  useEffect(() => { void load(); }, [load]);
  const save = async (values: Partial<Asset>, id?: string) => {
    setBusy(id || 'new'); setErr('');
    try {
      if (id) await api(`/assets/${id}`, token, { method: 'PUT', body: { organization_id: organizationId, ...values } });
      else await api('/assets', token, { method: 'POST', body: { organization_id: organizationId, ...values } });
      toast(id ? 'Asset updated' : 'Asset created'); setEditing(null); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save that asset.'); }
    finally { setBusy(''); }
  };
  const remove = async (a: Asset) => {
    if (!await confirmDialog(`Delete asset "${a.name}" (${a.asset_tag})?`, { confirmText: 'Delete', danger: true })) return;
    setBusy(a.id); setErr('');
    try { await api(`/assets/${a.id}?organization_id=${organizationId}`, token, { method: 'DELETE' }); toast('Asset deleted'); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete that asset.'); }
    finally { setBusy(''); }
  };
  // "Ready to Deploy" tab means truly unassigned-and-available; a deployable asset that's
  // actually checked out shows under the synthetic "deployed" tab instead (see isCheckedOut).
  const list = rows.filter(a => filter === 'all' || (filter === 'deployed' ? isCheckedOut(a) : filter === 'ready_to_deploy' ? a.status === 'ready_to_deploy' && !isCheckedOut(a) : a.status === filter));
  const t = useTable(list, (a, k) => k === 'device' ? (devices.find(d => d.id === a.device_id)?.hostname ?? '') : k === 'status' ? assetStatusLabel(a) : (a as any)[k]);
  const hostname = (id: string | null) => id ? (devices.find(d => d.id === id)?.hostname ?? '—') : '—';
  const memberEmail = (id: string | null) => id ? (members.find(m => m.user_id === id)?.email ?? '—') : null;
  const assigneeLabel = (a: Asset) => memberEmail(a.assigned_user_id) ?? a.assigned_to ?? '—';
  const expiring = (a: Asset) => a.warranty_expires && new Date(a.warranty_expires).getTime() - Date.now() < 30 * 86400000 && new Date(a.warranty_expires).getTime() > Date.now() - 86400000;
  const deployedCount = rows.filter(isCheckedOut).length;
  const readyCount = rows.filter(a => a.status === 'ready_to_deploy' && !isCheckedOut(a)).length;
  const pendingCount = rows.filter(a => a.status === 'pending').length;
  const archivedCount = rows.filter(a => a.status === 'archived').length;
  const tabs = [
    { id: 'all', label: `All (${rows.length})` },
    { id: 'ready_to_deploy', label: `Ready to Deploy (${readyCount})` },
    { id: 'deployed', label: `Deployed (${deployedCount})` },
    { id: 'pending', label: `Pending (${pendingCount})` },
    { id: 'undeployable', label: `Undeployable (${rows.filter(a => a.status === 'undeployable').length})` },
    { id: 'archived', label: `Archived (${archivedCount})` },
  ];
  return <div className="sites-workspace">
    <Flash kind="error" msg={err}/>
    <div className="stats-grid">
      <StatCard icon={<UserCheck size={15}/>} tone="green" label="Deployed" value={deployedCount}/>
      <StatCard icon={<Boxes size={15}/>} tone="blue" label="Ready to Deploy" value={readyCount}/>
      <StatCard icon={<Archive size={15}/>} tone="purple" label="Pending" value={pendingCount}/>
      <StatCard icon={<CircleAlert size={15}/>} tone="orange" label="Archived" value={archivedCount}/>
    </div>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Asset inventory</h3><p>{rows.length} asset{rows.length === 1 ? '' : 's'} · tags, warranty and who has what.</p></div>
      {isOp(role) && <button className="primary-action" onClick={() => setEditing('new')}><Plus size={15}/>Add asset</button>}</div>
      <div className="filter-bar"><Tabs items={tabs} active={filter} onChange={setFilter}/></div>
      {loading ? <Skeleton rows={3}/> : !t.rows.length ? <EmptyState icon={<Boxes size={22}/>} title="No assets yet" text="Add laptops, monitors, printers and other equipment to keep track of them."/> : <><div className="table-wrap"><table>
        <thead><tr><Th t={t} k="asset_tag">TAG</Th><Th t={t} k="name">NAME</Th><Th t={t} k="category">CATEGORY</Th><Th t={t} k="status">STATUS</Th><Th t={t} k="assigned_to">CHECKED OUT TO</Th><Th t={t} k="warranty_expires">WARRANTY</Th><th>ACTIONS</th></tr></thead>
        <tbody>{t.rows.map(a => <tr key={a.id}>
          <td><code>{a.asset_tag}</code></td>
          <td><b>{a.name}</b>{a.device_id && <div className="muted">linked: {hostname(a.device_id)}</div>}</td>
          <td>{ASSET_CATEGORIES.find(c => c.value === a.category)?.label ?? a.category}</td>
          <td><span className={`status-pill ${isCheckedOut(a) ? 'online' : a.status === 'archived' || a.status === 'undeployable' ? 'offline' : 'pending'}`}><i/>{assetStatusLabel(a)}</span></td>
          <td>{assigneeLabel(a)}</td>
          <td>{a.warranty_expires ? <span className={expiring(a) ? 'txt-warn' : ''}>{new Date(a.warranty_expires).toLocaleDateString()}</span> : '—'}</td>
          <td>{isOp(role) && <div className="row-actions"><button className="mini-icon" title="Edit" disabled={busy === a.id} onClick={() => setEditing(a)}><Pencil size={15}/></button><button className="mini-icon danger" title="Delete" disabled={busy === a.id} onClick={() => remove(a)}><Trash2 size={15}/></button></div>}</td>
        </tr>)}</tbody>
      </table></div><Pager t={t}/></>}
    </section>
    {editing && <AssetModal asset={editing === 'new' ? null : editing} devices={devices} sites={sites} members={members} busy={!!busy} onSave={values => save(values, editing === 'new' ? undefined : editing.id)} onClose={() => setEditing(null)}/>}
  </div>;
}
function AssetModal({ asset, devices, sites, members, busy, onSave, onClose }: { asset: Asset | null; devices: Dev[]; sites: { id: string; name: string }[]; members: OrgMember[]; busy: boolean; onSave: (v: Partial<Asset>) => void; onClose: () => void }) {
  const [v, setV] = useState<Partial<Asset>>(asset ?? { asset_tag: '', name: '', category: 'laptop', status: 'ready_to_deploy' });
  const set = (k: keyof Asset, val: any) => setV(prev => ({ ...prev, [k]: val }));
  return <Modal title={asset ? 'Edit asset' : 'Add asset'} subtitle={asset?.asset_tag} icon={<Boxes size={17}/>} onClose={onClose}>
    <form className="modal-form" onSubmit={e => { e.preventDefault(); onSave(v); }}>
      <label>Asset tag<input value={v.asset_tag ?? ''} onChange={e => set('asset_tag', e.target.value)} required maxLength={60} placeholder="LAP-0042"/></label>
      <label>Name<input value={v.name ?? ''} onChange={e => set('name', e.target.value)} required maxLength={120} placeholder="Dell Latitude 5440"/></label>
      <label>Category<Select value={v.category ?? 'laptop'} onChange={e => set('category', e.target.value)}>{ASSET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></label>
      <label>Status<Select value={v.status ?? 'ready_to_deploy'} onChange={e => set('status', e.target.value)}>{ASSET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select><small className="muted">Becomes "Deployed" automatically once checked out to someone below.</small></label>
      <label>Checked out to (user)<Select value={v.assigned_user_id ?? ''} onChange={e => set('assigned_user_id', e.target.value || null)}><option value="">Unassigned</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</Select></label>
      <label>Checked out to (free text) <em className="optional">Optional</em><input value={v.assigned_to ?? ''} onChange={e => set('assigned_to', e.target.value)} maxLength={120} placeholder="Outside contact, or leave blank"/></label>
      <label>Linked device <em className="optional">Optional</em><Select value={v.device_id ?? ''} onChange={e => set('device_id', e.target.value || null)}><option value="">None</option>{devices.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}</Select></label>
      <label>Site <em className="optional">Optional</em><Select value={v.site_id ?? ''} onChange={e => set('site_id', e.target.value || null)}><option value="">None</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
      <label>Location<input value={v.location ?? ''} onChange={e => set('location', e.target.value)} maxLength={120} placeholder="HQ · 2nd floor"/></label>
      <label>Vendor<input value={v.vendor ?? ''} onChange={e => set('vendor', e.target.value)} maxLength={120} placeholder="Dell"/></label>
      <label>Serial number<input value={v.serial_number ?? ''} onChange={e => set('serial_number', e.target.value)} maxLength={120}/></label>
      <label>Purchase date<input type="date" value={v.purchase_date ?? ''} onChange={e => set('purchase_date', e.target.value || null)}/></label>
      <label>Warranty expires<input type="date" value={v.warranty_expires ?? ''} onChange={e => set('warranty_expires', e.target.value || null)}/></label>
      <label className="span-2">Notes<input value={v.notes ?? ''} onChange={e => set('notes', e.target.value)} maxLength={500}/></label>
      <div className="modal-actions span-2"><button type="button" className="secondary-action" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-action" disabled={busy || !v.asset_tag?.trim() || !v.name?.trim()}>{busy ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}</button></div>
    </form>
  </Modal>;
}

/* ----------------------------------------------------------------- Tickets */
const TICKET_STATUSES = [
  { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' },
];
const TICKET_PRIORITIES = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' },
];
type Ticket = { id: string; number: number; title: string; description: string | null; status: string; priority: string; requester_email: string | null; device_id: string | null; assigned_user_id: string | null; created_at: string; updated_at: string; resolved_at: string | null };
export function TicketsPage({ organizationId, token, devices }: { organizationId: string; role: Role; token: string; devices: Dev[] }) {
  const members = useOrgMembers(organizationId, token);
  const [rows, setRows] = useState<Ticket[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [filter, setFilter] = useState('open'); const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api<{ tickets: Ticket[] }>(`/tickets?organization_id=${organizationId}`, token); setRows(r.tickets); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load tickets.'); }
    finally { setLoading(false); }
  }, [organizationId, token]);
  useTick(() => void load(), 20000, [load]);
  const create = async (values: Partial<Ticket>) => {
    try { await api('/tickets', token, { method: 'POST', body: { organization_id: organizationId, ...values } }); toast('Ticket created'); setCreating(false); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not create that ticket.'); }
  };
  const setStatus = async (t: Ticket, status: string) => {
    try { await api(`/tickets/${t.id}`, token, { method: 'PUT', body: { organization_id: organizationId, status } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not update that ticket.'); }
  };
  const setAssignee = async (t: Ticket, assignedUserId: string) => {
    try { await api(`/tickets/${t.id}`, token, { method: 'PUT', body: { organization_id: organizationId, assigned_user_id: assignedUserId || null } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not update that ticket.'); }
  };
  const list = rows.filter(t => filter === 'all' || t.status === filter);
  const t = useTable(list, (r, k) => (k === 'created_at' || k === 'updated_at') ? new Date((r as any)[k]).getTime() : (r as any)[k]);
  const hostname = (id: string | null) => id ? (devices.find(d => d.id === id)?.hostname ?? '—') : '—';
  const open = rows.find(r => r.id === openId) ?? null;
  const openCount = rows.filter(r => r.status === 'open').length;
  const inProgressCount = rows.filter(r => r.status === 'in_progress').length;
  const resolvedCount = rows.filter(r => r.status === 'resolved' || r.status === 'closed').length;
  const unassignedCount = rows.filter(r => !r.assigned_user_id && r.status !== 'resolved' && r.status !== 'closed').length;
  return <div className="sites-workspace">
    <Flash kind="error" msg={err}/>
    <div className="stats-grid">
      <StatCard icon={<Clock size={15}/>} tone="orange" label="Open" value={openCount}/>
      <StatCard icon={<MessageSquare size={15}/>} tone="blue" label="In progress" value={inProgressCount}/>
      <StatCard icon={<CheckCircle2 size={15}/>} tone="green" label="Resolved / closed" value={resolvedCount}/>
      <StatCard icon={<CircleAlert size={15}/>} tone="purple" label="Unassigned (open)" value={unassignedCount}/>
    </div>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Tickets</h3><p>{rows.filter(r => r.status === 'open').length} open · {rows.length} total</p></div>
      <button className="primary-action" onClick={() => setCreating(true)}><Plus size={15}/>New ticket</button></div>
      <div className="filter-bar"><Tabs items={[{ id: 'all', label: `All (${rows.length})` }, ...TICKET_STATUSES.map(s => ({ id: s.value, label: `${s.label} (${rows.filter(r => r.status === s.value).length})` }))]} active={filter} onChange={setFilter}/></div>
      {loading ? <Skeleton rows={3}/> : !t.rows.length ? <EmptyState icon={<MessageSquare size={22}/>} title="No tickets" text="Nothing matches this filter."/> : <><div className="table-wrap"><table>
        <thead><tr><th>#</th><Th t={t} k="title">TITLE</Th><Th t={t} k="priority">PRIORITY</Th><Th t={t} k="status">STATUS</Th><th>ASSIGNED TO</th><th>DEVICE</th><Th t={t} k="updated_at">UPDATED</Th></tr></thead>
        <tbody>{t.rows.map(r => <tr key={r.id} className="row-click" onClick={() => setOpenId(r.id)}>
          <td>#{r.number}</td><td><b>{r.title}</b></td>
          <td><span className={`sev sev-${r.priority === 'critical' ? 'critical' : r.priority === 'high' ? 'warning' : 'info'}`}>{TICKET_PRIORITIES.find(p => p.value === r.priority)?.label}</span></td>
          <td><span className={`status-pill ${r.status === 'open' ? 'pending' : r.status === 'resolved' || r.status === 'closed' ? 'online' : 'offline'}`}><i/>{TICKET_STATUSES.find(s => s.value === r.status)?.label}</span></td>
          <td onClick={e => e.stopPropagation()}><Select className="filter-select" value={r.assigned_user_id ?? ''} onChange={e => setAssignee(r, e.target.value)}><option value="">Unassigned</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</Select></td>
          <td>{hostname(r.device_id)}</td><td>{ago(r.updated_at)}</td>
        </tr>)}</tbody>
      </table></div><Pager t={t}/></>}
    </section>
    {creating && <TicketModal devices={devices} members={members} onSave={create} onClose={() => setCreating(false)}/>}
    {open && <TicketDrawer ticket={open} organizationId={organizationId} token={token} devices={devices} members={members} onStatus={s => setStatus(open, s)} onAssign={id => setAssignee(open, id)} onClose={() => { setOpenId(''); void load(); }}/>}
  </div>;
}
function TicketModal({ devices, members, onSave, onClose }: { devices: Dev[]; members: OrgMember[]; onSave: (v: Partial<Ticket>) => void; onClose: () => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [priority, setPriority] = useState('medium');
  const [requesterEmail, setRequesterEmail] = useState(''); const [deviceId, setDeviceId] = useState(''); const [assignedUserId, setAssignedUserId] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="New ticket" icon={<MessageSquare size={17}/>} onClose={onClose}>
    <form className="modal-form" onSubmit={async e => { e.preventDefault(); setBusy(true); await onSave({ title, description, priority, requester_email: requesterEmail || undefined, device_id: deviceId || undefined, assigned_user_id: assignedUserId || undefined }); setBusy(false); }}>
      <label className="span-2">Title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} placeholder="Printer on 2nd floor not working"/></label>
      <label className="span-2">Description<input value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="What's happening, since when…"/></label>
      <label>Priority<Select value={priority} onChange={e => setPriority(e.target.value)}>{TICKET_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></label>
      <label>Assigned to <em className="optional">Optional</em><Select value={assignedUserId} onChange={e => setAssignedUserId(e.target.value)}><option value="">Unassigned</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</Select></label>
      <label>Related device <em className="optional">Optional</em><Select value={deviceId} onChange={e => setDeviceId(e.target.value)}><option value="">None</option>{devices.map(d => <option key={d.id} value={d.id}>{d.hostname}</option>)}</Select></label>
      <label className="span-2">Requester email <em className="optional">Optional</em><input type="email" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)} placeholder="colleague@company.com"/></label>
      <div className="modal-actions span-2"><button type="button" className="secondary-action" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-action" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create ticket'}</button></div>
    </form>
  </Modal>;
}
function TicketDrawer({ ticket, organizationId, token, devices, members, onStatus, onAssign, onClose }: { ticket: Ticket; organizationId: string; token: string; devices: Dev[]; members: OrgMember[]; onStatus: (s: string) => void; onAssign: (userId: string) => void; onClose: () => void }) {
  const [comments, setComments] = useState<{ id: string; author_email: string | null; body: string; created_at: string }[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const r = await api<{ comments: typeof comments }>(`/tickets/${ticket.id}/comments?organization_id=${organizationId}`, token); setComments(r.comments); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load comments.'); }
  }, [ticket.id, organizationId, token]);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    if (!text.trim()) return; setBusy(true); setErr('');
    try { await api(`/tickets/${ticket.id}/comments`, token, { method: 'POST', body: { organization_id: organizationId, body: text.trim() } }); setText(''); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send that comment.'); }
    finally { setBusy(false); }
  };
  return <Drawer title={`#${ticket.number} · ${ticket.title}`} onClose={onClose}>
    <Flash kind="error" msg={err}/>
    <div className="ticket-meta">
      <Select className="filter-select" value={ticket.status} onChange={e => onStatus(e.target.value)}>{TICKET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
      <Select className="filter-select" value={ticket.assigned_user_id ?? ''} onChange={e => onAssign(e.target.value)}><option value="">Unassigned</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</Select>
      <span className={`sev sev-${ticket.priority === 'critical' ? 'critical' : ticket.priority === 'high' ? 'warning' : 'info'}`}>{TICKET_PRIORITIES.find(p => p.value === ticket.priority)?.label}</span>
      {ticket.device_id && <span className="muted">device: {devices.find(d => d.id === ticket.device_id)?.hostname ?? '—'}</span>}
    </div>
    {ticket.description && <p className="muted" style={{ lineHeight: 1.6 }}>{ticket.description}</p>}
    {ticket.requester_email && <p className="muted">Requested by {ticket.requester_email}</p>}
    <div className="settings-divider"/>
    <div className="ticket-comments">
      {comments.map(c => <div key={c.id} className="ticket-comment"><b>{c.author_email ?? 'Someone'}</b><small>{new Date(c.created_at).toLocaleString()}</small><p>{c.body}</p></div>)}
      {!comments.length && <p className="muted">No comments yet.</p>}
    </div>
    <div className="ticket-comment-form">
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Write an update…" onKeyDown={e => { if (e.key === 'Enter') send(); }}/>
      <button className="primary-action" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Reply'}</button>
    </div>
  </Drawer>;
}
