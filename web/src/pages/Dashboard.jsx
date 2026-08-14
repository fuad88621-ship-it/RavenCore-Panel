import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { useAuth, useSettings } from '../App.jsx';
import { Card, EmptyState, Icons, SectionHeader, Skeleton, SkeletonCard, SpotlightCard, StatusBadge, useToast, cn, AnimatedNumber } from '../components/ui.jsx';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const CpuIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
  </svg>
);
const RamIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
    <rect x="3" y="7" width="18" height="10" rx="1.5" />
    <path d="M7 17v2.5M12 17v2.5M17 17v2.5M7 10.5v3M12 10.5v3M17 10.5v3" />
  </svg>
);
const DiskIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);
const SlotIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" strokeWidth={2.4} />
  </svg>
);
const PlusIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const ArrowIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function fmtMb(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function BentoStat({ label, value, suffix, decimals = 0, icon, color, delay = 0 }) {
  const gradients = {
    violet: 'from-violet-500/20 to-fuchsia-500/10 text-violet-300',
    emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-300',
    sky: 'from-sky-500/20 to-blue-500/10 text-sky-300',
    fuchsia: 'from-fuchsia-500/20 to-pink-500/10 text-fuchsia-300',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-lg hover:shadow-violet-500/5"
    >
      <div className={cn('pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-40 blur-2xl transition-opacity group-hover:opacity-60', gradients[color].split(' ')[0], gradients[color].split(' ')[1])} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">
            <AnimatedNumber value={value} decimals={decimals} />
            {suffix && <span className="ml-1 text-sm font-normal text-zinc-500">{suffix}</span>}
          </p>
        </div>
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-white/10', gradients[color])}>
          {icon}
        </span>
      </div>
    </motion.div>
  );
}

function MiniSpark({ data, color = 'violet' }) {
  const colors = {
    violet: { fill: 'rgba(139,92,246,0.25)', stroke: '#a78bfa' },
    emerald: { fill: 'rgba(16,185,129,0.25)', stroke: '#34d399' },
    sky: { fill: 'rgba(56,189,248,0.25)', stroke: '#38bdf8' },
  };
  const c = colors[color];
  const max = Math.max(1, ...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const area = `0,${h} ${points.join(' ')} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-28 overflow-visible" preserveAspectRatio="none">
      <polygon points={area} fill={c.fill} />
      <polyline points={points.join(' ')} fill="none" stroke={c.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ServerCard({ server }) {
  const status = server.suspended ? 'suspended' : server.status || 'offline';
  const isRunning = status === 'running';
  const cpuData = [30, 45, 25, 60, 40, 55, 35, 50, 45, 60, 40, 35];

  return (
    <Link to={`/servers/${server.id}`}>
      <SpotlightCard className="group p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className={cn('status-ping absolute inline-flex h-full w-full rounded-full opacity-70', isRunning ? 'bg-emerald-400' : status === 'suspended' ? 'bg-red-400' : 'bg-amber-400')} />
              <span className={cn('relative inline-flex h-3 w-3 rounded-full', isRunning ? 'bg-emerald-400' : status === 'suspended' ? 'bg-red-400' : 'bg-amber-400')} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white transition group-hover:text-violet-200">{server.name}</p>
              <p className="text-[11px] text-zinc-500">{server.egg_name || 'Server'}</p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-600">CPU history</p>
            <MiniSpark data={cpuData} color={isRunning ? 'emerald' : 'violet'} />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            {server.cpu}% CPU · {fmtMb(server.memory_mb)} RAM · {fmtMb(server.disk_mb || 0)} disk
          </p>
        </div>
      </SpotlightCard>
    </Link>
  );
}

function QuickActionCard({ to, title, desc, icon, gradient }) {
  return (
    <Link to={to}>
      <SpotlightCard className="group p-5">
        <div className="flex items-start gap-4">
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105', gradient)}>
            {icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-white transition group-hover:text-violet-200">
              {title}
              <span className="text-zinc-500 transition-transform duration-300 group-hover:translate-x-1">{ArrowIcon}</span>
            </span>
            <span className="mt-1.5 block truncate text-xs text-zinc-500">{desc}</span>
          </div>
        </div>
      </SpotlightCard>
    </Link>
  );
}

const QUICK_ACTIONS = [
  { to: '/', title: 'Servers', desc: 'Manage your servers', gradient: 'from-emerald-500/30 to-teal-500/15', icon: SlotIcon },
  { to: '/admin/settings', title: 'Settings', desc: 'Panel configuration', gradient: 'from-amber-500/25 to-orange-500/10', icon: Icons.Gear({ className: 'h-5 w-5' }) },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.servers().then((d) => setServers(d.servers)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const running = servers.filter((s) => s.status === 'running').length;
  const totalMem = servers.reduce((s, x) => s + (x.memory_mb || 0), 0);
  const totalCpu = servers.reduce((s, x) => s + (x.cpu || 0), 0);

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-2xl lg:col-span-2" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  const settings = useSettings();
  const panelName = settings['app.name'] || 'Panel';

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <Card className="relative overflow-hidden p-6 sm:p-8" glow>
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-400">{panelName}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {greeting()},{' '}
              <span className="text-gradient">{user?.username}</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
              You have <AnimatedNumber value={servers.length} className="font-semibold text-violet-300" />{' '}
              {servers.length === 1 ? 'server' : 'servers'}. Start, stop and manage your bot hosting from one place.
            </p>
          </div>
        </Card>
      </motion.div>

      {/* Bento resource stats */}
      <section className="space-y-5">
        <SectionHeader title="Resource usage" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <BentoStat label="Total CPU" value={totalCpu / 100} suffix="cores" decimals={1} icon={CpuIcon} color="violet" delay={0.05} />
          <BentoStat label="Total RAM" value={totalMem / 1024} suffix="GiB" decimals={1} icon={RamIcon} color="emerald" delay={0.1} />
          <BentoStat label="Running" value={running} icon={SlotIcon} color="sky" delay={0.15} />
          <BentoStat label="Servers" value={servers.length} icon={SlotIcon} color="fuchsia" delay={0.2} />
        </div>
      </section>

      {/* Recent servers */}
      <section className="space-y-5">
        <SectionHeader title="Servers" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {servers.length === 0 ? (
          <EmptyState icon={<Icons.Server className="h-12 w-12 text-zinc-500" />} title="No servers yet" sub="Ask your host to create a server for you." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}>
                <ServerCard server={s} />
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="space-y-5">
        <SectionHeader title="Quick actions" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {QUICK_ACTIONS.map((qa, i) => (
            <motion.div key={qa.title} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, delay: 0.05 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}>
              <QuickActionCard {...qa} />
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
