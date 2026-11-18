import { Children, ReactNode, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ArrowDown, ArrowUp, Check, ChevronDown, Circle, Search, X } from 'lucide-react';

/* ---------- preferences (theme, language, density, onboarding) ---------- */
export type Prefs = { theme: 'dark' | 'light'; lang: 'en' | 'ar'; dense: boolean; onboardDone: boolean };
const KEY = 'eni-prefs';
const defaults: Prefs = { theme: 'dark', lang: 'en', dense: false, onboardDone: false };
function readPrefs(): Prefs { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults; } }
export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, setP] = useState<Prefs>(readPrefs);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = p.theme; el.dataset.density = p.dense ? 'compact' : 'comfortable';
    el.lang = p.lang; el.dir = p.lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage may be unavailable */ }
  }, [p]);
  return [p, patch => setP(prev => ({ ...prev, ...patch }))];
}

/* Arabic labels for navigation and the main chrome. Anything not listed stays English. */
const AR: Record<string, string> = {
  Overview: 'نظرة عامة', Devices: 'الأجهزة', Topology: 'الهيكل', Traffic: 'حركة الشبكة', Alerts: 'التنبيهات', Logs: 'السجلات', Uptime: 'التوافر',
  Reports: 'التقارير', 'Audit log': 'سجل التدقيق', 'Sites & Networks': 'المواقع والشبكات', Platform: 'المنصة', Settings: 'الإعدادات',
  'NOC wall': 'شاشة المراقبة', Documentation: 'التوثيق', MONITOR: 'المراقبة', INSIGHTS: 'التحليلات', MANAGE: 'الإدارة', PREFERENCES: 'التفضيلات',
  'Network overview': 'نظرة عامة على الشبكة', Workspace: 'مساحة العمل', 'NETWORK OPERATIONS CENTER': 'مركز عمليات الشبكة',
  'Search or jump to…': 'ابحث أو انتقل إلى…', Cancel: 'إلغاء', Confirm: 'تأكيد', 'Are you sure?': 'هل أنت متأكد؟', 'Getting started': 'ابدأ هنا',
  Dismiss: 'إخفاء', Previous: 'السابق', Next: 'التالي', Close: 'إغلاق', 'Pages': 'الصفحات', 'Devices ': 'الأجهزة', 'Actions': 'إجراءات',
};
export const tr = (lang: Prefs['lang'], s: string) => (lang === 'ar' && AR[s]) || s;

/* ---------- toasts ---------- */
type ToastItem = { id: number; msg: string; kind: 'success' | 'error' | 'info' };
const subs = new Set<(t: ToastItem) => void>(); let seq = 0;
export const toast = (msg: string, kind: ToastItem['kind'] = 'info') => { subs.forEach(f => f({ id: ++seq, msg, kind })); };
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (t: ToastItem) => {
      setList(x => x.some(y => y.msg === t.msg) ? x : [...x.slice(-3), t]);
      window.setTimeout(() => setList(x => x.filter(y => y.id !== t.id)), t.kind === 'error' ? 8000 : 4500);
    };
    subs.add(on); return () => { subs.delete(on); };
  }, []);
  return <div className="toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={`toast toast-${t.kind}`}><span>{t.msg}</span><button aria-label="Close" onClick={() => setList(x => x.filter(y => y.id !== t.id))}><X size={14}/></button></div>)}</div>;
}
/** Renders nothing: shows `msg` as a toast whenever it changes to a non-empty value. */
export function Flash({ msg, kind }: { msg?: string; kind: ToastItem['kind'] }) {
  useEffect(() => { if (msg) toast(msg, kind); }, [msg, kind]);
  return null;
}

/* ---------- confirm dialog (replaces window.confirm) ---------- */
type ConfirmOpts = { confirmText?: string; danger?: boolean; title?: string };
let ask: ((m: string, o?: ConfirmOpts) => Promise<boolean>) | null = null;
export const confirmDialog = (message: string, opts?: ConfirmOpts): Promise<boolean> => ask ? ask(message, opts) : Promise.resolve(window.confirm(message));
export function ConfirmHost({ lang }: { lang: Prefs['lang'] }) {
  const [s, setS] = useState<{ m: string; o?: ConfirmOpts; r: (v: boolean) => void } | null>(null);
  useEffect(() => { ask = (m, o) => new Promise(r => setS({ m, o, r })); return () => { ask = null; }; }, []);
  useEffect(() => { if (!s) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { s.r(false); setS(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [s]);
  if (!s) return null;
  const done = (v: boolean) => { s.r(v); setS(null); };
  const danger = s.o?.danger ?? /delete|remove|revoke|uninstall|archive/i.test(s.m);
  return <div className="modal-back" onClick={() => done(false)}><div className="modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
    <span className={danger ? 'modal-icon danger' : 'modal-icon'}><AlertTriangle size={20}/></span>
    <h3>{s.o?.title ?? tr(lang, 'Are you sure?')}</h3><p>{s.m}</p>
    <div className="modal-actions"><button className="secondary-action" onClick={() => done(false)}>{tr(lang, 'Cancel')}</button><button className={danger ? 'danger-solid' : 'primary-action'} autoFocus onClick={() => done(true)}>{s.o?.confirmText ?? tr(lang, 'Confirm')}</button></div>
  </div></div>;
}

/* ---------- custom select (drop-in for <select>) ---------- */
type Opt = { value: string; label: ReactNode; disabled?: boolean };
function flatOptions(ch: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(ch, c => { if (!isValidElement(c)) return; const p: any = c.props; if (c.type === 'option') out.push({ value: String(p.value ?? p.children), label: p.children, disabled: p.disabled }); else out.push(...flatOptions(p.children)); });
  return out;
}
export function Select({ value, onChange, children, className = '', disabled, id }: { value: string | number; onChange: (e: { target: { value: string } }) => void; children: ReactNode; className?: string; disabled?: boolean; id?: string }) {
  const opts = flatOptions(children); const cur = opts.find(o => o.value === String(value));
  const [open, setOpen] = useState(false); const [up, setUp] = useState(false); const [hi, setHi] = useState(0); const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const toggle = () => {
    if (disabled) return;
    if (!open && box.current) { const r = box.current.getBoundingClientRect(); const need = Math.min(opts.length * 38 + 14, 280); setUp(window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom); setHi(Math.max(0, opts.findIndex(o => o.value === String(value)))); }
    setOpen(o => !o);
  };
  const pick = (o?: Opt) => { if (!o || o.disabled) return; onChange({ target: { value: o.value } }); setOpen(false); };
  return <div ref={box} className={`select ${open ? 'open' : ''} ${className}`}>
    <button type="button" id={id} className="select-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false); else if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) toggle(); else setHi(h => Math.min(h + 1, opts.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); } else if (e.key === 'Enter' && open) { e.preventDefault(); pick(opts[hi]); } }}>
      <span>{cur?.label ?? ''}</span><ChevronDown size={16}/>
    </button>
    {open && <ul className={up ? 'select-menu up' : 'select-menu'} role="listbox">{opts.map((o, i) => <li key={o.value + i} role="option" aria-selected={o.value === String(value)} className={`${i === hi ? 'hi' : ''} ${o.value === String(value) ? 'sel' : ''} ${o.disabled ? 'dis' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}><span>{o.label}</span>{o.value === String(value) && <Check size={15}/>}</li>)}</ul>}
  </div>;
}

/* ---------- loading and empty states ---------- */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: `${92 - (i % 3) * 14}%` }}/>)}</div>;
}
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return <div className="empty-state">{icon && <span className="empty-state-icon">{icon}</span>}<b>{title}</b>{text && <p>{text}</p>}{action}</div>;
}

/* ---------- sorting and pagination ---------- */
export type Table<T> = { rows: T[]; sort: { k: string; d: 1 | -1 } | null; toggle: (k: string) => void; page: number; pages: number; setPage: (n: number) => void; total: number };
export function useTable<T>(rows: T[], get: (r: T, k: string) => string | number | null | undefined, pageSize = 25): Table<T> {
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { k, d } = sort;
    return [...rows].sort((a, b) => { const x = get(a, k) ?? '', y = get(b, k) ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * d; });
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  return { rows: sorted.slice(p * pageSize, (p + 1) * pageSize), sort, page: p, pages, setPage, total: sorted.length,
    toggle: k => { setSort(s => !s || s.k !== k ? { k, d: 1 } : s.d === 1 ? { k, d: -1 } : null); setPage(0); } };
}
export function Th<T>({ t, k, children }: { t: Table<T>; k: string; children: ReactNode }) {
  const on = t.sort?.k === k;
  return <th className="sortable" aria-sort={on ? (t.sort!.d === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => t.toggle(k)}>{children}{on && (t.sort!.d === 1 ? <ArrowUp size={11}/> : <ArrowDown size={11}/>)}</th>;
}
export function Pager<T>({ t, lang = 'en' }: { t: Table<T>; lang?: Prefs['lang'] }) {
  if (t.pages <= 1) return null;
  return <div className="pager"><span>{t.total} rows · {t.page + 1} / {t.pages}</span><div><button className="secondary-action" disabled={t.page === 0} onClick={() => t.setPage(t.page - 1)}>{tr(lang, 'Previous')}</button><button className="secondary-action" disabled={t.page >= t.pages - 1} onClick={() => t.setPage(t.page + 1)}>{tr(lang, 'Next')}</button></div></div>;
}

/* ---------- drawer ---------- */
export function Drawer({ title, onClose, children, lang = 'en' }: { title: string; onClose: () => void; children: ReactNode; lang?: Prefs['lang'] }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="drawer-back" onClick={onClose}><aside className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
    <div className="drawer-head"><h3>{title}</h3><button className="icon-btn" aria-label={tr(lang, 'Close')} onClick={onClose}><X size={18}/></button></div>
    <div className="drawer-body">{children}</div>
  </aside></div>;
}

/* ---------- command palette (Ctrl/⌘ + K) ---------- */
export type Command = { id: string; label: string; hint: string; run: () => void };
export function CommandPalette({ open, onClose, commands, lang }: { open: boolean; onClose: () => void; commands: Command[]; lang: Prefs['lang'] }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setI(0); window.setTimeout(() => input.current?.focus(), 0); } }, [open]);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return (s ? commands.filter(c => (c.label + ' ' + c.hint).toLowerCase().includes(s)) : commands).slice(0, 12); }, [q, commands]);
  if (!open) return null;
  const pick = (c?: Command) => { if (!c) return; onClose(); c.run(); };
  return <div className="modal-back palette-back" onClick={onClose}><div className="palette" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
    <div className="palette-input"><Search size={16}/><input ref={input} value={q} placeholder={tr(lang, 'Search or jump to…')} aria-label="Command palette"
      onChange={e => { setQ(e.target.value); setI(0); }}
      onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, list.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)); } else if (e.key === 'Enter') pick(list[i]); else if (e.key === 'Escape') onClose(); }}/><kbd>Esc</kbd></div>
    <ul>{list.map((c, n) => <li key={c.id} className={n === i ? 'active' : ''} onMouseEnter={() => setI(n)} onClick={() => pick(c)}><span>{c.label}</span><small>{c.hint}</small></li>)}{!list.length && <li className="palette-empty">No matches</li>}</ul>
  </div></div>;
}

/* ---------- onboarding checklist ---------- */
export type Step = { id: string; label: string; done: boolean; go: () => void };
export function Checklist({ steps, onDismiss, lang }: { steps: Step[]; onDismiss: () => void; lang: Prefs['lang'] }) {
  const done = steps.filter(s => s.done).length;
  if (done === steps.length) return null;
  return <section className="panel onboarding"><div className="onboarding-top"><div><b>{tr(lang, 'Getting started')}</b><span>{done} / {steps.length}</span></div><div className="onboarding-bar"><i style={{ width: `${(done / steps.length) * 100}%` }}/></div><button className="text-button" onClick={onDismiss}>{tr(lang, 'Dismiss')}</button></div>
    <div className="onboarding-steps">{steps.map(s => s.done
      ? <span key={s.id} className="chip-step done"><CheckCircle2 size={15}/>{s.label}</span>
      : <button key={s.id} className="chip-step" onClick={s.go}><Circle size={15}/>{s.label}</button>)}</div></section>;
}
