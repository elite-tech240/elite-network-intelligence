import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bell, Boxes, Cable, ChevronDown, CircleHelp, Gauge, LayoutDashboard, LogOut, Network, Search, Settings, ShieldCheck, Wifi, Zap, LockKeyhole, Eye, EyeOff, RefreshCw, MapPin, Server, ArrowUpRight, Clock3, UserRound, KeyRound } from 'lucide-react';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

type Device = { id: string; hostname: string; ip_address: string | null; status: string; device_type: string | null; last_seen_at: string | null; site_id?: string };
type Site = { id: string; name: string; location: string | null };
type Net = { id: string; name: string; cidr: string | null; site_id: string };
type Membership = { organization_id: string; role: 'owner' | 'admin' | 'operator' | 'viewer'; organizations?: { id: string; name: string } | null };
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
const supabase: SupabaseClient | null = configured ? createClient(url!, key!) : null;
const nav = [
  { label: 'Overview', icon: LayoutDashboard, path: '/' }, { label: 'Devices', icon: Boxes, path: '/devices' },
  { label: 'Topology', icon: Network, path: '/topology' }, { label: 'Traffic', icon: Activity, path: '/traffic' },
  { label: 'Alerts', icon: Bell, path: '/alerts' }, { label: 'Sites & Networks', icon: Cable, path: '/sites' },
];
const pageFromPath = () => nav.find(n => n.path === window.location.pathname)?.label ?? (window.location.pathname === '/settings' ? 'Settings' : 'Overview');

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [page, setPage] = useState(pageFromPath);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [networks, setNetworks] = useState<Net[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadWorkspace = useCallback(async (user: User) => {
    if (!supabase) return;
    setDataLoading(true); setDataError('');
    try {
      const { data: member, error: memberError } = await supabase.from('organization_members').select('organization_id,role,organizations(id,name)').eq('user_id', user.id).limit(1).maybeSingle();
      if (memberError) throw memberError;
      setMembership(member as Membership | null);
      if (!member) { setDevices([]); setSites([]); setNetworks([]); return; }
      const orgId = (member as Membership).organization_id;
      const [deviceResult, siteResult, networkResult] = await Promise.all([
        supabase.from('devices').select('id,hostname,ip_address,status,device_type,last_seen_at,site_id').eq('organization_id', orgId).order('last_seen_at', { ascending: false }),
        supabase.from('sites').select('id,name,location').eq('organization_id', orgId).order('name'),
        supabase.from('networks').select('id,name,cidr,site_id').eq('organization_id', orgId).order('name'),
      ]);
      if (deviceResult.error) throw deviceResult.error;
      if (siteResult.error) throw siteResult.error;
      if (networkResult.error) throw networkResult.error;
      setDevices((deviceResult.data ?? []) as Device[]); setSites((siteResult.data ?? []) as Site[]); setNetworks((networkResult.data ?? []) as Net[]);
    } catch (e) { setDataError(e instanceof Error ? e.message : 'Could not load workspace data.'); }
    finally { setDataLoading(false); }
  }, []);

  useEffect(() => { if (session?.user) void loadWorkspace(session.user); else { setMembership(null); setDevices([]); setSites([]); setNetworks([]); } }, [session?.user?.id, loadWorkspace]);
  useEffect(() => { const onPop = () => setPage(pageFromPath()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const go = (label: string) => { const item = nav.find(n => n.label === label); const path = item?.path ?? (label === 'Settings' ? '/settings' : '/'); window.history.pushState({}, '', path); setPage(label); };
  const signIn = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setBusy(true); setAuthError(''); setNotice(''); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) setAuthError(error.message); setBusy(false); };
  const sendReset = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setBusy(true); setAuthError(''); const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` }); if (error) setAuthError(error.message); else setNotice('Password reset email sent. Check your inbox.'); setBusy(false); };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); window.history.replaceState({}, '', '/login'); setPage('Overview'); };
  const refresh = () => { if (session?.user) void loadWorkspace(session.user); };
  const online = devices.filter(d => d.status === 'online').length;
  const title = page === 'Overview' ? 'Network overview' : page;

  if (!configured) return <AuthScreen configured={false} email={email} setEmail={setEmail} password={password} setPassword={setPassword} showPassword={showPassword} setShowPassword={setShowPassword} busy={false} error="" notice="" resetMode={false} setResetMode={() => {}} onSubmit={e => e.preventDefault()} />;
  if (!authReady) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark auth-mark"><Network size={22}/></div><p className="auth-subtitle">Loading secure session…</p></div></div>;
  if (!session) return <AuthScreen configured email={email} setEmail={setEmail} password={password} setPassword={setPassword} showPassword={showPassword} setShowPassword={setShowPassword} busy={busy} error={authError} notice={notice} resetMode={resetMode} setResetMode={setResetMode} onSubmit={resetMode ? sendReset : signIn} />;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Network size={21}/></div><div><b>ELITE</b><span>NETWORK INTELLIGENCE</span></div></div>
      <div className="workspace"><div className="workspace-icon">EN</div><div><b>{membership?.organizations?.name ?? 'Workspace'}</b><small>{membership ? `${membership.role} access` : 'No organization access'}</small></div><ChevronDown size={15}/></div>
      <div className="nav-label">PLATFORM</div>
      <nav>{nav.map(item => <button key={item.label} className={page === item.label ? 'nav-item selected' : 'nav-item'} onClick={() => go(item.label)}><item.icon size={17}/>{item.label}{item.label === 'Alerts' && <i className="nav-dot"/>}</button>)}</nav>
      <div className="nav-label tools-label">PREFERENCES</div>
      <button className={page === 'Settings' ? 'nav-item selected' : 'nav-item'} onClick={() => go('Settings')}><Settings size={17}/>Settings</button>
      <button className="nav-item" onClick={() => setNotice('Documentation is being prepared.')}><CircleHelp size={17}/>Documentation</button>
      <div className="sidebar-bottom"><div className="security"><ShieldCheck size={17}/><div><b>Access control</b><small>{membership?.role === 'owner' ? 'Owner account' : 'Role-based permissions'}</small></div></div><div className="profile"><div className="avatar">{(session.user.email?.[0] ?? 'U').toUpperCase()}</div><div><b>{session.user.email}</b><small>{membership?.role ?? 'No role assigned'}</small></div><button className="mini-icon" title="Sign out" onClick={signOut}><LogOut size={15}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> <b>{page}</b></div><div className="top-actions"><div className="search"><Search size={15}/><span>Search anything...</span><kbd>⌘ K</kbd></div><button className="icon-btn" onClick={() => go('Alerts')}><Bell size={18}/><i/></button><div className="avatar small">{(session.user.email?.[0] ?? 'U').toUpperCase()}</div></div></header>
      <section className="content">
        <div className="page-heading"><div><div className="eyebrow">NETWORK OPERATIONS CENTER</div><h1>{title}</h1><p>{pageDescription(page)}</p></div><button className="date-button" onClick={refresh}><RefreshCw size={14}/> Refresh</button></div>
        {notice && <div className="notice-banner">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
        {!membership ? <div className="panel access-panel"><div className="empty-icon"><LockKeyhole size={23}/></div><h2>No workspace access yet</h2><p>Your account is signed in, but it has not been added to an organization. Ask the system owner to assign your account.</p></div> : <>
          {dataError && <div className="error-banner">Could not load workspace data: {dataError}</div>}
          {dataLoading && <div className="loading-line">Loading workspace data…</div>}
          {page === 'Overview' && <Overview devices={devices} sites={sites} networks={networks} online={online} loading={dataLoading} go={go}/>}
          {page === 'Devices' && <DevicesPage devices={devices} loading={dataLoading}/>}
          {page === 'Topology' && <TopologyPage sites={sites} networks={networks} devices={devices}/>}
          {page === 'Traffic' && <TrafficPage/>}
          {page === 'Alerts' && <AlertsPage/>}
          {page === 'Sites & Networks' && <SitesPage sites={sites} networks={networks}/>}
          {page === 'Settings' && <SettingsPage user={session.user} membership={membership} onSignOut={signOut}/>}
        </>}
        <div className="footer"><span>ELITE NETWORK INTELLIGENCE <b>v0.3.0</b></span><span>Secure workspace · {membership?.role ?? 'No role'}</span></div>
      </section>
    </main>
  </div>;
}

function AuthScreen({configured, email, setEmail, password, setPassword, showPassword, setShowPassword, busy, error, notice, resetMode, setResetMode, onSubmit}:{configured:boolean;email:string;setEmail:(v:string)=>void;password:string;setPassword:(v:string)=>void;showPassword:boolean;setShowPassword:(v:boolean)=>void;busy:boolean;error:string;notice:string;resetMode:boolean;setResetMode:(v:boolean)=>void;onSubmit:(e:FormEvent)=>void}) {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark auth-mark"><Network size={22}/></div><div><b>ELITE</b><span>NETWORK INTELLIGENCE</span></div></div><div className="auth-kicker">NETWORK OPERATIONS CENTER</div><h1>{resetMode ? 'Reset your password' : 'Welcome back'}</h1><p className="auth-subtitle">{resetMode ? 'We will email you a secure password reset link.' : 'Sign in to access your network workspace.'}</p>
    {!configured ? <div className="setup-banner auth-setup"><Zap size={18}/><div><b>Connect Supabase to enable sign in</b><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel project settings, then redeploy.</p></div></div> : <form onSubmit={onSubmit} className="auth-form"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)} required/><label htmlFor="password">{resetMode ? ' ' : 'Password'}</label>{!resetMode && <div className="password-field"><input id="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>}{error && <div className="error-banner">{error}</div>}{notice && <div className="notice-banner">{notice}</div>}<button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : resetMode ? 'Send reset link' : 'Sign in securely'} <ArrowUpRight size={16}/></button></form>}
    {configured && <button className="auth-link" onClick={()=>setResetMode(!resetMode)}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>}<div className="auth-foot"><ShieldCheck size={15}/> Protected by secure authentication · No public sign-up</div></div></div>;
}
function pageDescription(page:string) { return ({Overview:'Monitor the health and activity of your network infrastructure.',Devices:'Every enrolled endpoint and its latest reported status.',Topology:'Understand how your sites, networks, and devices are connected.',Traffic:'Network traffic analytics and telemetry.',Alerts:'Review incidents and configure alerting workflows.', 'Sites & Networks':'Manage the physical sites and logical networks in your workspace.',Settings:'Account identity, workspace permissions, and system administration.'} as Record<string,string>)[page] ?? ''; }
function Overview({devices,sites,networks,online,loading,go}:{devices:Device[];sites:Site[];networks:Net[];online:number;loading:boolean;go:(s:string)=>void}) { return <><div className="section-row"><h2>Infrastructure health</h2><span className="muted">Live workspace inventory</span></div><div className="stats-grid"><Stat icon={<Boxes/>} label="Total devices" value={loading?'…':String(devices.length)} change="Enrolled assets" tone="blue"/><Stat icon={<Wifi/>} label="Online devices" value={loading?'…':String(online)} change="Currently reporting online" tone="green"/><Stat icon={<Network/>} label="Networks" value={loading?'…':String(networks.length)} change="Configured network segments" tone="purple"/><Stat icon={<MapPin/>} label="Sites" value={loading?'…':String(sites.length)} change="Workspace locations" tone="orange"/></div><div className="dashboard-grid"><section className="panel device-panel"><div className="panel-head"><div><h3>Recently discovered devices</h3><p>Latest assets reporting to your workspace</p></div><button className="text-button" onClick={()=>go('Devices')}>View all →</button></div><DeviceTable devices={devices.slice(0,6)} loading={loading}/></section><section className="panel quick-panel"><div className="panel-head"><div><h3>Workspace shortcuts</h3><p>Explore system areas</p></div></div><Quick icon={<Boxes/>} title="Device inventory" desc="Browse enrolled devices" onClick={()=>go('Devices')}/><Quick icon={<Network/>} title="Network topology" desc="Explore sites and segments" onClick={()=>go('Topology')}/><Quick icon={<Bell/>} title="Alerts center" desc="Review alerting status" onClick={()=>go('Alerts')}/><div className="tip"><ShieldCheck size={17}/><span><b>Owner-controlled access</b><small>Only assigned organization members can access workspace data.</small></span></div></section></div></>; }
function DevicesPage({devices,loading}:{devices:Device[];loading:boolean}) { const [filter,setFilter]=useState('all'); const filtered=useMemo(()=>devices.filter(d=>filter==='all'||d.status===filter),[devices,filter]); return <section className="panel page-panel"><div className="panel-head"><div><h3>Device inventory</h3><p>{devices.length} registered assets in this organization</p></div><select className="filter-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="online">Online</option><option value="offline">Offline</option><option value="degraded">Degraded</option><option value="unknown">Unknown</option></select></div><DeviceTable devices={filtered} loading={loading}/></section>; }
function DeviceTable({devices,loading}:{devices:Device[];loading:boolean}) { return <div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>IP ADDRESS</th><th>TYPE</th><th>LAST SEEN</th><th>STATUS</th></tr></thead><tbody>{loading&&<tr><td colSpan={5} className="empty">Loading device inventory…</td></tr>}{!loading&&devices.map(d=><tr key={d.id}><td><div className="device-name"><span className="device-icon"><Server size={15}/></span><b>{d.hostname}</b></div></td><td>{d.ip_address??'—'}</td><td>{d.device_type??'Unknown'}</td><td>{d.last_seen_at?new Date(d.last_seen_at).toLocaleString():'Never'}</td><td><span className={`status-pill ${d.status==='online'?'online':d.status==='offline'?'offline':'pending'}`}><i/>{d.status}</span></td></tr>)}{!loading&&devices.length===0&&<tr><td colSpan={5} className="empty">No devices found. Enroll an agent to start building your inventory.</td></tr>}</tbody></table></div>; }
function TopologyPage({sites,networks,devices}:{sites:Site[];networks:Net[];devices:Device[]}) { return <div className="topology-grid">{sites.length===0&&<section className="panel empty-panel"><Network size={26}/><h3>No topology data yet</h3><p>Add a site and network to start mapping your infrastructure.</p></section>}{sites.map(site=><section className="panel topology-card" key={site.id}><div className="topology-title"><span className="quick-icon"><MapPin size={17}/></span><div><h3>{site.name}</h3><p>{site.location||'Location not specified'}</p></div></div><div className="topology-children">{networks.filter(n=>n.site_id===site.id).map(net=><div className="network-node" key={net.id}><Network size={16}/><span><b>{net.name}</b><small>{net.cidr||'CIDR not set'} · {devices.filter(d=>d.site_id===site.id).length} devices</small></span></div>)}{networks.filter(n=>n.site_id===site.id).length===0&&<p className="muted">No networks assigned to this site.</p>}</div></section>)}</div>; }
function TrafficPage() { return <section className="panel empty-panel"><Activity size={28}/><h3>Traffic analytics are not connected yet</h3><p>The current backend schema does not include flow records or bandwidth telemetry. Connect a supported collector before showing real traffic metrics.</p><span className="status-pill pending">Awaiting telemetry source</span></section>; }
function AlertsPage() { return <section className="panel empty-panel"><Bell size={28}/><h3>No alert feed configured</h3><p>There is no alerts table or alert-processing service in the current backend yet. This page is ready for the alert pipeline integration.</p><span className="status-pill pending">Alert engine not configured</span></section>; }
function SitesPage({sites,networks}:{sites:Site[];networks:Net[]}) { return <div className="sites-grid">{sites.length===0&&<section className="panel empty-panel"><Cable size={26}/><h3>No sites configured</h3><p>Sites and network records will appear here after they are created in the workspace database.</p></section>}{sites.map(site=><section className="panel site-card" key={site.id}><div className="site-head"><MapPin size={18}/><div><h3>{site.name}</h3><p>{site.location||'Location not specified'}</p></div></div><div className="site-meta"><b>{networks.filter(n=>n.site_id===site.id).length}</b><span>Networks</span></div>{networks.filter(n=>n.site_id===site.id).map(n=><div className="network-row" key={n.id}><Network size={15}/><span>{n.name}</span><code>{n.cidr||'No CIDR'}</code></div>)}</section>)}</div>; }
function SettingsPage({user,membership,onSignOut}:{user:User;membership:Membership;onSignOut:()=>void}) { const isOwner=membership.role==='owner'; return <div className="settings-grid"><section className="panel settings-card"><div className="settings-icon"><UserRound size={19}/></div><h3>Account</h3><p>Signed-in identity and authentication status.</p><div className="setting-row"><span>Email</span><b>{user.email}</b></div><div className="setting-row"><span>User ID</span><code>{user.id.slice(0,8)}…</code></div><div className="setting-row"><span>Email verified</span><b>{user.email_confirmed_at?'Verified':'Pending'}</b></div><button className="secondary-action" onClick={onSignOut}><LogOut size={15}/> Sign out</button></section><section className="panel settings-card"><div className="settings-icon"><KeyRound size={19}/></div><h3>Workspace permissions</h3><p>Role-based access is enforced by the database, not just the interface.</p><div className="setting-row"><span>Organization</span><b>{membership.organizations?.name??membership.organization_id}</b></div><div className="setting-row"><span>Your role</span><span className={`role-badge ${isOwner?'owner':''}`}>{membership.role}</span></div>{isOwner?<div className="owner-note"><ShieldCheck size={17}/><span><b>System owner</b><small>You have owner-level access for this organization. Team management and destructive administration actions can be added after the owner account is provisioned.</small></span></div>:<div className="notice-banner">Owner-only controls are hidden from this account.</div>}</section></div>; }
function Stat({icon,label,value,change,tone}:{icon:React.ReactNode,label:string,value:string,change:string,tone:string}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><i className={`stat-icon ${tone}`}>{icon}</i></div><strong>{value}</strong><small>{change}</small></div>; }
function Quick({icon,title,desc,onClick}:{icon:React.ReactNode;title:string;desc:string;onClick:()=>void}) { return <button className="quick-action" onClick={onClick}><span className="quick-icon">{icon}</span><span><b>{title}</b><small>{desc}</small></span><span className="arrow">→</span></button>; }
