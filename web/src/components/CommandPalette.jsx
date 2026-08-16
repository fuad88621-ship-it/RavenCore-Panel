import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icons, cn } from './ui.jsx';

const ADMIN_ITEMS = [
  { id: 'admin/overview', label: 'Overview', to: '/admin', icon: 'Home' },
  { id: 'admin/servers', label: 'Servers', to: '/admin/servers', icon: 'Server' },
  { id: 'admin/nodes', label: 'Nodes', to: '/admin/nodes', icon: 'Node' },
  { id: 'admin/users', label: 'Users', to: '/admin/users', icon: 'Users' },
  { id: 'admin/nests', label: 'Nests', to: '/admin/nests', icon: 'Egg' },
  { id: 'admin/databases', label: 'Databases', to: '/admin/databases', icon: 'Database' },
  { id: 'admin/locations', label: 'Locations', to: '/admin/locations', icon: 'MapPin' },
  { id: 'admin/mounts', label: 'Mounts', to: '/admin/mounts', icon: 'Folder' },
  { id: 'admin/api-keys', label: 'API Keys', to: '/admin/api-keys', icon: 'Key' },
  { id: 'admin/settings', label: 'Settings', to: '/admin/settings', icon: 'Gear' },
];

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', to: '/', icon: 'Home' },
  ...ADMIN_ITEMS,
];

function Icon({ name, className }) {
  const I = Icons[name];
  return I ? <I className={className} /> : null;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = !!user?.root_admin;

  // Load servers when opening.
  useEffect(() => {
    if (!open) return;
    api.servers().then((d) => setServers(d.servers || [])).catch(() => setServers([]));
  }, [open]);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  // Toggle on Ctrl/Cmd + K.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav = NAV_ITEMS.filter((it) => isAdmin || !it.to.startsWith('/admin'));
    const serverItems = servers.map((s) => ({
      id: `server-${s.id}`,
      label: s.name,
      sub: s.egg_name || 'Server',
      to: `/servers/${s.id}`,
      icon: 'Server',
      kind: 'server',
    }));
    const all = [
      ...nav,
      ...serverItems,
    ];
    if (!q) return all;
    return all.filter((it) =>
      it.label.toLowerCase().includes(q) ||
      (it.sub || '').toLowerCase().includes(q) ||
      it.to.toLowerCase().includes(q)
    );
  }, [query, servers, isAdmin]);

  useEffect(() => {
    if (selected >= items.length) setSelected(0);
  }, [items.length, selected]);

  function go(item) {
    if (!item) return;
    setOpen(false);
    if (item.to) navigate(item.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[selected]);
    }
  }

  // Scroll selected into view.
  useEffect(() => {
    const el = listRef.current?.children[selected];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Don't render on auth pages.
  if (location.pathname === '/login' || location.pathname === '/register') return null;
  if (!user) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-4 top-20 z-[80] mx-auto w-full max-w-xl sm:top-24"
          >
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b0f]/95 shadow-2xl backdrop-blur-2xl">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
                <Icons.Search className="h-5 w-5 text-zinc-500" />
                <input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Jump to a page or server…"
                  className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                />
                <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">ESC</span>
              </div>

              {/* List */}
              <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
                {items.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">No results for “{query}”</div>
                ) : (
                  items.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={() => go(item)}
                      onMouseEnter={() => setSelected(i)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        i === selected ? 'bg-violet-500/15' : 'hover:bg-white/[0.03]'
                      )}
                    >
                      <span className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04]',
                        i === selected ? 'text-violet-300' : 'text-zinc-500'
                      )}>
                        <Icon name={item.icon} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className={cn('truncate text-sm', i === selected ? 'text-violet-100' : 'text-zinc-200')}>{item.label}</p>
                        {item.sub && <p className="truncate text-xs text-zinc-500">{item.sub}</p>}
                      </div>
                      {item.kind === 'server' && (
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-zinc-600">Server</span>
                      )}
                      {item.to?.startsWith('/admin') && (
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-zinc-600">Admin</span>
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1"><span className="rounded border border-white/[0.08] bg-white/[0.04] px-1 text-[10px]">↑↓</span> navigate</span>
                <span className="flex items-center gap-1"><span className="rounded border border-white/[0.08] bg-white/[0.04] px-1 text-[10px]">↵</span> select</span>
                <span className="ml-auto">Ctrl + K</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
