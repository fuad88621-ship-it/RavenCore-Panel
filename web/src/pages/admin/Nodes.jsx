import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Badge, Card, GlowButton, Icons, SectionHeader, Select, ShineCard, useToast, cn } from '../../components/ui.jsx';

function AllocationsTab({ node }) {
  const [allocations, setAllocations] = useState([]);
  const [ip, setIp] = useState('0.0.0.0');
  const [port, setPort] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();

  async function load() {
    try {
      const d = await api.admin.nodeAllocations(node.id);
      setAllocations(d.allocations);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [node.id]);

  async function add(e) {
    e.preventDefault();
    try {
      await api.admin.addAllocation(node.id, ip, +port);
      setPort('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addRange(e) {
    e.preventDefault();
    try {
      const d = await api.admin.addAllocationRange(node.id, ip, +from, +to);
      toast && toast.push(`Added ${d.added} allocations`);
      setFrom(''); setTo('');
      load();
    } catch (err) {
      setError(err.message);
      toast && toast.push(err.message, 'error');
    }
  }

  async function remove(a) {
    if (!confirm(`Delete allocation ${a.ip}:${a.port}?`)) return;
    try {
      await api.admin.deleteAllocation(a.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <h4 className="mb-3 text-sm font-semibold text-white">Add single port</h4>
          <form onSubmit={add} className="flex gap-2">
            <input className="input font-mono max-w-[130px]" value={ip} onChange={(e) => setIp(e.target.value)} />
            <input className="input font-mono" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="Port" required />
            <button className="btn-primary !px-3">Add</button>
          </form>
        </Card>
        <Card>
          <h4 className="mb-3 text-sm font-semibold text-white">Add port range</h4>
          <form onSubmit={addRange} className="flex gap-2">
            <input className="input font-mono max-w-[130px]" value={ip} onChange={(e) => setIp(e.target.value)} />
            <input className="input font-mono" type="number" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" required />
            <span className="self-center text-zinc-500">→</span>
            <input className="input font-mono" type="number" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" required />
            <button className="btn-primary !px-3">Add</button>
          </form>
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Port</th>
              <th className="px-4 py-3">Server</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">No allocations. Add a port or range.</td></tr>}
            {allocations.map((a) => (
              <tr key={a.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-zinc-300">{a.ip}</td>
                <td className="px-4 py-3 font-mono text-white">{a.port}</td>
                <td className="px-4 py-3">
                  {a.server_identifier ? <span className="chip bg-violet-500/10 text-violet-300 border border-violet-500/20">{a.server_identifier}</span> : <span className="text-zinc-500">free</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => remove(a)} disabled={!!a.server_identifier}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function NodeDetail({ node, onBack }) {
  const [tab, setTab] = useState('settings');
  const [form, setForm] = useState({ ...node });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    try {
      const d = await api.admin.updateNode(node.id, form);
      setForm(d.node);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <Icons.Back className="h-4 w-4" /> Back to nodes
      </button>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
          <Icons.Node className="h-5 w-5 text-violet-300" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-white">{node.name}</h1>
          <p className="text-xs text-zinc-500">{node.fqdn}:{node.port} · {node.location_short || 'no location'}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-white/[0.06]">
        {[{ id: 'settings', label: 'Settings' }, { id: 'allocations', label: 'Allocations' }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-white')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'allocations' ? (
        <AllocationsTab node={node} />
      ) : (
        <div className="max-w-2xl space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Card className="space-y-4">
            <h3 className="font-semibold text-white">Basic Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">FQDN</label><input className="input font-mono" value={form.fqdn} onChange={(e) => setForm({ ...form, fqdn: e.target.value })} /></div>
              <div className="col-span-2"><label className="label">Description</label><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div>
              <label className="label">Node Visibility</label>
              <div className="flex gap-2">
                <button onClick={() => setForm({ ...form, visibility: 'public' })} className={cn('rounded-lg border px-4 py-2 text-sm', form.visibility === 'public' ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Public</button>
                <button onClick={() => setForm({ ...form, visibility: 'private' })} className={cn('rounded-lg border px-4 py-2 text-sm', form.visibility === 'private' ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Private</button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Private nodes can't be auto-deployed to.</p>
            </div>
            <div>
              <label className="label">Communicate Over SSL</label>
              <div className="flex gap-2">
                <button onClick={() => setForm({ ...form, scheme: 'https' })} className={cn('rounded-lg border px-4 py-2 text-sm', form.scheme === 'https' ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Use SSL Connection</button>
                <button onClick={() => setForm({ ...form, scheme: 'http' })} className={cn('rounded-lg border px-4 py-2 text-sm', form.scheme === 'http' ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Use HTTP Connection</button>
              </div>
            </div>
            <div>
              <label className="label">Behind Proxy (Cloudflare)</label>
              <div className="flex gap-2">
                <button onClick={() => setForm({ ...form, behind_proxy: false })} className={cn('rounded-lg border px-4 py-2 text-sm', !form.behind_proxy ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Not Behind Proxy</button>
                <button onClick={() => setForm({ ...form, behind_proxy: true })} className={cn('rounded-lg border px-4 py-2 text-sm', form.behind_proxy ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400')}>Behind Proxy</button>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <h3 className="font-semibold text-white">Configuration</h3>
            <div><label className="label">Daemon Server File Directory</label><input className="input font-mono" value={form.file_directory || '/var/lib/raven/bots'} onChange={(e) => setForm({ ...form, file_directory: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Total Memory (MiB)</label><input className="input" type="number" value={form.memory_mb} onChange={(e) => setForm({ ...form, memory_mb: +e.target.value })} /></div>
              <div><label className="label">Memory Over-Allocation %</label><input className="input" type="number" value={form.memory_overallocate} onChange={(e) => setForm({ ...form, memory_overallocate: +e.target.value })} /></div>
              <div><label className="label">CPU Cores</label><input className="input" type="number" value={form.cpu_cores} onChange={(e) => setForm({ ...form, cpu_cores: +e.target.value })} /></div>
              <div><label className="label">Total Disk (MiB)</label><input className="input" type="number" value={form.disk_mb} onChange={(e) => setForm({ ...form, disk_mb: +e.target.value })} /></div>
              <div><label className="label">Disk Over-Allocation %</label><input className="input" type="number" value={form.disk_overallocate} onChange={(e) => setForm({ ...form, disk_overallocate: +e.target.value })} /></div>
              <div><label className="label">CPU Over-Allocation %</label><input className="input" type="number" value={form.cpu_overallocate} onChange={(e) => setForm({ ...form, cpu_overallocate: +e.target.value })} /></div>
              <div><label className="label">Daemon Port</label><input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: +e.target.value })} /></div>
              <div><label className="label">Daemon SFTP Port</label><input className="input" type="number" value={form.sftp_port} onChange={(e) => setForm({ ...form, sftp_port: +e.target.value })} /></div>
              <div><label className="label">Daemon Token</label><input className="input font-mono" value={form.daemon_token} onChange={(e) => setForm({ ...form, daemon_token: e.target.value })} /></div>
            </div>
            <p className="text-xs text-zinc-500">Over-allocation: enter -1 for unlimited, 0 to prevent over-allocating.</p>
          </Card>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>Save changes</button>
            {saved && <span className="self-center text-sm text-emerald-400">Saved ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Nodes() {
  const [nodes, setNodes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', location_id: '', fqdn: '', port: 8080, scheme: 'https',
    visibility: 'public', behind_proxy: false, file_directory: '/var/lib/raven/bots', sftp_port: 2022,
    memory_mb: 7680, memory_overallocate: 0, disk_mb: 80000, disk_overallocate: 0,
    cpu_cores: 4, cpu_overallocate: 0, daemon_token: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [n, l] = await Promise.all([api.admin.nodes(), api.admin.locations()]);
      setNodes(n.nodes);
      setLocations(l.locations);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.admin.createNode(form);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(n) {
    await api.admin.updateNode(n.id, { enabled: !n.enabled });
    load();
  }

  async function remove(n) {
    if (!confirm(`Delete node ${n.name}?`)) return;
    try {
      await api.admin.deleteNode(n.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (selected) return <NodeDetail node={selected} onBack={() => setSelected(null)} />;

  return (
    <div>
      <SectionHeader
        title="Nodes"
        sub="The machines that run your servers. Create local or remote nodes."
        action={
          <GlowButton onClick={() => setShowForm(!showForm)}>
            <Icons.Plus className="h-4 w-4" /> New Node
          </GlowButton>
        }
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card className="mb-4 space-y-4">
          <h3 className="font-semibold text-white">New Node</h3>
          <form onSubmit={create} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><label className="label">Location</label>
              <Select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.short}</option>)}
              </Select>
            </div>
            <div><label className="label">FQDN</label><input className="input font-mono" value={form.fqdn} onChange={(e) => setForm({ ...form, fqdn: e.target.value })} placeholder="node.example.com" required /></div>
            <div><label className="label">Daemon Port</label><input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: +e.target.value })} /></div>
            <div><label className="label">SFTP Port</label><input className="input" type="number" value={form.sftp_port} onChange={(e) => setForm({ ...form, sftp_port: +e.target.value })} /></div>
            <div>
              <label className="label">Visibility</label>
              <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </Select>
            </div>
            <div>
              <label className="label">Scheme</label>
              <Select value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })}>
                <option value="https">HTTPS (SSL)</option>
                <option value="http">HTTP</option>
              </Select>
            </div>
            <div><label className="label">File Directory</label><input className="input font-mono" value={form.file_directory} onChange={(e) => setForm({ ...form, file_directory: e.target.value })} /></div>
            <div><label className="label">Total Memory (MiB)</label><input className="input" type="number" value={form.memory_mb} onChange={(e) => setForm({ ...form, memory_mb: +e.target.value })} /></div>
            <div><label className="label">Memory Over-Allocation %</label><input className="input" type="number" value={form.memory_overallocate} onChange={(e) => setForm({ ...form, memory_overallocate: +e.target.value })} /></div>
            <div><label className="label">Total Disk (MiB)</label><input className="input" type="number" value={form.disk_mb} onChange={(e) => setForm({ ...form, disk_mb: +e.target.value })} /></div>
            <div><label className="label">Disk Over-Allocation %</label><input className="input" type="number" value={form.disk_overallocate} onChange={(e) => setForm({ ...form, disk_overallocate: +e.target.value })} /></div>
            <div><label className="label">CPU Cores</label><input className="input" type="number" value={form.cpu_cores} onChange={(e) => setForm({ ...form, cpu_cores: +e.target.value })} /></div>
            <div><label className="label">CPU Over-Allocation %</label><input className="input" type="number" value={form.cpu_overallocate} onChange={(e) => setForm({ ...form, cpu_overallocate: +e.target.value })} /></div>
            <div className="col-span-2">
              <label className="label">Daemon Token (agent secret)</label>
              <input className="input font-mono" value={form.daemon_token} onChange={(e) => setForm({ ...form, daemon_token: e.target.value })} placeholder="Leave empty to auto-generate" />
              <p className="mt-1 text-xs text-zinc-500">If left empty, a secure token is generated automatically. Copy it from the node's settings after creation.</p>
            </div>
            <div className="col-span-2 flex gap-2">
              <button className="btn-primary" disabled={busy}>{busy ? 'Registering…' : 'Register node'}</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {nodes.map((n) => {
          const memPct = n.memory_mb ? Math.min(100, (n.used_memory / n.memory_mb) * 100) : 0;
          const diskPct = n.disk_mb ? Math.min(100, (n.used_disk / n.disk_mb) * 100) : 0;
          return (
            <ShineCard key={n.id} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
                    <Icons.Node className="h-5 w-5 text-violet-300" />
                  </span>
                  <div>
                    <p className="font-semibold text-white">{n.name}</p>
                    <p className="text-xs text-zinc-500">{n.fqdn}:{n.port} · {n.location_short || 'no location'} · {n.server_count} server(s)</p>
                    {n.visibility === 'private' && <Badge tone="amber" className="mt-1">Private node</Badge>}
                  </div>
                </div>
                <Badge tone={n.enabled ? 'green' : 'red'} dot={n.enabled ? 'emerald' : 'red'}>{n.enabled ? 'Online' : 'Disabled'}</Badge>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-zinc-500"><span>Memory</span><span>{n.used_memory}/{n.memory_mb} MB</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-500" style={{ width: `${memPct}%` }} /></div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-zinc-500"><span>Disk</span><span>{n.used_disk}/{n.disk_mb} MB</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-sky-500" style={{ width: `${diskPct}%` }} /></div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setSelected(n)}>Configure</button>
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => toggle(n)}>{n.enabled ? 'Disable' : 'Enable'}</button>
                <button className="btn-danger !px-3 !py-1.5 text-xs ml-auto" onClick={() => remove(n)}>Delete</button>
              </div>
            </ShineCard>
          );
        })}
      </div>
    </div>
  );
}
