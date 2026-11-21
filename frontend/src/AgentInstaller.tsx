import { Select, Stepper, SetupCard } from './ui';
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Terminal } from 'lucide-react';
import { api, apiUrl, publishedAgentVersion, LATEST_AGENT_VERSION } from './lib';

type Site = { id: string; name: string };
type OS = 'windows' | 'linux' | 'macos';
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
  const [step, setStep] = useState(0);
  const [agentVersion, setAgentVersion] = useState(LATEST_AGENT_VERSION);
  const siteId = site || sites[0]?.id || '';
  useEffect(() => { let on = true; publishedAgentVersion().then(v => { if (on) setAgentVersion(v); }); return () => { on = false; }; }, []);
  const release = `https://github.com/elite-tech240/elite-network-intelligence/releases/download/agent-installer-v${agentVersion}/EliteNetworkAgent-Setup-${agentVersion}.exe`;

  const generate = async () => {
    if (!siteId) { setError('Create a site first.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/enrollment-tokens', accessToken, { method: 'POST', body: { organization_id: organizationId, site_id: siteId, label: 'Agent enrollment' } });
      setToken(r.token); setExpires(r.expires_at); setStep(2);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const command = token ? `curl -fsSL ${SCRIPT} | sudo ELITE_API_URL=${q(apiUrl)} ELITE_SITE_ID=${q(siteId)} ELITE_ENROLLMENT_TOKEN=${q(token)} bash` : '';

  const osLabel = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[os];
  const siteName = sites.find(v => v.id === siteId)?.name ?? '';
  if (!canManage) return <SetupCard title="Install the monitoring agent" text="Each device needs its own one-time token."><p className="muted">Your role is read-only for infrastructure setup.</p></SetupCard>;
  return <SetupCard title="Install the monitoring agent" text="Each device needs its own one-time token. Tokens expire after 24 hours and can be used once.">
    <Stepper current={step} onChange={i => { setStep(i); if (i < 2) setToken(''); }} steps={[
      { title: 'Choose site', hint: 'Where the device lives', summary: siteName, content: <>
        <div className="step-row">
          <Select className="filter-select step-select" value={siteId} onChange={e => { setSite(e.target.value); setToken(''); }} aria-label="Site">
            {sites.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
          <button className="primary-action" onClick={() => setStep(1)} disabled={!sites.length}>Continue</button>
        </div>
        {!sites.length && <p className="muted">Add a site first (Sites tab).</p>}
      </> },
      { title: 'Pick operating system', hint: 'Windows, Linux or macOS', summary: osLabel, content: <>
        <div className="os-tabs" role="tablist">{([['windows', 'Windows'], ['linux', 'Linux'], ['macos', 'macOS']] as [OS, string][]).map(([id, label]) =>
          <button key={id} type="button" role="tab" aria-selected={os === id} className={os === id ? 'os-tab active' : 'os-tab'} onClick={() => setOs(id)}>{label}</button>)}</div>
        <div className="step-row"><button className="primary-action" onClick={generate} disabled={busy || !apiUrl}>{busy ? 'Generating…' : 'Generate install token'}</button></div>
        {error && <div className="error-banner">{error}</div>}
      </> },
      { title: 'Install on the device', hint: 'Run the installer with the token', content: <>
        {os === 'windows' ? <>
          <a className="primary-action installer-download" href={release} target="_blank" rel="noreferrer"><Download size={15}/> Download Windows installer (.exe)</a>
          <p className="muted">Run it as administrator, then paste these values when asked:</p>
          <div className="kv"><span>Enrollment token</span><code>{token}</code><CopyButton text={token}/></div>
          <div className="kv"><span>Site ID</span><code>{siteId}</code><CopyButton text={siteId}/></div>
          <div className="kv"><span>API URL</span><code>{apiUrl}</code><CopyButton text={apiUrl}/></div>
        </> : <>
          <p className="muted">{os === 'linux' ? 'Open a terminal on the Linux machine (needs python3, curl and systemd) and run:' : 'Open Terminal on the Mac (needs python3 — run “xcode-select --install” if missing) and run:'}</p>
          <div className="cmd-box"><Terminal size={15}/><code>{command}</code></div>
          <div className="step-row"><CopyButton text={command} label="Copy command"/></div>
          <p className="muted">It downloads the agent from GitHub, saves the token in a root-only file, and starts a background service ({os === 'linux' ? 'systemd' : 'launchd'}). Remove with <code>{os === 'linux' ? 'sudo systemctl disable --now elite-network-agent' : 'sudo launchctl bootout system/com.elite.network-agent'}</code>.</p>
          <p className="muted warn">Linux and macOS installers are new and have had limited testing — try one machine first.</p>
        </>}
        <p className="muted token-meta">Token expires {expires ? new Date(expires).toLocaleString() : '—'} · one device only</p>
      </> },
    ]}/>
  </SetupCard>;
}
