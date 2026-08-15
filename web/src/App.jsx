import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, NavLink, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';
import { AuroraBackground, ConfirmProvider, CursorGlow, ParticlesBackground, Icons, Toasts, ToastContext, useToasts, cn, Badge } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ServerDetail from './pages/ServerDetail.jsx';
import Admin from './pages/admin/Admin.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const SettingsContext = createContext({});
export const useSettings = () => useContext(SettingsContext);

function Logo({ size = 36 }) {
  const settings = useSettings();
  const logoUrl = settings['panel.logo_url'];
  const safeLogo = logoUrl && /^(https?:|\/)/.test(logoUrl) ? logoUrl : null;
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 ring-1 ring-white/10"
      style={{ width: size, height: size }}
    >
      {safeLogo ? (
        <img src={safeLogo} alt="" className="h-full w-full object-contain p-1" />
      ) : (
        <Icons.Server className="h-5 w-5 text-violet-300" />
      )}
    </span>
  );
}

function avatarGradient(username) {
  const colors = [
    ['from-violet-500', 'to-fuchsia-600'],
    ['from-sky-500', 'to-blue-600'],
    ['from-emerald-500', 'to-teal-600'],
    ['from-amber-500', 'to-orange-600'],
    ['from-rose-500', 'to-pink-600'],
    ['from-indigo-500', 'to-violet-600'],
  ];
  let hash = 0;
  for (let i = 0; i < (username || '').length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % colors.length;
  return `bg-gradient-to-br ${colors[idx][0]} ${colors[idx][1]}`;
}

function NavItem({ item, active, delay = 0 }) {
  const Icon = item.icon;
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay }}>
      <NavLink
        to={item.to}
        end={item.end}
        className={cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
          active ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
        )}
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId="active-nav-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-xl border border-violet-500/25 bg-violet-500/[0.12] shadow-[0_0_20px_rgb(139_92_246/0.12)]"
              />
            )}
            <span className={cn(
              'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
              isActive ? 'bg-violet-500/20 text-violet-300' : 'bg-white/[0.03] text-zinc-400 group-hover:text-zinc-200'
            )}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="relative">{item.label}</span>
            {isActive && <span className="relative ml-auto h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgb(139_92_246/0.8)]" />}
          </>
        )}
      </NavLink>
    </motion.div>
  );
}

function Sidebar({ user, onLogout, nav }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const settings = useSettings();
  const panelName = settings['app.name'] || 'Panel';

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[280px] flex-col border-r border-white/[0.05] bg-[#08080a]/80 p-4 backdrop-blur-2xl lg:flex">
      <Link to="/" className="flex items-center gap-3 px-2 py-2">
        <Logo size={38} />
        <div className="flex flex-col">
          <span className="text-base font-bold tracking-tight text-white">{panelName}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Cloud Platform</span>
        </div>
      </Link>

      {/* User card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="mt-6 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-lg shadow-black/30 ring-1 ring-white/10',
            avatarGradient(user?.username)
          )}>
            {user?.username?.[0]?.toUpperCase() || 'R'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user?.username}</p>
            <p className="truncate text-[11px] text-zinc-500">{user?.email}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge tone="zinc" className="text-[10px]">Panel</Badge>
          {user?.root_admin && <Badge tone="amber" className="text-[10px]">Admin</Badge>}
        </div>
      </motion.div>

      {/* Nav */}
      <nav className="mt-8 flex-1 space-y-0.5">
        {nav.map((item, i) => (
          <NavItem
            key={item.to}
            item={item}
            active={item.end ? pathname === item.to : pathname.startsWith(item.to)}
            delay={0.08 + i * 0.04}
          />
        ))}
      </nav>

      {/* Sign out */}
      <button
        onClick={async () => { try { await api.logout(); } catch {} onLogout(); navigate('/login'); }}
        className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all hover:bg-white/[0.04] hover:text-red-300"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03]">
          <Icons.Logout className="h-[18px] w-[18px]" />
        </span>
        Sign out
      </button>
    </aside>
  );
}

function MobileNav({ user, onLogout, nav }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const settings = useSettings();
  const panelName = settings['app.name'] || 'Panel';
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.05] bg-[#08080a]/70 px-4 py-3 backdrop-blur-2xl lg:hidden">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-sm font-bold text-white">{panelName}</span>
        </Link>
        <div className="flex items-center gap-2">
          <AlertsBell />
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-zinc-400 transition hover:text-white"
            aria-label="Open menu"
          >
            <Icons.Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-white/[0.05] bg-[#08080a]/95 p-4 backdrop-blur-2xl lg:hidden"
            >
              <div className="flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
                  <Logo size={34} />
                  <span className="text-sm font-bold text-white">{panelName}</span>
                </Link>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-zinc-400 transition hover:text-white"
                  aria-label="Close menu"
                >
                  <Icons.Close className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-1 ring-white/10',
                    avatarGradient(user?.username)
                  )}>
                    {user?.username?.[0]?.toUpperCase() || 'R'}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{user?.username}</p>
                    <p className="truncate text-[11px] text-zinc-500">{user?.email}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone="zinc" className="text-[10px]">Panel</Badge>
                  {user?.root_admin && <Badge tone="amber" className="text-[10px]">Admin</Badge>}
                </div>
              </div>

              <nav className="mt-6 space-y-1">
                {nav.map((item) => {
                  const active = item.end ? pathname === item.to : pathname.startsWith(item.to);
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                        active
                          ? 'border border-violet-500/25 bg-violet-500/[0.12] text-white'
                          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                      )}
                    >
                      <span className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        active ? 'bg-violet-500/20 text-violet-300' : 'bg-white/[0.03] text-zinc-400'
                      )}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>

              <button
                onClick={async () => { try { await api.logout(); } catch {} onLogout(); navigate('/login'); setOpen(false); }}
                className="mt-6 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all hover:bg-white/[0.04] hover:text-red-300"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03]">
                  <Icons.Logout className="h-[18px] w-[18px]" />
                </span>
                Sign out
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function AlertsBell() {
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let mounted = true;
    function load() {
      api.alerts().then((d) => {
        if (!mounted) return;
        setAlerts(d.alerts || []);
        setUnread(d.unread || 0);
      }).catch(() => {});
    }
    load();
    const t = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function markRead() {
    try { await api.alertsRead(); setUnread(0); setAlerts((a) => a.map((x) => ({ ...x, read: true }))); } catch {}
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition hover:text-white"
        aria-label={`Notifications (${unread} unread)`}
      >
        <Icons.Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d12]/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-sm font-semibold text-white">Alerts</span>
            {unread > 0 && (
              <button onClick={markRead} className="text-xs text-violet-300 hover:text-violet-200">Mark all read</button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">No alerts 🎉</p>
            )}
            {alerts.map((a) => (
              <div key={a.id} className={cn('flex gap-3 border-b border-white/[0.04] px-4 py-3', !a.read && 'bg-violet-500/[0.06]')}>
                <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', a.severity === 'error' ? 'bg-red-400' : 'bg-amber-400')} />
                <div className="min-w-0">
                  <p className="text-[13px] leading-snug text-zinc-200">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{a.server_name} · {new Date(a.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const nav = [
    { to: '/', label: 'Dashboard', icon: Icons.Home, end: true },
  ];
  if (user?.root_admin) {
    nav.push(
      { to: '/admin', label: 'Overview', icon: Icons.Home, end: true },
      { to: '/admin/settings', label: 'Settings', icon: Icons.Gear, end: true },
      { to: '/admin/api-keys', label: 'Application API', icon: Icons.Key, end: true },
      { to: '/admin/databases', label: 'Databases', icon: Icons.Database, end: true },
      { to: '/admin/locations', label: 'Locations', icon: Icons.MapPin, end: true },
      { to: '/admin/nodes', label: 'Nodes', icon: Icons.Node, end: true },
      { to: '/admin/servers', label: 'Servers', icon: Icons.Server, end: true },
      { to: '/admin/users', label: 'Users', icon: Icons.Users, end: true },
      { to: '/admin/mounts', label: 'Mounts', icon: Icons.Folder, end: true },
      { to: '/admin/nests', label: 'Nests', icon: Icons.Egg, end: true },
    );
  }

  return (
    <div className="relative min-h-screen">
      <CursorGlow />
      <ParticlesBackground />
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="noise-overlay absolute inset-0" />
      </div>
      <Sidebar user={user} onLogout={logout} nav={nav} />
      <div className="lg:pl-[280px]">
        <MobileNav user={user} onLogout={logout} nav={nav} />
        <div className="hidden fixed right-4 top-4 z-40 lg:right-6 lg:top-5 lg:block">
          <AlertsBell />
        </div>
        <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 16, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.995 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4">
        <AuroraBackground />
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 ring-1 ring-white/10"
        >
          <Logo size={40} />
        </motion.div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminProtected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4">
        <AuroraBackground />
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 ring-1 ring-white/10"
        >
          <Logo size={40} />
        </motion.div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.root_admin) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function AuthLayout({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4">
        <AuroraBackground />
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 ring-1 ring-white/10"
        >
          <Logo size={40} />
        </motion.div>
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="relative min-h-screen">
      <AuroraBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-4">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});
  const toastApi = useToasts();

  useEffect(() => {
    api.me().then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false));
    api.settings().then((d) => setSettings(d.settings)).catch(() => {});
  }, []);

  // Apply branding: CSS variables, favicon and title.
  useEffect(() => {
    if (!settings) return;
    const primary = settings['panel.primary_color'] || '#8b5cf6';
    const accent = settings['panel.accent_color'] || '#d946ef';
    document.documentElement.style.setProperty('--raven-primary', primary);
    document.documentElement.style.setProperty('--raven-accent', accent);
    const favicon = settings['panel.favicon_url'];
    if (favicon && /^(https?:|\/)/.test(favicon)) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon;
    }
    const name = settings['app.name'];
    if (name) document.title = name;
  }, [settings]);

  const logout = () => setUser(null);
  const authValue = useMemo(() => ({ user, setUser, logout, loading }), [user, loading]);
  const location = useLocation();

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmProvider>
      <AuthContext.Provider value={authValue}>
        <SettingsContext.Provider value={settings}>
          <AnimatePresence mode="wait">
            <Routes location={location}>
              <Route path="/login" element={<AuthLayout><Login /></AuthLayout>} />
              <Route path="/register" element={<AuthLayout><Register /></AuthLayout>} />
              <Route path="/" element={<Protected><Dashboard /></Protected>} />
              <Route path="/servers/:id" element={<Protected><ServerDetail /></Protected>} />
              <Route path="/admin" element={<AdminProtected><Admin /></AdminProtected>} />
              <Route path="/admin/*" element={<AdminProtected><Admin /></AdminProtected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatePresence>
        </SettingsContext.Provider>
      </AuthContext.Provider>
      </ConfirmProvider>
      <Toasts toasts={toastApi.toasts} onDismiss={toastApi.dismiss} />
      {/* RavenCore attribution — required by the license, do not remove */}
      <div className="pointer-events-none fixed bottom-1.5 left-1/2 z-[90] -translate-x-1/2 text-[10px] text-zinc-600">
        Powered by <span className="font-semibold text-zinc-500">RavenCore</span>
      </div>
    </ToastContext.Provider>
  );
}
