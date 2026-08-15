import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../App.jsx';
import { useDebouncedCallback } from '../../useDebounce.js';
import NumberInput from '../../components/NumberInput.jsx';
import { Card, GlowButton, Icons, MultiSelect, SectionHeader, Select, ShineCard, StatusBadge, cn, useConfirm, useToast } from '../../components/ui.jsx';

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
  const toast = useToast();
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
    databases: 1, allocations: 1, backups: 3,
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
      setForm((f) => ({ ...f, docker_image: e.docker_image }));
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

  async function runOwnerSearch(q) {
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

  const debouncedOwnerSearch = useDebouncedCallback(runOwnerSearch, 300);

  function searchOwner(q) {
    setOwnerSearch(q);
    setOwnerSelected(null);
    setForm((f) => ({ ...f, user_id: '' }));
    if (q.trim().length < 3) { setOwnerResults([]); return; }
    debouncedOwnerSearch(q);
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
    let preview = eggs.find((e) => String(e.id) === String(form.egg_id))?.startup_command || '';
    preview = preview.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, name) => next[name] ?? m);
    setStartupPreview(preview);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.admin.createServer({ ...form, env });
      toast.push('Server created');
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
            <Field label="Default Allocation" hint="Auto-selected to the next free port. Change it if you need a specific one.">
              <Select value={form.default_allocation_id} onChange={(e) => setForm({ ...form, default_allocation_id: e.target.value })}>
                <option value="">—</option>
                {allocations.map((a) => <option key={a.id} value={a.id}>{a.ip}:{a.port}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Additional Allocation(s)" hint="Pick extra ports if the server needs more than one. Auto-assigned if left empty.">
            <MultiSelect
              value={form.additional_allocation_ids}
              onChange={(ids) => setForm((f) => ({ ...f, additional_allocation_ids: ids }))}
              placeholder="Select Additional Allocations"
            >
              {allocations.filter((a) => a.id !== form.default_allocation_id).map((a) => (
                <option key={a.id} value={a.id}>{a.ip}:{a.port}</option>
              ))}
            </MultiSelect>
          </Field>
        </div>

        {/* ── Application feature limits ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Application Feature Limits</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Database Limit"><NumberInput min={0} value={form.databases} onChange={(n) => setForm({ ...form, databases: n })} /></Field>
            <Field label="Allocation Limit"><NumberInput min={0} value={form.allocations} onChange={(n) => setForm({ ...form, allocations: n })} /></Field>
            <Field label="Backup Limit"><NumberInput min={0} value={form.backups} onChange={(n) => setForm({ ...form, backups: n })} /></Field>
          </div>
        </div>

        {/* ── Resource management ── */}
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Resource Management</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="CPU Limit (%)" hint="0 = unlimited. 100 = 1 thread. Quad core = 400."><NumberInput min={0} value={form.cpu} onChange={(n) => setForm({ ...form, cpu: n })} /></Field>
            <Field label="CPU Pinning" hint="Specific threads, e.g. 0, 0-1,3. Leave blank for all."><input className="input font-mono" value={form.cpu_pinning} onChange={(e) => setForm({ ...form, cpu_pinning: e.target.value })} /></Field>
            <Field label="Memory (MiB)" hint="Maximum RAM for this container. 0 = unlimited."><NumberInput min={0} value={form.memory_mb} onChange={(n) => setForm({ ...form, memory_mb: n })} /></Field>
            <Field label="Swap (MiB)" hint="-1 = unlimited, 0 = disabled."><NumberInput value={form.swap_mb} onChange={(n) => setForm({ ...form, swap_mb: n })} /></Field>
            <Field label="Disk Space (MiB)" hint="0 = unlimited."><NumberInput min={0} value={form.disk_mb} onChange={(n) => setForm({ ...form, disk_mb: n })} /></Field>
            <Field label="Block IO Weight" hint="10-1000. IO priority relative to other containers."><NumberInput min={10} max={1000} value={form.io} onChange={(n) => setForm({ ...form, io: n })} /></Field>
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
                  {v.env_variable === 'VERSION' ? (
                    <Select value={env[v.env_variable] ?? ''} onChange={(e) => setVar(v.env_variable, e.target.value)}>
                      <option value="latest">Latest</option>
                      <option value="1.21.11">1.21.11</option>
                      <option value="1.21.4">1.21.4</option>
                      <option value="1.21.1">1.21.1</option>
                      <option value="1.20.6">1.20.6</option>
                      <option value="1.20.4">1.20.4</option>
                      <option value="1.19.4">1.19.4</option>
                      <option value="1.18.2">1.18.2</option>
                      <option value="1.16.5">1.16.5</option>
                    </Select>
                  ) : (
                    <input className="input font-mono" value={env[v.env_variable] ?? ''} onChange={(e) => setVar(v.env_variable, e.target.value)} />
                  )}
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

  async function runSearch(q) {
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
  const debouncedSearch = useDebouncedCallback(runSearch, 300);

  function doSearch(q) {
    setSearch(q);
    setSelected(null);
    debouncedSearch(q);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-semibold text-white">Assign server</h3>
        <p className="mb-4 text-sm text-zinc-400">Choose a new owner for <b className="text-white">{server.name}</b>.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input
              className="input"
              value={search}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="Search username or email (min 3 chars)"
              autoComplete="off"
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

const STAGE_LABELS = {
  starting: 'Starting transfer…',
  stopping: 'Stopping server…',
  creating: 'Creating on destination…',
  moving: 'Moving files…',
  cleaning: 'Cleaning up…',
  updating: 'Updating panel…',
  done: 'Done!',
};

function pollTransfer(id, prefix, setP) {
  return new Promise((resolve) => {
    const tick = async () => {
      let t;
      try {
        const d = await api.admin.transferProgress(id);
        t = d.transfer;
      } catch (e) {
        setP({ active: true, label: prefix + 'Error polling transfer', percent: 0, error: e.message, running: false });
        return resolve(false);
      }
      if (t.status === 'error') {
        setP({ active: true, label: prefix + 'Transfer failed', percent: 0, error: t.error, running: false });
        return resolve(false);
      }
      if (t.status === 'done') {
        setP({ active: true, label: prefix + 'Done', percent: 100, error: null, running: false });
        return resolve(true);
      }
      setP({ active: true, label: prefix + (STAGE_LABELS[t.stage] || t.stage), percent: t.percent || 0, error: null, running: true });
      setTimeout(tick, 700);
    };
    tick();
  });
}

function TransferModal({ server, count = 1, nodes, onTransfer, onCancel, progress }) {
  const [nodeId, setNodeId] = useState('');
  const [busy, setBusy] = useState(false);

  const excluded = server ? new Set([server.node_id]) : new Set();
  const available = (nodes || []).filter((n) => n.enabled && !excluded.has(n.id));

  async function submit(e) {
    e.preventDefault();
    if (!nodeId) return;
    setBusy(true);
    try {
      await onTransfer(nodeId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <Card
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold text-white">Transfer {server ? 'server' : 'servers'}</h3>
        <p className="mb-4 text-sm text-zinc-400">
          {server ? (
            <>Move <b className="text-white">{server.name}</b> to another node. It will be stopped, its files
            moved to the destination, and recreated there{server.status === 'running' ? ' (then auto-started)' : ''}.</>
          ) : (
            <>Move <b className="text-white">{count} selected servers</b> to another node. Each will be stopped,
            its files moved to the destination, and recreated there.</>
          )}
        </p>
        {progress ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-300">{progress.label}</span>
              {progress.percent > 0 && <span className="font-medium text-violet-300">{progress.percent}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                style={{ width: `${progress.percent || 0}%` }}
              />
            </div>
            {progress.running && <p className="animate-pulse text-xs text-zinc-500">Transferring — keep this window open</p>}
            {progress.error && <p className="text-sm text-red-400">{progress.error}</p>}
            {!progress.running && !progress.error && <p className="text-sm text-emerald-400">Transfer complete.</p>}
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Close</button>
            </div>
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-4">
          <Select
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            label="Destination node"
            className="w-full"
          >
            <option value="">Select destination node…</option>
            {available.map((n) => (
              <option key={n.id} value={n.id}>{n.name} — {n.fqdn}:{n.port}</option>
            ))}
          </Select>
          {available.length === 0 && (
            <p className="text-xs text-amber-400">No other enabled nodes available to transfer to.</p>
          )}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy || !nodeId}>{busy ? 'Transferring…' : 'Transfer'}</button>
            <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          </div>
        </form>
        )}
      </Card>
    </div>
  );
}

export default function Servers() {
  const { user } = useAuth();
  const [servers, setServers] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('mine');
  const [showCreate, setShowCreate] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const confirm = useConfirm();

  async function load(s) {
    try {
      const d = await api.admin.servers(s);
      setServers(d.servers);
    } catch (e) {
      setError(e.message);
    }
  }

  const debouncedLoad = useDebouncedCallback((s) => load(s), 300);

  useEffect(() => { load(); }, []);

  const filteredServers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = servers;
    if (tab === 'mine') {
      list = list.filter((s) => s.owner_username === user?.username);
    } else if (tab === 'others') {
      list = list.filter((s) => s.owner_username !== user?.username);
    }
    if (!q) return list;
    return list.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.identifier || '').toLowerCase().includes(q) ||
      (s.owner_username || '').toLowerCase().includes(q)
    );
  }, [servers, search, tab, user?.username]);

  async function assignServer(serverId, userId) {
    try {
      await api.admin.assignServer(serverId, userId);
      setAssigning(null);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  }

  async function openTransfer(s) {
    try {
      const d = await api.admin.nodes();
      setNodes(d.nodes || []);
      setTransferring(s);
    } catch (e) {
      setError(e.message);
    }
  }

  async function openBulkTransfer() {
    try {
      const d = await api.admin.nodes();
      setNodes(d.nodes || []);
      setTransferring({ bulk: true });
    } catch (e) {
      setError(e.message);
    }
  }

  async function doTransfer(nodeId) {
    const isBulk = transferring && transferring.bulk;
    const ids = isBulk ? Array.from(selected) : [transferring.id];
    setProgress({ active: true, label: 'Starting transfer…', percent: 0, error: null, running: true });
    let ok = true;
    for (let i = 0; i < ids.length; i++) {
      const prefix = isBulk ? `Server ${i + 1}/${ids.length}: ` : '';
      try {
        const d = await api.admin.transferServer(ids[i], nodeId);
        if (!d.transferId) throw new Error('No transfer id returned');
        const res = await pollTransfer(d.transferId, prefix, setProgress);
        if (!res) { ok = false; break; }
      } catch (e) {
        setProgress({ active: true, label: prefix + 'Failed to start transfer', percent: 0, error: e.message, running: false });
        ok = false;
        break;
      }
    }
    if (ok) {
      setProgress(null);
      setTransferring(null);
      if (isBulk) setSelected(new Set());
      load(search);
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    const ids = filteredServers.map((s) => s.id);
    setSelected((prev) => {
      const allChecked = ids.length > 0 && ids.every((id) => prev.has(id));
      const n = new Set(prev);
      if (allChecked) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  async function bulkSuspend(suspend) {
    for (const id of Array.from(selected)) {
      try {
        if (suspend) await api.admin.suspendServer(id);
        else await api.admin.unsuspendServer(id);
      } catch (e) {
        setError(e.message);
      }
    }
    setSelected(new Set());
    load(search);
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
    try {
      if (s.status === 'suspended') await api.admin.unsuspendServer(s.id);
      else await api.admin.suspendServer(s.id);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(s) {
    if (!await confirm(`Delete server ${s.name}? This permanently deletes all its files.`)) return;
    try {
      await api.admin.deleteServer(s.id);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Servers"
        sub="Create and manage all servers."
        action={<GlowButton onClick={() => setShowCreate(!showCreate)}><Icons.Plus className="h-4 w-4" /> New Server</GlowButton>}
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2">
          <span className="text-sm font-medium text-white">{selected.size} selected</span>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => bulkSuspend(true)} aria-label="Suspend selected servers">Suspend</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => bulkSuspend(false)} aria-label="Unsuspend selected servers">Unsuspend</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={openBulkTransfer} aria-label="Transfer selected servers">Transfer</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {assigning && (
        <AssignModal
          server={assigning}
          onAssign={assignServer}
          onCancel={() => setAssigning(null)}
        />
      )}

      {transferring && (
        <TransferModal
          server={transferring.bulk ? null : transferring}
          count={selected.size}
          nodes={nodes}
          progress={progress}
          onTransfer={doTransfer}
          onCancel={() => setTransferring(null)}
        />
      )}

      {showCreate && (
        <div className="mb-6">
          <CreateServerForm onCreated={() => { setShowCreate(false); load(); }} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center rounded-xl border border-white/[0.06] bg-white/[0.03] p-1">
          <button
            onClick={() => { setTab('mine'); setSearch(''); }}
            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition', tab === 'mine' ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-400 hover:text-zinc-200')}
          >
            My servers
          </button>
          <button
            onClick={() => { setTab('others'); setSearch(''); }}
            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition', tab === 'others' ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-400 hover:text-zinc-200')}
          >
            Others' servers
          </button>
          <button
            onClick={() => { setTab('all'); setSearch(''); }}
            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition', tab === 'all' ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-400 hover:text-zinc-200')}
          >
            All
          </button>
        </div>
        <div className="relative max-w-sm">
          <Icons.Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="input !pl-9"
            placeholder="Search by name, ID, owner…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); debouncedLoad(e.target.value); }}
          />
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-2 py-3">
                <input
                  type="checkbox"
                  checked={filteredServers.length > 0 && filteredServers.every((s) => selected.has(s.id))}
                  onChange={toggleSelectAll}
                  aria-label="Select all servers"
                />
              </th>
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Owner</th>
              <th scope="col" className="px-4 py-3">Egg</th>
              <th scope="col" className="px-4 py-3">Node</th>
              <th scope="col" className="px-4 py-3">Limits</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredServers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                {tab === 'mine' ? 'You do not own any servers.' : tab === 'others' ? 'No servers owned by other users.' : 'No servers found.'}
              </td></tr>
            )}
            {filteredServers.map((s) => (
              <tr key={s.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    aria-label={`Select ${s.name}`}
                  />
                </td>
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
                    <button className="btn-primary !px-2 !py-1 text-xs mr-1" onClick={() => setAssigning(s)} aria-label={`Assign owner to server ${s.name}`}>Assign</button>
                  )}
                  {s.status === 'running' ? (
                    <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => power(s.id, 'stop')} aria-label={`Stop server ${s.name}`}>Stop</button>
                  ) : (
                    <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => power(s.id, 'start')} disabled={s.status === 'installing'} aria-label={`Start server ${s.name}`}>Start</button>
                  )}
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => toggleSuspend(s)} aria-label={`${s.status === 'suspended' ? 'Unsuspend' : 'Suspend'} server ${s.name}`}>{s.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => openTransfer(s)} aria-label={`Transfer server ${s.name}`}>Transfer</button>
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => remove(s)} aria-label={`Delete server ${s.name}`}>Delete</button>
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
