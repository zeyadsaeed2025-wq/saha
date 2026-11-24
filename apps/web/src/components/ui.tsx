import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties,
  type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '../lib/i18n.js';
import type { AttendanceStatus } from '../types.js';

export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
    size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button className={`btn btn-${variant} ${size !== 'md' ? `btn-${size}` : ''} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 size={16} className="spin" /> : icon}{children}
    </button>
  );
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className="btn btn-ghost btn-icon btn-sm" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ children, className = '', ...props }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}

export function CardHead({ title, subtitle, action, icon }: {
  title: string; subtitle?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div>
        <h2>{icon ? <span className="row" style={{ gap: 8 }}>{icon}{title}</span> : title}</h2>
        {subtitle && <div className="card-sub">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }: {
  label: string; hint?: string; error?: string; children: ReactNode; className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props}>{children}</select>;
}

export function Badge({ tone = 'muted', children, plain }: {
  tone?: 'muted' | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'accent'; children: ReactNode; plain?: boolean;
}) {
  return <span className={`badge badge-${tone} ${plain ? 'plain' : ''}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: AttendanceStatus | string }) {
  const { t } = useI18n();
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'muted'> = {
    on_time: 'success', late: 'warning', absent: 'danger', partial: 'info',
    excused: 'primary', pending_review: 'warning', scheduled: 'muted', completed: 'success', cancelled: 'danger',
  };
  return <Badge tone={map[status] ?? 'muted'}>{t(`status_${status}`) || status}</Badge>;
}

export function Avatar({ name, color, size = '' }: { name: string; color?: string; size?: 'sm' | 'lg' | '' }) {
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`avatar ${size}`} style={color ? { background: color } : undefined}>{initials}</span>;
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', radius = 6 }: { height?: number | string; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="app-skeleton">
      <div>
        <div className="app-skeleton__mark">س</div>
        <div className="small muted text-center" style={{ marginTop: 12 }}>{label}</div>
      </div>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, children, footer, onClose }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head"><h3>{title}</h3><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="progress"><div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...props} />;
}

export interface TabItem<T extends string> { value: T; label: ReactNode }

export function Tabs<T extends string>({ items, value, onChange, label, className = '' }: {
  items: Array<TabItem<T>>; value: T; onChange: (value: T) => void; label?: string; className?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number) => {
    const next = (index + items.length) % items.length;
    onChange(items[next].value);
    buttons.current[next]?.focus();
  };
  const move = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault(); select(index + (rtl && event.key === 'ArrowRight' ? -1 : 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault(); select(index + (rtl && event.key === 'ArrowLeft' ? 1 : -1));
    } else if (event.key === 'Home') { event.preventDefault(); select(0); }
    else if (event.key === 'End') { event.preventDefault(); select(items.length - 1); }
  };
  return (
    <div className={`tabs ${className}`} role="group" aria-label={label}>
      {items.map((item, index) => (
        <button key={item.value} ref={(node) => { buttons.current[index] = node; }} type="button"
          aria-pressed={value === item.value}
          className={`tab ${value === item.value ? 'active' : ''}`}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => move(event, index)}>{item.label}</button>
      ))}
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: {
  title?: string; message: ReactNode; confirmLabel?: string;
  onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={title ?? t('confirmTitle')} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" onClick={() => { void onConfirm(); onClose(); }}>
          {confirmLabel ?? t('delete')}
        </Button>
      </>
    }>
      <p className="confirm-message">{message}</p>
    </Modal>
  );
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await loader()); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export { useAsync as useLoader };
