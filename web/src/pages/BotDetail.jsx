import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { api } from '../api.js';
import { Card, Icons, StatusBadge, cn } from '../components/ui.jsx';

const RUNTIME_ICONS = { nodejs: '🟢', python: '🐍', java: '☕', go: '🐹' };

function StatChip({ label, value }) {
  return (
    <span className="chip border border-white/10 bg-white/[0.04] text-zinc-300">
      <span className="text-zinc-500">{label}</span> {value}
    </span>
  );
}

function ConsoleTab({ bot }) {
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let term;
    let disposed = false;

    async function init() {
      const { socket } = await api.console(bot.id);
      if (disposed) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        theme: { background: '#0a0a0f', foreground: '#d1d5db', cursor: '#8b5cf6' },
      });
      // Wait for the page fade-in animation to finish before opening —
      // opening inside an opacity-0 container can leave the DOM renderer
      // uninitialized.
      await new Promise((r) => setTimeout(r, 450));
      if (disposed) return;
      term.open(termRef.current);
      term.writeln('\x1b[90mConnecting to console…\x1b[0m');

      const ws = new WebSocket(socket);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        term.clear();
        term.writeln('\x1b[32m● Connected. Bot output will appear here.\x1b[0m');
      };
      ws.onmessage = (ev) => term.write(ev.data);
      ws.onclose = () => {
        setConnected(false);
        term.writeln('\r\n\x1b[31m● Disconnected.\x1b[0m');
      };
      ws.onerror = () => setError('WebSocket error');

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      // Kick the renderer when the tab becomes visible again (background
      // tabs throttle xterm's renderer).
      const onVis = () => {
        if (!document.hidden && !disposed) {
          try { term.resize(term.cols, term.rows); } catch {}
        }
      };
      document.addEventListener('visibilitychange', onVis);
      ws.addEventListener('close', () => document.removeEventListener('visibilitychange', onVis));
    }

    init().catch((e) => setError(e.message));

    return () => {
      disposed = true;
      try { wsRef.current?.close(); } catch {}
      try { term?.dispose(); } catch {}
    };
  }, [bot.id]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn('chip border', connected ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-red-500/20 bg-red-500/10 text-red-400')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-500')} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <div ref={termRef} className="h-[480px] overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]" />
    </div>
  );
}

function FilesTab({ bot }) {
  const [path, setPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  async function load(p) {
    try {
      const d = await api.files(bot.id, p);
      setPath(d.path);
      setFiles(d.files);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load('/'); }, [bot.id]);

  function join(p, name) {
    return p === '/' ? `/${name}` : `${p}/${name}`;
  }

  async function openFile(f) {
    if (f.type === 'dir') return load(join(path, f.name));
    try {
      const d = await api.readFile(bot.id, join(path, f.name));
      setEditing(f.name);
      setContent(d.content);
    } catch (e) {
      setError(e.message);
    }
  }

  async function save() {
    try {
      await api.writeFile(bot.id, join(path, editing), content);
      setEditing(null);
      load(path);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(f) {
    if (!confirm(`Delete ${f.name}?`)) return;
    try {
      await api.deleteFile(bot.id, join(path, f.name));
      load(path);
    } catch (e) {
      setError(e.message);
    }
  }

  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      await api.writeFile(bot.id, join(path, file.name), text);
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => load('/')}>Root</button>
        <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => load(path.split('/').slice(0, -1).join('/') || '/')}>Up</button>
        <span className="flex-1 truncate font-mono text-sm text-zinc-400">{path}</span>
        <label className="btn-primary !px-3 !py-1.5 cursor-pointer text-xs">
          <Icons.Upload className="h-3.5 w-3.5" /> Upload
          <input type="file" className="hidden" onChange={upload} />
        </label>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {editing ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm text-zinc-300">{editing}</span>
            <div className="flex gap-2">
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={save}><Icons.Save className="h-3.5 w-3.5" /> Save</button>
              <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
          <textarea
            className="input h-96 font-mono"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <Card className="!p-0 overflow-hidden">
          {files.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">Empty directory</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <button className="flex items-center gap-2 text-zinc-300 hover:text-white" onClick={() => openFile(f)}>
                        <span>{f.type === 'dir' ? '📁' : '📄'}</span>
                        <span className="font-mono">{f.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{f.type === 'file' ? `${(f.size / 1024).toFixed(1)} KB` : ''}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-xs text-red-400 hover:text-red-300" onClick={() => remove(f)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function EnvTab({ bot }) {
  const [env, setEnv] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEnv(bot.env || {});
  }, [bot.id]);

  function set(key, value) {
    setEnv((e) => ({ ...e, [key]: value }));
    setSaved(false);
  }

  function remove(key) {
    setEnv((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.env(bot.id, env);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <p className="mb-4 text-sm text-zinc-500">Environment variables are injected into your bot's container. Saving rebuilds the container so changes apply instantly.</p>
      <div className="mb-4 space-y-2">
        {Object.entries(env).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <input className="input flex-1 font-mono" value={k} onChange={(e) => {
              const { [k]: val, ...rest } = env;
              setEnv({ ...rest, [e.target.value]: val });
            }} placeholder="KEY" />
            <input className="input flex-1 font-mono" value={v} onChange={(e) => set(k, e.target.value)} placeholder="value" />
            <button className="btn-danger !px-3" onClick={() => remove(k)}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={() => setEnv((e) => ({ ...e, '': '' }))}>+ Add variable</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function SettingsTab({ bot, onDeleted }) {
  const [name, setName] = useState(bot.name);
  const [startup, setStartup] = useState(bot.startup_command || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.updateBot(bot.id, { name, startup_command: startup });
      alert('Saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reinstall() {
    if (!confirm('Reinstall wipes dependencies and re-runs the install command. Continue?')) return;
    await api.reinstall(bot.id);
    alert('Reinstalling…');
  }

  async function remove() {
    if (!confirm('Delete this bot permanently? This cannot be undone.')) return;
    await api.deleteBot(bot.id);
    onDeleted();
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label className="label">Bot name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Startup command</label>
        <input className="input font-mono" value={startup} onChange={(e) => setStartup(e.target.value)} />
        <p className="mt-1 text-xs text-zinc-500">Runs inside the container with /app as working directory. Saving rebuilds the container.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button className="btn-ghost" onClick={reinstall}>Reinstall</button>
        <button className="btn-danger ml-auto" onClick={remove}><Icons.Trash className="h-4 w-4" /> Delete bot</button>
      </div>
    </div>
  );
}

export default function BotDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bot, setBot] = useState(null);
  const [tab, setTab] = useState('console');
  const [resources, setResources] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.bot(id).then((d) => setBot(d.bot)).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!bot) return;
    const t = setInterval(() => {
      api.resources(bot.id).then(setResources).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [bot?.id]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!bot) return <p className="text-zinc-500">Loading…</p>;

  const tabs = [
    { id: 'console', label: 'Console', icon: <Icons.Terminal className="h-4 w-4" /> },
    { id: 'files', label: 'Files', icon: <Icons.Folder className="h-4 w-4" /> },
    { id: 'env', label: 'Environment', icon: <Icons.Env className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <Icons.Gear className="h-4 w-4" /> },
  ];

  async function power(action) {
    try {
      await api.power(bot.id, action);
      const d = await api.bot(bot.id);
      setBot(d.bot);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <Icons.Back className="h-4 w-4" /> Back to dashboard
      </Link>

      <div className="mb-6 mt-3 flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 text-xl ring-1 ring-white/10">
          {RUNTIME_ICONS[bot.runtime] || '📦'}
        </span>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            {bot.name}
            <StatusBadge status={bot.status} />
          </h1>
          <p className="text-xs text-zinc-500">
            {bot.runtime_name} · {bot.memory_mb}MB · {bot.cpu}% CPU · <span className="font-mono">{bot.identifier}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {resources && (
            <>
              <StatChip label="CPU" value={`${resources.cpu}%`} />
              <StatChip label="RAM" value={`${resources.memory_mb}/${resources.memory_limit_mb}MB`} />
            </>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {bot.status === 'running' ? (
          <button className="btn-ghost" onClick={() => power('stop')}><Icons.Stop className="h-4 w-4" /> Stop</button>
        ) : (
          <button className="btn-primary" onClick={() => power('start')} disabled={bot.status === 'installing'}><Icons.Play className="h-4 w-4" /> Start</button>
        )}
        <button className="btn-ghost" onClick={() => power('restart')} disabled={bot.status === 'installing'}><Icons.Restart className="h-4 w-4" /> Restart</button>
        <button className="btn-danger" onClick={() => power('kill')}><Icons.Kill className="h-4 w-4" /> Kill</button>
      </div>

      <div className="mb-4 flex gap-1 border-b border-white/[0.06]">
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

      {tab === 'console' && <ConsoleTab bot={bot} />}
      {tab === 'files' && <FilesTab bot={bot} />}
      {tab === 'env' && <EnvTab bot={bot} />}
      {tab === 'settings' && <SettingsTab bot={bot} onDeleted={() => navigate('/')} />}
    </div>
  );
}
