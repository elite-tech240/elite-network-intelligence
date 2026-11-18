import { Select } from './ui';
import { useState } from 'react';
import { Check, Copy, Download, Terminal } from 'lucide-react';
import { api, apiUrl } from './lib';

type Site = { id: string; name: string };
type OS = 'windows' | 'linux' | 'macos';
const RELEASE = 'https://github.com/elite-tech240/elite-network-intelligence/releases/latest/download/EliteNetworkAgent-Setup.exe';
const SCRIPT = 'https://raw.githubusercontent.com/elite-tech240/elite-network-intelligence/main/agent/install.sh';
const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="secondary-action copy-btn" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ }
  }}>{done ? <Check size={14}/> : <Copy size={14}/>}{done ? 'Copied' : label}</button>;
}

export function AgentInstaller({ sites, organizationId, accessToken, canManage }: { sites: Site[]; organizationId: string; accessToken: string; canManage: boolean }) {
  const [site, setSite] = useState(sites[0]?.id ?? '');
  const [token, setToken] = useState(''); const [expires, setExpires] = useState('');
  const [os, setOs] = useState<OS>('windows'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const siteId = site || sites[0]?.id || '';

  const generate = async () => {
    if (!siteId) { setError('Create a site first.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/enrollment-tokens', accessToken, { method: 'POST', body: { organization_id: organizationId, site_id: siteId, label: 'Agent enrollment' } });
      setToken(r.token); setExpires(r.expires_at);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const command = token ? `curl -fsSL ${SCRIPT} | sudo ELITE_API_URL=${q(apiUrl)} ELITE_SITE_ID=${q(siteId)} ELITE_ENROLLMENT_TOKEN=${q(token)} bash` : '';

  if (!canManage) return <section className="panel installer"><p className="muted">Your role is read-only for infrastructure setup.</p></section>;
  return <section className="panel installer">
    <header className="installer-head"><h3>Install the monitoring agent</h3><p>Each device needs its own one-time token. Tokens expire after 24 hours and can be used once.</p></header>

    <div className="installer-step"><span className="step-num">1</span><div className="step-body">
      <h4>Choose where the device lives</h4>
      <div className="installer-row">
        <Select className="filter-select installer-select" value={siteId} onChange={e => { setSite(e.target.value); setToken(''); }} aria-label="Site">
          {sites.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <button className="primary-action" onClick={generate} disabled={busy || !apiUrl || !sites.length}>{busy ? 'Generating…' : token ? 'Generate a new token' : 'Generate install token'}</button>
      </div>
      {!sites.length && <p className="muted">Add a site first (Sites tab).</p>}
      {error && <div className="error-banner">{error}</div>}
    </div></div>

    <div className={token ? 'installer-step' : 'installer-step disabled'}><span className="step-num">2</span><div className="step-body">
      <h4>Pick the operating system</h4>
      <div className="os-tabs" role="tablist">{([['windows', 'Windows'], ['linux', 'Linux'], ['macos', 'macOS']] as [OS, string][]).map(([id, label]) =>
        <button key={id} type="button" role="tab" aria-selected={os === id} className={os === id ? 'os-tab active' : 'os-tab'} onClick={() => setOs(id)}>{label}</button>)}</div>

      {!token && <p className="muted">Generate a token in step 1 to see the install instructions.</p>}
      {token && os === 'windows' && <div className="os-panel">
        <a className="primary-action installer-download" href={RELEASE} target="_blank" rel="noreferrer"><Download size={15}/> Download Windows installer (.exe)</a>
        <p className="muted">Run it as administrator, then paste these two values when asked:</p>
        <div className="kv"><span>Enrollment token</span><code>{token}</code><CopyButton text={token}/></div>
        <div className="kv"><span>Site ID</span><code>{siteId}</code><CopyButton text={siteId}/></div>
        <div className="kv"><span>API URL</span><code>{apiUrl}</code><CopyButton text={apiUrl}/></div>
      </div>}
      {token && os !== 'windows' && <div className="os-panel">
        <p className="muted">{os === 'linux' ? 'Open a terminal on the Linux machine (needs python3, curl and systemd) and run:' : 'Open Terminal on the Mac (needs python3 — run “xcode-select --install” if missing) and run:'}</p>
        <div className="cmd-box"><Terminal size={15}/><code>{command}</code></div>
        <div className="installer-row"><CopyButton text={command} label="Copy command"/></div>
        <p className="muted">It downloads the agent from GitHub, saves the token in a root-only file, and starts a background service ({os === 'linux' ? 'systemd' : 'launchd'}). Remove with <code>{os === 'linux' ? 'sudo systemctl disable --now elite-network-agent' : 'sudo launchctl bootout system/com.elite.network-agent'}</code>.</p>
        <p className="muted warn">Linux and macOS installers are new and have had limited testing — try one machine first.</p>
      </div>}
      {token && <p className="muted token-meta">Token expires {new Date(expires).toLocaleString()} · one device only</p>}
    </div></div>
  </section>;
}
