import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase, api, fmtBps, fmtUptime, ago, LATEST_AGENT_VERSION, SELF_UPDATE_FROM, versionAtLeast, publishedAgentVersion, type Role } from './lib';
import { Maximize2 } from 'lucide-react';
import { LineChart, Sparkline, type Point } from './Chart';
import { Flash, confirmDialog, Skeleton, Select, toast, LongText } from './ui';

type Dev = { id: string; hostname: string; agent_version?: string | null };
const isOp = (r: Role) => ['owner', 'admin', 'operator'].includes(r);
const isAdmin = (r: Role) => ['owner', 'admin'].includes(r);
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
  useTick(() => { void load(); }, 15000, [load]);
  const name = (id: string) => devices.find(d => d.id === id)?.hostname ?? id.slice(0, 8);
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
      <div className="table-wrap"><table><thead><tr><th>TIME</th><th>DEVICE</th><th>LEVEL</th><th>SOURCE</th><th>MESSAGE</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{new Date(r.logged_at).toLocaleString()}</td><td>{name(r.device_id)}</td><td><Sev level={r.level}/></td><td>{r.source}{r.event_id ? ` · ${r.event_id}` : ''}</td><td className="wrap-cell"><LongText text={r.message}/></td></tr>)}
        {!rows.length && <Empty cols={5} text="No logs match. Logs appear once an agent v0.4.0+ is installed and reports warnings or errors."/>}
      </tbody></table></div></section></div>;
}

/* ---------------------------------------------------------------- Uptime */
export function UptimePage({ organizationId, role, token, sites }: { organizationId: string; role: Role; token: string; sites: { id: string; name: string }[] }) {
  const [checks, setChecks] = useState<any[]>([]); const [spark, setSpark] = useState<Record<string, (number | null)[]>>({}); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [name, setName] = useState(''), [type, setType] = useState('http'), [target, setTarget] = useState('https://'), [port, setPort] = useState('443'), [interval, setIntervalS] = useState('300'), [busy, setBusy] = useState('');
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
    const { error } = await supabase.from('uptime_checks').insert(row); setBusy('');
    if (error) setErr(error.message); else { setMsg('Check created. First result arrives within a minute.'); setName(''); void load(); }
  };
  const run = async (id: string) => { setBusy(id); setErr(''); try { const r = await api('/uptime-checks/run', token, { method: 'POST', body: { check_id: id } }); setMsg(r.status === 'up' ? `Up · ${r.latency_ms} ms` : `Down · ${r.error}`); void load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const toggle = async (c: any) => { await supabase?.from('uptime_checks').update({ enabled: !c.enabled }).eq('id', c.id); void load(); };
  const del = async (c: any) => { if (!await confirmDialog(`Delete check "${c.name}"?`)) return; await supabase?.from('uptime_checks').delete().eq('id', c.id); void load(); };
  return <div className="sites-workspace">
    <Flash kind="success" msg={msg}/><Flash kind="error" msg={err}/>
    {isOp(role) && <form className="panel asset-form" onSubmit={add}><h3>Add uptime check</h3>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="Company website"/></label>
      <label>Type<Select value={type} onChange={e => { setType(e.target.value); setTarget(e.target.value === 'http' ? 'https://' : ''); }}><option value="http">HTTP(S) page</option><option value="tcp">TCP port</option></Select></label>
      <label className="span-2">{type === 'http' ? 'URL' : 'Host'}<input value={target} onChange={e => setTarget(e.target.value)} required placeholder={type === 'http' ? 'https://example.com' : 'mail.example.com'}/></label>
      <label>Check every<Select value={interval} onChange={e => setIntervalS(e.target.value)}><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="3600">1 hour</option></Select></label>
      {type === 'tcp' && <label>Port<input type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} required/></label>}
      <div className="form-cta"><button className="primary-action" disabled={busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Create check'}</button></div>
      <p className="muted form-note">Checks run from the cloud, so only public internet targets are allowed (private/local addresses are blocked). A check turns “down” after 2 failures in a row.</p></form>}
    <section className="panel page-panel"><div className="panel-head"><div><h3>Uptime checks</h3><p>Availability of websites and services, last 24 hours of latency.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>CHECK</th><th>TARGET</th><th>STATUS</th><th>LATENCY (24H)</th><th>LAST RUN</th><th></th></tr></thead><tbody>
        {checks.map(c => <tr key={c.id}><td><b>{c.name}</b>{!c.enabled && <span className="muted"> · paused</span>}</td><td>{c.check_type.toUpperCase()} {c.target}{c.port ? ':' + c.port : ''}</td>
          <td><span className={`status-pill ${c.status === 'up' ? 'online' : c.status === 'down' ? 'offline' : 'pending'}`}><i/>{c.status}</span></td>
          <td className="spark-cell"><Sparkline values={spark[c.id] ?? []}/></td><td>{ago(c.last_checked_at)}</td>
          <td>{isOp(role) && <div className="row-actions"><button className="secondary-action" disabled={busy === c.id} onClick={() => run(c.id)}>Run now</button><button className="secondary-action" onClick={() => toggle(c)}>{c.enabled ? 'Pause' : 'Resume'}</button><button className="danger-action" onClick={() => del(c)}>Delete</button></div>}</td></tr>)}
        {!checks.length && <Empty cols={6} text="No uptime checks yet. Add your website or a service above."/>}
      </tbody></table></div></section></div>;
}

/* --------------------------------------------------------------- Reports */
export function ReportsPage({ organizationId, token }: { organizationId: string; token: string }) {
  const [days, setDays] = useState(7); const [r, setR] = useState<any>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { let on = true; setLoading(true); setErr(''); api(`/reports/summary?organization_id=${organizationId}&days=${days}`, token).then(d => on && setR(d)).catch(e => on && setErr(e.message)).finally(() => on && setLoading(false)); return () => { on = false; }; }, [organizationId, days, token]);
  return <div className="sites-workspace report-page">
    <div className="tabs-row no-print"><p className="muted">Availability, usage and incidents for the selected period.</p><div className="sites-actions"><Select className="filter-select" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select><button className="primary-action" onClick={() => window.print()} disabled={!r}>Print / Save as PDF</button></div></div>
    <Flash kind="error" msg={err}/>{loading && <Skeleton rows={4}/>}
    {r && <>
      <section className="panel page-panel"><div className="panel-head"><div><h3>Devices</h3><p>{r.period.from.slice(0, 10)} → {r.period.to.slice(0, 10)}</p></div></div><div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>AVAILABILITY</th><th>CPU AVG</th><th>MEMORY AVG</th><th>DISK MAX</th><th>AVG DOWNLOAD</th><th>AVG UPLOAD</th></tr></thead><tbody>
        {r.devices.map((d: any) => <tr key={d.id ?? d.hostname}><td><b>{d.hostname}</b></td><td>{d.availability_percent}%</td><td>{d.cpu_avg ?? '—'}%</td><td>{d.memory_avg ?? '—'}%</td><td>{d.disk_max ?? '—'}%</td><td>{fmtBps(d.net_recv_bps_avg)}</td><td>{fmtBps(d.net_sent_bps_avg)}</td></tr>)}
        {!r.devices.length && <Empty cols={7} text="No devices."/>}</tbody></table></div></section>
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
  return <div className="sites-workspace"><section className="panel page-panel"><div className="panel-head"><div><h3>Audit log</h3><p>Who changed what. Entries cannot be edited.</p></div><Select className="filter-select" value={action} onChange={e => setAction(e.target.value)}><option value="all">Everything</option><option value="device">Devices</option><option value="enrollment_token">Enrollment tokens</option><option value="alert_rules">Alert rules</option><option value="uptime_checks">Uptime checks</option><option value="notification_channels">Notification channels</option><option value="organization_member">Team</option></Select></div>
    <div className="table-wrap"><table><thead><tr><th>WHEN</th><th>ACTOR</th><th>ACTION</th><th>RESOURCE</th><th>RESULT</th><th>DETAILS</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td>{new Date(r.occurred_at).toLocaleString()}</td><td>{r.actor_type}{r.actor_user_id ? ' · ' + String(r.actor_user_id).slice(0, 8) : ''}</td><td><b>{r.action}</b></td><td>{r.resource_type}</td><td>{r.outcome}</td><td className="wrap-cell muted">{r.details && Object.keys(r.details).length ? JSON.stringify(r.details).slice(0, 140) : ''}</td></tr>)}
      {!rows.length && <Empty cols={6} text="No audit entries yet."/>}</tbody></table></div></section></div>;
}

/* -------------------------------------------------------------- Platform */
export function PlatformPage({ organizationId, token }: { organizationId: string; token: string }) {
  const [s, setS] = useState<any>(null); const [err, setErr] = useState('');
  useTick(() => { api(`/platform/status?organization_id=${organizationId}`, token).then(setS).catch(e => setErr(e.message)); }, 30000, [organizationId, token]);
  const tick = s?.last_tick; const tickAge = tick?.updated_at ? (Date.now() - new Date(tick.updated_at).getTime()) / 1000 : null;
  const healthy = tickAge != null && tickAge < 180;
  const Row = ({ k, v, ok }: { k: string; v: React.ReactNode; ok?: boolean }) => <div className="setting-row"><span>{k}</span><b className={ok === undefined ? '' : ok ? 'txt-good' : 'txt-bad'}>{v}</b></div>;
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
    {s && <section className="panel page-panel"><div className="panel-head"><div><h3>Platform events</h3><p>Errors raised by the monitoring service itself.</p></div></div><div className="table-wrap"><table><thead><tr><th>TIME</th><th>LEVEL</th><th>SOURCE</th><th>MESSAGE</th></tr></thead><tbody>{(s.events ?? []).map((e: any) => <tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td><Sev level={e.level === 'error' ? 'error' : e.level}/></td><td>{e.source}</td><td className="wrap-cell"><LongText text={e.message}/></td></tr>)}{!s.events?.length && <Empty cols={4} text="No platform errors. All good."/>}</tbody></table></div></section>}
  </div>;
}

/* ------------------------------------------- Notification channels + maintenance (Settings tabs) */
export function ChannelsPanel({ organizationId, role, token }: { organizationId: string; role: Role; token: string }) {
  const [rows, setRows] = useState<any[]>([]); const [deliveries, setDeliveries] = useState<any[]>([]); const [name, setName] = useState(''), [type, setType] = useState('email'), [dest, setDest] = useState(''), [sev, setSev] = useState('warning'), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => { if (!supabase) return; const [a, b] = await Promise.all([supabase.from('notification_channels').select('id,name,channel_type,config,min_severity,enabled').eq('organization_id', organizationId).order('created_at'), supabase.from('notification_deliveries').select('id,channel_id,kind,status,detail,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(15)]); setRows(a.data ?? []); setDeliveries(b.data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  if (!isAdmin(role)) return <section className="panel settings-card"><p className="muted">Only owners and admins can manage notification channels.</p></section>;
  const add = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setErr(''); setMsg(''); const config = type === 'email' ? { to: dest.trim() } : type === 'telegram' ? { chat_id: dest.trim() } : { url: dest.trim() }; const { error } = await supabase.from('notification_channels').insert({ organization_id: organizationId, name: name.trim(), channel_type: type, config, min_severity: sev, enabled: true }); if (error) setErr(error.message); else { setName(''); setDest(''); setMsg('Channel added. Press “Send test” to confirm it works.'); void load(); } };
  const test = async (id: string) => { setBusy(id); setErr(''); setMsg(''); try { const r = await api('/notification-channels/test', token, { method: 'POST', body: { channel_id: id } }); setMsg(r.ok ? 'Test notification sent.' : 'Not sent: ' + r.detail); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); void load(); } };
  const del = async (id: string) => { if (await confirmDialog('Delete this channel?')) { await supabase?.from('notification_channels').delete().eq('id', id); void load(); } };
  const flip = async (c: any) => { await supabase?.from('notification_channels').update({ enabled: !c.enabled }).eq('id', c.id); void load(); };
  const shown = (c: any) => c.channel_type === 'email' ? c.config?.to : c.channel_type === 'telegram' ? 'chat ' + c.config?.chat_id : (() => { try { return new URL(c.config?.url).host; } catch { return 'webhook'; } })();
  return <div className="sites-workspace"><Flash kind="success" msg={msg}/><Flash kind="error" msg={err}/>
    <form className="panel asset-form" onSubmit={add}><h3>Add notification channel</h3>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} placeholder="IT team"/></label>
      <label>Type<Select value={type} onChange={e => { setType(e.target.value); setDest(''); }}><option value="email">Email</option><option value="telegram">Telegram</option><option value="webhook">Webhook (Slack, Teams, etc.)</option></Select></label>
      <label>{type === 'email' ? 'Email address' : type === 'telegram' ? 'Telegram chat ID' : 'HTTPS webhook URL'}<input value={dest} onChange={e => setDest(e.target.value)} required placeholder={type === 'email' ? 'it@company.com' : type === 'telegram' ? '123456789' : 'https://hooks.example.com/…'}/></label>
      <label>Send alerts from<Select value={sev} onChange={e => setSev(e.target.value)}><option value="info">Everything</option><option value="warning">Warning and above</option><option value="critical">Critical only</option></Select></label>
      <div className="form-actions"><button className="primary-action">Add channel</button></div>
      <p className="muted form-note">Email needs RESEND_API_KEY and Telegram needs TELEGRAM_BOT_TOKEN set on the server; until then sends show as “skipped”. Weekly reports go to email channels on Mondays.</p></form>
    <section className="panel page-panel"><div className="table-wrap"><table><thead><tr><th>CHANNEL</th><th>TYPE</th><th>DESTINATION</th><th>MIN. SEVERITY</th><th></th></tr></thead><tbody>
      {rows.map(c => <tr key={c.id}><td><b>{c.name}</b>{!c.enabled && <span className="muted"> · off</span>}</td><td>{c.channel_type}</td><td>{shown(c)}</td><td>{c.min_severity}</td><td><div className="row-actions"><button className="secondary-action" disabled={busy === c.id} onClick={() => test(c.id)}>Send test</button><button className="secondary-action" onClick={() => flip(c)}>{c.enabled ? 'Turn off' : 'Turn on'}</button><button className="danger-action" onClick={() => del(c.id)}>Delete</button></div></td></tr>)}
      {!rows.length && <Empty cols={5} text="No channels yet. Without one, alerts only appear in the dashboard."/>}</tbody></table></div></section>
    <section className="panel page-panel"><div className="panel-head"><div><h3>Recent deliveries</h3></div></div><div className="table-wrap"><table><tbody>{deliveries.map(d => <tr key={d.id}><td>{new Date(d.created_at).toLocaleString()}</td><td>{d.kind}</td><td><span className={`status-pill ${d.status === 'sent' ? 'online' : d.status === 'failed' ? 'offline' : 'pending'}`}><i/>{d.status}</span></td><td className="wrap-cell muted"><LongText text={d.detail}/></td></tr>)}{!deliveries.length && <Empty cols={4} text="Nothing sent yet."/>}</tbody></table></div></section></div>;
}

export function MaintenancePanel({ organizationId, role }: { organizationId: string; role: Role }) {
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState('Planned maintenance'); const [mins, setMins] = useState('60'); const [err, setErr] = useState('');
  const load = useCallback(async () => { const { data } = await (supabase?.from('maintenance_windows').select('id,name,starts_at,ends_at').eq('organization_id', organizationId).order('starts_at', { ascending: false }).limit(20) ?? Promise.resolve({ data: [] })); setRows(data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  const start = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setErr(''); const now = Date.now(); const { error } = await supabase.from('maintenance_windows').insert({ organization_id: organizationId, name: name.trim(), starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + Number(mins) * 60000).toISOString() }); if (error) setErr(error.message); else void load(); };
  const end = async (id: string) => { await supabase?.from('maintenance_windows').update({ ends_at: new Date().toISOString() }).eq('id', id); void load(); };
  const active = (w: any) => new Date(w.starts_at).getTime() <= Date.now() && new Date(w.ends_at).getTime() >= Date.now();
  return <div className="sites-workspace"><Flash kind="error" msg={err}/>
    {isOp(role) && <form className="panel asset-form" onSubmit={start}><h3>Start a maintenance window</h3><label>Reason<input value={name} onChange={e => setName(e.target.value)} required maxLength={80}/></label><label>For<Select value={mins} onChange={e => setMins(e.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="720">12 hours</option></Select></label><div className="form-actions"><button className="primary-action">Start now</button></div><p className="muted form-note">While a window is active, new alerts and notifications are paused so planned work does not page anyone.</p></form>}
    <section className="panel page-panel"><div className="table-wrap"><table><thead><tr><th>WINDOW</th><th>FROM</th><th>UNTIL</th><th></th></tr></thead><tbody>{rows.map(w => <tr key={w.id}><td><b>{w.name}</b> {active(w) && <span className="status-pill pending"><i/>active</span>}</td><td>{new Date(w.starts_at).toLocaleString()}</td><td>{new Date(w.ends_at).toLocaleString()}</td><td>{isOp(role) && active(w) && <button className="secondary-action" onClick={() => end(w.id)}>End now</button>}</td></tr>)}{!rows.length && <Empty cols={4} text="No maintenance windows."/>}</tbody></table></div></section></div>;
}

/* ------------------------------------------------- Discovery (Devices tab) */
export function DiscoveryPanel({ organizationId, role, sites }: { organizationId: string; role: Role; sites: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<any[]>([]); const [show, setShow] = useState('new');
  const load = useCallback(async () => { const { data } = await (supabase?.from('discovered_hosts').select('id,site_id,ip_address,mac_address,state,first_seen_at,last_seen_at,device_id').eq('organization_id', organizationId).order('first_seen_at', { ascending: false }).limit(300) ?? Promise.resolve({ data: [] })); setRows(data ?? []); }, [organizationId]);
  useTick(() => void load(), 30000, [load]);
  const set = async (id: string, state: string) => { await supabase?.from('discovered_hosts').update({ state }).eq('id', id); void load(); };
  const list = rows.filter(r => show === 'all' || r.state === show);
  return <section className="panel page-panel"><div className="panel-head"><div><h3>Discovered on your network</h3><p>Read from each agent's ARP table — nothing is scanned or probed. The first report from a site is treated as the baseline.</p></div><Select className="filter-select" value={show} onChange={e => setShow(e.target.value)}><option value="new">New</option><option value="known">Known</option><option value="ignored">Ignored</option><option value="all">All</option></Select></div>
    <div className="table-wrap"><table><thead><tr><th>IP</th><th>MAC</th><th>SITE</th><th>FIRST SEEN</th><th>LAST SEEN</th><th>STATE</th><th></th></tr></thead><tbody>
      {list.map(r => <tr key={r.id}><td><b>{r.ip_address}</b></td><td><code>{r.mac_address}</code></td><td>{sites.find(s => s.id === r.site_id)?.name ?? '—'}</td><td>{new Date(r.first_seen_at).toLocaleString()}</td><td>{ago(r.last_seen_at)}</td><td><span className={`status-pill ${r.state === 'new' ? 'pending' : r.state === 'known' ? 'online' : 'offline'}`}><i/>{r.state}</span></td>
        <td>{isOp(role) && <div className="row-actions">{r.state !== 'known' && <button className="secondary-action" onClick={() => set(r.id, 'known')}>Mark known</button>}{r.state !== 'ignored' && <button className="secondary-action" onClick={() => set(r.id, 'ignored')}>Ignore</button>}</div>}</td></tr>)}
      {!list.length && <Empty cols={7} text="Nothing here. Hosts appear once agents v0.4.0+ report."/>}</tbody></table></div></section>;
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
  useTick(() => void load(), 5000, [load]);
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
  // an agent that never reported its version is running something older than the published build
  const outdated = !!dev && dev.agent_version !== latestVersion;
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
      <section className="panel page-panel"><div className="panel-head"><div><h3>Top processes</h3><p>Latest sample · names only</p></div></div><div className="table-wrap"><table><thead><tr><th>PROCESS</th><th>CPU</th><th>MEMORY</th></tr></thead><tbody>{(latest?.top_processes ?? []).map((p: any, i: number) => <tr key={i}><td>{p.name}</td><td>{p.cpu}%</td><td>{p.memory_mb} MB</td></tr>)}{!latest?.top_processes?.length && <Empty cols={3} text="Needs agent v0.4.0+."/>}</tbody></table></div></section>
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
