import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, GlowButton, Icons, SectionHeader, Select, ShineCard, StatusBadge, cn } from '../../components/ui.jsx';

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      <span className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-violet-500' : 'bg-white/10')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

function CreateServerForm({ onCreated }) {
  const [nodes, setNodes] = useState([]);
  const [nests, setNests] = useState([]);
  const [eggs, setEggs] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [eggVars, setEggVars] = useState([]);
  const [env, setEnv] = useState({});
  const [startupPreview, setStartupPreview] = useState('');
  const [form, setForm] = useState({
    user_id: '', node_id: '', nest_id: '', egg_id: '',
    name: '', description: '',
    memory_mb: 1024, cpu: 150, cpu_pinning: '', disk_mb: 3072, swap_mb: 0, io: 500,
    databases: 1, allocations: 1, backups: 0,
    docker_image: '', skip_install: false, start_on_install: false, oom_killer: true,
    default_allocation_id: '', additional_allocation_ids: [],
  });
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerResults, setOwnerResults] = useState([]);
  const [ownerSelected, setOwnerSelected] = useState(null);
  const [ownerSearching, setOwnerSearching] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.admin.nodes(), api.admin.nests()]).then(([n, ne]) => {
      setNodes(n.nodes); setNests(ne.nests);
      if (n.nodes[0]) setForm((f) => ({ ...f, node_id: n.nodes[0].id }));
      if (ne.nests[0]) setForm((f) => ({ ...f, nest_id: ne.nests[0].id }));
    }).catch((e) => setError(e.message));
  }, []);

  // Load eggs when nest changes
  useEffect(() => {
    if (!form.nest_id) return;
    api.admin.eggs(form.nest_id).then((d) => {
      setEggs(d.eggs);
      if (d.eggs[0]) setForm((f) => ({ ...f, egg_id: d.eggs[0].id }));
    }).catch(() => {});
  }, [form.nest_id]);

  // Load egg variables + docker image when egg changes
  useEffect(() => {
    if (!form.egg_id) return;
    api.admin.egg(form.egg_id).then((d) => {
      setEggVars(d.variables);
      const e = d.egg;
      setForm((f) => ({ ...f, docker_image: f.docker_image || e.docker_image }));
      // Seed env with defaults
      const merged = {};
      for (const v of d.variables) merged[v.env_variable] = v.default_value;
      setEnv(merged);
      setStartupPreview(e.startup_command);
    }).catch(() => {});
  }, [form.egg_id]);

  // Load allocations when node changes
  useEffect(() => {
    if (!form.node_id) return;
    api.admin.nodeAllocations(form.node_id).then((d) => {
      const free = d.allocations.filter((a) => !a.server_identifier);
      setAllocations(free);
      if (free[0]) setForm((f) => ({ ...f, default_allocation_id: f.default_allocation_id || free[0].id }));
    }).catch(() => {});
  }, [form.node_id]);

  async function searchOwner(q) {
    setOwnerSearch(q);
    setOwnerSelected(null);
    setForm((f) => ({ ...f, user_id: '' }));
    if (q.trim().length < 3) { setOwnerResults([]); return; }
    setOwnerSearching(true);
    try {
      const d = await api.userSearch(q);
      setOwnerResults(d.users);
    } catch (e) {
      setOwnerResults([]);
    } finally {
      setOwnerSearching(false);
    }
  }

  function pickOwner(u) {
    setOwnerSelected(u);
    setOwnerSearch(`${u.username} — ${u.email}`);
    setOwnerResults([]);
    setForm((f) => ({ ...f, user_id: u.id }));
  }

  function setVar(key, value) {
    const next = { ...env, [key]: value };
    setEnv(next);
    // Live-update the startup preview
    let preview = eggs.find((e) => e.id === form.egg_id)?.startup_command || '';
    preview = preview.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, name) => next[name] ?? m);
    setStartupPreview(preview);
  }

  function toggleAdditional(id) {
    setForm((f) => {
      const cur = f.additional_allocation_ids || [];
      return { ...f, additional_allocation_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.admin.createServer({ ...form, env });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShineCard className="space-y-6">
      <form onSubmit={submit} className="space-y-6">
        {/* ── Basic details ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Basic Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Server Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Server Owner" hint="Search by username or email. Leave empty to create an unassigned inventory server.">
              <div className="relative">
                <input
                  className="input"
                  value={ownerSearch}
                  onChange={(e) => searchOwner(e.target.value)}
                  placeholder="Type username or email (min 3 chars)"
                />
                {ownerSearching && <p className="mt-1 text-xs text-zinc-500">Searching…</p>}
                {ownerResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0d0d12] shadow-xl">
                    {ownerResults.map((u) => (
                      <button
                        type="button"
                        key={u.id}
                        onClick={() => pickOwner(u)}
                        className="block w-full px-4 py-2.5 text-left text-sm hover:bg-white/[0.05]"
                      >
                        <span className="font-medium text-white">{u.username}</span>
                        <span className="ml-2 text-zinc-400">{u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
                {ownerSelected && <p className="mt-1 text-xs text-emerald-400">✓ Selected: {ownerSelected.username}</p>}
              </div>
            </Field>
            <div className="col-span-2">
              <Field label="Server Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
          </div>
          <Toggle label="Start Server when Installed" checked={form.start_on_install} onChange={(v) => setForm({ ...form, start_on_install: v })} hint="Automatically start the server once installation completes." />
        </div>

        {/* ── Allocation management ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Allocation Management</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Node">
              <Select value={form.node_id} onChange={(e) => setForm({ ...form, node_id: e.target.value })}>
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </Select>
            </Field>
            <Field label="Default Allocation">
              <Select value={form.default_allocation_id} onChange={(e) => setForm({ ...form, default_allocation_id: e.target.value })}>
                <option value="">—</option>
                {allocations.map((a) => <option key={a.id} value={a.id}>{a.ip}:{a.port}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Additional Allocations">
            <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {allocations.filter((a) => a.id !== form.default_allocation_id).map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => toggleAdditional(a.id)}
                  className={cn('rounded-lg border px-2 py-1.5 font-mono text-xs', (form.additional_allocation_ids || []).includes(a.id) ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400 hover:text-white')}
                >
                  {a.ip}:{a.port}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* ── Application feature limits ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Application Feature Limits</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Database Limit"><input className="input" type="number" min={0} value={form.databases} onChange={(e) => setForm({ ...form, databases: +e.target.value })} /></Field>
            <Field label="Allocation Limit"><input className="input" type="number" min={0} value={form.allocations} onChange={(e) => setForm({ ...form, allocations: +e.target.value })} /></Field>
            <Field label="Backup Limit"><input className="input" type="number" min={0} value={form.backups} onChange={(e) => setForm({ ...form, backups: +e.target.value })} /></Field>
          </div>
        </div>

        {/* ── Resource management ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Resource Management</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="CPU Limit (%)" hint="0 = unlimited. 100 = 1 thread. Quad core = 400."><input className="input" type="number" min={0} value={form.cpu} onChange={(e) => setForm({ ...form, cpu: +e.target.value })} /></Field>
            <Field label="CPU Pinning" hint="Specific threads, e.g. 0, 0-1,3. Leave blank for all."><input className="input font-mono" value={form.cpu_pinning} onChange={(e) => setForm({ ...form, cpu_pinning: e.target.value })} /></Field>
            <Field label="Memory (MiB)" hint="Maximum RAM for this container. 0 = unlimited."><input className="input" type="number" min={0} value={form.memory_mb} onChange={(e) => setForm({ ...form, memory_mb: +e.target.value })} /></Field>
            <Field label="Swap (MiB)" hint="-1 = unlimited, 0 = disabled."><input className="input" type="number" value={form.swap_mb} onChange={(e) => setForm({ ...form, swap_mb: +e.target.value })} /></Field>
            <Field label="Disk Space (MiB)" hint="0 = unlimited."><input className="input" type="number" min={0} value={form.disk_mb} onChange={(e) => setForm({ ...form, disk_mb: +e.target.value })} /></Field>
            <Field label="Block IO Weight" hint="10-1000. IO priority relative to other containers."><input className="input" type="number" min={10} max={1000} value={form.io} onChange={(e) => setForm({ ...form, io: +e.target.value })} /></Field>
          </div>
          <Toggle label="Enable OOM Killer" checked={form.oom_killer} onChange={(v) => setForm({ ...form, oom_killer: v })} hint="Terminates the server if it breaches memory limits." />
        </div>

        {/* ── Nest / egg configuration ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Nest Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nest">
              <Select value={form.nest_id} onChange={(e) => setForm({ ...form, nest_id: e.target.value })}>
                {nests.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </Select>
            </Field>
            <Field label="Egg">
              <Select value={form.egg_id} onChange={(e) => setForm({ ...form, egg_id: e.target.value })}>
                {eggs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
          </div>
          <Toggle label="Skip Egg Install Script" checked={form.skip_install} onChange={(v) => setForm({ ...form, skip_install: v })} hint="Skip the install script if you're uploading files manually." />
        </div>

        {/* ── Docker configuration ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Docker Configuration</h3>
          <Field label="Docker Image" hint="Select an image from the egg or enter a custom image.">
            <input className="input font-mono" value={form.docker_image} onChange={(e) => setForm({ ...form, docker_image: e.target.value })} />
          </Field>
        </div>

        {/* ── Startup configuration ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Startup Configuration</h3>
          <Field label="Startup Command" hint="Variables: {'{{SERVER_MEMORY}}'}, {'{{SERVER_IP}}'}, {'{{SERVER_PORT}}'} and egg variables.">
            <textarea className="input h-24 font-mono text-xs" value={startupPreview} readOnly />
          </Field>
        </div>

        {/* ── Service variables ── */}
        {eggVars.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-white">Service Variables</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {eggVars.map((v) => (
                <Field key={v.id} label={`${v.name} — {{${v.env_variable}}}`} hint={v.description || `Validation: ${v.rules || 'none'}`}>
                  <input className="input font-mono" value={env[v.env_variable] ?? ''} onChange={(e) => setVar(v.env_variable, e.target.value)} />
                </Field>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create server'}</button>
      </form>
    </ShineCard>
  );
}

function AssignModal({ server, onAssign, onCancel }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doSearch(q) {
    setSearch(q);
    setSelected(null);
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const d = await api.userSearch(q);
      setResults(d.users);
    } catch (e) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickUser(u) {
    setSelected(u);
    setSearch(`${u.username} — ${u.email}`);
    setResults([]);
  }

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await onAssign(server.id, selected.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onCancel}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-semibold text-white">Assign server</h3>
        <p className="mb-4 text-sm text-zinc-400">Choose a new owner for <b className="text-white">{server.name}</b>.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input
              className="input"
              value={search}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="Search username or email (min 3 chars)"
              required
            />
            {searching && <p className="mt-1 text-xs text-zinc-500">Searching…</p>}
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0d0d12] shadow-xl">
                {results.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => pickUser(u)}
                    className="block w-full px-4 py-2.5 text-left text-sm hover:bg-white/[0.05]"
                  >
                    <span className="font-medium text-white">{u.username}</span>
                    <span className="ml-2 text-zinc-400">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && <p className="mt-1 text-xs text-emerald-400">✓ Selected: {selected.username}</p>}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy || !selected}>{busy ? 'Assigning…' : 'Assign'}</button>
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function Servers() {
  const [servers, setServers] = useState([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [error, setError] = useState('');

  async function load(s) {
    try {
      const d = await api.admin.servers(s);
      setServers(d.servers);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function assignServer(serverId, userId) {
    try {
      await api.admin.assignServer(serverId, userId);
      setAssigning(null);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  }

  async function power(id, action) {
    try {
      await api.admin.serverPower(id, action);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleSuspend(s) {
    if (s.status === 'suspended') await api.admin.unsuspendServer(s.id);
    else await api.admin.suspendServer(s.id);
    load(search);
  }

  async function remove(s) {
    if (!confirm(`Delete server ${s.name}? This permanently deletes all its files.`)) return;
    await api.admin.deleteServer(s.id);
    load(search);
  }

  return (
    <div>
      <SectionHeader
        title="Servers"
        sub="Create and manage all servers."
        action={<GlowButton onClick={() => setShowCreate(!showCreate)}><Icons.Plus className="h-4 w-4" /> New Server</GlowButton>}
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {assigning && (
        <AssignModal
          server={assigning}
          onAssign={assignServer}
          onCancel={() => setAssigning(null)}
        />
      )}

      {showCreate && (
        <div className="mb-6">
          <CreateServerForm onCreated={() => { setShowCreate(false); load(); }} />
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Icons.Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="input !pl-9"
            placeholder="Search by name, ID, owner…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
          />
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Egg</th>
              <th className="px-4 py-3">Node</th>
              <th className="px-4 py-3">Limits</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500">No servers found.</td></tr>
            )}
            {servers.map((s) => (
              <tr key={s.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{s.name}</p>
                  <p className="font-mono text-xs text-zinc-500">{s.identifier}</p>
                </td>
                <td className="px-4 py-3">
                  {s.owner_username ? (
                    <span className="text-zinc-400">{s.owner_username}</span>
                  ) : (
                    <span className="chip bg-amber-500/10 text-amber-300 border border-amber-500/20">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-400">{s.egg_name}</td>
                <td className="px-4 py-3 text-zinc-400">{s.node_name}</td>
                <td className="px-4 py-3 text-xs text-zinc-400">{s.memory_mb}MB · {s.cpu}% · {s.disk_mb}MB</td>
                <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {!s.owner_username && (
                    <button className="btn-primary !px-2 !py-1 text-xs mr-1" onClick={() => setAssigning(s)}>Assign</button>
                  )}
                  {s.status === 'running' ? (
                    <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => power(s.id, 'stop')}>Stop</button>
                  ) : (
                    <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => power(s.id, 'start')} disabled={s.status === 'installing'}>Start</button>
                  )}
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => toggleSuspend(s)}>{s.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button>
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
