import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, GlowButton, Icons, SectionHeader, useConfirm } from '../../components/ui.jsx';

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [short, setShort] = useState('');
  const [long, setLong] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.admin.locations();
      setLocations(d.locations);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.admin.createLocation(short, long);
      setShort(''); setLong(''); setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(loc) {
    if (!await confirm(`Delete location ${loc.short}?`)) return;
    try {
      await api.admin.deleteLocation(loc.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Locations"
        sub="Group your nodes by region or datacenter."
        action={<GlowButton onClick={() => setShowForm(!showForm)}><Icons.Plus className="h-4 w-4" /> New Location</GlowButton>}
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={create} className="flex gap-3">
            <input className="input max-w-[120px]" value={short} onChange={(e) => setShort(e.target.value)} placeholder="us-east" required />
            <input className="input flex-1" value={long} onChange={(e) => setLong(e.target.value)} placeholder="US East Coast" />
            <button className="btn-primary">Create</button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((l) => (
          <Card key={l.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
                  <Icons.MapPin className="h-5 w-5 text-violet-300" />
                </span>
                <div>
                  <p className="font-semibold text-white">{l.short}</p>
                  <p className="text-xs text-zinc-500">{l.long || '—'} · {l.node_count} node(s)</p>
                </div>
              </div>
              <button className="text-zinc-500 hover:text-red-400" onClick={() => remove(l)}><Icons.Trash className="h-4 w-4" /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
