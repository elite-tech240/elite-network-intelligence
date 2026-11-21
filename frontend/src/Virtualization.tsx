import { useState } from 'react';
import { Server, HardDrive, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { api, apiUrl } from './lib';
import { Select, Drawer, EmptyState } from './ui';
import { DeviceDetail } from './Monitoring';

type Device = { id: string; hostname: string; ip_address: string | null; status: string; device_type: string | null; last_seen_at: string | null; site_id?: string; parent_device_id?: string | null };
type Site = { id: string; name: string };

function deviceStatus(d: Device) { if (!d.last_seen_at) return 'unknown'; return Date.now() - new Date(d.last_seen_at).getTime() > 120000 ? 'offline' : d.status; }

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="secondary-action copy-btn" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ }
  }}>{done ? <Check size={14}/> : <Copy size={14}/>}{done ? 'Copied' : 'Copy'}</button>;
}

function HostCard({ host, vms, onOpen }: { host: Device; vms: Device[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const online = vms.filter(v => deviceStatus(v) === 'online').length;
  return <div className="panel page-panel esxi-host-card">
    <button type="button" className="esxi-host-head" onClick={() => setOpen(o => !o)}>
      {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
      <Server size={16}/>
      <b onClick={e => { e.stopPropagation(); onOpen(host.id); }} className="esxi-host-name">{host.hostname}</b>
      <span className={`status-pill ${deviceStatus(host) === 'online' ? 'online' : deviceStatus(host) === 'offline' ? 'offline' : 'pending'}`}><i/>{deviceStatus(host)}</span>
      <span className="muted esxi-vm-count">{vms.length} VM{vms.length === 1 ? '' : 's'} · {online} running</span>
    </button>
    {open && (vms.length ? <div className="table-wrap"><table><thead><tr><th>VM</th><th>GUEST OS</th><th>STATUS</th><th>LAST SEEN</th></tr></thead><tbody>
      {vms.map(v => <tr key={v.id} className="row-click" onClick={() => onOpen(v.id)}>
        <td><div className="device-name"><span className="device-icon"><HardDrive size={14}/></span><b>{v.hostname}</b></div></td>
        <td>{(v as any).os_name ?? '—'}</td>
        <td><span className={`status-pill ${deviceStatus(v) === 'online' ? 'online' : deviceStatus(v) === 'offline' ? 'offline' : 'pending'}`}><i/>{deviceStatus(v)}</span></td>
        <td>{v.last_seen_at ? new Date(v.last_seen_at).toLocaleString() : 'Never'}</td>
      </tr>)}
    </tbody></table></div> : <p className="muted esxi-empty-vms">No VMs reported yet.</p>)}
  </div>;
}

export function VirtualizationPage({ devices, sites, organizationId, accessToken, role }: { devices: Device[]; sites: Site[]; organizationId: string; accessToken: string; role: 'owner' | 'admin' | 'operator' | 'viewer' }) {
  const hosts = devices.filter(d => d.device_type === 'esxi_host');
  const vmsOf = (hostId: string) => devices.filter(d => d.device_type === 'esxi_vm' && d.parent_device_id === hostId);
  const [openId, setOpenId] = useState('');
  const canManage = ['owner', 'admin'].includes(role);

  const [site, setSite] = useState(sites[0]?.id ?? '');
  const [token, setToken] = useState(''); const [expires, setExpires] = useState('');
  const [esxiHost, setEsxiHost] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [shell, setShell] = useState<'powershell' | 'bash'>('powershell');
  const siteId = site || sites[0]?.id || '';

  const generate = async () => {
    if (!siteId) { setError('Create a site first.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/enrollment-tokens', accessToken, { method: 'POST', body: { organization_id: organizationId, site_id: siteId, label: 'ESXi connector' } });
      setToken(r.token); setExpires(r.expires_at);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const vars: [string, string][] = [
    ['ELITE_API_URL', apiUrl], ['ELITE_SITE_ID', siteId], ['ELITE_ENROLLMENT_TOKEN', token],
    ['ESXI_HOST', esxiHost], ['ESXI_USER', 'root'], ['ESXI_PASSWORD', '...'],
  ];
  const command = token && esxiHost
    ? shell === 'powershell'
      ? vars.map(([k, v]) => `$env:${k}='${v}'`).join('; ') + '; python esxi_connector.py'
      : vars.map(([k, v]) => `${k}='${v}'`).join(' ') + ' python3 esxi_connector.py'
    : '';

  return <div className="sites-workspace">
    <section className="panel page-panel installer">
      <header className="installer-head"><h3>Connect an ESXi host</h3><p>Works with standalone ESXi 6+ — no vCenter needed. Run the connector on any machine that can reach the host's management network (port 443).</p></header>
      {!canManage ? <p className="muted">Your role is read-only for infrastructure setup.</p> : <>
        <div className="installer-step"><span className="step-num">1</span><div className="step-body">
          <h4>Choose where the host lives</h4>
          <div className="installer-row">
            <Select className="filter-select installer-select" value={siteId} onChange={e => { setSite(e.target.value); setToken(''); }} aria-label="Site">
              {sites.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <input className="esxi-host-input" placeholder="ESXi host IP or hostname" value={esxiHost} onChange={e => setEsxiHost(e.target.value)}/>
            <button className="primary-action" onClick={generate} disabled={busy || !apiUrl || !sites.length}>{busy ? 'Generating…' : token ? 'Generate a new token' : 'Generate connector token'}</button>
          </div>
          {!sites.length && <p className="muted">Add a site first (Sites tab).</p>}
          {error && <div className="error-banner">{error}</div>}
        </div></div>
        <div className={token && esxiHost ? 'installer-step' : 'installer-step disabled'}><span className="step-num">2</span><div className="step-body">
          <h4>Run the connector</h4>
          {!token && <p className="muted">Generate a token in step 1 first.</p>}
          {token && !esxiHost && <p className="muted">Enter the ESXi host's IP or hostname in step 1.</p>}
          {token && esxiHost && <>
            <p className="muted">Download <code>agent/esxi_connector.py</code> from the repo (needs <code>pip install pyvmomi requests</code>), then run on a machine with network access to the host:</p>
            <div className="os-tabs" role="tablist">{([['powershell', 'Windows (PowerShell)'], ['bash', 'Linux / macOS (bash)']] as const).map(([id, label]) =>
              <button key={id} type="button" role="tab" aria-selected={shell === id} className={shell === id ? 'os-tab active' : 'os-tab'} onClick={() => setShell(id)}>{label}</button>)}</div>
            <div className="cmd-box"><code>{command}</code></div>
            <div className="installer-row"><CopyButton text={command}/></div>
            <p className="muted">Replace <code>ESXI_PASSWORD</code> with the host's real root (or read-only) password — it's only sent to the ESXi host itself, never to Elite. The host and every VM on it will appear below within a minute.</p>
          </>}
          {token && <p className="muted token-meta">Token expires {new Date(expires).toLocaleString()} · one host only</p>}
        </div></div>
      </>}
    </section>

    <section className="panel-head" style={{ marginTop: 8 }}><div><h3>Hosts</h3><p>{hosts.length} ESXi host{hosts.length === 1 ? '' : 's'}</p></div></section>
    {hosts.length ? hosts.map(h => <HostCard key={h.id} host={h} vms={vmsOf(h.id)} onOpen={setOpenId}/>) : <section className="panel page-panel"><EmptyState icon={<Server size={22}/>} title="No ESXi hosts yet" text="Connect one above and it will appear here within a minute."/></section>}

    {openId && <Drawer title={devices.find(d => d.id === openId)?.hostname ?? 'Device'} onClose={() => setOpenId('')}><DeviceDetail devices={devices.filter(d => d.id === openId) as any}/></Drawer>}
  </div>;
}
