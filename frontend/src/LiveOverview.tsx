import { useEffect, useMemo, useState } from 'react';
import { Globe2, Router, Server, Layers, Monitor, Plus, Activity, ArrowUpRight, Boxes } from 'lucide-react';
import { supabase, fmtBps } from './lib';
import { LineChart } from './Chart';
import { Checklist, EmptyState, type Prefs } from './ui';

type Device = { id: string; hostname: string; ip_address: string | null; status: string; device_type: string | null; last_seen_at: string | null; site_id?: string; parent_device_id?: string | null };
type Site = { id: string; name: string; location: string | null };
type Net = { id: string; name: string; cidr: string | null; site_id: string };
type Point = { t: number; v: number | null };
type Latest = { cpu: number | null; mem: number | null; net: number | null; at: number };

const ONLINE_MS = 120_000;
const isOnline = (d: Device) => !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < ONLINE_MS;
const rel = (iso: string | null) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`;
};
const kindIcon = (d: Device, size = 18) => d.device_type === 'esxi_host' ? <Layers size={size}/> : d.device_type === 'workstation' ? <Monitor size={size}/> : <Server size={size}/>;
const kindLabel = (d: Device) => d.device_type === 'esxi_host' ? 'ESXi host' : d.device_type ?? 'device';

function Gauge({ value, label }: { value: number | null; label: string }) {
  const C = 2 * Math.PI * 15;
  return <div className={value == null ? 'lv-gauge dim' : 'lv-gauge'}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="lv-gb"/>{value != null && <circle cx="18" cy="18" r="15" className="lv-gf" style={{ strokeDasharray: `${(Math.min(100, value) / 100) * C} ${C}` }}/>}</svg>
    <b>{value == null ? '—' : Math.round(value) + '%'}</b><small>{label}</small>
  </div>;
}

export function LiveOverview({ devices, hosts, sites, networks, loading, go, organizationId, prefs, setPrefs }: { devices: Device[]; hosts: Device[]; sites: Site[]; networks: Net[]; loading: boolean; go: (s: string, tab?: string) => void; organizationId: string; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void }) {
  const [rows, setRows] = useState<any[]>([]), [alerts, setAlerts] = useState<any[]>([]), [counts, setCounts] = useState({ uptime: 0, channels: 0 }), [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  useEffect(() => {
    let on = true; if (!supabase) return;
    const load = () => {
      supabase!.from('device_metrics').select('device_id,cpu_percent,memory_percent,net_recv_bps,net_sent_bps,recorded_at').eq('organization_id', organizationId).gte('recorded_at', new Date(Date.now() - 3600000).toISOString()).order('recorded_at').limit(3000).then(({ data }) => { if (on) setRows(data ?? []); });
      supabase!.from('alert_events').select('id,title,severity,triggered_at,status').eq('organization_id', organizationId).in('status', ['open', 'acknowledged']).order('triggered_at', { ascending: false }).limit(6).then(({ data }) => { if (on) setAlerts(data ?? []); });
    };
    load();
    Promise.all([supabase.from('uptime_checks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId), supabase.from('notification_channels').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)]).then(([a, b]) => { if (on) setCounts({ uptime: a.count ?? 0, channels: b.count ?? 0 }); });
    const t = window.setInterval(load, 1000);
    return () => { on = false; window.clearInterval(t); };
  }, [organizationId]);

  const all = useMemo(() => [...devices, ...hosts], [devices, hosts]);
  const latest = useMemo(() => {
    const m = new Map<string, Latest>();
    rows.forEach(r => { const net = r.net_recv_bps == null && r.net_sent_bps == null ? null : Number(r.net_recv_bps ?? 0) + Number(r.net_sent_bps ?? 0); m.set(r.device_id, { cpu: r.cpu_percent == null ? null : Number(r.cpu_percent), mem: r.memory_percent == null ? null : Number(r.memory_percent), net, at: new Date(r.recorded_at).getTime() }); });
    return m;
  }, [rows]);
  const series = useMemo(() => {
    const b = new Map<number, { c: number[]; n: number[] }>();
    rows.forEach(r => { const k = Math.floor(new Date(r.recorded_at).getTime() / 60000); const e = b.get(k) ?? { c: [], n: [] }; if (r.cpu_percent != null) e.c.push(Number(r.cpu_percent)); e.n.push(Number(r.net_recv_bps ?? 0) + Number(r.net_sent_bps ?? 0)); b.set(k, e); });
    const avg = (x: number[]) => x.length ? x.reduce((p, q) => p + q, 0) / x.length : null;
    const keys = [...b.keys()].sort((x, y) => x - y);
    return { cpu: keys.map(k => ({ t: k * 60000, v: avg(b.get(k)!.c) })) as Point[], net: keys.map(k => ({ t: k * 60000, v: avg(b.get(k)!.n) })) as Point[] };
  }, [rows]);

  const onlineDevs = all.filter(isOnline);
  const liveVals = onlineDevs.map(d => latest.get(d.id)).filter(Boolean) as Latest[];
  const cpuVals = liveVals.map(l => l.cpu).filter((v): v is number => v != null);
  const avgCpu = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
  const throughput = liveVals.reduce((a, l) => a + (l.net ?? 0), 0);
  const hotId = useMemo(() => { let best = '', max = 125_000; onlineDevs.forEach(d => { const n = latest.get(d.id)?.net ?? 0; if (n > max) { max = n; best = d.id; } }); return best; }, [onlineDevs, latest]);

  // ---- live map layout (percent coordinates inside the map box) ----
  const map = useMemo(() => {
    const groups: { key: string; label: string; sub: string; devs: Device[] }[] = sites.map(s => ({ key: s.id, label: s.name, sub: `${networks.filter(n => n.site_id === s.id).length} network${networks.filter(n => n.site_id === s.id).length === 1 ? '' : 's'}`, devs: all.filter(d => d.site_id === s.id) }));
    const unassigned = all.filter(d => !d.site_id || !sites.some(s => s.id === d.site_id));
    if (unassigned.length || !groups.length) groups.push({ key: '_none', label: groups.length ? 'Unassigned' : 'Local network', sub: 'no site', devs: unassigned });
    const shown = groups.filter(g => g.devs.length || g.key !== '_none');
    const MAX = 10; let used = 0;
    const gNodes = shown.map((g, i) => ({ ...g, x: ((i + 1) / (shown.length + 1)) * 100, y: 36 }));
    const dNodes: { d: Device; x: number; y: number; gx: number; gy: number }[] = [];
    const totalDevs = Math.min(MAX, shown.reduce((a, g) => a + g.devs.length, 0));
    let slot = 0;
    gNodes.forEach(g => g.devs.forEach(d => {
      if (used >= MAX) return; used++;
      const x = ((slot + 1) / (totalDevs + 1)) * 100; const y = slot % 2 ? 84 : 72; slot++;
      dNodes.push({ d, x, y, gx: g.x, gy: g.y });
    }));
    return { gNodes, dNodes, hidden: all.length - used };
  }, [sites, networks, all]);
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const a = x1 * 10, b = y1 * 4.8, c = x2 * 10, d = y2 * 4.8, m = (b + d) / 2; return `M${a} ${b} C${a} ${m} ${c} ${m} ${c} ${d}`; };

  const feed = [
    ...alerts.map(a => ({ id: 'a' + a.id, tone: a.severity === 'critical' ? 'c' : 'w', title: a.title, sub: `${a.status === 'acknowledged' ? 'Acknowledged' : 'Open'} · ${rel(a.triggered_at)}`, t: new Date(a.triggered_at).getTime() })),
    ...[...onlineDevs].sort((a, b) => new Date(b.last_seen_at!).getTime() - new Date(a.last_seen_at!).getTime()).slice(0, 4).map(d => ({ id: 'd' + d.id, tone: 'n', title: `${d.hostname} checked in`, sub: `${d.ip_address ?? kindLabel(d)} · ${rel(d.last_seen_at)}`, t: new Date(d.last_seen_at!).getTime() })),
  ].slice(0, 6);

  const steps = [{ id: 'site', label: 'Add your first site', done: sites.length > 0, go: () => go('Sites & Networks', 'sites') }, { id: 'net', label: 'Add a network (CIDR range)', done: networks.length > 0, go: () => go('Sites & Networks', 'networks') }, { id: 'agent', label: 'Install an agent on a device', done: devices.length > 0, go: () => go('Sites & Networks', 'agents') }, { id: 'uptime', label: 'Create an uptime check', done: counts.uptime > 0, go: () => go('Uptime') }, { id: 'notify', label: 'Set up a notification channel', done: counts.channels > 0, go: () => go('Settings', 'notify') }];
  const cards = all.filter(d => filter === 'all' || (filter === 'online' ? isOnline(d) : !isOnline(d)));
  const dash = (x: string) => loading ? '—' : x;

  return <div className="lv">
    <div className="lv-chips">
      <button className="lv-chip" onClick={() => go('Devices')}><small>Online</small><b>{dash(`${onlineDevs.length}/${all.length}`)}</b></button>
      <button className="lv-chip" onClick={() => go('Traffic')}><small>Throughput</small><b>{dash(liveVals.length ? fmtBps(throughput) : '—')}</b></button>
      <button className="lv-chip" onClick={() => go('Devices', 'health')}><small>Avg CPU</small><b>{dash(avgCpu == null ? '—' : Math.round(avgCpu) + '%')}</b></button>
      <button className={alerts.length ? 'lv-chip warn' : 'lv-chip'} onClick={() => go('Alerts')}><small>Open alerts</small><b>{dash(String(alerts.length))}</b></button>
    </div>

    {!prefs.onboardDone && <Checklist steps={steps} lang={prefs.lang} onDismiss={() => setPrefs({ onboardDone: true })}/>}

    <section className="lv-map" aria-label="Live network map">
      <div className="lv-map-head"><span className="lv-live"/><b>Live topology</b><span className="lv-legend"><i className="on"/>online<i className="off"/>offline<i className="hot"/>busiest link</span></div>
      <div className="lv-stage">{all.length === 0 && !loading ? <div className="lv-map-empty"><EmptyState icon={<Boxes size={22}/>} title="Nothing on the map yet" text="Install the agent on a device and it appears here within a minute." action={<button className="primary-action" onClick={() => go('Sites & Networks', 'agents')}><Plus size={16}/>Add device</button>}/></div> : <>
        <svg className="lv-links" viewBox="0 0 1000 480" preserveAspectRatio="none" aria-hidden="true">
          {map.gNodes.map(g => <path key={'l' + g.key} d={curve(50, 9, g.x, g.y)} className="lv-ln"/>)}
          {map.dNodes.map(n => <path key={'l' + n.d.id} d={curve(n.gx, n.gy, n.x, n.y)} className={`lv-ln ${!isOnline(n.d) ? 'dead' : n.d.id === hotId ? 'hot' : ''}`}/>)}
        </svg>
        <div className="lv-node root" style={{ left: '50%', top: '9%' }}><span className="lv-nic"><Globe2 size={18}/></span><div><b>Internet</b><small>WAN</small></div></div>
        {map.gNodes.map((g, i) => <button key={g.key} className="lv-node site" style={{ left: `${g.x}%`, top: `${g.y}%`, animationDelay: `${0.1 + i * 0.06}s` }} onClick={() => go('Topology')}><span className="lv-nic"><Router size={18}/></span><div><b>{g.label}</b><small>{g.sub} · {g.devs.length} device{g.devs.length === 1 ? '' : 's'}</small></div></button>)}
        {map.dNodes.map((n, i) => <button key={n.d.id} className={`lv-node dev ${isOnline(n.d) ? '' : 'off'}`} style={{ left: `${n.x}%`, top: `${n.y}%`, animationDelay: `${0.2 + i * 0.05}s` }} title={`${n.d.hostname}${n.d.ip_address ? ' · ' + n.d.ip_address : ''}`} onClick={() => go(n.d.device_type === 'esxi_host' ? 'Virtualization' : 'Devices')}><span className="lv-nic">{kindIcon(n.d)}</span><div><b>{n.d.hostname}</b><small>{n.d.ip_address ?? kindLabel(n.d)}</small></div></button>)}
        {map.hidden > 0 && <button className="lv-more" onClick={() => go('Devices')}>+{map.hidden} more</button>}
      </>}</div>
      <aside className="lv-feed"><div className="lv-feed-head"><b>Live events</b><span className="lv-rec">● LIVE</span></div>
        {feed.length ? <ul>{feed.map(f => <li key={f.id} className={f.tone}><i/><div><b>{f.title}</b><small>{f.sub}</small></div></li>)}</ul> : <p className="muted">Waiting for the first heartbeat…</p>}
        <button className="text-button" onClick={() => go('Alerts')}>All alerts →</button></aside>
    </section>

    <section className="lv-devs">
      <div className="lv-devs-head"><h2>Devices</h2><div className="lv-devs-r">
        <div className="lv-seg" role="tablist">{([['all', `All ${all.length}`], ['online', `Online ${onlineDevs.length}`], ['offline', `Offline ${all.length - onlineDevs.length}`]] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{l}</button>)}</div>
        <button className="primary-action" onClick={() => go('Sites & Networks', 'agents')}><Plus size={16}/>Add device</button></div></div>
      {cards.length ? <div className="lv-grid">{cards.map((d, i) => { const l = isOnline(d) ? latest.get(d.id) : undefined; const on = isOnline(d); return <article key={d.id} className={on ? 'lv-card' : 'lv-card off'} style={{ animationDelay: `${0.05 + i * 0.04}s` }}>
        <header><span className="lv-cic">{kindIcon(d, 16)}</span><div><b>{d.hostname}</b><small>{kindLabel(d)}{d.ip_address && d.ip_address !== d.hostname ? ` · ${d.ip_address}` : ''}</small></div><span className={on ? 'status-pill online' : 'status-pill offline'}><i/>{on ? 'online' : 'offline'}</span></header>
        <div className="lv-gauges"><Gauge value={l?.cpu ?? null} label="CPU"/><Gauge value={l?.mem ?? null} label="Memory"/></div>
        <footer><span><Activity size={14}/>{on && l?.net != null ? fmtBps(l.net) : on ? '—' : `last seen ${rel(d.last_seen_at)}`}</span><button className="text-button" onClick={() => go(d.device_type === 'esxi_host' ? 'Virtualization' : 'Devices')}>Details <ArrowUpRight size={14}/></button></footer>
      </article>; })}</div> : <section className="panel"><EmptyState icon={<Boxes size={22}/>} title={filter === 'offline' ? 'Everything is online' : 'No devices here'} text={filter === 'offline' ? 'No device has missed its heartbeat.' : 'Install the agent and it will appear here.'}/></section>}
    </section>

    <section className="panel lv-activity"><div className="panel-head"><div><h3>Activity</h3><p>Averages across all devices, last hour</p></div><button className="text-button" onClick={() => go('Traffic')}>Traffic →</button></div>
      <div className="lv-activity-body"><div><div className="lv-mh"><span>Average CPU</span><b>{avgCpu == null ? '—' : Math.round(avgCpu) + '%'}</b></div><LineChart points={series.cpu} color="#f5630f" height={150} max={100} unit="%"/></div>
        <div><div className="lv-mh"><span>Network throughput</span><b>{liveVals.length ? fmtBps(throughput) : '—'}</b></div><LineChart points={series.net} color="#4fd1c5" height={150} format={fmtBps}/></div></div></section>
  </div>;
}
