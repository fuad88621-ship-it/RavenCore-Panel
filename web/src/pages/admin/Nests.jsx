import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Badge, Card, GlowButton, Icons, SectionHeader, Select, cn, useConfirm, useToast } from '../../components/ui.jsx';

function EggDetail({ egg, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showVar, setShowVar] = useState(false);
  const [varForm, setVarForm] = useState({ name: '', env_variable: '', default_value: '', description: '', user_viewable: true, user_editable: true, rules: '' });

  async function load() {
    try {
      const d = await api.admin.egg(egg.id);
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [egg.id]);

  async function addVar(e) {
    e.preventDefault();
    try {
      await api.admin.createEggVariable(egg.id, varForm);
      setVarForm({ name: '', env_variable: '', default_value: '', description: '', user_viewable: true, user_editable: true, rules: '' });
      setShowVar(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeVar(id) {
    await api.admin.deleteEggVariable(id);
    load();
  }

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <Icons.Back className="h-4 w-4" /> Back to nests
      </button>
      <SectionHeader title={data.egg.name} sub={data.egg.description || 'No description'} />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <label className="label">Docker image</label>
          <input className="input font-mono" value={data.egg.docker_image} readOnly />
        </Card>
        <Card>
          <label className="label">Startup command</label>
          <input className="input font-mono" value={data.egg.startup_command} readOnly />
        </Card>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-white">Variables</h3>
        <button className="btn-primary !py-1.5 text-xs" onClick={() => setShowVar(!showVar)}><Icons.Plus className="h-3.5 w-3.5" /> Add variable</button>
      </div>

      {showVar && (
        <Card className="mb-4">
          <form onSubmit={addVar} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className="label">Name</label><input className="input" value={varForm.name} onChange={(e) => setVarForm({ ...varForm, name: e.target.value })} required /></div>
            <div><label className="label">Env variable</label><input className="input font-mono" value={varForm.env_variable} onChange={(e) => setVarForm({ ...varForm, env_variable: e.target.value })} placeholder="MAIN_FILE" required /></div>
            <div><label className="label">Default value</label><input className="input" value={varForm.default_value} onChange={(e) => setVarForm({ ...varForm, default_value: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Description</label><input className="input" value={varForm.description} onChange={(e) => setVarForm({ ...varForm, description: e.target.value })} /></div>
            <div><label className="label">Rules</label><input className="input font-mono" value={varForm.rules} onChange={(e) => setVarForm({ ...varForm, rules: e.target.value })} placeholder="required|string|max:64" /></div>
            <div className="col-span-2"><button className="btn-primary">Add variable</button></div>
          </form>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Env</th>
              <th scope="col" className="px-4 py-3">Default</th>
              <th scope="col" className="px-4 py-3">Editable</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.variables.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No variables.</td></tr>
            )}
            {data.variables.map((v) => (
              <tr key={v.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-white">{v.name}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">{v.env_variable}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">{v.default_value || '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={v.user_editable ? 'green' : 'zinc'}>{v.user_editable ? 'Yes' : 'No'}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => removeVar(v.id)}>Delete</button>
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

// ── Import a Pterodactyl egg (paste JSON or upload a .json file) ──
function ImportEggModal({ nests, onClose, onDone }) {
  const [nestId, setNestId] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const fileRef = useRef(null);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setJsonText(String(reader.result || ''));
    reader.readAsText(f);
  }

  async function submit(e) {
    e.preventDefault();
    if (!nestId) { setError('Pick a nest first'); return; }
    if (!jsonText.trim()) { setError('Paste the egg JSON or upload a file'); return; }
    setBusy(true);
    setError('');
    try {
      await api.admin.importEgg(nestId, jsonText);
      toast.push('Egg imported');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-white">Import Pterodactyl Egg</h3>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white" aria-label="Close">
            <Icons.Close className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-zinc-500">
            Paste the contents of a Pterodactyl egg export (<span className="font-mono">.json</span> — the file you get from
            <span className="font-mono"> Admin → Nests → Egg → Export</span> on any Pterodactyl panel) or upload it. The egg
            will be created in the selected nest and works like any built-in egg.
          </p>
          <div>
            <label className="label">Destination nest</label>
            <Select value={nestId} onChange={(e) => setNestId(e.target.value)} className="w-full">
              <option value="">Select a nest…</option>
              {nests.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="label">Egg JSON</label>
            <textarea
              className="input min-h-[180px] font-mono text-xs"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{
  "meta": { "version": "PTDL_v2" },
  "name": "My Egg",
  "startup": "java -jar {{JARFILE}}",
  "docker_images": { "ghcr.io/parkervcp/yolks:java_21": "ghcr.io/parkervcp/yolks:java_21" },
  "scripts": { "installation": { "script": "apt update && apt install -y curl", "container": "ghcr.io/parkervcp/yolks:debian", "entrypoint": "bash" } },
  "variables": []
}'
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icons.Upload className="h-4 w-4" /> Upload .json file
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
            {jsonText && <span className="text-xs text-emerald-400">✓ JSON loaded</span>}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || !nestId || !jsonText.trim()}>{busy ? 'Importing…' : 'Import Egg'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function Nests() {
  const toast = useToast();
  const [nests, setNests] = useState([]);
  const [selectedEgg, setSelectedEgg] = useState(null);
  const [showNest, setShowNest] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [nestName, setNestName] = useState('');
  const [nestDesc, setNestDesc] = useState('');
  const [error, setError] = useState('');
  const confirm = useConfirm();

  async function load() {
    try {
      const d = await api.admin.nests();
      setNests(d.nests);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function createNest(e) {
    e.preventDefault();
    try {
      await api.admin.createNest(nestName, nestDesc);
      setNestName(''); setNestDesc(''); setShowNest(false);
      toast.push('Nest created');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeNest(n) {
    if (!await confirm(`Delete nest ${n.name}?`)) return;
    try {
      await api.admin.deleteNest(n.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (selectedEgg) return <EggDetail egg={selectedEgg} onBack={() => setSelectedEgg(null)} />;

  return (
    <div>
      <SectionHeader
        title="Nests"
        sub="Nests group eggs together. Eggs define how servers run."
        action={
          <div className="flex gap-2">
            <GlowButton onClick={() => setShowImport(true)}><Icons.Upload className="h-4 w-4" /> Import Egg</GlowButton>
            <GlowButton onClick={() => setShowNest(!showNest)}><Icons.Plus className="h-4 w-4" /> New Nest</GlowButton>
          </div>
        }
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showImport && (
        <ImportEggModal
          nests={nests}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); toast.push('Egg imported'); load(); }}
        />
      )}

      {showNest && (
        <Card className="mb-4">
          <form onSubmit={createNest} className="flex gap-3">
            <input className="input max-w-xs" value={nestName} onChange={(e) => setNestName(e.target.value)} placeholder="Nest name" required />
            <input className="input flex-1" value={nestDesc} onChange={(e) => setNestDesc(e.target.value)} placeholder="Description" />
            <button className="btn-primary">Create</button>
          </form>
        </Card>
      )}

      <div className="space-y-4">
        {nests.map((n) => (
          <Card key={n.id} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
                  <Icons.Egg className="h-5 w-5 text-violet-300" />
                </span>
                <div>
                  <p className="font-semibold text-white">{n.name}</p>
                  <p className="text-xs text-zinc-500">{n.description || '—'} · {n.egg_count} egg(s)</p>
                </div>
              </div>
              <button className="text-zinc-500 hover:text-red-400" onClick={() => removeNest(n)} aria-label={`Delete nest ${n.name}`}><Icons.Trash className="h-4 w-4" /></button>
            </div>
            <EggList nestId={n.id} onSelect={setSelectedEgg} />
          </Card>
        ))}
      </div>
    </div>
  );
}

function EggList({ nestId, onSelect }) {
  const [eggs, setEggs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.admin.eggs(nestId).then((d) => setEggs(d.eggs)).catch((e) => setError(e.message));
  }, [nestId]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {eggs.map((e) => (
        <button
          key={e.id}
          onClick={() => onSelect(e)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/5"
        >
          <p className="text-sm font-medium text-white">{e.name}</p>
          <p className="text-xs text-zinc-500">{e.variable_count} variable(s)</p>
        </button>
      ))}
    </div>
  );
}
