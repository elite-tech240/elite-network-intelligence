import { CSSProperties, Children, ReactNode, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  return createPortal(<div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) done(false); }}><div className="modal confirm-modal" role="alertdialog" aria-modal="true">
    <span className={danger ? 'modal-icon danger' : 'modal-icon'}><AlertTriangle size={20}/></span>
    <h3>{s.o?.title ?? tr(lang, 'Are you sure?')}</h3><p>{s.m}</p>
    <div className="modal-actions"><button className="secondary-action" onClick={() => done(false)}>{tr(lang, 'Cancel')}</button><button className={danger ? 'danger-solid' : 'primary-action'} autoFocus onClick={() => done(true)}>{s.o?.confirmText ?? tr(lang, 'Confirm')}</button></div>
  </div></div>, document.body);
}

/* ---------- custom select (drop-in for <select>) ---------- */
type Opt = { value: string; label: ReactNode; disabled?: boolean; group?: string };
function flatOptions(ch: ReactNode, group?: string): Opt[] {
  const out: Opt[] = [];
  Children.forEach(ch, c => { if (!isValidElement(c)) return; const p: any = c.props; if (c.type === 'option') out.push({ value: String(p.value ?? p.children), label: p.children, disabled: p.disabled, group }); else out.push(...flatOptions(p.children, c.type === 'optgroup' ? String(p.label) : group)); });
  return out;
}
export function Select({ value, onChange, children, className = '', disabled, id }: { value: string | number; onChange: (e: { target: { value: string } }) => void; children: ReactNode; className?: string; disabled?: boolean; id?: string }) {
  const opts = flatOptions(children); const cur = opts.find(o => o.value === String(value));
  const [open, setOpen] = useState(false); const [up, setUp] = useState(false); const [hi, setHi] = useState(0); const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const reposition = () => {
    if (!box.current) return;
    const r = box.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  };
  useEffect(() => {
    if (!open) return;
    // The option list renders through a portal straight onto document.body (so it can escape a
    // modal's clipped/scrolling container), so it is never a DOM descendant of `box` - checking
    // only `box.contains(target)` closed the menu on every mousedown inside it, a split second
    // before the option's own click handler could fire, so choosing an option silently did nothing.
    const off = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.select-menu.portal')) return;
      setOpen(false);
    };
    const onScrollOrResize = () => reposition();
    document.addEventListener('mousedown', off);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => { document.removeEventListener('mousedown', off); window.removeEventListener('scroll', onScrollOrResize, true); window.removeEventListener('resize', onScrollOrResize); };
  }, [open]);
  const toggle = () => {
    if (disabled) return;
    if (!open && box.current) { const r = box.current.getBoundingClientRect(); const need = Math.min(opts.length * 38 + 14 + new Set(opts.map(o => o.group).filter(Boolean)).size * 30, 340); setUp(window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom); setHi(Math.max(0, opts.findIndex(o => o.value === String(value)))); setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width }); }
    setOpen(o => !o);
  };
  const pick = (o?: Opt) => { if (!o || o.disabled) return; onChange({ target: { value: o.value } }); setOpen(false); };
  const menu = open && rect ? <ul className={`select-menu portal ${up ? 'up' : ''}`} role="listbox" style={{ position: 'fixed', left: rect.left, width: rect.width, ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }}>
    {opts.map((o, i) => [o.group && o.group !== opts[i - 1]?.group ? <li key={'g' + o.group} className="select-group" role="presentation" onClick={e => e.preventDefault()}>{o.group}</li> : null, <li key={o.value + i} role="option" aria-selected={o.value === String(value)} className={`${i === hi ? 'hi' : ''} ${o.value === String(value) ? 'sel' : ''} ${o.disabled ? 'dis' : ''}`} onMouseEnter={() => setHi(i)} onClick={e => { e.preventDefault(); pick(o); }}><span>{o.label}</span>{o.value === String(value) && <Check size={15}/>}</li>])}
  </ul> : null;
  return <div ref={box} className={`select ${open ? 'open' : ''} ${className}`}>
    <button type="button" id={id} className="select-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false); else if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) toggle(); else setHi(h => Math.min(h + 1, opts.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); } else if (e.key === 'Enter' && open) { e.preventDefault(); pick(opts[hi]); } }}>
      <span>{cur?.label ?? ''}</span><ChevronDown size={16}/>
    </button>
    {menu && createPortal(menu, document.body)}
  </div>;
}

/* ---------- loading and empty states ---------- */
export function Counter({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value), start = useRef(0), raf = useRef(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    from.current = shown; start.current = 0;
    const step = (t: number) => {
      if (!start.current) start.current = t;
      const k = Math.min(1, (t - start.current) / 650), e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from.current + (value - from.current) * e));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{shown}</>;
}

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

/** Long free text in a table cell: wraps (even unbroken strings), clamps to 2 lines, click to expand. */
export function LongText({ text, lines = 2 }: { text?: string | null; lines?: number }) {
  const [open, setOpen] = useState(false);
  const t = text ?? '';
  if (!t) return <span className="muted">—</span>;
  const long = t.length > 140;
  return <div className={open ? 'long-text open' : 'long-text'} style={{ '--lines': lines } as CSSProperties} title={open ? undefined : t}>
    <span className="long-text-body">{t}</span>
    {long && <button type="button" className="long-text-toggle" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{open ? 'Show less' : 'Show more'}</button>}
  </div>;
}

/** Centered dialog rendered on document.body so no page layout can trap it. */
export function Modal({ title, subtitle, icon, onClose, children, width = 480 }: { title: string; subtitle?: string; icon?: ReactNode; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); document.body.classList.add('modal-open'); return () => { window.removeEventListener('keydown', k); document.body.classList.remove('modal-open'); }; }, [onClose]);
  return createPortal(<div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal form-modal" style={{ width: `min(100%, ${width}px)` }} role="dialog" aria-modal="true" aria-label={title}>
    <div className="form-modal-head">{icon && <span className="modal-icon">{icon}</span>}<div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="form-modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
    {children}
  </div></div>, document.body);
}

/* ---------- setup stepper (one look for every guided flow) ---------- */
export type StepDef = { title: string; hint: string; summary?: ReactNode; content: ReactNode };
export function Stepper({ steps, current, onChange }: { steps: StepDef[]; current: number; onChange: (i: number) => void }) {
  return <ol className="stepper">{steps.map((s, i) => {
    const state = i < current ? 'done' : i === current ? 'active' : 'locked';
    return <li key={i} className={`stepper-item ${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <div className="stepper-rail"><span className="stepper-dot">{state === 'done' ? <Check size={15}/> : i + 1}</span>{i < steps.length - 1 && <span className="stepper-line"/>}</div>
      <div className="stepper-body">
        <div className="stepper-title"><h4>{s.title}</h4>{state === 'locked' && <LockIcon/>}{state === 'done' && <button type="button" className="stepper-change" onClick={() => onChange(i)}>Change</button>}</div>
        <p className="stepper-hint">{state === 'done' ? (s.summary ?? 'Done') : state === 'locked' ? `Finish step ${current + 1} first` : s.hint}</p>
        {state === 'active' && <div className="stepper-content">{s.content}</div>}
      </div>
    </li>;
  })}</ol>;
}
function LockIcon() { return <svg className="stepper-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>; }
export function SetupCard({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return <section className="panel setup-card"><header className="setup-card-head"><h3>{title}</h3><p>{text}</p></header><div className="setup-card-body">{children}</div></section>;
}
