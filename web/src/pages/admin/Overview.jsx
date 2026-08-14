import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, ErrorState, Icons, SectionHeader, Skeleton, SkeletonCard, StatCard, cn } from '../../components/ui.jsx';

function ResourceBar({ used, total, unit, color = 'violet' }) {
  const pct = Math.min(100, (used / Math.max(total, 1)) * 100);
  const colors = { violet: 'from-violet-500 to-fuchsia-500', sky: 'from-sky-500 to-blue-500', emerald: 'from-emerald-500 to-teal-500', amber: 'from-amber-500 to-orange-500' };
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', colors[color])} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-zinc-400">{used}/{total} {unit}</span>
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.admin.overview().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorState title="Failed to load overview" sub={error} onRetry={() => window.location.reload()} />;
  if (!data) {
    return (
      <div>
        <Skeleton className="mb-2 h-7 w-32" />
        <Skeleton className="mb-8 h-4 w-48" />
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <Skeleton className="mb-2 h-7 w-32" />
        <Skeleton className="mb-4 h-4 w-56" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const stats = [
    { label: 'Users', value: data.users, icon: <Icons.Users className="h-5 w-5" />, color: 'violet' },
    { label: 'Servers', value: data.servers, icon: <Icons.Server className="h-5 w-5" />, color: 'sky' },
    { label: 'Running', value: data.running, icon: <Icons.Play className="h-5 w-5" />, color: 'emerald' },
    { label: 'Nodes', value: data.nodes, icon: <Icons.Node className="h-5 w-5" />, color: 'violet' },
    { label: 'Locations', value: data.locations, icon: <Icons.MapPin className="h-5 w-5" />, color: 'sky' },
    { label: 'Eggs', value: data.eggs, icon: <Icons.Egg className="h-5 w-5" />, color: 'amber' },
  ];

  return (
    <div>
      <SectionHeader title="Overview" sub="A quick look at your panel." />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-6">
        {stats.map((s, i) => (
          <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} color={s.color} delay={i * 0.04} />
        ))}
      </div>

      <SectionHeader title="Node Resources" sub="Memory, disk and CPU usage per node." />
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Node</th>
              <th className="px-4 py-3">Servers</th>
              <th className="px-4 py-3">Memory</th>
              <th className="px-4 py-3">Disk</th>
              <th className="px-4 py-3">CPU</th>
            </tr>
          </thead>
          <tbody>
            {(data.nodeStats || []).map((n) => (
              <tr key={n.name} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-white">{n.name}</td>
                <td className="px-4 py-3">{n.server_count}</td>
                <td className="px-4 py-3"><ResourceBar used={n.used_memory} total={n.memory_mb} unit="MB" color="violet" /></td>
                <td className="px-4 py-3"><ResourceBar used={n.used_disk} total={n.disk_mb} unit="MB" color="sky" /></td>
                <td className="px-4 py-3"><ResourceBar used={n.used_cpu} total={n.cpu_cores * 100} unit="%" color="emerald" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
