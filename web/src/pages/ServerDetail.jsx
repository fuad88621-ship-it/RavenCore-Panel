import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { api } from '../api.js';
import { Card, ErrorState, Icons, Select, Skeleton, StatusBadge, useToast, cn } from '../components/ui.jsx';

function StatChip({ label, value }) {
  return (
    <span className="chip border border-white/10 bg-white/[0.04] text-zinc-300">
      <span className="text-zinc-500">{label}</span> {value}
    </span>
  );
}

function ConsoleTab({ server }) {
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let term;
    let disposed = false;

    async function init() {
      const { socket } = await api.console(server.id);
      if (disposed) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        theme: { background: '#0a0a0f', foreground: '#d1d5db', cursor: '#8b5cf6' },
      });
      await new Promise((r) => setTimeout(r, 450));
      if (disposed) return;
      term.open(termRef.current);
      term.writeln('\x1b[90mConnecting to console…\x1b[0m');

      const ws = new WebSocket(socket);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        term.clear();
        term.writeln('\x1b[32m● Connected. Server output will appear here.\x1b[0m');
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
  }, [server.id]);

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

function FilesTab({ server }) {
  const [path, setPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  async function load(p) {
    try {
      const d = await api.files(server.id, p);
      setPath(d.path);
      setFiles(d.files);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load('/'); }, [server.id]);

  function join(p, name) {
    return p === '/' ? `/${name}` : `${p}/${name}`;
  }

  async function openFile(f) {
    if (f.type === 'dir') return load(join(path, f.name));
    try {
      const d = await api.readFile(server.id, join(path, f.name));
      setEditing(f.name);
      setContent(d.content);
    } catch (e) {
      setError(e.message);
    }
  }

  async function save() {
    try {
      await api.writeFile(server.id, join(path, editing), content);
      setEditing(null);
      load(path);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(f) {
    if (!confirm(`Delete ${f.name}?`)) return;
    try {
      await api.deleteFile(server.id, join(path, f.name));
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
      await api.writeFile(server.id, join(path, file.name), text);
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
          <textarea className="input h-96 font-mono" value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
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

function DatabasesTab({ server }) {
  const [databases, setDatabases] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState({});

  async function load() {
    try {
      const d = await api.databases(server.id);
      setDatabases(d.databases);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [server.id]);

  async function create(e) {
    e.preventDefault();
    try {
      await api.createDatabase(server.id, name);
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(db) {
    if (!confirm(`Delete database ${db.database_name}? This cannot be undone.`)) return;
    try {
      await api.deleteDatabase(db.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function rotate(db) {
    try {
      await api.rotateDatabase(db.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500">Databases are MySQL databases hosted on the panel's database server. Limit: {server.databases}.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {databases.length < server.databases && (
        <form onSubmit={create} className="mb-4 flex gap-2">
          <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="database name" required />
          <button className="btn-primary">+ Create</button>
        </form>
      )}

      <div className="space-y-3">
        {databases.length === 0 && <p className="text-sm text-zinc-500">No databases yet.</p>}
        {databases.map((db) => (
          <Card key={db.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono font-semibold text-white">{db.database_name}</p>
                <p className="text-xs text-zinc-500">Host: {db.host}:3306</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setRevealed((r) => ({ ...r, [db.id]: !r[db.id] }))}>
                  {revealed[db.id] ? 'Hide' : 'Details'}
                </button>
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => rotate(db)}><Icons.Refresh className="h-3.5 w-3.5" /> Rotate</button>
                <button className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => remove(db)}>Delete</button>
              </div>
            </div>
            {revealed[db.id] && (
              <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-white/[0.03] p-3 font-mono text-xs sm:grid-cols-2">
                <p><span className="text-zinc-500">Database:</span> <span className="text-zinc-200">{db.database_name}</span></p>
                <p><span className="text-zinc-500">Username:</span> <span className="text-zinc-200">{db.username}</span></p>
                <p><span className="text-zinc-500">Password:</span> <span className="text-zinc-200">{db.password}</span></p>
                <p><span className="text-zinc-500">Host:</span> <span className="text-zinc-200">{db.host}:3306</span></p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function StartupTab({ server }) {
  const [variables, setVariables] = useState([]);
  const [env, setEnv] = useState({});
  const [startup, setStartup] = useState('');
  const [image, setImage] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.startup(server.id).then((d) => {
      setVariables(d.variables);
      setEnv(d.env || {});
      setStartup(d.startup_command);
      setImage(d.docker_image);
    }).catch((e) => setError(e.message));
  }, [server.id]);

  async function save() {
    try {
      await api.updateStartup(server.id, env);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="max-w-2xl">
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="mb-4">
        <label className="label">Docker image</label>
        <input className="input font-mono" value={image} readOnly />
      </div>
      <div className="mb-4">
        <label className="label">Startup command</label>
        <input className="input font-mono" value={startup} readOnly />
        <p className="mt-1 text-xs text-zinc-500">Variables in {'{{UPPERCASE}}'} are replaced with the values below.</p>
      </div>
      <div className="mb-4 space-y-3">
        {variables.map((v) => (
          <div key={v.id}>
            <label className="label">{v.name} <span className="normal-case text-zinc-600">· {v.env_variable}</span></label>
            <input
              className="input font-mono"
              value={env[v.env_variable] ?? v.default_value}
              onChange={(e) => setEnv((x) => ({ ...x, [v.env_variable]: e.target.value }))}
              disabled={!v.user_editable}
              placeholder={v.description || ''}
            />
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={save}>Save</button>
      {saved && <span className="ml-3 text-sm text-emerald-400">Saved ✓ (restart to apply)</span>}
    </div>
  );
}

function SettingsTab({ server, onDeleted }) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  async function save() {
    try {
      await api.updateSettings(server.id, { name, description });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast && toast.push('Settings saved');
    } catch (e) {
      setError(e.message);
      toast && toast.push(e.message, 'error');
    }
  }

  async function reinstall() {
    if (!confirm('Reinstall wipes dependencies and re-runs the install command. Continue?')) return;
    try {
      await api.reinstall(server.id);
      toast && toast.push('Reinstall started');
    } catch (e) {
      setError(e.message);
      toast && toast.push(e.message, 'error');
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label className="label">Server name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={save}>Save changes</button>
        <button className="btn-ghost" onClick={reinstall}>Reinstall</button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
      </div>
    </div>
  );
}

function SchedulesTab({ server }) {
  const [schedules, setSchedules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', cron: '*/5 * * * *', is_active: true, tasks: [{ action: 'command', payload: '' }] });
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.schedules(server.id);
      setSchedules(d.schedules);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [server.id]);

  async function create(e) {
    e.preventDefault();
    try {
      await api.createSchedule(server.id, form);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggle(s) {
    await api.updateSchedule(s.id, { is_active: !s.is_active });
    load();
  }

  async function remove(s) {
    if (!confirm(`Delete schedule ${s.name}?`)) return;
    await api.deleteSchedule(s.id);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">Run tasks on a cron schedule. Limit: unlimited.</p>
        <button className="btn-primary !py-1.5 text-xs" onClick={() => setShowForm(!showForm)}><Icons.Plus className="h-3.5 w-3.5" /> New Schedule</button>
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Cron (min hour day month weekday)</label><input className="input font-mono" value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} required /></div>
            </div>
            <div>
              <label className="label">Task</label>
              <div className="flex gap-2">
                <Select className="max-w-[140px]" value={form.tasks[0].action} onChange={(e) => setForm({ ...form, tasks: [{ ...form.tasks[0], action: e.target.value }] })}>
                  <option value="command">Send command</option>
                  <option value="start">Start</option>
                  <option value="stop">Stop</option>
                  <option value="restart">Restart</option>
                  <option value="kill">Kill</option>
                </Select>
                <input className="input flex-1 font-mono" value={form.tasks[0].payload} onChange={(e) => setForm({ ...form, tasks: [{ ...form.tasks[0], payload: e.target.value }] })} placeholder="command to send (if any)" />
              </div>
            </div>
            <button className="btn-primary">Create schedule</button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {schedules.length === 0 && <p className="text-sm text-zinc-500">No schedules yet.</p>}
        {schedules.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">{s.name}</p>
                <p className="font-mono text-xs text-zinc-500">{s.cron} · {s.task_count} task(s) · last run: {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'never'}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => toggle(s)}>{s.is_active ? 'Disable' : 'Enable'}</button>
                <button className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UsersTab({ server }) {
  const [users, setUsers] = useState([]);
  const [perms, setPerms] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.subusers(server.id);
      setUsers(d.users);
      setPerms(d.permissions);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [server.id]);

  async function doSearch(q) {
    setSearch(q);
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const d = await api.userSearch(q);
      setResults(d.users);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }

  function pickUser(u) {
    setSelected(u);
    setSearch(`${u.email} (${u.username})`);
    setResults([]);
  }

  async function add(e) {
    e.preventDefault();
    if (!selected) return setError('Search for a user and pick them from the results');
    try {
      await api.createSubuser(server.id, { user_id: selected.id, permissions: selectedPerms });
      setSelected(null); setSearch(''); setSelectedPerms([]);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(su) {
    if (!confirm(`Remove ${su.username} from this server?`)) return;
    await api.deleteSubuser(su.id);
    load();
  }

  function togglePerm(p) {
    setSelectedPerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500">Grant other users access to this server with limited permissions. Search by email or username.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <form onSubmit={add} className="mb-6 space-y-3">
        <div className="relative max-w-sm">
          <label className="label">Select user…</label>
          <input
            className="input"
            value={search}
            onChange={(e) => doSearch(e.target.value)}
            placeholder="Type an email or username (min 3 chars)"
            required
          />
          {searching && <p className="mt-1 text-xs text-zinc-500">Searching…</p>}
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-panel shadow-xl">
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
          {selected && <p className="mt-1 text-xs text-emerald-400">✓ Selected: {selected.email}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {perms.map((p) => (
            <button type="button" key={p} onClick={() => togglePerm(p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${selectedPerms.includes(p) ? 'border-violet-500/50 bg-violet-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'}`}>
              {p}
            </button>
          ))}
        </div>
        <button className="btn-primary !py-1.5 text-sm">Add user</button>
      </form>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">No sub-users.</td></tr>}
            {users.map((su) => (
              <tr key={su.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{su.username}</p>
                  <p className="text-xs text-zinc-500">{su.email}</p>
                </td>
                <td className="px-4 py-3"><span className="font-mono text-xs text-zinc-400">{su.permissions.join(', ') || 'none'}</span></td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-danger !px-3 !py-1 text-xs" onClick={() => remove(su)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function BackupsTab({ server }) {
  const [backups, setBackups] = useState([]);
  const [error, setError] = useState('');
  const toast = useToast();

  async function load() {
    try {
      const d = await api.backups(server.id);
      setBackups(d.backups);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, [server.id]);

  async function create() {
    try {
      await api.createBackup(server.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function download(b) {
    try {
      const d = await api.downloadBackup(b.id);
      const blob = new Blob([JSON.stringify(d)], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${b.name}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  async function restore(b) {
    if (!confirm(`Restore backup ${b.name}? This overwrites all current files.`)) return;
    try {
      await api.restoreBackup(b.id);
      toast && toast.push('Restore started');
    } catch (e) {
      setError(e.message);
      toast && toast.push(e.message, 'error');
    }
  }

  async function remove(b) {
    if (!confirm(`Delete backup ${b.name}?`)) return;
    await api.deleteBackup(b.id);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">Backups are stored on the node. Limit: {server.backups}.</p>
        <button className="btn-primary !py-1.5 text-xs" onClick={create}><Icons.Plus className="h-3.5 w-3.5" /> New Backup</button>
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No backups yet.</td></tr>}
            {backups.map((b) => (
              <tr key={b.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-white">{b.name}</td>
                <td className="px-4 py-3 text-zinc-400">{(b.size_bytes / 1024 / 1024).toFixed(2)} MB</td>
                <td className="px-4 py-3">
                  <span className={`chip border ${b.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : b.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'}`}>
                    {b.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500">{new Date(b.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => download(b)}>Download</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => restore(b)}>Restore</button>
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => remove(b)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ActivityTab({ server }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.activity(server.id).then((d) => setLogs(d.logs)).catch((e) => setError(e.message));
  }, [server.id]);

  const actionIcons = {
    'server.create': '✨', 'server.start': '▶', 'server.stop': '■', 'server.restart': '↻', 'server.kill': '✕',
    'file.write': '📝', 'database.create': '🗄',
  };
  const actionLabels = {
    'server.create': 'Server created', 'server.start': 'Server started', 'server.stop': 'Server stopped',
    'server.restart': 'Server restarted', 'server.kill': 'Server killed',
    'file.write': 'File modified', 'database.create': 'Database created',
  };

  return (
    <div className="max-w-2xl">
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <Card className="!p-0 overflow-hidden">
        {logs.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">No activity yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg">{actionIcons[l.action] || '•'}</span>
                <div className="flex-1">
                  <p className="text-sm text-white">{actionLabels[l.action] || l.action}</p>
                  {l.metadata && Object.keys(l.metadata).length > 0 && (
                    <p className="text-xs text-zinc-500 font-mono">{JSON.stringify(l.metadata)}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-400">{l.username || 'system'}</p>
                  <p className="text-xs text-zinc-600">{new Date(l.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function NetworkTab({ server }) {
  const [allocations, setAllocations] = useState([]);
  const [sftp, setSftp] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.network(server.id).then((d) => setAllocations(d.allocations)).catch((e) => setError(e.message));
    api.sftp(server.id).then(setSftp).catch(() => {});
  }, [server.id]);

  async function rotateSftp() {
    try {
      const d = await api.rotateSftp(server.id);
      setSftp((s) => ({ ...s, password: d.password }));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <h3 className="mb-3 font-semibold text-white">Allocations</h3>
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Port</th>
                <th className="px-4 py-3">Node</th>
              </tr>
            </thead>
            <tbody>
              {allocations.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">No allocations.</td></tr>}
              {allocations.map((a) => (
                <tr key={a.id} className="border-b border-white/[0.06] last:border-0">
                  <td className="px-4 py-3 font-mono text-zinc-300">{a.ip}</td>
                  <td className="px-4 py-3 font-mono text-white">{a.port}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.node_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 font-semibold text-white">SFTP</h3>
        {sftp ? (
          <Card className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Host</label><input className="input font-mono" value={sftp.host} readOnly /></div>
              <div><label className="label">Port</label><input className="input font-mono" value={sftp.port} readOnly /></div>
              <div><label className="label">Username</label><input className="input font-mono" value={sftp.username} readOnly /></div>
              <div><label className="label">Password</label>
                <div className="flex gap-2">
                  <input className="input font-mono" value={sftp.password} readOnly />
                  <button className="btn-ghost !px-3" onClick={() => navigator.clipboard.writeText(sftp.password)} title="Copy"><Icons.Copy className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
            <p className="text-xs text-zinc-500">Connect with any SFTP client (FileZilla, WinSCP). You are chrooted to this server's files.</p>
            <button className="btn-ghost !py-1.5 text-xs" onClick={rotateSftp}>Rotate password</button>
          </Card>
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}
      </div>
    </div>
  );
}

export default function ServerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [server, setServer] = useState(null);
  const [tab, setTab] = useState('console');
  const [resources, setResources] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.server(id).then((d) => setServer(d.server)).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!server) return;
    const t = setInterval(() => {
      api.resources(server.id).then(setResources).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [server?.id]);

  if (error) return <ErrorState title="Failed to load server" sub={error} onRetry={() => window.location.reload()} />;
  if (!server) {
    return (
      <div>
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="mb-6 h-4 w-64" />
        <div className="mb-4 flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const tabs = [
    { id: 'console', label: 'Console', icon: <Icons.Terminal className="h-4 w-4" /> },
    { id: 'files', label: 'Files', icon: <Icons.Folder className="h-4 w-4" /> },
    { id: 'databases', label: 'Databases', icon: <Icons.Database className="h-4 w-4" /> },
    { id: 'schedules', label: 'Schedules', icon: <Icons.Clock className="h-4 w-4" /> },
    { id: 'users', label: 'Users', icon: <Icons.Users className="h-4 w-4" /> },
    { id: 'backups', label: 'Backups', icon: <Icons.Save className="h-4 w-4" /> },
    { id: 'network', label: 'Network', icon: <Icons.Node className="h-4 w-4" /> },
    { id: 'startup', label: 'Startup', icon: <Icons.Play className="h-4 w-4" /> },
    { id: 'activity', label: 'Activity', icon: <Icons.Clock className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <Icons.Gear className="h-4 w-4" /> },
  ];

  async function power(action) {
    try {
      await api.power(server.id, action);
      const d = await api.server(server.id);
      setServer(d.server);
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
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 text-xl ring-1 ring-white/10">🖥️</span>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            {server.name}
            <StatusBadge status={server.status} />
          </h1>
          <p className="text-xs text-zinc-500">
            {server.egg_name} · {server.memory_mb}MB · {server.cpu}% CPU · <span className="font-mono">{server.identifier}</span>
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
        {server.status === 'running' ? (
          <button className="btn-ghost" onClick={() => power('stop')}><Icons.Stop className="h-4 w-4" /> Stop</button>
        ) : (
          <button className="btn-primary" onClick={() => power('start')} disabled={server.status === 'installing'}><Icons.Play className="h-4 w-4" /> Start</button>
        )}
        <button className="btn-ghost" onClick={() => power('restart')} disabled={server.status === 'installing'}><Icons.Restart className="h-4 w-4" /> Restart</button>
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

      {tab === 'console' && <ConsoleTab server={server} />}
      {tab === 'files' && <FilesTab server={server} />}
      {tab === 'databases' && <DatabasesTab server={server} />}
      {tab === 'schedules' && <SchedulesTab server={server} />}
      {tab === 'users' && <UsersTab server={server} />}
      {tab === 'backups' && <BackupsTab server={server} />}
      {tab === 'network' && <NetworkTab server={server} />}
      {tab === 'startup' && <StartupTab server={server} />}
      {tab === 'activity' && <ActivityTab server={server} />}
      {tab === 'settings' && <SettingsTab server={server} onDeleted={() => navigate('/')} />}
    </div>
  );
}
