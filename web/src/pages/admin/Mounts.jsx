import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, EmptyState, GlowButton, Icons, SectionHeader } from '../../components/ui.jsx';

export default function Mounts() {
  const [mounts, setMounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', source: '', target: '', read_only: false });
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.admin.mounts();
      setMounts(d.mounts);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.admin.createMount(form);
      setForm({ name: '', description: '', source: '', target: '', read_only: false });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(m) {
    if (!confirm(`Delete mount ${m.name}?`)) return;
    await api.admin.deleteMount(m.id);
    load();
  }

  return (
    <div>
      <SectionHeader
        title="Mounts"
        sub="Mount host directories into server containers."
        action={<GlowButton onClick={() => setShowForm(!showForm)}><Icons.Plus className="h-4 w-4" /> New Mount</GlowButton>}
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={create} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="label">Source (host path)</label><input className="input font-mono" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="/var/lib/raven/shared" required /></div>
            <div><label className="label">Target (container path)</label><input className="input font-mono" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="/shared" required /></div>
            <div className="col-span-2"><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-zinc-300 pb-2">
                <input type="checkbox" checked={form.read_only} onChange={(e) => setForm({ ...form, read_only: e.target.checked })} className="accent-violet-500" />
                Read-only
              </label>
            </div>
            <div className="col-span-2"><button className="btn-primary">Create mount</button></div>
          </form>
        </Card>
      )}

      {mounts.length === 0 ? (
        <EmptyState
          icon={<Icons.Folder className="h-10 w-10 text-violet-300" />}
          title="No mounts yet"
          sub="Mounts let you share host directories with server containers."
          action={<button className="btn-primary" onClick={() => setShowForm(true)}><Icons.Plus className="h-4 w-4" /> New Mount</button>}
        />
      ) : (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mounts.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
                  <Icons.Folder className="h-5 w-5 text-violet-300" />
                </span>
                <div>
                  <p className="font-semibold text-white">{m.name}</p>
                  <p className="text-xs text-zinc-500">{m.description || '—'} · {m.server_count} server(s)</p>
                </div>
              </div>
              <button className="text-zinc-500 hover:text-red-400" onClick={() => remove(m)}><Icons.Trash className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 rounded-lg bg-white/[0.03] p-3 font-mono text-xs">
              <p className="text-zinc-500">{m.source} <span className="text-violet-400">→</span> <span className="text-zinc-200">{m.target}</span> {m.read_only && <span className="text-amber-400">(ro)</span>}</p>
            </div>
          </Card>
        ))}
      </div>
      )}
    </div>
  );
}
