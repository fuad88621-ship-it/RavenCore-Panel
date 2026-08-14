import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icons, SectionHeader, StatusBadge, cn } from '../components/ui.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState('');
  const [showAddNode, setShowAddNode] = useState(false);
  const [nodeForm, setNodeForm] = useState({ name: '', fqdn: '', port: 8080, token: '', total_memory_mb: 7680, total_disk_mb: 80000, cpu_cores: 4 });

  async function load() {
    try {
      const [s, u, b, n] = await Promise.all([
        api.admin.stats(), api.admin.users(), api.admin.bots(), api.admin.nodes(),
      ]);
      setStats(s); setUsers(u.users); setBots(b.bots); setNodes(n.nodes);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function addNode(e) {
    e.preventDefault();
    try {
      await api.admin.addNode(nodeForm);
      setShowAddNode(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleNode(n) {
    await api.admin.setNodeEnabled(n.id, !n.enabled);
    load();
  }

  async function toggleUser(u) {
    if (u.suspended) await api.admin.unsuspendUser(u.id);
    else await api.admin.suspendUser(u.id);
    load();
  }

  async function toggleBot(b) {
    if (b.status === 'suspended') await api.admin.unsuspendBot(b.id);
    else await api.admin.suspendBot(b.id);
    load();
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <Icons.Home className="h-4 w-4" /> },
    { id: 'users', label: 'Users', icon: <Icons.Users className="h-4 w-4" /> },
    { id: 'bots', label: 'Bots', icon: <Icons.Server className="h-4 w-4" /> },
    { id: 'nodes', label: 'Nodes', icon: <Icons.Node className="h-4 w-4" /> },
  ];

  return (
    <div>
      <SectionHeader title="Admin Panel" sub="Manage users, bots and nodes." />

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="mb-6 flex gap-1 border-b border-white/[0.06]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-white'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-zinc-500">Users</p><p className="text-2xl font-bold text-white">{stats.users}</p></Card>
          <Card className="p-4"><p className="text-xs text-zinc-500">Bots</p><p className="text-2xl font-bold text-white">{stats.bots}</p></Card>
          <Card className="p-4"><p className="text-xs text-zinc-500">Running</p><p className="text-2xl font-bold text-emerald-400">{stats.running}</p></Card>
          <Card className="p-4"><p className="text-xs text-zinc-500">Nodes</p><p className="text-2xl font-bold text-white">{stats.nodes}</p></Card>
        </div>
      )}

      {tab === 'users' && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Bots</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <span className="text-white">{u.email}</span>
                    {u.role === 'admin' && <span className="ml-2 chip bg-violet-500/15 text-violet-300 border border-violet-500/20">admin</span>}
                    {u.suspended && <span className="ml-2 chip bg-red-500/10 text-red-400 border border-red-500/20">suspended</span>}
                  </td>
                  <td className="px-4 py-3 uppercase text-violet-300">{u.plan}</td>
                  <td className="px-4 py-3">{u.bot_count}</td>
                  <td className="px-4 py-3 text-zinc-500">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => toggleUser(u)}>
                      {u.suspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'bots' && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Runtime</th>
                <th className="px-4 py-3">Node</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-medium text-white">{b.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{b.owner_email}</td>
                  <td className="px-4 py-3 text-zinc-400">{b.runtime_name}</td>
                  <td className="px-4 py-3 text-zinc-400">{b.node_name || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => toggleBot(b)}>
                      {b.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'nodes' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setShowAddNode(!showAddNode)}>
              <Icons.Plus className="h-4 w-4" /> Add Node
            </button>
          </div>

          {showAddNode && (
            <Card>
              <form onSubmit={addNode} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div><label className="label">Name</label><input className="input" value={nodeForm.name} onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })} required /></div>
                <div><label className="label">FQDN</label><input className="input" value={nodeForm.fqdn} onChange={(e) => setNodeForm({ ...nodeForm, fqdn: e.target.value })} placeholder="node.example.com" required /></div>
                <div><label className="label">Port</label><input className="input" type="number" value={nodeForm.port} onChange={(e) => setNodeForm({ ...nodeForm, port: +e.target.value })} /></div>
                <div><label className="label">Token</label><input className="input font-mono" value={nodeForm.token} onChange={(e) => setNodeForm({ ...nodeForm, token: e.target.value })} required /></div>
                <div><label className="label">Memory (MB)</label><input className="input" type="number" value={nodeForm.total_memory_mb} onChange={(e) => setNodeForm({ ...nodeForm, total_memory_mb: +e.target.value })} /></div>
                <div><label className="label">Disk (MB)</label><input className="input" type="number" value={nodeForm.total_disk_mb} onChange={(e) => setNodeForm({ ...nodeForm, total_disk_mb: +e.target.value })} /></div>
                <div><label className="label">CPU cores</label><input className="input" type="number" value={nodeForm.cpu_cores} onChange={(e) => setNodeForm({ ...nodeForm, cpu_cores: +e.target.value })} /></div>
                <div className="col-span-2 flex items-end"><button className="btn-primary">Register node</button></div>
              </form>
            </Card>
          )}

          <Card className="!p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">FQDN</th>
                  <th className="px-4 py-3">RAM</th>
                  <th className="px-4 py-3">Disk</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-medium text-white">{n.name}</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{n.fqdn}</td>
                    <td className="px-4 py-3 text-zinc-400">{n.allocated_memory_mb}/{n.total_memory_mb} MB</td>
                    <td className="px-4 py-3 text-zinc-400">{n.allocated_disk_mb}/{n.total_disk_mb} MB</td>
                    <td className="px-4 py-3">
                      <span className={cn('chip border', n.enabled ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', n.enabled ? 'bg-emerald-400' : 'bg-red-500')} />
                        {n.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => toggleNode(n)}>
                        {n.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
