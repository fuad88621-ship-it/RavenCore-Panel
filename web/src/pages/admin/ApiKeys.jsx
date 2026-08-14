import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, GlowButton, Icons, SectionHeader } from '../../components/ui.jsx';

const PERMISSIONS = ['*', 'servers.read', 'servers.create', 'servers.delete', 'servers.power', 'users.read', 'users.create', 'nodes.read', 'locations.read', 'nests.read'];

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState(['*']);
  const [newKey, setNewKey] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.admin.apiKeys();
      setKeys(d.keys);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const d = await api.admin.createApiKey(description, permissions);
      setNewKey(d.key);
      setDescription('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this API key? Applications using it will stop working.')) return;
    await api.admin.deleteApiKey(id);
    load();
  }

  function togglePerm(p) {
    setPermissions((prev) => {
      if (p === '*') return ['*'];
      const rest = prev.filter((x) => x !== '*');
      return rest.includes(p) ? rest.filter((x) => x !== p) : [...rest, p];
    });
  }

  return (
    <div className="max-w-3xl">
      <SectionHeader title="Application API" sub="Create API keys to manage the panel programmatically." />

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {newKey && (
        <Card className="mb-6 border-emerald-500/30">
          <p className="mb-2 text-sm font-semibold text-emerald-300">Key created — copy it now, it won't be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-emerald-300 break-all">{newKey}</code>
            <button className="btn-ghost !px-3 !py-2" onClick={() => { navigator.clipboard.writeText(newKey); }} aria-label="Copy API key"><Icons.Copy className="h-4 w-4" /></button>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="label">Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. My automation script" required />
          </div>
          <div>
            <label className="label">Permissions</label>
            <div className="flex flex-wrap gap-2">
              {PERMISSIONS.map((p) => {
                const active = permissions.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => togglePerm(p)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'}`}
                  >
                    {active && <Icons.Check className="h-3.5 w-3.5 text-violet-300" />}
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <GlowButton>Create key</GlowButton>
        </form>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">Key</th>
              <th scope="col" className="px-4 py-3">Permissions</th>
              <th scope="col" className="px-4 py-3">Last used</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <p className="font-mono text-white">{k.key_prefix}…</p>
                  <p className="text-xs text-zinc-500">{k.description}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-zinc-400">{k.permissions.includes('*') ? '*' : k.permissions.join(', ')}</span>
                </td>
                <td className="px-4 py-3 text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-danger !px-3 !py-1 text-xs" onClick={() => remove(k.id)}>Delete</button>
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
