import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Icons, SectionHeader } from '../components/ui.jsx';

const RUNTIME_ICONS = { nodejs: '🟢', python: '🐍', java: '☕', go: '🐹' };

export default function CreateBot() {
  const [runtimes, setRuntimes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState('nodejs');
  const [memory, setMemory] = useState(512);
  const [disk, setDisk] = useState(1536);
  const [cpu, setCpu] = useState(60);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.runtimes().then((d) => {
      setRuntimes(d.runtimes);
      if (d.runtimes[0]) setRuntime(d.runtimes[0].id);
    }).catch((e) => setError(e.message));
    api.plans().then((d) => setPlans(d.plans)).catch(() => {});
  }, []);

  function selectRuntime(id) {
    setRuntime(id);
    const rt = runtimes.find((r) => r.id === id);
    if (rt) {
      setMemory(rt.default_memory_mb);
      setDisk(rt.default_disk_mb);
      setCpu(rt.default_cpu);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.createBot({ name, runtime, memory_mb: memory, disk_mb: disk, cpu });
      navigate(`/bots/${d.bot.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const plan = plans[0];

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeader title="Create a Bot" sub="Pick a runtime, set your limits, and deploy." />

      <form onSubmit={submit} className="space-y-6 rounded-2xl border border-white/[0.08] bg-panel/80 p-6 backdrop-blur-xl">
        <div>
          <label className="label">Bot name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Music Bot" required />
        </div>

        <div>
          <label className="label">Runtime</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {runtimes.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => selectRuntime(r.id)}
                className={cnRuntime(runtime === r.id)}
              >
                <div className="mb-1 text-xl">{RUNTIME_ICONS[r.id] || '📦'}</div>
                {r.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Memory (MB)</label>
            <input className="input" type="number" min={128} step={128} value={memory} onChange={(e) => setMemory(+e.target.value)} />
          </div>
          <div>
            <label className="label">Disk (MB)</label>
            <input className="input" type="number" min={256} step={256} value={disk} onChange={(e) => setDisk(+e.target.value)} />
          </div>
          <div>
            <label className="label">CPU (%)</label>
            <input className="input" type="number" min={10} max={400} step={10} value={cpu} onChange={(e) => setCpu(+e.target.value)} />
          </div>
        </div>

        {plan && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-zinc-400">
            <Icons.Shield className="h-4 w-4 text-violet-300" />
            Your plan: <span className="font-semibold uppercase text-violet-300">{plan.id}</span>
            <span className="text-zinc-600">·</span> max {plan.memory_mb}MB RAM, {plan.disk_mb}MB disk, {plan.cpu}% CPU, {plan.max_bots} bot(s)
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create Bot'}</button>
      </form>
    </div>
  );
}

function cnRuntime(active) {
  return `rounded-xl border px-3 py-3 text-sm font-medium transition-all duration-200 ${
    active
      ? 'border-violet-500/50 bg-violet-500/15 text-white shadow-lg shadow-violet-600/10'
      : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white'
  }`;
}
