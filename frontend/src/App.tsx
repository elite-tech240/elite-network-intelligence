import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, Boxes, Cable, ChevronDown, CircleHelp, LayoutDashboard, LogOut, Network, Search, Settings, ShieldCheck, Wifi, ScrollText, Globe2, FileBarChart, ClipboardList, Gauge, MonitorUp, Zap, LockKeyhole, Eye, EyeOff, MapPin, Server, ArrowUpRight, UserRound, KeyRound, Sun, Moon, Languages, MoreHorizontal, Building2, Check, Plus, Trash2, RefreshCw, Layers } from 'lucide-react';
import type { Session, User } from '@supabase/supabase-js';

type Device = { id: string; hostname: string; ip_address: string | null; status: string; device_type: string | null; last_seen_at: string | null; site_id?: string; archived_at?: string | null; agent_version?: string | null; parent_device_id?: string | null; os_name?: string | null };
type Site = { id: string; name: string; location: string | null };
type Net = { id: string; name: string; cidr: string | null; site_id: string };
type Membership = { organization_id: string; role: 'owner' | 'admin' | 'operator' | 'viewer'; organizations?: { id: string; name: string }[] | null };
import { supabase, configured, apiUrl, fmtBps, LATEST_AGENT_VERSION, SELF_UPDATE_FROM, versionAtLeast, publishedAgentVersion } from './lib';
import { AgentInstaller } from './AgentInstaller';
import { Toaster, ConfirmHost, Flash, confirmDialog, toast, usePrefs, tr, CommandPalette, Drawer, Skeleton, EmptyState, useTable, Th, Pager, Checklist, Select, Counter, type Command, type Prefs } from './ui';
import { LineChart, type Point } from './Chart';
import { LogsPage, UptimePage, ReportsPage, AuditPage, PlatformPage, ChannelsPanel, MaintenancePanel, DiscoveryPanel, DeviceDetail, NocWall } from './Monitoring';
import { VirtualizationPage } from './Virtualization';
const nav = [
  { label: 'Overview', icon: LayoutDashboard, path: '/' }, { label: 'Devices', icon: Boxes, path: '/devices' },
  { label: 'Topology', icon: Network, path: '/topology' }, { label: 'Virtualization', icon: Layers, path: '/virtualization' }, { label: 'Traffic', icon: Activity, path: '/traffic' },
  { label: 'Alerts', icon: Bell, path: '/alerts' }, { label: 'Logs', icon: ScrollText, path: '/logs' },
  { label: 'Uptime', icon: Globe2, path: '/uptime' }, { label: 'Reports', icon: FileBarChart, path: '/reports' },
  { label: 'Audit log', icon: ClipboardList, path: '/audit' }, { label: 'Sites & Networks', icon: Cable, path: '/sites' },
];
const adminNav = { label: 'Platform', icon: Gauge, path: '/platform' };
const pageFromPath = () => [...nav, adminNav].find(n => n.path === window.location.pathname)?.label ?? (window.location.pathname === '/settings' ? 'Settings' : 'Overview');

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [page, setPage] = useState(pageFromPath);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const activeOrgRef = useRef<string>('');
  const [newWs, setNewWs] = useState(false); const [wsName, setWsName] = useState(''); const [wsBusy, setWsBusy] = useState(false);
  const [delWs, setDelWs] = useState(false); const [delName, setDelName] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [archivedDevices, setArchivedDevices] = useState<Device[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [networks, setNetworks] = useState<Net[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [noc, setNoc] = useState(false);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const [palette, setPalette] = useState(false);
  const lang = prefs.lang;
  const [wsOpen, setWsOpen] = useState(false); const wsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!wsOpen) return; const off = (e: MouseEvent) => { if (!wsRef.current?.contains(e.target as Node)) setWsOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, [wsOpen]);
  const orgOf = (m: Membership | null) => { const o: any = m?.organizations; return (Array.isArray(o) ? o[0]?.name : o?.name) ?? 'Workspace'; };
  const switchOrg = (m: Membership) => { activeOrgRef.current = m.organization_id; setMembership(m); setPage('Overview'); };
  const createWs = async (e: FormEvent) => {
    e.preventDefault(); const name = wsName.trim(); if (!name || !supabase || !session?.user) return;
    setWsBusy(true);
    try {
      const { data: newId, error } = await supabase.rpc('create_organization', { p_name: name });
      if (error) throw error;
      activeOrgRef.current = newId as string; setWsName(''); setNewWs(false); setWsOpen(false);
      await loadWorkspace(session.user); setPage('Overview'); toast('Workspace created');
    } catch (err: any) { toast(err?.message ?? 'Could not create the workspace'); }
    finally { setWsBusy(false); }
  };
  const deleteWs = async (e: FormEvent) => {
    e.preventDefault(); if (!supabase || !session?.user || !membership) return;
    setWsBusy(true);
    try {
      const { error } = await supabase.rpc('delete_organization', { p_id: membership.organization_id, p_name: delName.trim() });
      if (error) throw error;
      activeOrgRef.current = ''; setDelName(''); setDelWs(false); setPage('Overview');
      await loadWorkspace(session.user); toast('Workspace deleted');
    } catch (err: any) { toast(err?.message ?? 'Could not delete the workspace'); }
    finally { setWsBusy(false); }
  };
  const orgRaw: any = membership?.organizations; const orgName: string = (Array.isArray(orgRaw) ? orgRaw[0]?.name : orgRaw?.name) ?? 'Workspace';
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loaded = useRef(false);
  const loadWorkspace = useCallback(async (user: User) => {
    if (!supabase) return;
    if (!loaded.current) setDataLoading(true);
    setDataError('');
    try {
      const { data: member, error: memberError } = await supabase.from('organization_members').select('organization_id,role,organizations(id,name)').eq('user_id', user.id);
      if (memberError) throw memberError;
      const list = (member ?? []) as Membership[]; setMemberships(list);
      const picked = list.find(m => m.organization_id === activeOrgRef.current) ?? list[0] ?? null;
      activeOrgRef.current = picked?.organization_id ?? '';
      setMembership(picked);
      if (!picked) { setDevices([]); setArchivedDevices([]); setSites([]); setNetworks([]); return; }
      const orgId = picked.organization_id;
      supabase.from('alert_events').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'open').then(({ count }) => setOpenAlerts(count ?? 0));
      const [deviceResult, siteResult, networkResult] = await Promise.all([
        supabase.from('devices').select('id,hostname,ip_address,status,device_type,last_seen_at,site_id,archived_at,agent_version,parent_device_id,os_name').eq('organization_id', orgId).order('last_seen_at', { ascending: false }),
        supabase.from('sites').select('id,name,location').eq('organization_id', orgId).order('name'),
        supabase.from('networks').select('id,name,cidr,site_id').eq('organization_id', orgId).order('name'),
      ]);
      if (deviceResult.error) throw deviceResult.error;
      if (siteResult.error) throw siteResult.error;
      if (networkResult.error) throw networkResult.error;
      setDevices(((deviceResult.data ?? []) as Device[]).filter(d => !d.archived_at)); setArchivedDevices(((deviceResult.data ?? []) as Device[]).filter(d => Boolean(d.archived_at))); setSites((siteResult.data ?? []) as Site[]); setNetworks((networkResult.data ?? []) as Net[]);
    } catch (e) { setDataError(e instanceof Error ? e.message : 'Could not load workspace data.'); }
    finally { loaded.current = true; setDataLoading(false); }
  }, []);

  useEffect(() => { if (session?.user) void loadWorkspace(session.user); else { loaded.current = false; setMembership(null); setDevices([]); setArchivedDevices([]); setSites([]); setNetworks([]); } }, [session?.user?.id, loadWorkspace]);

  useEffect(() => {
    if (!supabase || !session?.user || !membership?.organization_id) return;
    const orgId = membership.organization_id;
    const channel = supabase.channel('workspace-live-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: 'organization_id=eq.' + orgId }, () => { void loadWorkspace(session.user); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites', filter: 'organization_id=eq.' + orgId }, () => { void loadWorkspace(session.user); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'networks', filter: 'organization_id=eq.' + orgId }, () => { void loadWorkspace(session.user); })
      .subscribe();
    const timer = window.setInterval(() => { void loadWorkspace(session.user); }, 15000);
    return () => { window.clearInterval(timer); void supabase!.removeChannel(channel); };
  }, [session?.user?.id, membership?.organization_id, loadWorkspace]);
  useEffect(() => { const onPop = () => setPage(pageFromPath()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const [pageTab, setPageTab] = useState('');
  const go = (label: string, tab = '') => { setPageTab(tab); const item = [...nav, adminNav].find(n => n.label === label); const path = item?.path ?? (label === 'Settings' ? '/settings' : '/'); window.history.pushState({}, '', path); setPage(label); };
  const signIn = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setBusy(true); setAuthError(''); setNotice(''); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) setAuthError(error.message); setBusy(false); };
  const sendReset = async (e: FormEvent) => { e.preventDefault(); if (!supabase) return; setBusy(true); setAuthError(''); const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` }); if (error) setAuthError(error.message); else setNotice('Password reset email sent. Check your inbox.'); setBusy(false); };
  const signOut = async () => { if (!(await confirmDialog('You will need to sign in again to access your workspace.', { title: 'Sign out?', confirmText: 'Sign out', danger: false }))) return; if (supabase) await supabase.auth.signOut(); window.history.replaceState({}, '', '/login'); setPage('Overview'); };
  const refresh = () => { if (session?.user) void loadWorkspace(session.user); };
  const online = devices.filter(d => deviceStatus(d) === 'online').length;
  const title = tr(lang, page === 'Overview' ? 'Network overview' : page);
  const nonEsxiDevices = useMemo(() => devices.filter(d => d.device_type !== 'esxi_host' && d.device_type !== 'esxi_vm'), [devices]);
  const commands: Command[] = [
    ...[...nav, adminNav, { label: 'Settings' }].filter(n => n.label !== 'Platform' || (membership && ['owner', 'admin'].includes(membership.role))).map(n => ({ id: 'p-' + n.label, label: tr(lang, n.label), hint: tr(lang, 'Pages'), run: () => go(n.label) })),
    ...devices.map(d => ({ id: 'd-' + d.id, label: d.hostname, hint: (d.ip_address ?? '') + ' · ' + tr(lang, 'Devices'), run: () => go('Devices') })),
    { id: 'a-theme', label: prefs.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', hint: 'Appearance', run: () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'a-lang', label: prefs.lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English', hint: 'Language', run: () => setPrefs({ lang: prefs.lang === 'en' ? 'ar' : 'en' }) },
    { id: 'a-dense', label: prefs.dense ? 'Comfortable table density' : 'Compact table density', hint: 'Appearance', run: () => setPrefs({ dense: !prefs.dense }) },
    { id: 'a-noc', label: tr(lang, 'NOC wall'), hint: 'Page', run: () => go('NOC wall') },
  ];

  if (!configured) return <AuthScreen configured={false} email={email} setEmail={setEmail} password={password} setPassword={setPassword} showPassword={showPassword} setShowPassword={setShowPassword} busy={false} error="" notice="" resetMode={false} setResetMode={() => {}} onSubmit={e => e.preventDefault()} />;
  if (!authReady) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark auth-mark"><img src="/elite-mark.svg" alt="" /></div><p className="auth-subtitle">Loading secure session…</p></div></div>;
  if (!session) return <AuthScreen configured email={email} setEmail={setEmail} password={password} setPassword={setPassword} showPassword={showPassword} setShowPassword={setShowPassword} busy={busy} error={authError} notice={notice} resetMode={resetMode} setResetMode={setResetMode} onSubmit={resetMode ? sendReset : signIn} />;

  return <div className="shell"><div className="fx-tape" aria-hidden="true"/>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><img src="/elite-mark.svg" alt="" /></div><div><b>ELITE</b><span>NETWORK INTELLIGENCE</span></div></div>
      <div className="workspace-wrap" ref={wsRef}><button className="workspace" aria-haspopup="menu" aria-expanded={wsOpen} onClick={() => setWsOpen(o => !o)}><div className="workspace-icon">{orgName.slice(0, 2).toUpperCase()}</div><div><b>{orgName}</b><small>{membership ? `${membership.role} access` : 'No organization access'}</small></div><ChevronDown size={15}/></button>
        {wsOpen && <div className="ws-menu" role="menu"><div className="ws-menu-label">Workspaces</div>
          {memberships.map(m => <button key={m.organization_id} role="menuitem" className={m.organization_id === membership?.organization_id ? 'ws-item sel' : 'ws-item'} onClick={() => { setWsOpen(false); switchOrg(m); }}><Building2 size={16}/><span><b>{orgOf(m)}</b><small>{m.role}</small></span>{m.organization_id === membership?.organization_id && <Check size={15}/>}</button>)}
          {!memberships.length && <p className="ws-empty">You have no workspaces yet.</p>}
          <div className="ws-sep"/>
          <button role="menuitem" className="ws-item" onClick={() => { setWsOpen(false); setNewWs(true); }}><Plus size={16}/><span><b>Create workspace</b><small>Start a separate, empty environment</small></span></button>
          </div>}</div>
      <nav>{[['MONITOR', ['Overview','Devices','Topology','Virtualization','Traffic','Alerts','Logs','Uptime']], ['INSIGHTS', ['Reports','Audit log']], ['MANAGE', ['Sites & Networks', ...(membership && ['owner','admin'].includes(membership.role) ? ['Platform'] : [])]]].map(([group, labels]) => <div key={group as string}><div className="nav-label">{tr(lang, group as string)}</div>{[...nav, adminNav].filter(i => (labels as string[]).includes(i.label)).map(item => <button key={item.label} className={page === item.label ? 'nav-item selected' : 'nav-item'} onClick={() => go(item.label)}><item.icon size={17}/>{tr(lang, item.label)}{item.label === 'Alerts' && openAlerts > 0 && <i className="nav-dot"/>}</button>)}</div>)}</nav>
      <div className="nav-label tools-label">{tr(lang, 'PREFERENCES')}</div>
      <button className={page === 'Settings' ? 'nav-item selected' : 'nav-item'} onClick={() => go('Settings')}><Settings size={17}/>{tr(lang, 'Settings')}</button>
      <button className={page === 'NOC wall' ? 'nav-item active' : 'nav-item'} onClick={() => go('NOC wall')}><MonitorUp size={17}/>{tr(lang, 'NOC wall')}</button>
      <a className="nav-item" href="https://github.com/elite-tech240/elite-network-intelligence/tree/main/docs" target="_blank" rel="noreferrer"><CircleHelp size={17}/>{tr(lang, 'Documentation')}</a>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">{(session.user.email?.[0] ?? 'U').toUpperCase()}</div><div><b title={session.user.email ?? ""}>{session.user.email}</b><small>{membership?.role ?? 'No role assigned'}</small></div><button className="mini-icon" title="Sign out" onClick={signOut}><LogOut size={15}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">{tr(lang, 'Workspace')} <span>/</span> <b>{tr(lang, page)}</b></div><div className="top-actions"><button className="search search-btn" onClick={() => setPalette(true)} aria-label="Open command palette"><Search size={15}/><span>{tr(lang, 'Search or jump to…')}</span><kbd>Ctrl K</kbd></button><button className="icon-btn" aria-label="Toggle theme" title="Theme" onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>{prefs.theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-btn" aria-label="Language" title="العربية / English" onClick={() => setPrefs({ lang: prefs.lang === 'en' ? 'ar' : 'en' })}><Languages size={18}/></button><button className="icon-btn" aria-label="Alerts" onClick={() => go('Alerts')}><Bell size={18}/>{openAlerts > 0 && <i/>}</button><div className="avatar small">{(session.user.email?.[0] ?? 'U').toUpperCase()}</div></div></header>
      <section className="content">
        <div className="page-heading"><div><div className="eyebrow">{tr(lang, 'NETWORK OPERATIONS CENTER')}</div><h1>{title}</h1><p>{pageDescription(page)}</p></div></div>
        {notice && <div className="notice-banner">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
        {!membership ? <div className="panel access-panel"><div className="empty-icon"><LockKeyhole size={23}/></div><h2>No workspace access yet</h2><p>Your account is signed in, but it has not been added to an organization. Ask the system owner to assign your account.</p></div> : <>
          <Flash kind="error" msg={dataError ? 'Could not load workspace data: ' + dataError : ''}/>
          {dataLoading && <Skeleton rows={3}/>}
          {page === 'Overview' && <Overview devices={nonEsxiDevices} sites={sites} networks={networks} online={online} loading={dataLoading} go={go} organizationId={membership.organization_id} prefs={prefs} setPrefs={setPrefs}/>}
          {page === 'Devices' && <DevicesPage devices={nonEsxiDevices} archivedDevices={archivedDevices} loading={dataLoading} organizationId={membership.organization_id} role={membership.role} accessToken={session.access_token} onRefresh={refresh} sites={sites}/>}
          {page === 'Topology' && <TopologyPage sites={sites} networks={networks} devices={nonEsxiDevices}/>}
          {page === 'Virtualization' && <VirtualizationPage devices={devices} sites={sites} organizationId={membership.organization_id} accessToken={session.access_token} role={membership.role}/>}
          {page === 'Traffic' && <TrafficPage organizationId={membership.organization_id}/>}
          {page === 'Alerts' && <AlertsPage organizationId={membership.organization_id} role={membership.role}/>}
          {page === 'Logs' && <LogsPage organizationId={membership.organization_id} devices={nonEsxiDevices}/>}
          {page === 'Uptime' && <UptimePage organizationId={membership.organization_id} role={membership.role} token={session.access_token} sites={sites}/>}
          {page === 'Reports' && <ReportsPage organizationId={membership.organization_id} token={session.access_token}/>}
          {page === 'NOC wall' && <NocWall devices={nonEsxiDevices} organizationId={membership.organization_id} embedded onPresent={() => setNoc(true)}/>}
          {page === 'Audit log' && <AuditPage organizationId={membership.organization_id}/>}
          {page === 'Platform' && ['owner','admin'].includes(membership.role) && <PlatformPage organizationId={membership.organization_id} token={session.access_token}/>}
          {page === 'Sites & Networks' && <SitesPage key={'t'+pageTab} initialTab={pageTab} sites={sites} networks={networks} organizationId={membership.organization_id} role={membership.role} accessToken={session.access_token} onRefresh={refresh}/>}
          {page === 'Settings' && <SettingsPage key={'s'+pageTab} initialTab={pageTab} user={session.user} membership={membership} accessToken={session.access_token} onSignOut={signOut} orgName={orgName} onDeleteWorkspace={() => setDelWs(true)}/>}
        </>}
        {newWs && <div className="modal-back" onClick={() => !wsBusy && setNewWs(false)}><div className="modal" role="dialog" aria-modal="true" aria-label="Create workspace" onClick={e => e.stopPropagation()}>
          <div className="modal-icon"><Building2 size={21}/></div>
          <h3>Create workspace</h3>
          <p className="modal-text">A workspace is a separate environment with its own sites, devices, alerts and team. Nothing is shared with {orgName}.</p>
          <form onSubmit={createWs}>
            <label className="field">Workspace name<input autoFocus value={wsName} maxLength={80} onChange={e => setWsName(e.target.value)} placeholder="Acme Head Office"/></label>
            <ol className="ws-steps"><li>You join it as <b>owner</b>.</li><li>Add a site and a network.</li><li>Install the agent to start collecting data.</li></ol>
            <div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setNewWs(false)} disabled={wsBusy}>Cancel</button><button className="primary-action" disabled={wsBusy || !wsName.trim()}>{wsBusy ? 'Creating…' : 'Create workspace'}</button></div>
          </form></div></div>}
        {delWs && membership && <div className="modal-back" onClick={() => !wsBusy && setDelWs(false)}><div className="modal" role="dialog" aria-modal="true" aria-label="Delete workspace" onClick={e => e.stopPropagation()}>
          <div className="modal-icon danger"><Trash2 size={21}/></div>
          <h3>Delete {orgName}?</h3>
          <p className="modal-text">Every site, network, device, metric, alert, uptime check and member in this workspace is deleted with it. This cannot be undone.</p>
          <form onSubmit={deleteWs}>
            <label className="field"><span>Type <b>{orgName}</b> to confirm</span><input autoFocus value={delName} onChange={e => setDelName(e.target.value)} placeholder={orgName}/></label>
            <div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setDelWs(false)} disabled={wsBusy}>Cancel</button><button className="danger-solid" disabled={wsBusy || delName.trim() !== orgName}>{wsBusy ? 'Deleting…' : 'Delete workspace'}</button></div>
          </form></div></div>}
        {noc && membership && <NocWall devices={nonEsxiDevices} organizationId={membership.organization_id} onClose={() => setNoc(false)}/>}
        <div className="footer"><span>ELITE NETWORK INTELLIGENCE <b>v0.4.0</b></span><span>Secure workspace · {membership?.role ?? 'No role'}</span></div>
      </section>
    </main>
    <nav className="bottom-nav" aria-label="Primary">{[['Overview', LayoutDashboard], ['Devices', Boxes], ['Alerts', Bell], ['Uptime', Globe2]].map(([l, Ic]: any) => <button key={l} className={page === l ? 'selected' : ''} onClick={() => go(l)}><Ic size={20}/><span>{tr(lang, l)}</span>{l === 'Alerts' && openAlerts > 0 && <i className="nav-dot"/>}</button>)}<button onClick={() => setPalette(true)}><MoreHorizontal size={20}/><span>More</span></button></nav>
    <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} lang={lang}/>
    <Toaster/><ConfirmHost lang={lang}/>
  </div>;
}

function AuthScreen({configured, email, setEmail, password, setPassword, showPassword, setShowPassword, busy, error, notice, resetMode, setResetMode, onSubmit}:{configured:boolean;email:string;setEmail:(v:string)=>void;password:string;setPassword:(v:string)=>void;showPassword:boolean;setShowPassword:(v:boolean)=>void;busy:boolean;error:string;notice:string;resetMode:boolean;setResetMode:(v:boolean)=>void;onSubmit:(e:FormEvent)=>void}) {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark auth-mark"><img src="/elite-mark.svg" alt="" /></div><div><b>ELITE</b><span>NETWORK INTELLIGENCE</span></div></div><div className="auth-kicker">NETWORK OPERATIONS CENTER</div><h1>{resetMode ? 'Reset your password' : 'Welcome back'}</h1><p className="auth-subtitle">{resetMode ? 'We will email you a secure password reset link.' : 'Sign in to access your network workspace.'}</p>
    {!configured ? <div className="setup-banner auth-setup"><Zap size={18}/><div><b>Connect Supabase to enable sign in</b><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel project settings, then redeploy.</p></div></div> : <form onSubmit={onSubmit} className="auth-form"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)} required/><label htmlFor="password">{resetMode ? ' ' : 'Password'}</label>{!resetMode && <div className="password-field"><input id="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>}{error && <div className="error-banner">{error}</div>}{notice && <div className="notice-banner">{notice}</div>}<button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : resetMode ? 'Send reset link' : 'Sign in securely'} <ArrowUpRight size={16}/></button></form>}
    {configured && <button className="auth-link" onClick={()=>setResetMode(!resetMode)}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>}<div className="auth-foot"><ShieldCheck size={15}/> Protected by secure authentication · No public sign-up</div></div></div>;
}

function pageDescription(page:string) { return ({Overview:'Monitor the health and activity of your network infrastructure.',Devices:'Every enrolled endpoint and its latest reported status.',Topology:'Understand how your sites, networks, and devices are connected.',Traffic:'Network traffic analytics and telemetry.',Alerts:'Review incidents and configure alerting workflows.',Logs:'Warnings, errors and failed sign-ins collected from your devices.',Uptime:'Check that your websites and services are reachable.',Reports:'Availability, usage and incident summaries.','Audit log':'A record of who changed what in this workspace.',Platform:'Health of the monitoring service itself.', 'Sites & Networks':'Manage the physical sites and logical networks in your workspace.',Settings:'Account identity, workspace permissions, and system administration.'} as Record<string,string>)[page] ?? ''; }
function Kpi({icon,label,value,sub,tone,onClick}:{icon:React.ReactNode;label:string;value:React.ReactNode;sub:string;tone:string;onClick:()=>void}) {
 return <button className={`ov-kpi ${tone}`} onClick={onClick}><span className="ov-kpi-icon">{icon}</span><span className="ov-kpi-label">{label}</span><strong>{value}</strong><small>{sub}</small><ArrowUpRight className="ov-kpi-go" size={16}/></button>;
}
function Overview({devices,sites,networks,online,loading,go,organizationId,prefs,setPrefs}:{devices:Device[];sites:Site[];networks:Net[];online:number;loading:boolean;go:(s:string,tab?:string)=>void;organizationId:string;prefs:Prefs;setPrefs:(p:Partial<Prefs>)=>void}) {
 const [rows,setRows]=useState<any[]>([]),[counts,setCounts]=useState({uptime:0,channels:0}),[alerts,setAlerts]=useState<any[]>([]);
 useEffect(()=>{let on=true;if(!supabase)return;const load=()=>{supabase!.from('device_metrics').select('cpu_percent,net_recv_bps,net_sent_bps,recorded_at').eq('organization_id',organizationId).gte('recorded_at',new Date(Date.now()-3600000).toISOString()).order('recorded_at').limit(1500).then(({data})=>{if(on)setRows(data??[]);});supabase!.from('alert_events').select('id,title,severity,triggered_at,status').eq('organization_id',organizationId).in('status',['open','acknowledged']).order('triggered_at',{ascending:false}).limit(5).then(({data})=>{if(on)setAlerts(data??[]);});Promise.all([supabase!.from('uptime_checks').select('id',{count:'exact',head:true}).eq('organization_id',organizationId),supabase!.from('notification_channels').select('id',{count:'exact',head:true}).eq('organization_id',organizationId)]).then(([a,b])=>{if(on)setCounts({uptime:a.count??0,channels:b.count??0});});};load();const t=window.setInterval(load,20000);const ch=supabase!.channel('metrics-live-'+organizationId).on('postgres_changes',{event:'INSERT',schema:'public',table:'device_metrics',filter:'organization_id=eq.'+organizationId},(p:any)=>{const r=p.new;if(!on||!r?.recorded_at)return;setRows(prev=>{const cut=Date.now()-3600000;const next=[...prev,{cpu_percent:r.cpu_percent,net_recv_bps:r.net_recv_bps,net_sent_bps:r.net_sent_bps,recorded_at:r.recorded_at}];return next.filter(x=>new Date(x.recorded_at).getTime()>=cut);});}).subscribe();return()=>{on=false;window.clearInterval(t);supabase!.removeChannel(ch);};},[organizationId]);
 const series=useMemo(()=>{const b=new Map<number,{c:number[];n:number[]}>();rows.forEach(r=>{const k=Math.floor(new Date(r.recorded_at).getTime()/60000);const e=b.get(k)??{c:[],n:[]};if(r.cpu_percent!=null)e.c.push(Number(r.cpu_percent));e.n.push(Number(r.net_recv_bps??0)+Number(r.net_sent_bps??0));b.set(k,e);});const avg=(x:number[])=>x.length?x.reduce((p,q)=>p+q,0)/x.length:null;const keys=[...b.keys()].sort((x,y)=>x-y);return{cpu:keys.map(k=>({t:k*60000,v:avg(b.get(k)!.c)})) as Point[],net:keys.map(k=>({t:k*60000,v:avg(b.get(k)!.n)})) as Point[]};},[rows]);
 const lastCpu=[...series.cpu].reverse().find(p=>p.v!=null)?.v,lastNet=[...series.net].reverse().find(p=>p.v!=null)?.v;
 const offline=Math.max(0,devices.length-online);
 const availability=devices.length?Math.round((online/devices.length)*100):0;
 const workstation=devices.filter(d=>d.device_type==='workstation').length;
 const steps=[{id:'site',label:'Add your first site',done:sites.length>0,go:()=>go('Sites & Networks','sites')},{id:'net',label:'Add a network (CIDR range)',done:networks.length>0,go:()=>go('Sites & Networks','networks')},{id:'agent',label:'Install an agent on a device',done:devices.length>0,go:()=>go('Sites & Networks','agents')},{id:'uptime',label:'Create an uptime check',done:counts.uptime>0,go:()=>go('Uptime')},{id:'notify',label:'Set up a notification channel',done:counts.channels>0,go:()=>go('Settings','notify')}];
 const v=(x:React.ReactNode)=>loading?'—':x;
 return <div className="ov">
  <div className="ov-kpis">
   <Kpi tone="orange" icon={<Boxes size={18}/>} label="Total devices" value={v(<Counter value={devices.length}/>)} sub="Registered endpoints" onClick={()=>go('Devices')}/>
   <Kpi tone="green" icon={<Wifi size={18}/>} label="Online" value={v(<Counter value={online}/>)} sub="Reporting right now" onClick={()=>go('Devices')}/>
   <Kpi tone={offline?'red':'muted'} icon={<Activity size={18}/>} label="Offline" value={v(<Counter value={offline}/>)} sub={offline?'Needs attention':'Everything is reporting'} onClick={()=>go('Devices')}/>
   <Kpi tone="blue" icon={<Network size={18}/>} label="Networks / Sites" value={v(<><Counter value={networks.length}/><em> / {sites.length}</em></>)} sub="Configured infrastructure" onClick={()=>go('Sites & Networks')}/>
  </div>
  {!prefs.onboardDone&&<Checklist steps={steps} lang={prefs.lang} onDismiss={()=>setPrefs({onboardDone:true})}/>}
  <div className="ov-row two">
   <section className="panel ov-card"><div className="card-head"><div><h3>Fleet health</h3><p>Based on the latest device heartbeat</p></div><button className="text-button" onClick={()=>go('Devices')}>Inventory →</button></div>
    <div className="ov-health"><div className="health-ring" style={{'--health-value':availability} as React.CSSProperties}><div><strong>{v(availability+'%')}</strong><small>Online rate</small></div></div>
     <ul className="ov-legend"><li><i className="g"/>Online<b>{v(online)}</b></li><li><i className="r"/>Offline<b>{v(offline)}</b></li><li><i className="m"/>Workstations<b>{v(workstation)}</b></li><li><i className="m"/>Servers & other<b>{v(Math.max(0,devices.length-workstation))}</b></li></ul></div></section>
   <section className="panel ov-card"><div className="card-head"><div><h3>Activity</h3><p>Averages across all devices, last hour</p></div><button className="text-button" onClick={()=>go('Traffic')}>Traffic →</button></div>
    <div className="ov-metrics"><div><div className="ov-metric-head"><span>Average CPU</span><strong>{lastCpu==null?'—':Math.round(lastCpu)+'%'}</strong></div><LineChart points={series.cpu} color="#f5630f" height={150} max={100} unit="%"/></div><div><div className="ov-metric-head"><span>Network throughput</span><strong>{lastNet==null?'—':fmtBps(lastNet)}</strong></div><LineChart points={series.net} color="#5ba6ff" height={150} format={fmtBps}/></div></div></section>
  </div>
  <div className="ov-row split">
   <section className="panel ov-card"><div className="card-head"><div><h3>Recently active devices</h3><p>Latest endpoints in your workspace</p></div><button className="text-button" onClick={()=>go('Devices')}>View all →</button></div>{loading?<Skeleton rows={3}/>:devices.length?<ul className="ov-devices">{devices.slice(0,6).map(d=><li key={d.id}><span className="device-icon"><Server size={15}/></span><div><b>{d.hostname}</b><small>{d.ip_address??'—'} · {d.device_type??'device'}</small></div><span className={`status-pill ${deviceStatus(d)==='online'?'online':deviceStatus(d)==='offline'?'offline':'pending'}`}><i/>{deviceStatus(d)}</span><small className="ov-seen">{d.last_seen_at?new Date(d.last_seen_at).toLocaleString():'Never'}</small></li>)}</ul>:<EmptyState icon={<Boxes size={22}/>} title="No devices yet" text="Install the agent and it will appear here."/>}</section>
   <div className="ov-stack">
    <section className="panel ov-card"><div className="card-head"><div><h3>Open alerts</h3><p>Needs a look</p></div><button className="text-button" onClick={()=>go('Alerts')}>All alerts →</button></div>
     {alerts.length?<ul className="ov-alerts">{alerts.map(a=><li key={a.id}><span className={`sev sev-${a.severity}`}>{a.severity}</span><b>{a.title}</b><small>{new Date(a.triggered_at).toLocaleString()}</small></li>)}</ul>:<EmptyState icon={<ShieldCheck size={22}/>} title="All clear" text="No open alerts right now."/>}</section>
    <section className="panel ov-card"><div className="card-head"><div><h3>Quick access</h3></div></div>
     <Quick icon={<Network/>} title="Network topology" desc="Explore sites and segments" onClick={()=>go('Topology')}/>
     <Quick icon={<Activity/>} title="Traffic analytics" desc="Review network counters" onClick={()=>go('Traffic')}/>
     <Quick icon={<Globe2/>} title="Uptime checks" desc="Websites and ports" onClick={()=>go('Uptime')}/></section>
   </div>
  </div>
 </div>;
}
function DevicesPage({devices,archivedDevices,loading,organizationId,role,accessToken,onRefresh,sites}:{sites:Site[];devices:Device[];archivedDevices:Device[];loading:boolean;organizationId:string;role:Membership['role'];accessToken:string;onRefresh:()=>void}) {
 const [openId,setOpenId]=useState(''),[filter,setFilter]=useState('all'),[metrics,setMetrics]=useState<any[]>([]),[actionError,setActionError]=useState(''),[actionMessage,setActionMessage]=useState(''),[busyDevice,setBusyDevice]=useState(''),[tab,setTab]=useState('inventory');
 const filtered=useMemo(()=>devices.filter(d=>filter==='all'||deviceStatus(d)===filter),[devices,filter]);
 useEffect(()=>{let active=true;if(!supabase)return;const loadMetrics=()=>{supabase!.from('device_metrics').select('device_id,cpu_percent,memory_percent,disk_percent,recorded_at').eq('organization_id',organizationId).order('recorded_at',{ascending:false}).limit(250).then(({data})=>{if(active)setMetrics(data??[]);});};void loadMetrics();const timer=window.setInterval(loadMetrics,15000);return()=>{active=false;window.clearInterval(timer);};},[organizationId,devices.length]);
 const latest=new Map<string,any>();metrics.forEach(m=>{if(!latest.has(m.device_id))latest.set(m.device_id,m);});
 const canManage=['owner','admin'].includes(role);
 const [latestVersion,setLatestVersion]=useState(LATEST_AGENT_VERSION),[updBusy,setUpdBusy]=useState(false);
 useEffect(()=>{void publishedAgentVersion().then(setLatestVersion);},[]);
 const outdated=devices.filter(d=>d.agent_version!==latestVersion&&versionAtLeast(d.agent_version,SELF_UPDATE_FROM));
 const needManual=devices.filter(d=>d.agent_version!==latestVersion&&!versionAtLeast(d.agent_version,SELF_UPDATE_FROM));
 const updateAll=async()=>{
   if(!supabase)return;
   const ok=await confirmDialog(`Send the update to ${latestVersion} to ${outdated.length} device${outdated.length===1?'':'s'}? Only devices reporting right now will pick it up.`,{title:'Update outdated agents',confirmText:'Send update'});
   if(!ok)return;
   setUpdBusy(true);
   try{
     const {data,error}=await supabase.rpc('request_agent_upgrade_all',{p_organization_id:organizationId});
     if(error)throw error;
     const n=Number(data??0);
     toast(n?`Update sent to ${n} device${n===1?'':'s'}`:'No device was ready for the update');
     onRefresh();
   }catch(err:any){toast(err?.message??'Could not send the update');}
   finally{setUpdBusy(false);}
 };
 const action=async(id:string,kind:'archive'|'restore'|'uninstall')=>{const device=[...devices,...archivedDevices].find(d=>d.id===id);if(!device)return;if(kind==='archive'&&deviceStatus(device)!=='offline'){setActionError('Only offline devices can be archived.');return;}if(kind==='uninstall'&&deviceStatus(device)!=='online'){setActionError('Remote uninstall requires an online device.');return;}const prompts={archive:'Archive this offline device? History will be retained.',restore:'Restore this device to active inventory?',uninstall:'Send remote uninstall to this online Windows agent? Local agent files and credentials will be removed; history remains.'};if(!await confirmDialog(prompts[kind]))return;setBusyDevice(id);setActionError('');setActionMessage('');try{const response=await fetch(apiUrl+'/devices/'+id+'/'+kind,{method:'POST',headers:{Authorization:'Bearer '+accessToken}});const body=await response.json();if(!response.ok)throw new Error(body.detail||'Device action failed');setActionMessage(kind==='uninstall'?'Uninstall queued. The agent will remove itself on its next heartbeat.':kind==='archive'?'Device archived. History retained.':'Device restored.');onRefresh();}catch(e){setActionError(e instanceof Error?e.message:'Device action failed.');}finally{setBusyDevice('');}};
 return <div className="sites-workspace"><PageTabs items={[{id:'inventory',label:'Inventory'},{id:'health',label:'Health metrics'},{id:'access',label:'Credentials'},{id:'charts',label:'Charts'},{id:'discovered',label:'Discovered'},{id:'archived',label:'Archived devices'}]} active={tab} onChange={setTab}/><Flash kind="error" msg={actionError}/><Flash kind="success" msg={actionMessage}/>
 {tab==='inventory'&&<section className="panel page-panel"><div className="panel-head"><div><h3>Device inventory</h3><p>{devices.length} active assets{outdated.length?` · ${outdated.length} can update from here`:''}{needManual.length?` · ${needManual.length} need the installer run once`:''} · Only offline devices can be archived</p></div>{role==='owner'&&outdated.length>0&&<button className="secondary-action" onClick={updateAll} disabled={updBusy}><RefreshCw size={15}/>{updBusy?'Sending…':`Update ${outdated.length} agent${outdated.length===1?'':'s'}`}</button>}<Select className="filter-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="online">Online</option><option value="offline">Offline</option><option value="degraded">Degraded</option><option value="unknown">Unknown</option></Select></div><DeviceTable devices={filtered} loading={loading} onOpen={setOpenId} onArchive={canManage?id=>action(id,'archive'):undefined} onUninstall={canManage?id=>action(id,'uninstall'):undefined} busyDevice={busyDevice}/></section>}
 {tab==='health'&&<section className="panel page-panel"><div className="panel-head"><div><h3>Latest device health</h3><p>CPU, memory and disk from authenticated heartbeats.</p></div></div><div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>CPU</th><th>MEMORY</th><th>DISK</th><th>UPDATED</th></tr></thead><tbody>{filtered.map(d=>{const m=latest.get(d.id);return <tr key={d.id}><td>{d.hostname}</td><td>{m?.cpu_percent==null?'—':m.cpu_percent.toFixed(1)+'%'}</td><td>{m?.memory_percent==null?'—':m.memory_percent.toFixed(1)+'%'}</td><td>{m?.disk_percent==null?'—':m.disk_percent.toFixed(1)+'%'}</td><td>{m?.recorded_at?new Date(m.recorded_at).toLocaleString():'No metrics yet'}</td></tr>;})}{!filtered.length&&<tr><td colSpan={5} className="empty">No health metrics available.</td></tr>}</tbody></table></div></section>}
 {tab==='access'&&<section className="panel page-panel"><h3>Device credential control</h3><p>Revoke compromised or retired agent credentials. Telemetry history remains preserved.</p>{canManage?<div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>STATUS</th><th></th></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td>{d.hostname}</td><td>{deviceStatus(d)}</td><td><button className="danger-action" disabled={busyDevice===d.id} onClick={async()=>{if(await confirmDialog('Revoke this credential? The agent must be enrolled again.'))void (async()=>{setBusyDevice(d.id);try{const r=await fetch(apiUrl+'/devices/'+d.id+'/revoke',{method:'POST',headers:{Authorization:'Bearer '+accessToken}});const v=await r.json();if(!r.ok)throw new Error(v.detail||'Revoke failed');onRefresh();}catch(e){setActionError(e instanceof Error?e.message:'Revoke failed');}finally{setBusyDevice('');}})();}}>Revoke credential</button></td></tr>)}</tbody></table></div>:<p className="muted">Only owners and admins can revoke device credentials.</p>}</section>}
 {tab==='charts'&&<DeviceDetail devices={devices as any}/>}
 {tab==='discovered'&&<DiscoveryPanel organizationId={organizationId} role={role} sites={sites}/>}
 {openId&&<Drawer title={devices.find(d=>d.id===openId)?.hostname??'Device'} onClose={()=>setOpenId('')}><DeviceDetail devices={devices.filter(d=>d.id===openId) as any}/></Drawer>}
 {tab==='archived'&&<section className="panel page-panel"><div className="panel-head"><div><h3>Archived devices</h3><p>Telemetry and alert history are retained. Restore to active inventory at any time.</p></div><span className="status-pill pending">{archivedDevices.length} archived</span></div><div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>IP ADDRESS</th><th>ARCHIVED AT</th><th>ACTION</th></tr></thead><tbody>{archivedDevices.map(d=><tr key={d.id}><td><b>{d.hostname}</b></td><td>{d.ip_address??'—'}</td><td>{d.archived_at?new Date(d.archived_at).toLocaleString():'—'}</td><td>{canManage&&<button className="secondary-action" onClick={()=>action(d.id,'restore')} disabled={busyDevice===d.id}>Restore</button>}</td></tr>)}{!archivedDevices.length&&<tr><td colSpan={4} className="empty">No archived devices.</td></tr>}</tbody></table></div></section>}
 </div>;
}
function deviceStatus(device:Device) { if (!device.last_seen_at) return 'unknown'; return Date.now()-new Date(device.last_seen_at).getTime()>120000 ? 'offline' : device.status; }
function DeviceTable({devices,loading,onArchive,onUninstall,busyDevice,onOpen}:{devices:Device[];loading:boolean;onArchive?:(id:string)=>void;onUninstall?:(id:string)=>void;busyDevice?:string;onOpen?:(id:string)=>void}) { const actions=Boolean(onArchive||onUninstall);const t=useTable(devices,(d,k)=>k==='status'?deviceStatus(d):k==='last_seen_at'?(d.last_seen_at?new Date(d.last_seen_at).getTime():0):(d as any)[k]);return <><div className="table-wrap"><table><thead><tr><Th t={t} k="hostname">DEVICE</Th><Th t={t} k="ip_address">IP ADDRESS</Th><Th t={t} k="device_type">TYPE</Th><Th t={t} k="last_seen_at">LAST SEEN</Th><Th t={t} k="status">STATUS</Th>{actions&&<th>ACTIONS</th>}</tr></thead><tbody>{loading&&<tr><td colSpan={actions?6:5} className="empty"><Skeleton rows={3}/></td></tr>}{!loading&&t.rows.map(d=><tr key={d.id} className={onOpen?'row-click':''} onClick={()=>onOpen?.(d.id)}><td><div className="device-name"><span className="device-icon"><Server size={15}/></span><b>{d.hostname}</b></div></td><td>{d.ip_address??'—'}</td><td>{d.device_type??'Unknown'}</td><td>{d.last_seen_at?new Date(d.last_seen_at).toLocaleString():'Never'}</td><td><span className={`status-pill ${deviceStatus(d)==='online'?'online':deviceStatus(d)==='offline'?'offline':'pending'}`}><i/>{deviceStatus(d)}</span></td>{actions&&<td><div className="row-actions" onClick={e=>e.stopPropagation()}>{onArchive&&deviceStatus(d)==='offline'&&<button className="secondary-action" disabled={busyDevice===d.id} onClick={()=>onArchive(d.id)}>Archive</button>}{onUninstall&&d.device_type==='workstation'&&<button className="danger-action" disabled={busyDevice===d.id||deviceStatus(d)!=='online'} onClick={()=>onUninstall(d.id)}>{busyDevice===d.id?'Working…':'Uninstall agent'}</button>}</div></td>}</tr>)}{!loading&&devices.length===0&&<tr><td colSpan={actions?6:5}><EmptyState icon={<Boxes size={22}/>} title="No devices yet" text="Install the agent on a computer or server and it will appear here within a minute."/></td></tr>}</tbody></table></div><Pager t={t}/></>; }
function TopologyPage({sites,networks,devices}:{sites:Site[];networks:Net[];devices:Device[]}) {
 const [tab,setTab]=useState('sites');
 return <div className="sites-workspace"><PageTabs items={[{id:'sites',label:'Sites'},{id:'networks',label:'Networks'},{id:'devices',label:'Devices'}]} active={tab} onChange={setTab}/>
 {tab==='sites'&&(sites.length===0
  ? <section className="panel empty-panel"><Network size={26}/><h3>No topology data yet</h3><p>Add a site and network to start mapping your infrastructure.</p></section>
  : <section className="panel topo2"><div className="panel-head"><div><h3>Infrastructure map</h3><p>Sites, the networks inside them, and the devices reporting from each.</p></div><span className="topo2-legend"><i className="on"/>online<i className="off"/>offline</span></div>
    <div className="topo2-body">{sites.map(site=>{const nets=networks.filter(n=>n.site_id===site.id);const siteDevs=devices.filter(d=>d.site_id===site.id);const onCount=siteDevs.filter(d=>deviceStatus(d)==='online').length;
     return <div className="topo2-site" key={site.id}>
      <div className="topo2-node site"><span className="topo2-icon"><MapPin size={16}/></span><div><b>{site.name}</b><small>{site.location||'Location not specified'}</small></div><span className="topo2-count">{siteDevs.length} device{siteDevs.length===1?'':'s'} · {onCount} online</span></div>
      <div className="topo2-branch">{nets.length===0
        ? <div className="topo2-leafless">No networks assigned.</div>
        : nets.map(net=>{const nd=siteDevs;return <div className="topo2-net" key={net.id}>
          <div className="topo2-node net"><span className="topo2-icon"><Network size={15}/></span><div><b>{net.name}</b><small>{net.cidr||'CIDR not set'}</small></div></div>
          <div className="topo2-devices">{nd.length===0?<span className="topo2-leafless">No devices reporting.</span>:nd.map(d=><span className={'topo2-dev '+deviceStatus(d)} key={d.id} title={d.ip_address??''}><i/>{d.hostname}</span>)}</div>
        </div>;})}</div>
     </div>;})}</div></section>)}
 {tab==='networks'&&<section className="panel page-panel"><div className="table-wrap"><table><thead><tr><th>NETWORK</th><th>CIDR</th><th>SITE</th><th>DEVICES</th></tr></thead><tbody>{networks.map(n=><tr key={n.id}><td>{n.name}</td><td>{n.cidr||'—'}</td><td>{sites.find(s=>s.id===n.site_id)?.name??'—'}</td><td>{devices.filter(d=>d.site_id===n.site_id).length}</td></tr>)}{!networks.length&&<tr><td colSpan={4} className="empty">No networks available.</td></tr>}</tbody></table></div></section>}
 {tab==='devices'&&<section className="panel page-panel"><DeviceTable devices={devices} loading={false}/></section>}
 </div>;
}
function TrafficPage({organizationId}:{organizationId:string}) {
 const [rows,setRows]=useState<any[]>([]),[tab,setTab]=useState('all');
 const tt=useTable(rows,(r,k)=>{const d=Array.isArray(r.devices)?r.devices[0]:r.devices;return k==='hostname'?d?.hostname:k==='type'?d?.device_type:k==='recorded_at'?new Date(r.recorded_at).getTime():Number(r[k]??0);},25);
 useEffect(()=>{let active=true;if(!supabase)return;const loadRows=()=>{supabase!.from('device_metrics').select('device_id,bytes_sent,bytes_recv,net_sent_bps,net_recv_bps,recorded_at,devices(hostname,device_type)').eq('organization_id',organizationId).order('recorded_at',{ascending:false}).limit(100).then(({data})=>{if(active)setRows(data??[]);});};void loadRows();const channel=supabase.channel('traffic-live-'+organizationId).on('postgres_changes',{event:'*',schema:'public',table:'device_metrics',filter:'organization_id=eq.'+organizationId},()=>{void loadRows();}).subscribe();const timer=window.setInterval(loadRows,15000);return()=>{active=false;window.clearInterval(timer);void supabase!.removeChannel(channel);};},[organizationId]);
 return <div className="sites-workspace"><PageTabs items={[{id:'all',label:'All counters'},{id:'sent',label:'Outbound'},{id:'received',label:'Inbound'}]} active={tab} onChange={setTab}/><section className="panel page-panel"><div className="panel-head"><div><h3>Network interface counters</h3><p>Cumulative host counters and aggregate SNMP interface octets, not per-flow packet inspection.</p></div></div><div className="table-wrap"><table><thead><tr><Th t={tt} k="hostname">DEVICE</Th><Th t={tt} k="type">TYPE</Th>{tab!=='received'&&<Th t={tt} k="bytes_sent">BYTES SENT</Th>}{tab!=='sent'&&<Th t={tt} k="bytes_recv">BYTES RECEIVED</Th>}<Th t={tt} k="net_sent_bps">UPLOAD RATE</Th><Th t={tt} k="net_recv_bps">DOWNLOAD RATE</Th><Th t={tt} k="recorded_at">REPORTED AT</Th></tr></thead><tbody>{tt.rows.map((r,i)=>{const d=Array.isArray(r.devices)?r.devices[0]:r.devices;return <tr key={r.device_id+r.recorded_at+i}><td>{d?.hostname??r.device_id.slice(0,8)}</td><td>{d?.device_type??'device'}</td>{tab!=='received'&&<td>{r.bytes_sent==null?'—':Number(r.bytes_sent).toLocaleString()}</td>}{tab!=='sent'&&<td>{r.bytes_recv==null?'—':Number(r.bytes_recv).toLocaleString()}</td>}<td>{fmtBps(r.net_sent_bps)}</td><td>{fmtBps(r.net_recv_bps)}</td><td>{new Date(r.recorded_at).toLocaleString()}</td></tr>;})}{!rows.length&&<tr><td colSpan={7} className="empty">No network counters received yet.</td></tr>}</tbody></table></div><Pager t={tt}/></section></div>;
}
function AlertsPage({organizationId,role}:{organizationId:string;role:Membership['role']}) {
 const [events,setEvents]=useState<any[]>([]),[rules,setRules]=useState<any[]>([]),[tab,setTab]=useState('events');
 const [name,setName]=useState('High CPU'),[metric,setMetric]=useState('cpu_percent'),[threshold,setThreshold]=useState('85'),[operator,setOperator]=useState('gt'),[editingId,setEditingId]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);const canManage=['owner','admin','operator'].includes(role);
 const load=useCallback(async()=>{if(!supabase)return;const [a,b]=await Promise.all([supabase.from('alert_events').select('id,title,message,severity,status,source,triggered_at').eq('organization_id',organizationId).order('triggered_at',{ascending:false}).limit(100),supabase.from('alert_rules').select('id,name,metric,operator,threshold,enabled').eq('organization_id',organizationId).order('created_at',{ascending:false})]);if(!a.error)setEvents(a.data??[]);if(!b.error)setRules(b.data??[]);},[organizationId]);
 useEffect(()=>{void load();const channel=supabase?.channel('alerts-live-'+organizationId).on('postgres_changes',{event:'*',schema:'public',table:'alert_events',filter:'organization_id=eq.'+organizationId},()=>{void load();}).on('postgres_changes',{event:'*',schema:'public',table:'alert_rules',filter:'organization_id=eq.'+organizationId},()=>{void load();}).subscribe();const timer=window.setInterval(()=>{void load();},15000);return()=>{window.clearInterval(timer);if(channel&&supabase)void supabase.removeChannel(channel);};},[load,organizationId]);
 const reset=()=>{setEditingId('');setName('High CPU');setMetric('cpu_percent');setThreshold('85');setOperator('gt');setError('');};
 const edit=(r:any)=>{setEditingId(r.id);setName(r.name);setMetric(r.metric);setThreshold(String(r.threshold??85));setOperator(r.operator??'gt');setTab('rules');};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setBusy(true);setError('');const payload={name:name.trim(),metric,operator,threshold:metric==='device_offline'?null:Number(threshold),enabled:true};const result=editingId?await supabase.from('alert_rules').update(payload).eq('id',editingId).eq('organization_id',organizationId):await supabase.from('alert_rules').insert({...payload,organization_id:organizationId});setBusy(false);if(result.error){setError(result.error.message);return;}reset();await load();};
 const remove=async(id:string)=>{if(!supabase||!await confirmDialog('Delete this rule? Existing alert events are retained.'))return;const {error}=await supabase.from('alert_rules').delete().eq('id',id).eq('organization_id',organizationId);if(error)setError(error.message);else await load();};
 const resolve=async(id:string)=>{if(!supabase)return;const {error}=await supabase.from('alert_events').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',id);if(error)setError(error.message);else await load();};
 const acknowledge=async(id:string)=>{if(!supabase)return;const {error}=await supabase.from('alert_events').update({status:'acknowledged',acknowledged_at:new Date().toISOString()}).eq('id',id);if(error)setError(error.message);else await load();};
 return <div className="sites-workspace"><PageTabs items={[{id:'events',label:'Alert events'},{id:'rules',label:'Alert rules'}]} active={tab} onChange={setTab}/><Flash kind="error" msg={error}/>
 {tab==='events'&&<section className="panel page-panel"><div className="panel-head"><div><h3>Alert events</h3><p>Incident history is retained for audit and troubleshooting.</p></div><span className="status-pill pending">{events.filter(e=>e.status==='open').length} open</span></div><div className="table-wrap"><table><thead><tr><th>ALERT</th><th>SEVERITY</th><th>STATUS</th><th>TRIGGERED</th><th></th></tr></thead><tbody>{events.map(e=><tr key={e.id} className={`alert-row ${e.status}`}><td><b>{e.title}</b><div className="muted">{e.message}</div></td><td><span className={`sev sev-${e.severity}`}>{e.severity}</span></td><td><span className={`state-pill state-${e.status}`}>{e.status==='open'?'Unresolved':e.status==='acknowledged'?'Acknowledged':'Resolved'}</span>{e.source&&e.source!=='metric'&&<small className="muted src">{e.source}</small>}</td><td>{new Date(e.triggered_at).toLocaleString()}</td><td><div className="row-actions">{canManage&&e.status==='open'&&<button className="secondary-action" onClick={()=>acknowledge(e.id)}>Acknowledge</button>}{canManage&&e.status!=='resolved'&&<button className="primary-action sm" onClick={()=>resolve(e.id)}>Resolve</button>}</div></td></tr>)}{events.length===0&&<tr><td colSpan={5} className="empty">No alert events yet.</td></tr>}</tbody></table></div></section>}
 {tab==='rules'&&<><section className="panel page-panel"><h3>{editingId?'Edit alert rule':'Alert rules'}</h3><p>Create and manage threshold rules.</p>{canManage&&<form className="asset-form" onSubmit={save}><label>Rule name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></label><label>Metric<Select value={metric} onChange={e=>setMetric(e.target.value)}><option value="cpu_percent">CPU</option><option value="memory_percent">Memory</option><option value="disk_percent">Disk</option><option value="device_offline">Device offline</option></Select></label>{metric!=='device_offline'&&<label>Threshold (%)<input type="number" min="1" max="100" value={threshold} onChange={e=>setThreshold(e.target.value)} required/></label>}<label>Condition<Select value={operator} onChange={e=>setOperator(e.target.value)}><option value="gt">Greater than</option><option value="gte">Greater than or equal</option></Select></label><div className="form-actions"><button type="button" className="secondary-action" onClick={reset}>Clear</button><button className="primary-action" disabled={busy}>{busy?'Saving…':editingId?'Save changes':'Create rule'}</button></div></form>}</section><section className="panel page-panel"><div className="table-wrap"><table><thead><tr><th>RULE</th><th>METRIC</th><th>THRESHOLD</th><th>STATE</th><th>ACTIONS</th></tr></thead><tbody>{rules.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.metric}</td><td>{r.threshold==null?'—':String(r.threshold)+'%'}</td><td>{r.enabled?'Enabled':'Disabled'}</td><td>{canManage&&<div className="row-actions"><button className="secondary-action" onClick={()=>edit(r)}>Edit</button><button className="danger-action" onClick={()=>remove(r.id)}>Delete</button></div>}</td></tr>)}{rules.length===0&&<tr><td colSpan={5} className="empty">No alert rules configured.</td></tr>}</tbody></table></div></section></>}
 </div>;
}
function SitesPage({initialTab,sites,networks,organizationId,role,accessToken,onRefresh}:{initialTab?:string;sites:Site[];networks:Net[];organizationId:string;role:Membership['role'];accessToken:string;onRefresh:()=>void}) {
 const [tab,setTab]=useState(initialTab||'sites'),[showSite,setShowSite]=useState(false),[showNetwork,setShowNetwork]=useState(false),[editingSite,setEditingSite]=useState<Site|null>(null),[editingNetwork,setEditingNetwork]=useState<Net|null>(null);
 const [siteName,setSiteName]=useState(''),[location,setLocation]=useState(''),[networkName,setNetworkName]=useState(''),[cidr,setCidr]=useState(''),[siteId,setSiteId]=useState('');
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const canManage=['owner','admin','operator'].includes(role),canDelete=['owner','admin'].includes(role);
 const openSite=(v?:Site)=>{setEditingSite(v??null);setSiteName(v?.name??'');setLocation(v?.location??'');setShowSite(true);setTab('sites');};
 const openNetwork=(v?:Net)=>{setEditingNetwork(v??null);setNetworkName(v?.name??'');setCidr(v?.cidr??'');setSiteId(v?.site_id??sites[0]?.id??'');setShowNetwork(true);setTab('networks');};
 const saveSite=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setSaving(true);setError('');const payload={name:siteName.trim(),location:location.trim()||null};const result=editingSite?await supabase.from('sites').update(payload).eq('id',editingSite.id).eq('organization_id',organizationId):await supabase.from('sites').insert({...payload,organization_id:organizationId});setSaving(false);if(result.error){setError(result.error.message);return;}setShowSite(false);setEditingSite(null);setMessage(editingSite?'Site updated.':'Site created.');onRefresh();};
 const saveNetwork=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setSaving(true);setError('');const payload={site_id:siteId,name:networkName.trim(),cidr:cidr.trim()||null};const result=editingNetwork?await supabase.from('networks').update(payload).eq('id',editingNetwork.id).eq('organization_id',organizationId):await supabase.from('networks').insert({...payload,organization_id:organizationId});setSaving(false);if(result.error){setError(result.error.message);return;}setShowNetwork(false);setEditingNetwork(null);setMessage(editingNetwork?'Network updated.':'Network created.');onRefresh();};
 const deleteSite=async(v:Site)=>{if(!supabase||!canDelete||!await confirmDialog('Delete site '+v.name+' and attached networks?'))return;const {error}=await supabase.from('sites').delete().eq('id',v.id).eq('organization_id',organizationId);if(error)setError(error.message);else{setMessage('Site deleted.');onRefresh();}};
 const deleteNetwork=async(v:Net)=>{if(!supabase||!canDelete||!await confirmDialog('Delete network '+v.name+'?'))return;const {error}=await supabase.from('networks').delete().eq('id',v.id).eq('organization_id',organizationId);if(error)setError(error.message);else{setMessage('Network deleted.');onRefresh();}};
 return <div className="sites-workspace"><div className="tabs-row"><PageTabs items={[{id:'sites',label:'Sites'},{id:'networks',label:'Networks'},{id:'agents',label:'Agent installer'}]} active={tab} onChange={v=>{setTab(v);setShowSite(false);setShowNetwork(false);setError('');}}/>{canManage&&<div className="sites-actions">{tab==='sites'&&<button className="primary-action" onClick={()=>openSite()}>＋ Add site</button>}{tab==='networks'&&<button className="primary-action" disabled={!sites.length} onClick={()=>openNetwork()}>＋ Add network</button>}</div>}</div>
 <Flash kind="success" msg={message}/><Flash kind="error" msg={error}/>
 {tab==='sites'&&<>{showSite&&<form className="panel asset-form" onSubmit={saveSite}><h3>{editingSite?'Edit site':'Create site'}</h3><label>Site name<input value={siteName} onChange={e=>setSiteName(e.target.value)} required maxLength={120}/></label><label>Location<input value={location} onChange={e=>setLocation(e.target.value)}/></label><div className="form-actions"><button type="button" className="secondary-action" onClick={()=>{setShowSite(false);setEditingSite(null);}}>Cancel</button><button className="primary-action" disabled={saving}>{saving?'Saving…':editingSite?'Save changes':'Create site'}</button></div></form>}
 {sites.length===0?<section className="panel empty-panel"><Cable size={26}/><h3>No sites yet</h3><p>Create a site to organize your network infrastructure.</p></section>:<div className="sites-grid">{sites.map(v=><section className="panel site-card" key={v.id}><div className="site-head"><span className="quick-icon"><MapPin size={17}/></span><div><h3>{v.name}</h3><p>{v.location||'Location not specified'}</p></div></div><div className="site-meta"><b>{networks.filter(n=>n.site_id===v.id).length}</b><span>Networks</span></div><div className="row-actions">{canManage&&<button className="secondary-action" onClick={()=>openSite(v)}>Edit</button>}{canDelete&&<button className="danger-action" onClick={()=>deleteSite(v)}>Delete</button>}</div></section>)}</div>}</>}
 {tab==='networks'&&<>{showNetwork&&<form className="panel asset-form" onSubmit={saveNetwork}><h3>{editingNetwork?'Edit network':'Create network'}</h3><label>Site<Select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">Select site</option>{sites.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</Select></label><label>Network name<input value={networkName} onChange={e=>setNetworkName(e.target.value)} required maxLength={120}/></label><label>CIDR<input value={cidr} onChange={e=>setCidr(e.target.value)} placeholder="192.168.1.0/24"/></label><div className="form-actions"><button type="button" className="secondary-action" onClick={()=>{setShowNetwork(false);setEditingNetwork(null);}}>Cancel</button><button className="primary-action" disabled={saving||!sites.length}>{saving?'Saving…':editingNetwork?'Save changes':'Create network'}</button></div></form>}
 <section className="panel page-panel"><div className="table-wrap"><table><thead><tr><th>NETWORK</th><th>CIDR</th><th>SITE</th><th>ACTIONS</th></tr></thead><tbody>{networks.map(v=><tr key={v.id}><td>{v.name}</td><td>{v.cidr||'—'}</td><td>{sites.find(s=>s.id===v.site_id)?.name??'Unknown'}</td><td><div className="row-actions">{canManage&&<button className="secondary-action" onClick={()=>openNetwork(v)}>Edit</button>}{canDelete&&<button className="danger-action" onClick={()=>deleteNetwork(v)}>Delete</button>}</div></td></tr>)}{!networks.length&&<tr><td colSpan={4} className="empty">No networks configured.</td></tr>}</tbody></table></div></section></>}
 {tab==='agents'&&<AgentInstaller sites={sites} organizationId={organizationId} accessToken={accessToken} canManage={canManage}/>}
 {!canManage&&<p className="muted">Your role is read-only for infrastructure setup.</p>}</div>;
}
function SettingsPage({initialTab,user,membership,accessToken,onSignOut,orgName,onDeleteWorkspace}:{initialTab?:string;user:User;membership:Membership;accessToken:string;onSignOut:()=>void;orgName:string;onDeleteWorkspace:()=>void}) {
 const [tab,setTab]=useState(initialTab||'account');const isOwner=membership.role==='owner';
 return <div className="sites-workspace"><PageTabs items={[{id:'account',label:'Account'},{id:'workspace',label:'Workspace access'},{id:'team',label:'Team management'},{id:'notify',label:'Notifications'},{id:'maint',label:'Maintenance'}]} active={tab} onChange={setTab}/>
 {tab==='account'&&<section className="panel settings-card"><div className="settings-icon"><UserRound size={19}/></div><h3>Account</h3><p>Signed-in identity and authentication status.</p><div className="setting-row"><span>Email</span><b>{user.email}</b></div><div className="setting-row"><span>User ID</span><code>{user.id.slice(0,8)}…</code></div><div className="setting-row"><span>Email verified</span><b>{user.email_confirmed_at?'Verified':'Pending'}</b></div><button className="secondary-action" onClick={onSignOut}><LogOut size={15}/> Sign out</button></section>}
 {tab==='workspace'&&<><section className="panel settings-card"><div className="settings-icon"><KeyRound size={19}/></div><h3>Workspace permissions</h3><p>Role-based access is enforced by the database and trusted API.</p><div className="setting-row"><span>Organization</span><b>{membership.organizations?.[0]?.name??membership.organization_id}</b></div><div className="setting-row"><span>Your role</span><span className={isOwner?'role-badge owner':'role-badge'}>{membership.role}</span></div>{isOwner?<div className="owner-note"><ShieldCheck size={17}/><span><b>System owner</b><small>You can invite teammates and control workspace access.</small></span></div>:<div className="notice-banner">Owner-only controls are hidden from this account.</div>}</section>
  {isOwner&&<section className="panel settings-card danger-card"><div className="settings-icon danger"><Trash2 size={19}/></div><h3>Delete this workspace</h3><p>Removes {orgName} with every site, network, device, metric, alert and member in it. This cannot be undone.</p><button className="danger-action" onClick={onDeleteWorkspace}><Trash2 size={15}/>Delete workspace</button></section>}</>}
 {tab==='notify'&&<ChannelsPanel organizationId={membership.organization_id} role={membership.role} token={accessToken}/>}
 {tab==='maint'&&<MaintenancePanel organizationId={membership.organization_id} role={membership.role}/>}
 {tab==='team'&&<TeamInvite organizationId={membership.organization_id} role={membership.role} accessToken={accessToken}/>}
 </div>;
}
function TeamInvite({organizationId,role,accessToken}:{organizationId:string;role:Membership['role'];accessToken:string}) { const [email,setEmail]=useState(''),[inviteRole,setInviteRole]=useState('viewer'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');if(!['owner','admin'].includes(role))return null;const invite=async(e:FormEvent)=>{e.preventDefault();if(!apiUrl){setError('VITE_API_URL is not configured.');return;}setBusy(true);setError('');setMessage('');try{const response=await fetch(apiUrl+'/team/invite',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken},body:JSON.stringify({organization_id:organizationId,email:email.trim(),role:inviteRole})});const body=await response.json();if(!response.ok)throw new Error(body.detail||'Invite failed');setMessage('Invitation sent to '+body.email);setEmail('');}catch(e){setError(e instanceof Error?e.message:'Invitation failed.');}finally{setBusy(false);}};return <section className="panel settings-card"><div className="settings-icon"><UserRound size={19}/></div><h3>Team management</h3><p>Invite a teammate by email. Supabase Auth sends the invitation link; the selected role is assigned to this workspace.</p><form className="asset-form" onSubmit={invite}><label>Team member email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="colleague@company.com" required/></label><label>Workspace role<Select value={inviteRole} onChange={e=>setInviteRole(e.target.value)}><option value="viewer">Viewer</option><option value="operator">Operator</option>{role==='owner'&&<option value="admin">Admin</option>}</Select></label><Flash kind="error" msg={error}/><Flash kind="success" msg={message}/><button className="primary-action" disabled={busy}>{busy?'Sending…':'Send invitation'}</button></form></section>; }

function PageTabs({items,active,onChange}:{items:{id:string;label:string}[];active:string;onChange:(id:string)=>void}) {
 return <div className="page-tabs" role="tablist">{items.map(v=><button key={v.id} type="button" role="tab" aria-selected={active===v.id} className={active===v.id?'page-tab active':'page-tab'} onClick={()=>onChange(v.id)}>{v.label}</button>)}</div>;
}

function Quick({icon,title,desc,onClick}:{icon:React.ReactNode;title:string;desc:string;onClick:()=>void}) { return <button className="quick-action" onClick={onClick}><span className="quick-icon">{icon}</span><span><b>{title}</b><small>{desc}</small></span><span className="arrow">→</span></button>; }
