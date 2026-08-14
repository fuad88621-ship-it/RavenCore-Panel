import React, { createContext, useContext, useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

// ── Backgrounds ──────────────────────────────────────────────
export function AuroraBackground({ children }) {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#070709]">
      <div className="aurora absolute -inset-[100%] opacity-40 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.12),transparent_55%)]" />
      <div className="noise-overlay absolute inset-0" />
    </div>
  );
}

export function CursorGlow() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 hidden lg:block"
      style={{
        background: `radial-gradient(600px circle at ${pos.x}px ${pos.y}px, rgb(139 92 246 / 0.07), transparent 40%)`,
      }}
    />
  );
}

export function ParticlesBackground() {
  const count = 24;
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: Math.random() * 2 + 1,
    delay: Math.random() * 5,
    duration: Math.random() * 10 + 10,
  }));
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-40">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            filter: 'blur(1px)',
          }}
          animate={{ y: [-20, 20, -20], opacity: [0.2, 0.6, 0.2] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ── Motion number ────────────────────────────────────────────
export function AnimatedNumber({ value, decimals = 0, className }) {
  const spring = useSpring(value, { stiffness: 90, damping: 20 });
  const display = useTransform(spring, (v) =>
    v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
  useEffect(() => { spring.set(value); }, [value, spring]);
  return <motion.span className={className}>{display}</motion.span>;
}

// ── Cards ────────────────────────────────────────────────────
export function Card({ className, children, delay = 0, hover = false, glow = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      whileHover={hover ? { y: -3 } : undefined}
      className={cn(
        'relative rounded-2xl border border-white/[0.06] bg-white/[0.03] shadow-xl backdrop-blur-sm',
        glow && 'glow-border',
        hover && 'transition-all duration-300 hover:border-violet-500/30 hover:bg-white/[0.05] hover:shadow-violet-500/10',
        className
      )}
    >
      {children}
    </motion.div>
  );
}

export function ShineCard({ children, className, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/30 hover:bg-white/[0.05] hover:shadow-violet-500/10',
        className
      )}
    >
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
      {children}
    </motion.div>
  );
}

export function SpotlightCard({ children, className, delay = 0 }) {
  const ref = React.useRef(null);
  function onMouseMove(e) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--spotlight-x', `${e.clientX - rect.left}px`);
    ref.current.style.setProperty('--spotlight-y', `${e.clientY - rect.top}px`);
  }
  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] shadow-xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/30 hover:bg-white/[0.05] hover:shadow-violet-500/10',
        className
      )}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'radial-gradient(600px circle at var(--spotlight-x) var(--spotlight-y), rgba(139,92,246,0.15), transparent 40%)' }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

export function GradientBorder({ children, className, active = false }) {
  return (
    <div
      className={cn(
        'relative rounded-2xl p-[1px] before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-violet-500/40 before:via-white/10 before:to-fuchsia-500/40 before:transition-opacity',
        active ? 'before:opacity-100' : 'before:opacity-0 hover:before:opacity-100',
        className
      )}
    >
      <div className="relative h-full rounded-2xl bg-[#0c0c10]/90">{children}</div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────
export function StatCard({ label, value, total, suffix, decimals = 0, icon, delay = 0, color = 'violet' }) {
  const numericValue = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) || 0 : value;
  const pct = total && total > 0 ? Math.min(100, (numericValue / total) * 100) : 0;
  const pctFormatted = pct.toFixed(1);
  const isHigh = pct >= 90;
  const isMid = pct >= 70 && pct < 90;

  const colorClasses = {
    violet: 'from-violet-500 to-fuchsia-500 text-violet-300',
    emerald: 'from-emerald-500 to-teal-500 text-emerald-300',
    sky: 'from-sky-500 to-blue-500 text-sky-300',
    amber: 'from-amber-500 to-orange-500 text-amber-300',
    rose: 'from-rose-500 to-pink-500 text-rose-300',
    fuchsia: 'from-fuchsia-500 to-purple-500 text-fuchsia-300',
  };

  const barColor = isHigh ? 'from-red-500 to-rose-500' : isMid ? 'from-amber-500 to-orange-500' : colorClasses[color].split(' ').slice(0, 2).join(' ');
  const displayValue = typeof value === 'string' ? value : numericValue;

  return (
    <Card delay={delay} hover className="group relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</p>
        {icon && <span className={cn('text-white/60', colorClasses[color].split(' ').pop())}>{icon}</span>}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">
        {typeof displayValue === 'number' ? <AnimatedNumber value={displayValue} decimals={decimals} /> : displayValue}
        {total != null && (
          <span className="text-base font-normal text-zinc-500">
            {' '}/ <AnimatedNumber value={total} decimals={decimals} />
          </span>
        )}
        {suffix && <span className="ml-1 text-sm font-normal text-zinc-500">{suffix}</span>}
      </p>
      {total != null && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className={cn('h-full rounded-full bg-gradient-to-r', barColor)}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, delay: delay + 0.2, ease: 'easeOut' }}
            />
          </div>
          <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wider', isHigh ? 'text-red-400' : isMid ? 'text-amber-400' : 'text-zinc-500')}>{pctFormatted}%</span>
        </div>
      )}
    </Card>
  );
}

// ── Buttons ──────────────────────────────────────────────────
export function GlowButton({ href, loading = false, disabled, onClick, type = 'button', className, children, variant = 'primary' }) {
  const variants = {
    primary: cn(
      'relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white',
      'shadow-[0_0_24px_rgb(139_92_246/0.3)] transition-all hover:bg-violet-500 hover:shadow-[0_0_32px_rgb(139_92_246/0.45)]'
    ),
    secondary: cn(
      'rounded-xl border border-white/[0.08] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white',
      'transition-all hover:border-violet-500/30 hover:bg-white/[0.08]'
    ),
    ghost: 'text-sm font-medium text-zinc-400 transition-colors hover:text-white',
    danger: cn(
      'rounded-xl bg-red-600/90 px-5 py-2.5 text-sm font-semibold text-white',
      'transition-all hover:bg-red-500'
    ),
  };

  const cls = cn(variants[variant], 'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]', className);
  const content = (
    <>
      {loading && <Spinner />}
      {children}
    </>
  );

  if (href) {
    return (
      <motion.a href={href} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className={cls}>
        {content}
      </motion.a>
    );
  }
  return (
    <motion.button type={type} onClick={onClick} disabled={disabled || loading} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className={cls}>
      {content}
    </motion.button>
  );
}

export function Spinner({ className }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// ── Badges ───────────────────────────────────────────────────
const BADGE_TONES = {
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-red-500/30 bg-red-500/10 text-red-300',
  zinc: 'border-white/[0.08] bg-white/[0.04] text-zinc-300',
  blue: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  purple: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
};

export function Badge({ tone = 'violet', className, children, dot }) {
  return (
    <span className={cn('chip border', BADGE_TONES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot === true ? 'bg-current' : `bg-${dot}-400`)} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    running: { tone: 'green', dot: 'emerald', label: 'Running', ring: true },
    offline: { tone: 'zinc', dot: 'zinc', label: 'Offline' },
    installing: { tone: 'amber', dot: 'amber', label: 'Installing', pulse: true },
    suspended: { tone: 'red', dot: 'red', label: 'Suspended' },
  };
  const s = map[status] || map.offline;
  return (
    <span className={cn('chip border relative', BADGE_TONES[s.tone])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot === 'zinc' ? 'bg-zinc-400' : s.dot === 'amber' ? 'bg-amber-400' : s.dot === 'red' ? 'bg-red-400' : 'bg-emerald-400', s.pulse && 'status-ping')} />
      {s.label}
    </span>
  );
}

// ── Custom select ────────────────────────────────────────────
export function Select({ value, onChange, children, className, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) { document.addEventListener('mousedown', onClick); return () => document.removeEventListener('mousedown', onClick); }
  }, [open]);

  const options = React.Children.toArray(children).filter((c) => c.type === 'option');
  const selected = options.find((c) => c.props.value === value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          'input flex w-full items-center justify-between text-left',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={selected ? 'text-zinc-100' : 'text-zinc-500'}>{selected ? selected.props.children : '—'}</span>
        <svg className={cn('h-4 w-4 text-zinc-400 transition-transform', open && 'rotate-180')} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-white/[0.08] bg-[#0c0c10] py-1 shadow-2xl">
          {options.map((opt) => (
            <button
              key={opt.props.value}
              type="button"
              onClick={() => { onChange({ target: { value: opt.props.value } }); setOpen(false); }}
              className={cn(
                'block w-full px-4 py-2 text-left text-sm transition-colors',
                opt.props.value === value ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
              )}
            >
              {opt.props.children}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Multi-select dropdown ────────────────────────────────────
export function MultiSelect({ value = [], onChange, children, placeholder = 'Select…', className, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) { document.addEventListener('mousedown', onClick); return () => document.removeEventListener('mousedown', onClick); }
  }, [open]);

  const options = React.Children.toArray(children).filter((c) => c.type === 'option');
  const selectedSet = new Set(value);
  const selectedLabels = options.filter((c) => selectedSet.has(c.props.value)).map((c) => c.props.children);

  function toggle(v) {
    const next = selectedSet.has(v) ? value.filter((x) => x !== v) : [...value, v];
    onChange(next);
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          'input flex w-full items-center justify-between text-left',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={selectedLabels.length ? 'text-zinc-100' : 'text-zinc-500'}>
          {selectedLabels.length ? `${selectedLabels.length} selected` : placeholder}
        </span>
        <svg className={cn('h-4 w-4 text-zinc-400 transition-transform', open && 'rotate-180')} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-white/[0.08] bg-[#0c0c10] py-1 shadow-2xl">
          {options.map((opt) => {
            const selected = selectedSet.has(opt.props.value);
            return (
              <button
                key={opt.props.value}
                type="button"
                onClick={() => toggle(opt.props.value)}
                className={cn(
                  'flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors',
                  selected ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                )}
              >
                <span>{opt.props.children}</span>
                {selected && <span className="text-violet-300">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────
export function SectionHeader({ title, sub, action }) {
  return (
    <div className="mb-5 flex items-end justify-between">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
        {sub && <p className="text-sm text-zinc-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────
export function Skeleton({ className }) {
  return <div className={cn('shimmer rounded-md', className)} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 shadow-xl">
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────
export function EmptyState({ icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 text-center">
      {icon && <div className="mb-4 text-5xl">{icon}</div>}
      <h3 className="mb-1 text-lg font-semibold text-white">{title}</h3>
      {sub && <p className="max-w-sm text-sm text-zinc-500">{sub}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────
export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20 }}
          className={cn(
            'flex min-w-[16rem] items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl',
            t.type === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
          )}
        >
          {t.type === 'error' ? <Icons.Exclamation className="h-5 w-5 shrink-0" /> : <Icons.Check className="h-5 w-5 shrink-0" />}
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button onClick={() => onDismiss(t.id)} className="text-current opacity-60 hover:opacity-100">
            <Icons.Close className="h-4 w-4" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
  return { toasts, push, dismiss };
}

// ── Mobile navigation menu ───────────────────────────────────
export function MobileMenu({ nav, user, onLogout, open, onClose, title = 'Panel' }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <motion.div
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'tween', duration: 0.2 }}
        className="fixed inset-y-0 left-0 z-40 w-[280px] border-r border-white/[0.05] bg-[#08080a]/95 backdrop-blur-2xl lg:hidden"
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 ring-1 ring-white/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="7" rx="1.5" />
                <rect x="3" y="13" width="18" height="7" rx="1.5" />
                <path d="M7 7.5h.01M7 16.5h.01" strokeWidth={2.4} />
              </svg>
            </span>
            <div>
              <p className="font-bold text-white leading-tight">{title}</p>
              <p className="text-xs text-zinc-600">Cloud Platform</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-zinc-400 hover:text-white">
            <Icons.Close className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-0.5 px-3 py-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="active-nav-pill-mobile" className="absolute inset-0 rounded-xl border border-violet-500/25 bg-violet-500/[0.12] shadow-[0_0_20px_rgb(139_92_246/0.12)]" />}
                  <span className={cn('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors', isActive ? 'bg-violet-500/20 text-violet-300' : 'bg-white/[0.03] text-zinc-400 group-hover:text-zinc-200')}>
                    {n.icon}
                  </span>
                  <span className="relative">{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/10 text-sm font-bold text-violet-200 ring-1 ring-white/10">
              {user?.username?.[0]?.toUpperCase() || 'R'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.username}</p>
              <p className="text-xs uppercase tracking-wide text-violet-300/80">{user?.root_admin ? 'Admin' : 'User'}</p>
            </div>
            <button
              onClick={async () => { await api.logout(); onLogout(); navigate('/login'); onClose(); }}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-zinc-500 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <Icons.Logout className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Error boundary ───────────────────────────────────────────
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-500/10 text-3xl text-red-400 ring-1 ring-red-500/20">
            <Icons.Exclamation className="h-10 w-10" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-white">Something went wrong</h1>
          <p className="mb-6 max-w-md text-sm text-zinc-500">{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => window.location.reload()} className="btn-primary">Reload page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Error fallback card ──────────────────────────────────────
export function ErrorState({ title, sub, onRetry }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-2xl text-red-400 ring-1 ring-red-500/20">
        <Icons.Exclamation className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-white">{title}</h2>
      {sub && <p className="mb-6 max-w-md text-sm text-zinc-500">{sub}</p>}
      {onRetry && <button onClick={onRetry} className="btn-primary">Try again</button>}
    </div>
  );
}

// ── Icons (stroke style) ─────────────────────────────────────
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Icons = {
  Home: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" />
    </svg>
  ),
  Server: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" strokeWidth={2.4} />
    </svg>
  ),
  Plus: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Shield: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  Logout: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M14 4h-8a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h8" /><path d="M10 12h11M17.5 8.5 21 12l-3.5 3.5" />
    </svg>
  ),
  Cpu: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </svg>
  ),
  Ram: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="3" y="7" width="18" height="10" rx="1.5" /><path d="M7 17v2.5M12 17v2.5M17 17v2.5M7 10.5v3M12 10.5v3M17 10.5v3" />
    </svg>
  ),
  Disk: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  ),
  Play: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  ),
  Stop: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  ),
  Restart: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
    </svg>
  ),
  Kill: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  Terminal: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  ),
  Folder: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  Env: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  Gear: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </svg>
  ),
  Users: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.2a6.5 6.5 0 0 1 4 5.8" />
    </svg>
  ),
  Node: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01" />
    </svg>
  ),
  Back: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ),
  Upload: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" />
    </svg>
  ),
  Trash: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
    </svg>
  ),
  Key: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 21 2M15 8l3 3M18 5l2 2" />
    </svg>
  ),
  Database: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  ),
  MapPin: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  Egg: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M12 3c4 5 7 9 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z" />
    </svg>
  ),
  Search: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  Copy: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Refresh: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  Clock: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Save: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M5 3h11l5 5v13H5z" /><path d="M8 3v6h8V3M8 21v-7h8v7" />
    </svg>
  ),
  Menu: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  Close: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  Box: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" /><path d="M12 22.08V12" />
    </svg>
  ),
  Exclamation: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" />
    </svg>
  ),
  Wallet: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M15 12.5h5v3h-5a1.5 1.5 0 0 1 0-3z" />
    </svg>
  ),
  Bag: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M5.5 8h13l-1 12.5a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z" />
      <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
    </svg>
  ),
  File: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  CloudDown: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M18 10h1.5a3.5 3.5 0 1 1-.5 7H18" />
      <path d="M4 14.5A4.5 4.5 0 0 1 8.5 10h.8A7 7 0 1 1 18 16" />
      <path d="M12 13v7M8 17l4 4 4-4" />
    </svg>
  ),
  CloudUp: (p) => (
    <svg viewBox="0 0 24 24" className={p.className} {...stroke}>
      <path d="M18 10h1.5a3.5 3.5 0 1 1-.5 7H18" />
      <path d="M4 14.5A4.5 4.5 0 0 1 8.5 10h.8A7 7 0 1 1 18 16" />
      <path d="M12 20v-7M8 13l4-4 4 4" />
    </svg>
  ),
};
