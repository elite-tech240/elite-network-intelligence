import { useEffect, useState } from 'react';
import { Activity, Bell, Boxes, Cable, ChevronDown, CircleHelp, Gauge, LayoutDashboard, Network, Search, Settings, ShieldCheck, Wifi, Zap } from 'lucide-react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Device = { id: string; hostname: string; ip_address: string | null; status: string; device_type: string | null; last_seen_at: string | null };
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
let supabase: SupabaseClient | null = null;
if (configured) supabase = createClient(url!, key!);

const nav = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Devices', icon: Boxes },
  { label: 'Topology', icon: Network }, { label: 'Traffic', icon: Activity },
  { label: 'Alerts', icon: Bell }, { label: 'Sites & Networks', icon: Cable },
];

export default function App() {
  const [active, setActive] = useState('Overview');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    setLoading(true);
    supabase.from('devices').select('id,hostname,ip_address,status,device_type,last_seen_at').order('last_seen_at', { ascending: false }).limit(8)
      .then(({ data, error: queryError }) => { if (!alive) return; if (queryError) setError(queryError.message); else setDevices((data ?? []) as Device[]); setLoading(false); });
    return () => { alive = false; };
  }, []);
  const online = devices.filter(d => d.status === 'online').length;
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Network size={21}/></div><div><b>ELITE</b><span>NETWORK INTELLIGENCE</span></div></div>
      <div className="workspace"><div className="workspace-icon">EN</div><div><b>Workspace</b><small>Default organization</small></div><ChevronDown size={15}/></div>
      <div className="nav-label">PLATFORM</div>
      <nav>{nav.map(item => <button key={item.label} className={active === item.label ? 'nav-item selected' : 'nav-item'} onClick={() => setActive(item.label)}><item.icon size={17}/>{item.label}{item.label === 'Alerts' && <i className="nav-dot"/>}</button>)}</nav>
      <div className="nav-label tools-label">PREFERENCES</div>
      <button className="nav-item" onClick={() => setActive('Settings')}><Settings size={17}/>Settings</button>
      <button className="nav-item"><CircleHelp size={17}/>Documentation</button>
      <div className="sidebar-bottom"><div className="security"><ShieldCheck size={17}/><div><b>Security status</b><small>Review configuration</small></div></div><div className="profile"><div className="avatar">ET</div><div><b>Elite Team</b><small>Administrator</small></div><ChevronDown size={15}/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> <b>{active}</b></div><div className="top-actions"><div className="search"><Search size={15}/><span>Search anything...</span><kbd>⌘ K</kbd></div><button className="icon-btn"><Bell size={18}/><i/></button><div className="avatar small">ET</div></div></header>
      <section className="content">
        <div className="page-heading"><div><div className="eyebrow">NETWORK OPERATIONS CENTER</div><h1>{active === 'Overview' ? 'Network overview' : active}</h1><p>Monitor, understand, and manage your network infrastructure.</p></div><button className="date-button">Last 24 hours <ChevronDown size={15}/></button></div>
        {!configured && <div className="setup-banner"><div className="setup-icon"><Zap size={18}/></div><div><b>Connect your Supabase project</b><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your frontend environment to load live inventory.</p></div><span className="status-pill pending">Setup required</span></div>}
        {error && <div className="error-banner">Could not load devices: {error}</div>}
        <div className="section-row"><h2>Infrastructure health</h2><span className="muted">Live status overview</span></div>
        <div className="stats-grid">
          <Stat icon={<Boxes/>} label="Total devices" value={configured ? String(devices.length) : '—'} change="Discovered assets" tone="blue"/>
          <Stat icon={<Wifi/>} label="Online devices" value={configured ? String(online) : '—'} change="Currently reachable" tone="green"/>
          <Stat icon={<Activity/>} label="Network uptime" value="—" change="Awaiting telemetry" tone="purple"/>
          <Stat icon={<Bell/>} label="Active alerts" value="—" change="Alert rules not configured" tone="orange"/>
        </div>
        <div className="dashboard-grid">
          <section className="panel device-panel"><div className="panel-head"><div><h3>Recently discovered devices</h3><p>Latest assets reporting to your workspace</p></div><button className="text-button" onClick={() => setActive('Devices')}>View all <span>→</span></button></div>
            <div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>IP ADDRESS</th><th>TYPE</th><th>STATUS</th></tr></thead><tbody>
              {loading && <tr><td colSpan={4} className="empty">Loading device inventory…</td></tr>}
              {!loading && devices.map(d => <tr key={d.id}><td><div className="device-name"><span className="device-icon"><Network size={15}/></span><b>{d.hostname}</b></div></td><td>{d.ip_address ?? '—'}</td><td>{d.device_type ?? 'Unknown'}</td><td><span className={`status-pill ${d.status === 'online' ? 'online' : 'offline'}`}><i/>{d.status}</span></td></tr>)}
              {!loading && devices.length === 0 && <tr><td colSpan={4} className="empty">{configured ? 'No devices enrolled yet. Install an Elite agent to begin discovery.' : 'Device inventory will appear here after setup.'}</td></tr>}
            </tbody></table></div>
          </section>
          <section className="panel quick-panel"><div className="panel-head"><div><h3>Quick actions</h3><p>Common management tasks</p></div></div><Quick icon={<Boxes/>} title="Enroll a device" desc="Connect a new network asset"/><Quick icon={<Network/>} title="Explore topology" desc="Visualize network relationships"/><Quick icon={<Bell/>} title="Configure alerts" desc="Set up health notifications"/><div className="tip"><ShieldCheck size={17}/><span><b>Stay protected</b><small>Review access policies and rotate enrollment tokens regularly.</small></span></div></section>
        </div>
        <div className="footer"><span>ELITE NETWORK INTELLIGENCE <b>v0.2.0</b></span><span>Monitoring foundation · More collectors coming soon</span></div>
      </section>
    </main>
  </div>;
}
function Stat({icon,label,value,change,tone}:{icon:React.ReactNode,label:string,value:string,change:string,tone:string}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><i className={`stat-icon ${tone}`}>{icon}</i></div><strong>{value}</strong><small>{change}</small></div>; }
function Quick({icon,title,desc}:{icon:React.ReactNode,title:string,desc:string}) { return <button className="quick-action"><span className="quick-icon">{icon}</span><span><b>{title}</b><small>{desc}</small></span><span className="arrow">→</span></button>; }
