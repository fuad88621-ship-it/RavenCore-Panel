import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import NumberInput from '../../components/NumberInput.jsx';
import { Badge, Card, GlowButton, Icons, SectionHeader, Select, ShineCard, Skeleton, useConfirm, useToast, useCopy, cn } from '../../components/ui.jsx';

function formatMb(mb) {
  if (!mb) return '0 MB';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function fmtUptime(sec) {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function AllocationsTab({ node }) {
  const [allocations, setAllocations] = useState([]);
  const [ip, setIp] = useState('0.0.0.0');
  const [port, setPort] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const confirm = useConfirm();
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
      toast.push('Allocation added');
      load();
    } catch (err) {
      setError(err.message);
      toast.push(err.message || 'Add failed', 'error');
    }
  }

  async function addRange(e) {
    e.preventDefault();
    const f = +from, t = +to;
    if (!Number.isInteger(f) || !Number.isInteger(t) || f < 1 || t > 65535 || f > t) {
      setError('Invalid port range: use integers from 1 to 65535 with from ≤ to');
      return;
    }
    try {
      const d = await api.admin.addAllocationRange(node.id, ip, f, t);
      toast && toast.push(`Added ${d.added} allocations`);
      setFrom(''); setTo('');
      load();
    } catch (err) {
      setError(err.message);
      toast && toast.push(err.message, 'error');
    }
  }

  async function remove(a) {
    if (!await confirm(`Delete allocation ${a.ip}:${a.port}?`)) return;
    try {
      await api.admin.deleteAllocation(a.id);
      toast.push('Allocation deleted');
      load();
    } catch (err) {
      setError(err.message);
      toast.push(err.message || 'Delete failed', 'error');
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">IP</th>
              <th scope="col" className="px-4 py-3">Port</th>
              <th scope="col" className="px-4 py-3">Server</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
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
        </div>
      </Card>
    </div>
  );
}

// ── Cleanup modal: 3-step confirmation (preview → confirm → type CLEANUP) ──
function CleanupModal({ node, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [days, setDays] = useState(7);
  const [servers, setServers] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  // Load the preview whenever the days value changes (debounced by the button).
  async function loadPreview() {
    setError('');
    setBusy(true);
    try {
      const d = await api.admin.nodeCleanupPreview(node.id, days);
      setServers(d.servers);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { loadPreview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true);
    setError('');
    try {
      const d = await api.admin.nodeCleanup(node.id, days, typed);
      toast.push(`Deleted ${d.deleted} inactive server${d.deleted === 1 ? '' : 's'}`);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const count = servers ? servers.length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-white">Cleanup {node.name}</h3>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white" aria-label="Close">
            <Icons.Close className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-4 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={cn('flex-1 rounded-full py-1 text-center text-[11px] font-semibold', step >= s ? 'bg-red-500/20 text-red-200' : 'bg-white/[0.05] text-zinc-500')}>
              {s === 1 ? 'Review' : s === 2 ? 'Confirm' : 'Type CLEANUP'}
            </div>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Find servers on <b className="text-white">{node.name}</b> that are <b className="text-white">offline</b> and have had no activity for the given number of days. They will be <b className="text-red-300">permanently deleted</b> (files, databases, backups).
            </p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="label">Inactive for (days)</label>
                <NumberInput min={1} max={365} value={days} onChange={(n) => { setDays(n); setServers(null); }} />
              </div>
              <button className="btn-ghost" onClick={loadPreview} disabled={busy}>{busy ? 'Scanning…' : 'Scan'}</button>
            </div>
            {servers && (
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                {count === 0 ? (
                  <p className="py-4 text-center text-sm text-zinc-500">No inactive servers found. 🎉</p>
                ) : (
                  servers.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{s.name}</p>
                        <p className="font-mono text-[11px] text-zinc-500">{s.identifier}</p>
                      </div>
                      <span className="shrink-0 text-xs text-zinc-500">last active {new Date(s.last_active).toLocaleDateString()}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary flex-1" onClick={() => setStep(2)} disabled={count === 0 || busy}>Continue ({count})</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-100">
                You are about to <b>permanently delete {count} server{count === 1 ? '' : 's'}</b> on {node.name}.
              </p>
              <p className="mt-2 text-xs text-red-200/70">
                This removes the containers, all files, all databases, and all backups. <b>This cannot be undone.</b>
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setStep(1)} disabled={busy}>Back</button>
              <button className="btn-danger flex-1" onClick={() => setStep(3)} disabled={busy}>I understand — continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Type <b className="font-mono text-red-300">CLEANUP</b> to permanently delete {count} server{count === 1 ? '' : 's'}.
            </p>
            <input
              className="input font-mono"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="CLEANUP"
              autoFocus
              disabled={busy}
            />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setStep(2)} disabled={busy}>Back</button>
              <button className="btn-danger flex-1" onClick={run} disabled={typed.trim() !== 'CLEANUP' || busy}>
                {busy ? 'Deleting…' : `Delete ${count} server${count === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function NodeDetail({ node, onBack }) {
  const [tab, setTab] = useState('settings');
  const [form, setForm] = useState({ ...node });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const savedTimer = useRef(null);
  const toast = useToast();

  useEffect(() => { setForm({ ...node }); }, [node.id]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  async function save() {
    try {
      const d = await api.admin.updateNode(node.id, form);
      setForm(d.node);
      setSaved(true);
      toast.push('Node settings saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><label className="label">Total Memory (MiB)</label><NumberInput value={form.memory_mb} onChange={(n) => setForm({ ...form, memory_mb: n })} /></div>
              <div><label className="label">Memory Over-Allocation %</label><NumberInput value={form.memory_overallocate} onChange={(n) => setForm({ ...form, memory_overallocate: n })} /></div>
              <div><label className="label">CPU Cores</label><NumberInput value={form.cpu_cores} onChange={(n) => setForm({ ...form, cpu_cores: n })} /></div>
              <div><label className="label">Total Disk (MiB)</label><NumberInput value={form.disk_mb} onChange={(n) => setForm({ ...form, disk_mb: n })} /></div>
              <div><label className="label">Disk Over-Allocation %</label><NumberInput value={form.disk_overallocate} onChange={(n) => setForm({ ...form, disk_overallocate: n })} /></div>
              <div><label className="label">CPU Over-Allocation %</label><NumberInput value={form.cpu_overallocate} onChange={(n) => setForm({ ...form, cpu_overallocate: n })} /></div>
              <div><label className="label">Daemon Port</label><NumberInput value={form.port} onChange={(n) => setForm({ ...form, port: n })} /></div>
              <div><label className="label">Daemon SFTP Port</label><NumberInput value={form.sftp_port} onChange={(n) => setForm({ ...form, sftp_port: n })} /></div>
              <div><label className="label">Daemon Token</label><input className="input font-mono" value={form.daemon_token} onChange={(e) => setForm({ ...form, daemon_token: e.target.value })} /></div>
            </div>
            <p className="text-xs text-zinc-500">Over-allocation: enter -1 for unlimited, 0 to prevent over-allocating.</p>
          </Card>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>Save changes</button>
            {saved && <span className="self-center text-sm text-emerald-400">Saved ✓</span>}
          </div>

          <Card className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
            <h3 className="mb-1 text-sm font-semibold text-red-200">Cleanup inactive servers</h3>
            <p className="mb-4 text-xs text-red-200/70">Permanently delete servers on this node that have been offline and inactive for a set number of days. Requires 3 confirmations.</p>
            <button className="btn-danger" onClick={() => setShowCleanup(true)}>Cleanup inactive servers…</button>
          </Card>
        </div>
      )}

      {showCleanup && (
        <CleanupModal
          node={node}
          onClose={() => setShowCleanup(false)}
          onDone={() => { setShowCleanup(false); toast.push('Cleanup complete'); }}
        />
      )}
    </div>
  );
}

export default function Nodes() {
  const copyText = useCopy();
  const toast = useToast();
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openSections, setOpenSections] = useState({ general: true, connection: true, resources: true, security: true });
  const [health, setHealth] = useState([]);
  const confirm = useConfirm();

  function toggleSection(k) {
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));
  }

  function Section({ k, title, children }) {
    const open = openSections[k];
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <button type="button" onClick={() => toggleSection(k)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.03]">
          {title}
          <span className={cn('text-zinc-500 transition-transform', open && 'rotate-180')} aria-hidden="true">▾</span>
        </button>
        {open && <div className="grid grid-cols-2 gap-4 px-4 pb-4 sm:grid-cols-3">{children}</div>}
      </div>
    );
  }

  async function load() {
    try {
      const [n, l] = await Promise.all([api.admin.nodes(), api.admin.locations()]);
      setNodes(n.nodes);
      setLocations(l.locations);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadHealth() {
    try {
      const d = await api.admin.nodeHealth();
      setHealth(d.nodes || []);
    } catch {}
  }

  useEffect(() => { load(); loadHealth(); }, []);
  useEffect(() => {
    const t = setInterval(loadHealth, 15000);
    return () => clearInterval(t);
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.admin.createNode(form);
      setShowForm(false);
      toast.push('Node created');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(n) {
    try {
      await api.admin.updateNode(n.id, { enabled: !n.enabled });
      toast.push(n.enabled ? 'Node disabled' : 'Node enabled');
      load();
    } catch (err) {
      toast.push(err.message || 'Update failed', 'error');
    }
  }

  async function remove(n) {
    if (!await confirm(`Delete node ${n.name}?`)) return;
    try {
      await api.admin.deleteNode(n.id);
      toast.push('Node deleted');
      load();
    } catch (err) {
      toast.push(err.message || 'Delete failed', 'error');
    }
  }

  const healthById = Object.fromEntries(health.map((h) => [h.id, h]));

  if (selected) return <NodeDetail node={selected} onBack={() => setSelected(null)} />;

  if (loading) {
    return (
      <div>
        <SectionHeader title="Nodes" sub="The machines that run your servers. Create local or remote nodes." />
        <Skeleton className="mb-6 h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

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

      {/* Connect a new VPS — one-command installer */}
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Icons.Plus className="h-4 w-4 text-violet-300" /> Connect a new VPS as a node
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Run this on the new VPS (as root). It installs Docker + the agent and registers itself here automatically.
            </p>
          </div>
          <button
            className="btn-ghost !px-3 !py-1.5 text-xs"
            onClick={() => copyText('bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)', 'Install command copied')}
          >
            <Icons.Copy className="h-3.5 w-3.5" /> Copy command
          </button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-3 font-mono text-xs text-emerald-300">bash &lt;(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)</pre>
        <p className="mt-2 text-[11px] text-zinc-500">
          The script will ask for your panel URL and an <span className="text-zinc-300">Application API key</span> with the{' '}
          <span className="font-mono text-zinc-300">node:create</span> permission (create one under <span className="text-zinc-300">Application API</span>).
        </p>
      </Card>

      {/* Live node health */}
      {health.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Live Node Health</h3>
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              refreshes every 15s
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {health.map((h) => {
              const s = h.stats;
              const memPct = s && s.memory_total_mb ? Math.min(100, (s.memory_used_mb / s.memory_total_mb) * 100) : 0;
              const diskPct = s && s.disk_total_mb ? Math.min(100, (s.disk_used_mb / s.disk_total_mb) * 100) : 0;
              return (
                <Card key={h.id} className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('h-2.5 w-2.5 rounded-full', h.online ? 'bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.6)]' : 'bg-red-500')} />
                      <span className="text-sm font-semibold text-white">{h.name}</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500">{h.fqdn}:{h.port}</span>
                  </div>
                  {!h.online ? (
                    <p className="py-4 text-center text-xs text-red-400">Node unreachable — agent offline</p>
                  ) : (
                    <div className="space-y-2.5">
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-zinc-500"><span>CPU</span><span className="font-mono text-zinc-300">{s.cpu}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full', s.cpu > 80 ? 'bg-red-500' : 'bg-violet-500')} style={{ width: `${Math.min(100, s.cpu)}%` }} /></div>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-zinc-500"><span>Memory</span><span className="font-mono text-zinc-300">{formatMb(s.memory_used_mb)} / {formatMb(s.memory_total_mb)}</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full', memPct > 80 ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${memPct}%` }} /></div>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-zinc-500"><span>Disk</span><span className="font-mono text-zinc-300">{formatMb(s.disk_used_mb)} / {formatMb(s.disk_total_mb)}</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full', diskPct > 80 ? 'bg-red-500' : 'bg-sky-500')} style={{ width: `${diskPct}%` }} /></div>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/[0.05] pt-2 text-[11px] text-zinc-500">
                        <span>Load <span className="font-mono text-zinc-300">{s.load?.[0] ?? 0}</span></span>
                        <span>Uptime <span className="font-mono text-zinc-300">{fmtUptime(s.uptime_seconds)}</span></span>
                        <span>Containers <span className="font-mono text-zinc-300">{s.containers?.running}/{s.containers?.total}</span></span>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <Card className="mb-4 space-y-4">
          <h3 className="font-semibold text-white">New Node</h3>
          <form onSubmit={create} className="space-y-3">
            <Section k="general" title="General">
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><label className="label">Location</label>
                <Select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                  <option value="">—</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.short}</option>)}
                </Select>
              </div>
              <div><label className="label">Visibility</label>
                <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </Select>
              </div>
              <div><label className="label">File Directory</label><input className="input font-mono" value={form.file_directory} onChange={(e) => setForm({ ...form, file_directory: e.target.value })} /></div>
            </Section>
            <Section k="connection" title="Connection">
              <div><label className="label">FQDN</label><input className="input font-mono" value={form.fqdn} onChange={(e) => setForm({ ...form, fqdn: e.target.value })} placeholder="node.example.com" required /></div>
              <div><label className="label">Daemon Port</label><NumberInput value={form.port} onChange={(n) => setForm({ ...form, port: n })} /></div>
              <div><label className="label">SFTP Port</label><NumberInput value={form.sftp_port} onChange={(n) => setForm({ ...form, sftp_port: n })} /></div>
              <div><label className="label">Scheme</label>
                <Select value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })}>
                  <option value="https">HTTPS (SSL)</option>
                  <option value="http">HTTP</option>
                </Select>
              </div>
            </Section>
            <Section k="resources" title="Resources">
              <div><label className="label">Total Memory (MiB)</label><NumberInput value={form.memory_mb} onChange={(n) => setForm({ ...form, memory_mb: n })} /></div>
              <div><label className="label">Memory Over-Allocation %</label><NumberInput value={form.memory_overallocate} onChange={(n) => setForm({ ...form, memory_overallocate: n })} /></div>
              <div><label className="label">Total Disk (MiB)</label><NumberInput value={form.disk_mb} onChange={(n) => setForm({ ...form, disk_mb: n })} /></div>
              <div><label className="label">Disk Over-Allocation %</label><NumberInput value={form.disk_overallocate} onChange={(n) => setForm({ ...form, disk_overallocate: n })} /></div>
              <div><label className="label">CPU Cores</label><NumberInput value={form.cpu_cores} onChange={(n) => setForm({ ...form, cpu_cores: n })} /></div>
              <div><label className="label">CPU Over-Allocation %</label><NumberInput value={form.cpu_overallocate} onChange={(n) => setForm({ ...form, cpu_overallocate: n })} /></div>
            </Section>
            <Section k="security" title="Security">
              <div className="col-span-2">
                <label className="label">Daemon Token (agent secret)</label>
                <input className="input font-mono" value={form.daemon_token} onChange={(e) => setForm({ ...form, daemon_token: e.target.value })} placeholder="Leave empty to auto-generate" />
                <p className="mt-1 text-xs text-zinc-500">If left empty, a secure token is generated automatically. Copy it from the node's settings after creation.</p>
              </div>
            </Section>
            <div className="flex gap-2">
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
          const h = healthById[n.id];
          const online = h ? h.online : false;
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
                {!n.enabled ? (
                  <Badge tone="red" dot="red">Disabled</Badge>
                ) : online ? (
                  <Badge tone="green" dot="emerald">Online</Badge>
                ) : (
                  <Badge tone="red" dot="red">Offline</Badge>
                )}
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
