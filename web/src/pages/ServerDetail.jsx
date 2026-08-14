import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Terminal } from '@xterm/xterm';
import { api } from '../api.js';
import { useDebouncedCallback } from '../useDebounce.js';
import { Card, ErrorState, Icons, Select, Skeleton, StatusBadge, useToast, cn } from '../components/ui.jsx';

function StatChip({ label, value }) {
  return (
    <span className="chip border border-white/10 bg-white/[0.04] text-zinc-300">
      <span className="text-zinc-500">{label}</span> {value}
    </span>
  );
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  // Guard against bogus epoch/timestamp values that produce multi-year uptimes.
  const MAX_SANE_UPTIME_SECONDS = 100 * 365 * 24 * 60 * 60; // 100 years
  if (seconds > MAX_SANE_UPTIME_SECONDS) return 'Unknown';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatMemory(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GiB`;
  return `${Math.round(mb)} MiB`;
}

function StatCard({ icon, label, value, sub, bar, index, copy }) {
  const hasBar = typeof bar === 'number';
  const pct = hasBar ? Math.min(100, Math.max(0, bar)) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="flex min-h-[88px] items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-300">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
          <div className={cn('flex items-center gap-1.5', copy ? 'flex-wrap' : 'whitespace-nowrap')}>
            <p className={cn('text-base font-semibold text-white', copy ? 'break-all' : 'truncate')}>{value}</p>
            {sub && <p className="truncate text-xs text-zinc-500">{sub}</p>}
            {copy && (
              <button
                className="ml-auto shrink-0 rounded p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-violet-300"
                onClick={() => navigator.clipboard.writeText(copy)}
                title="Copy address"
                aria-label="Copy address"
              >
                <Icons.Copy className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hasBar && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function ConsoleTab({ server }) {
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const installing = server.status === 'installing';
    let term;
    let pollId;
    let startupTimer;
    let disposed = false;
    let onVis;

    function setConn(v) { if (!disposed) setConnected(v); }
    function setErr(v) { if (!disposed) setError(v); }

    async function init() {
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        theme: { background: '#0a0a0f', foreground: '#d1d5db', cursor: '#8b5cf6' },
      });
      await new Promise((r) => { startupTimer = setTimeout(r, 300); });
      if (disposed) return;
      term.open(termRef.current);

      if (installing) {
        term.writeln('\x1b[33m● Server is installing. Install output will appear below.\x1b[0m');
        term.writeln('');
        let lastLog = '';
        let busy = false;
        const poll = async () => {
          if (busy || disposed) return;
          busy = true;
          try {
            const d = await api.installLog(server.id);
            if (d.log && d.log !== lastLog) {
              const newLines = d.log.slice(lastLog.length);
              term.write(newLines);
              lastLog = d.log;
            }
          } catch (e) {
            // ignore poll errors
          } finally {
            busy = false;
          }
        };
        pollId = setInterval(poll, 2000);
        return;
      }

      term.writeln('\x1b[90mConnecting to console…\x1b[0m');

      const { socket } = await api.console(server.id);
      if (disposed) return;

      const ws = new WebSocket(socket);
      wsRef.current = ws;
      ws.onopen = () => {
        setConn(true);
        term.clear();
        term.writeln('\x1b[32m● Connected. Server output will appear here.\x1b[0m');
      };
      ws.onmessage = (ev) => term.write(ev.data);
      ws.onclose = () => {
        setConn(false);
        term.writeln('\r\n\x1b[31m● Disconnected.\x1b[0m');
      };
      ws.onerror = () => setErr('WebSocket error');

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      onVis = () => {
        if (!document.hidden && !disposed) {
          try { term.resize(term.cols, term.rows); } catch {}
        }
      };
      document.addEventListener('visibilitychange', onVis);
    }

    init().catch((e) => setErr(e.message));

    return () => {
      disposed = true;
      if (pollId) clearInterval(pollId);
      if (startupTimer) clearTimeout(startupTimer);
      try { wsRef.current?.close(); } catch {}
      try { term?.dispose(); } catch {}
      if (onVis) document.removeEventListener('visibilitychange', onVis);
    };
  }, [server.id, server.status]);

  const installing = server.status === 'installing';

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {installing ? (
          <span className="chip border border-amber-500/20 bg-amber-500/10 text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Installing
          </span>
        ) : (
          <span className={cn('chip border', connected ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-red-500/20 bg-red-500/10 text-red-400')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-500')} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <div ref={termRef} className="h-[50vh] min-h-[280px] max-h-[560px] overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]" />
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function Modal({ children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab') {
        const el = ref.current;
        if (!el) return;
        const focusables = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement;
    const first = ref.current?.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()} ref={ref}>
        {children}
      </Card>
    </div>
  );
}

function FileIcon({ type, name }) {
  if (type === 'dir') return <Icons.Folder className="h-8 w-8 text-violet-300" />;
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.ts')) return <Icons.Terminal className="h-8 w-8 text-amber-300" />;
  if (name.endsWith('.json') || name.endsWith('.yml') || name.endsWith('.yaml')) return <Icons.Database className="h-8 w-8 text-sky-300" />;
  if (name.endsWith('.md') || name.endsWith('.txt')) return <Icons.Env className="h-8 w-8 text-emerald-300" />;
  return <Icons.File className="h-8 w-8 text-zinc-400" />;
}

function fileGlyphClass(name, isDir) {
  if (isDir) return 'text-amber-300/90';
  const lower = name.toLowerCase();
  if (lower.endsWith('.env') || lower.includes('token') || lower.includes('secret')) return 'text-emerald-400';
  if (lower.endsWith('.py')) return 'text-sky-300';
  if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.mjs')) return 'text-yellow-300';
  if (lower.endsWith('.go')) return 'text-cyan-300';
  if (lower.endsWith('.java')) return 'text-orange-300';
  if (lower.endsWith('.json')) return 'text-zinc-300';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text-violet-300';
  if (lower.endsWith('.md')) return 'text-zinc-400';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text-zinc-500';
  if (isArchive(name)) return 'text-rose-300';
  return 'text-zinc-500';
}

function isArchive(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar') || lower.endsWith('.7z') || lower.endsWith('.rar');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function parentPath(p) {
  if (!p || p === '/') return '/';
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.slice(0, idx);
}

function FilesTab({ server }) {
  const [path, setPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [view, setView] = useState('list');
  const [modal, setModal] = useState(null); // { type: 'newFile'|'newFolder'|'rename'|'delete', file? }
  const [modalValue, setModalValue] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const toast = useToast();

  async function load(p) {
    try {
      const d = await api.files(server.id, p);
      setPath(d.path);
      setFiles(d.files);
      setSelected(new Set());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load('/'); }, [server.id]);

  function join(p, name) {
    return p === '/' ? `/${name}` : `${p}/${name}`;
  }

  // Reject names that could escape the server directory (path traversal).
  function isValidName(name) {
    if (!name || name === '.' || name === '..') return false;
    if (/[\/\\\x00-\x1f]|\.\./.test(name)) return false;
    return true;
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
    try {
      await api.deleteFile(server.id, join(path, f.name));
      setModal(null);
      toast.push(`Deleted ${f.name}`);
      load(path);
    } catch (e) {
      setError(e.message);
    }
  }

  async function rename(f) {
    if (!modalValue || modalValue === f.name) {
      setModal(null);
      return;
    }
    if (!isValidName(modalValue)) {
      setError('Invalid name: cannot contain /, \\, or ..');
      return;
    }
    try {
      await api.renameFile(server.id, join(path, f.name), join(path, modalValue));
      setModal(null);
      toast.push('Renamed');
      load(path);
    } catch (e) {
      setError(e.message);
    }
  }

  async function upload(e) {
    const file = e.target.files[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (!isValidName(file.name)) {
      setError('Invalid file name');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(',')[1];
      try {
        await api.writeFile(server.id, join(path, file.name), base64, 'base64');
        toast.push(`Uploaded ${file.name}`);
        load(path);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsDataURL(file);
  }

  function toggleSelect(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.name)));
  }

  async function createFolder() {
    if (!modalValue.trim()) return;
    if (!isValidName(modalValue.trim())) {
      setError('Invalid name: cannot contain /, \\, or ..');
      return;
    }
    try {
      await api.createFolder(server.id, join(path, modalValue.trim()));
      setModal(null);
      setModalValue('');
      toast.push('Folder created');
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createFile() {
    if (!modalValue.trim()) return;
    if (!isValidName(modalValue.trim())) {
      setError('Invalid name: cannot contain /, \\, or ..');
      return;
    }
    try {
      const p = join(path, modalValue.trim());
      await api.writeFile(server.id, p, '');
      setModal(null);
      setModalValue('');
      toast.push('File created');
      load(path);
      setEditing(modalValue.trim());
      setContent('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function archiveSelected() {
    if (selected.size === 0) return;
    const name = prompt('Archive name (e.g. backup.tar.gz):', 'archive.tar.gz');
    if (!name) return;
    try {
      await api.archiveFiles(server.id, Array.from(selected).map((n) => join(path, n)), name);
      setSelected(new Set());
      toast.push(`Archived ${selected.size} item(s)`);
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  async function compress(f) {
    try {
      await api.archiveFiles(server.id, [join(path, f.name)], `${f.name}.tar.gz`);
      toast.push('Archived');
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  async function extract(f) {
    try {
      await api.extractArchive(server.id, join(path, f.name));
      toast.push(`Extracted ${f.name}`);
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  async function download(f) {
    const url = api.downloadFile(server.id, join(path, f.name));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
  }

  async function deleteSelected() {
    const names = Array.from(selected);
    try {
      const results = await Promise.allSettled(names.map((n) => api.deleteFile(server.id, join(path, n))));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        setError(`Failed to delete ${failed.length} item(s)`);
      } else {
        toast.push(`Deleted ${names.length} item(s)`);
      }
      setSelected(new Set());
      setModal(null);
      load(path);
    } catch (err) {
      setError(err.message);
    }
  }

  const crumbs = path === '/' ? [] : path.slice(1).split('/').filter(Boolean);
  const selectedFiles = files.filter((f) => selected.has(f.name));
  const singleFileSelected = selectedFiles.length === 1 && selectedFiles[0].type === 'file' ? selectedFiles[0] : null;

  function openRename(f) {
    setModal({ type: 'rename', file: f });
    setModalValue(f.name);
  }

  function openDelete(f) {
    setModal({ type: 'delete', file: f });
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {editing ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEditing(null)}><Icons.Back className="h-3.5 w-3.5" /> Back</button>
              <span className="font-mono text-sm text-zinc-300">{editing}</span>
            </div>
            <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={save}><Icons.Save className="h-3.5 w-3.5" /> Save</button>
          </div>
          <textarea className="input h-[480px] font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
        </motion.div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Card className="!py-2 !px-3">
              <nav className="flex min-w-0 items-center gap-1 font-mono text-sm">
                <button onClick={() => load('/')} className="rounded px-1.5 py-0.5 text-violet-300 transition hover:bg-violet-500/10">/</button>
                {crumbs.map((seg, i) => (
                  <span key={`${seg}-${i}`} className="flex items-center gap-1">
                    <span className="text-zinc-600">/</span>
                    <button
                      onClick={() => load('/' + crumbs.slice(0, i + 1).join('/'))}
                      className={cn('rounded px-1.5 py-0.5 transition hover:bg-violet-500/10', i === crumbs.length - 1 ? 'text-white' : 'text-violet-300')}
                    >
                      {seg}
                    </button>
                  </span>
                ))}
              </nav>
            </Card>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl border border-white/[0.06] bg-white/[0.03] p-1">
                <button onClick={() => setView('list')} className={cn('rounded-lg p-1.5 transition', view === 'list' ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-500 hover:text-zinc-300')} title="List view">
                  <Icons.List className="h-4 w-4" />
                </button>
                <button onClick={() => setView('grid')} className={cn('rounded-lg p-1.5 transition', view === 'grid' ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-500 hover:text-zinc-300')} title="Grid view">
                  <Icons.Grid className="h-4 w-4" />
                </button>
              </div>
              <button onClick={() => { setModalValue(''); setModal({ type: 'newFile' }); }} className="btn-ghost !px-3 !py-1.5 text-xs">
                <Icons.FilePlus className="h-3.5 w-3.5" /> New file
              </button>
              <button onClick={() => { setModalValue(''); setModal({ type: 'newFolder' }); }} className="btn-ghost !px-3 !py-1.5 text-xs">
                <Icons.FolderPlus className="h-3.5 w-3.5" /> New folder
              </button>
              <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Icons.Upload className="h-3.5 w-3.5" /> Upload
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={upload} />
            </div>
          </div>

          {/* Batch action bar */}
          {selected.size > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/[0.07] px-3 py-2">
                <span className="text-xs text-violet-200">{selected.size} selected</span>
                <span className="mx-1 h-4 w-px bg-violet-500/25" />
                <button onClick={archiveSelected} className="btn-ghost !px-3 !py-1.5 text-xs"><Icons.Archive className="h-3.5 w-3.5" /> Archive</button>
                <button onClick={() => singleFileSelected && download(singleFileSelected)} disabled={!singleFileSelected} className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-40"><Icons.Download className="h-3.5 w-3.5" /> Download</button>
                <button onClick={() => setModal({ type: 'batchDelete' })} className="btn-ghost !px-3 !py-1.5 text-xs hover:text-red-300"><Icons.Trash className="h-3.5 w-3.5" /> Delete</button>
                <button onClick={() => setSelected(new Set())} className="btn-ghost !px-3 !py-1.5 text-xs ml-auto"><Icons.X className="h-3.5 w-3.5" /> Clear</button>
              </div>
            </motion.div>
          )}

          {/* File surface */}
          <Card className="!p-0 overflow-hidden">
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/60">
                  <Icons.Upload className="h-7 w-7 text-zinc-500" />
                </div>
                <p className="mt-4 text-sm font-medium text-zinc-300">This folder is empty</p>
                <p className="mt-1 text-xs text-zinc-500">Upload or create a new file.</p>
              </div>
            ) : view === 'list' ? (
              <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                  <div className="grid grid-cols-[40px_1fr_100px_170px_150px] items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <input
                      type="checkbox"
                      aria-label="Select all files"
                      checked={files.length > 0 && selected.size === files.length}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < files.length; }}
                      onChange={selectAll}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-violet-500"
                    />
                    <span>Name</span>
                    <span className="text-right">Size</span>
                    <span>Modified</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <ul className="divide-y divide-white/[0.06]">
                    {path !== '/' && (
                      <li>
                        <button onClick={() => load(parentPath(path))} className="grid w-full grid-cols-[40px_1fr_100px_170px_150px] gap-2 px-4 py-2.5 text-left text-sm text-zinc-400 transition hover:bg-white/[0.03]">
                          <span />
                          <span className="flex items-center gap-2.5">
                            <Icons.Folder className="h-4 w-4 shrink-0 text-amber-300/90" />
                            ..
                          </span>
                          <span />
                          <span />
                          <span />
                        </button>
                      </li>
                    )}
                    {files.map((f) => {
                      const isSelected = selected.has(f.name);
                      const glyph = fileGlyphClass(f.name, f.type === 'dir');
                      return (
                        <li key={f.name} className={cn('grid grid-cols-[40px_1fr_100px_170px_150px] items-center gap-2 px-4 py-2.5 transition hover:bg-white/[0.03]', isSelected && 'bg-violet-500/[0.08]')}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${f.name}`}
                            checked={isSelected}
                            onChange={() => toggleSelect(f.name)}
                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-violet-500"
                          />
                          <button onClick={() => openFile(f)} className="flex min-w-0 items-center gap-2.5 text-left">
                            {f.type === 'dir' ? (
                              <Icons.Folder className="h-5 w-5 shrink-0 text-amber-300/90" />
                            ) : (
                              <Icons.File className={cn('h-5 w-5 shrink-0', glyph)} />
                            )}
                            <span className="truncate text-sm text-zinc-200">{f.name}</span>
                          </button>
                          <span className="text-right text-xs text-zinc-500">{f.type === 'file' ? formatBytes(f.size) : '—'}</span>
                          <span className="text-xs text-zinc-500">{fmtDate(f.modifiedAt)}</span>
                          <span className="flex justify-end gap-0.5">
                            {f.type === 'file' && (
                              <button onClick={() => download(f)} className="rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-violet-300" title="Download">
                                <Icons.Download className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button onClick={() => compress(f)} className="rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-violet-300" title="Compress">
                              <Icons.Archive className="h-3.5 w-3.5" />
                            </button>
                            {f.type === 'file' && isArchive(f.name) && (
                              <button onClick={() => extract(f)} className="rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-violet-300" title="Extract">
                                <Icons.Extract className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button onClick={() => openRename(f)} className="rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-violet-300" title="Rename">
                              <Icons.Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => openDelete(f)} className="rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-red-300" title="Delete">
                              <Icons.Trash className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {path !== '/' && (
                    <button onClick={() => load(parentPath(path))} className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-center transition hover:border-violet-500/30 hover:bg-white/[0.05]">
                      <Icons.Folder className="h-10 w-10 text-amber-300/90" />
                      <span className="text-sm text-zinc-400">..</span>
                    </button>
                  )}
                  {files.map((f) => {
                    const isSelected = selected.has(f.name);
                    const glyph = fileGlyphClass(f.name, f.type === 'dir');
                    return (
                      <div
                        key={f.name}
                        onClick={() => openFile(f)}
                        className={cn(
                          'group relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition',
                          isSelected ? 'border-violet-500/40 bg-violet-500/[0.12]' : 'border-white/[0.06] bg-white/[0.03] hover:border-violet-500/30 hover:bg-white/[0.05]'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => { e.stopPropagation(); toggleSelect(f.name); }}
                          className="absolute left-2 top-2 h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-violet-500"
                        />
                        {f.type === 'dir' ? (
                          <Icons.Folder className="h-10 w-10 text-amber-300/90" />
                        ) : (
                          <Icons.File className={cn('h-10 w-10', glyph)} />
                        )}
                        <span className="w-full truncate text-xs text-zinc-300">{f.name}</span>
                        <span className="text-[10px] text-zinc-600">{f.type === 'file' ? formatBytes(f.size) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Modals */}
          {modal?.type === 'newFile' && (
            <Modal onClose={() => setModal(null)}>
              <h3 className="text-base font-semibold text-white">New file</h3>
              <input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createFile()} placeholder="config.yml" className="input mt-4" />
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setModal(null)} className="btn-ghost !px-4 !py-2 text-xs">Cancel</button>
                <button onClick={createFile} disabled={!modalValue.trim()} className="btn-primary !px-4 !py-2 text-xs">Create & edit</button>
              </div>
            </Modal>
          )}

          {modal?.type === 'newFolder' && (
            <Modal onClose={() => setModal(null)}>
              <h3 className="text-base font-semibold text-white">New folder</h3>
              <input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createFolder()} placeholder="folder-name" className="input mt-4" />
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setModal(null)} className="btn-ghost !px-4 !py-2 text-xs">Cancel</button>
                <button onClick={createFolder} disabled={!modalValue.trim()} className="btn-primary !px-4 !py-2 text-xs">Create</button>
              </div>
            </Modal>
          )}

          {modal?.type === 'rename' && modal.file && (
            <Modal onClose={() => setModal(null)}>
              <h3 className="text-base font-semibold text-white">Rename <span className="font-mono text-violet-300">{modal.file.name}</span></h3>
              <input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename(modal.file)} className="input mt-4" />
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setModal(null)} className="btn-ghost !px-4 !py-2 text-xs">Cancel</button>
                <button onClick={() => rename(modal.file)} className="btn-primary !px-4 !py-2 text-xs">Rename</button>
              </div>
            </Modal>
          )}

          {modal?.type === 'delete' && modal.file && (
            <Modal onClose={() => setModal(null)}>
              <h3 className="text-base font-semibold text-white">Delete file?</h3>
              <p className="mt-2 text-sm text-zinc-400">This will permanently delete <b className="text-white">{modal.file.name}</b>.</p>
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setModal(null)} className="btn-ghost !px-4 !py-2 text-xs">Cancel</button>
                <button onClick={() => remove(modal.file)} className="btn-danger !px-4 !py-2 text-xs">Delete</button>
              </div>
            </Modal>
          )}

          {modal?.type === 'batchDelete' && (
            <Modal onClose={() => setModal(null)}>
              <h3 className="text-base font-semibold text-white">Delete {selected.size} items?</h3>
              <p className="mt-2 text-sm text-zinc-400">This cannot be undone.</p>
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setModal(null)} className="btn-ghost !px-4 !py-2 text-xs">Cancel</button>
                <button onClick={deleteSelected} className="btn-danger !px-4 !py-2 text-xs">Delete</button>
              </div>
            </Modal>
          )}
        </>
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
                <p className="text-xs text-zinc-500">Host: {db.host}:{db.port || 3306}</p>
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
                <p className="flex items-center gap-2"><span className="text-zinc-500">Password:</span> <span className="text-zinc-200">{db.password}</span><button className="text-zinc-500 transition hover:text-violet-300" onClick={() => navigator.clipboard.writeText(db.password)} aria-label={`Copy password for ${db.database_name}`}><Icons.Copy className="h-3.5 w-3.5" /></button></p>
                <p><span className="text-zinc-500">Host:</span> <span className="text-zinc-200">{db.host}:{db.port || 3306}</span></p>
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
  const savedTimer = useRef(null);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  useEffect(() => {
    api.startup(server.id).then((d) => {
      setVariables(d.variables || []);
      setEnv(d.env || {});
      setStartup(d.startup_command || '');
      setImage(d.docker_image || '');
    }).catch((e) => setError(e.message));
  }, [server.id]);

  async function save() {
    try {
      await api.updateStartup(server.id, env);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
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
              value={env[v.env_variable] !== undefined ? env[v.env_variable] : v.default_value}
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
  const savedTimer = useRef(null);
  const toast = useToast();

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  async function save() {
    try {
      await api.updateSettings(server.id, { name, description });
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
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

  async function remove() {
    if (!confirm(`Delete server ${server.name}? This permanently deletes all its files and cannot be undone.`)) return;
    try {
      await api.deleteServer(server.id);
      toast && toast.push('Server deleted');
      onDeleted();
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
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save}>Save changes</button>
        <button className="btn-ghost" onClick={reinstall}>Reinstall</button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
      </div>

      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
        <h3 className="mb-1 text-sm font-semibold text-red-200">Danger zone</h3>
        <p className="mb-4 text-xs text-red-200/70">Deleting this server will permanently remove all files, databases, and backups associated with it.</p>
        <button className="btn-danger" onClick={remove}>Delete server</button>
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
    try {
      await api.updateSchedule(s.id, { is_active: !s.is_active });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(s) {
    if (!confirm(`Delete schedule ${s.name}?`)) return;
    try {
      await api.deleteSchedule(s.id);
      load();
    } catch (err) {
      setError(err.message);
    }
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

  async function runSearch(q) {
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
  const debouncedSearch = useDebouncedCallback(runSearch, 300);

  function doSearch(q) {
    setSearch(q);
    setSelected(null);
    debouncedSearch(q);
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
    try {
      await api.deleteSubuser(su.id);
      load();
    } catch (err) {
      setError(err.message);
    }
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
            autoComplete="off"
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
              <th scope="col" className="px-4 py-3">User</th>
              <th scope="col" className="px-4 py-3">Permissions</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
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
                <td className="px-4 py-3"><span className="font-mono text-xs text-zinc-400">{su.permissions?.join(', ') || 'none'}</span></td>
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
      const a = document.createElement('a');
      a.href = api.downloadBackup(b.id);
      a.download = `${b.name}.tar.gz`;
      a.click();
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
    try {
      await api.deleteBackup(b.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">Backups are stored on the node. Limit: {server.backups}.</p>
        <button className="btn-primary !py-1.5 text-xs" onClick={create}><Icons.Plus className="h-3.5 w-3.5" /> New Backup</button>
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Size</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Created</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No backups yet.</td></tr>}
            {backups.map((b) => (
              <tr key={b.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-white">{b.name}</td>
                <td className="px-4 py-3 text-zinc-400">{((b.size_bytes || 0) / 1024 / 1024).toFixed(2)} MB</td>
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
        </div>
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
                <span className="text-lg" aria-hidden="true">{actionIcons[l.action] || '•'}</span>
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
  const [showSftpPassword, setShowSftpPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.network(server.id).then((d) => setAllocations(d.allocations)).catch((e) => setError(e.message));
    api.sftp(server.id).then(setSftp).catch((e) => setError(e.message));
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th scope="col" className="px-4 py-3">IP</th>
                <th scope="col" className="px-4 py-3">Port</th>
                <th scope="col" className="px-4 py-3">Node</th>
              </tr>
            </thead>
            <tbody>
              {allocations.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">No allocations.</td></tr>}
              {allocations.map((a) => (
                <tr key={a.id} className="border-b border-white/[0.06] last:border-0">
                  <td className="px-4 py-3 font-mono text-zinc-300">{a.ip && a.ip !== '0.0.0.0' ? a.ip : (server.node_fqdn || a.ip)}</td>
                  <td className="px-4 py-3 font-mono text-white">{a.port}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.node_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
                  <input className="input font-mono" type={showSftpPassword ? 'text' : 'password'} value={sftp.password} readOnly />
                  <button className="btn-ghost !px-3" onClick={() => setShowSftpPassword((v) => !v)} title={showSftpPassword ? 'Hide password' : 'Show password'} aria-label={showSftpPassword ? 'Hide password' : 'Show password'} aria-pressed={showSftpPassword}><Icons.EyeOff className="h-4 w-4" /></button>
                  <button className="btn-ghost !px-3" onClick={() => navigator.clipboard.writeText(sftp.password)} title="Copy" aria-label="Copy password"><Icons.Copy className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
            <p className="text-xs text-zinc-500">Connect with any SFTP client (FileZilla, WinSCP). You are chrooted to this server's files.</p>
            <button className="btn-ghost !py-1.5 text-xs" onClick={rotateSftp}>Rotate password</button>
          </Card>
        ) : (
          <Card className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-48" />
          </Card>
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
    const ab = new AbortController();
    let ignore = false;
    api.server(id, { signal: ab.signal })
      .then((d) => { if (!ignore) setServer(d.server); })
      .catch((e) => { if (!ignore && e.name !== 'AbortError') setError(e.message); });
    return () => { ignore = true; ab.abort(); };
  }, [id]);

  useEffect(() => {
    if (!server) return;
    const controller = new AbortController();
    let mounted = true;
    function load() {
      if (document.hidden) return;
      api.resources(server.id, { signal: controller.signal })
        .then((d) => { if (mounted) setResources(d); })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 2000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [server?.id]);

  const tabs = useMemo(() => [
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
  ], []);

  const address = server?.allocation_port
    ? `${(server?.allocation_ip && server.allocation_ip !== '0.0.0.0') ? server.allocation_ip : (server?.node_fqdn || '0.0.0.0')}:${server.allocation_port}`
    : server?.node_fqdn;

  const memLimitMb = resources?.memory_limit_mb || server?.memory_mb || 1;
  const diskLimitMb = resources?.disk_limit_mb || server?.disk_mb || 1;
  const isOffline = server?.status !== 'running';

  const statCards = useMemo(() => resources ? [
    { icon: <Icons.Node className="h-5 w-5" />, label: 'Address', value: address, sub: server?.node_fqdn, copy: address },
    { icon: <Icons.Clock className="h-5 w-5" />, label: 'Uptime', value: isOffline ? 'Offline' : formatUptime(resources.uptime_seconds) },
    { icon: <Icons.Cpu className="h-5 w-5" />, label: 'CPU Load', value: isOffline ? '—' : `${resources.cpu}%`, sub: isOffline ? undefined : `/ ${server?.cpu}%`, bar: isOffline ? 0 : (resources.cpu / server?.cpu) * 100 },
    { icon: <Icons.Ram className="h-5 w-5" />, label: 'Memory', value: isOffline ? '—' : formatMemory(resources.memory_mb), sub: isOffline ? undefined : `/ ${formatMemory(memLimitMb)}`, bar: isOffline ? 0 : (resources.memory_mb / memLimitMb) * 100 },
    { icon: <Icons.Disk className="h-5 w-5" />, label: 'Disk', value: isOffline ? '—' : formatMemory(resources.disk_mb), sub: isOffline ? undefined : `/ ${formatMemory(diskLimitMb)}`, bar: isOffline ? 0 : (resources.disk_mb / diskLimitMb) * 100 },
    { icon: <Icons.CloudDown className="h-5 w-5" />, label: 'Network (In)', value: isOffline ? '—' : `${resources.network_rx_mb} MiB` },
    { icon: <Icons.CloudUp className="h-5 w-5" />, label: 'Network (Out)', value: isOffline ? '—' : `${resources.network_tx_mb} MiB` },
  ] : [], [resources, address, server?.node_fqdn, server?.cpu, memLimitMb, diskLimitMb, isOffline]);

  if (error) return <ErrorState title="Failed to load server" sub={error} onRetry={() => window.location.reload()} />;
  if (!server) {
    return (
      <div>
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="mb-6 h-4 w-64" />
        <div className="mb-4 flex flex-wrap gap-2">
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-24" />
        </div>
        <div className="mb-4 flex gap-1 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-24 shrink-0" />
          ))}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

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
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/5 ring-1 ring-white/10">
          <Icons.Server className="h-5 w-5 text-violet-300" />
        </span>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <span className="truncate">{server.name}</span>
            <StatusBadge status={server.status} />
          </h1>
          <p className="text-xs text-zinc-500">
            {server.egg_name} · {server.memory_mb}MB · {server.cpu}% CPU · <span className="font-mono">{server.identifier}</span>
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {server.status === 'running' ? (
          <button className="btn-ghost min-h-[44px]" onClick={() => power('stop')}><Icons.Stop className="h-4 w-4" /> Stop</button>
        ) : (
          <button className="btn-primary min-h-[44px]" onClick={() => power('start')} disabled={server.status === 'installing'}><Icons.Play className="h-4 w-4" /> Start</button>
        )}
        <button className="btn-ghost min-h-[44px]" onClick={() => power('restart')} disabled={server.status === 'installing'}><Icons.Restart className="h-4 w-4" /> Restart</button>
        <button className="btn-danger min-h-[44px]" onClick={() => power('kill')}><Icons.Kill className="h-4 w-4" /> Kill</button>
      </div>

      <div className={cn('mb-4 flex gap-1 overflow-x-auto border-b border-white/[0.06]', 'scrollbar-none')}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-white'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-3', tab !== 'console' && 'hidden')}>
        <div className="lg:col-span-2">
          <ConsoleTab server={server} />
        </div>
        <div className="space-y-3">
          {!resources && (
            <div className="space-y-3">
              {[...Array(7)].map((_, i) => (
                <Card key={i} className="flex h-[88px] items-center gap-3 p-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                </Card>
              ))}
            </div>
          )}
          {statCards.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
        </div>
      </div>
      {tab !== 'console' && (
        <>
          {tab === 'files' && <FilesTab server={server} />}
          {tab === 'databases' && <DatabasesTab server={server} />}
          {tab === 'schedules' && <SchedulesTab server={server} />}
          {tab === 'users' && <UsersTab server={server} />}
          {tab === 'backups' && <BackupsTab server={server} />}
          {tab === 'network' && <NetworkTab server={server} />}
          {tab === 'startup' && <StartupTab server={server} />}
          {tab === 'activity' && <ActivityTab server={server} />}
          {tab === 'settings' && <SettingsTab server={server} onDeleted={() => navigate('/')} />}
        </>
      )}
    </div>
  );
}
