import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
export const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const supabase: SupabaseClient | null = configured ? createClient(url!, key!) : null;
export const SELF_UPDATE_FROM = '0.5.0'; // the first agent that understands the upgrade command

export function versionAtLeast(version: string | null | undefined, minimum: string): boolean {
  if (!version) return false;
  const a = version.split('.').map(n => parseInt(n, 10) || 0);
  const b = minimum.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export const LATEST_AGENT_VERSION = '0.4.0'; // fallback only; the live value comes from agent_releases

export async function publishedAgentVersion(): Promise<string> {
  if (!supabase) return LATEST_AGENT_VERSION;
  const { data } = await supabase.from('agent_releases').select('version').eq('id', true).maybeSingle();
  return data?.version ?? LATEST_AGENT_VERSION;
}

export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

export async function api<T = any>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!apiUrl) throw new Error('VITE_API_URL is not configured.');
  const response = await fetch(apiUrl + path, {
    method: init.method ?? 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Request failed');
  return data as T;
}

export const fmtBps = (v: number | null | undefined) => {
  if (v == null) return '—';
  const bits = v * 8;
  if (bits >= 1e9) return (bits / 1e9).toFixed(2) + ' Gbps';
  if (bits >= 1e6) return (bits / 1e6).toFixed(2) + ' Mbps';
  if (bits >= 1e3) return (bits / 1e3).toFixed(1) + ' Kbps';
  return bits.toFixed(0) + ' bps';
};
export const fmtUptime = (s: number | null | undefined) => {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
export const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return Math.round(s) + 's ago';
  if (s < 5400) return Math.round(s / 60) + 'm ago';
  if (s < 129600) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};
