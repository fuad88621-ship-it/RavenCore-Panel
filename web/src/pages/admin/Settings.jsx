import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Card, Icons, SectionHeader, Select, useToast } from '../../components/ui.jsx';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

const FIELDS = [
  { key: 'app.name', label: 'Panel name', type: 'text' },
  { key: 'app.description', label: 'Panel description', type: 'text' },
  { key: 'app.url', label: 'Panel URL', type: 'text' },
  { key: 'app.timezone', label: 'Timezone', type: 'text' },
  { key: 'app.locale', label: 'Locale', type: 'text' },
  { key: 'panel.registration', label: 'Allow registration', type: 'select', options: ['true', 'false'] },
  { key: 'panel.announcement', label: 'Announcement banner', type: 'textarea' },
  { key: 'panel.logo_url', label: 'Logo URL (optional)', type: 'text', placeholder: 'https://example.com/logo.png' },
  { key: 'panel.favicon_url', label: 'Favicon URL (optional)', type: 'text', placeholder: 'https://example.com/favicon.ico' },
  { key: 'panel.primary_color', label: 'Primary color (hex)', type: 'text', placeholder: '#8b5cf6' },
  { key: 'panel.accent_color', label: 'Accent color (hex)', type: 'text', placeholder: '#d946ef' },
];

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [backups, setBackups] = useState([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const savedTimer = useRef(null);
  const toast = useToast();

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  useEffect(() => {
    api.admin.settings().then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
    loadBackups();
  }, []);

  async function loadBackups() {
    try {
      const d = await api.admin.listBackups();
      setBackups(d.backups || []);
    } catch (e) {
      // ignore — backup agent may not be reachable yet
    }
  }

  async function createBackup() {
    setBackupBusy(true);
    setBackupError('');
    try {
      await api.admin.createBackup();
      await loadBackups();
    } catch (e) {
      setBackupError(e.message);
    } finally {
      setBackupBusy(false);
    }
  }

  async function save() {
    try {
      await api.admin.updateSettings(settings);
      setSaved(true);
      toast.push('Settings saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="max-w-2xl">
      <SectionHeader title="Settings" sub="Panel-wide configuration." />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <Card className="space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            {f.type === 'select' ? (
              <Select value={String(settings[f.key] ?? '')} onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : f.type === 'textarea' ? (
              <textarea className="input" rows={3} value={settings[f.key] || ''} onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))} />
            ) : (
              <input className="input" value={settings[f.key] || ''} placeholder={f.placeholder || ''} onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))} />
            )}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Save settings</button>
          {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
        </div>
      </Card>

      <Card className="mt-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Full panel backup</h3>
          <p className="text-sm text-zinc-500">
            Creates a complete archive of your panel: databases, server containers, config files and secrets.
            Download it and store it somewhere safe. To migrate, install RavenCore on a new VPS, run the restore script
            with the archive, then point your domain DNS to the new IP.
          </p>
        </div>
        {backupError && <p className="text-sm text-red-400">{backupError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={createBackup} disabled={backupBusy}>
            {backupBusy ? 'Creating backup…' : <><Icons.Save className="h-4 w-4" /> Create backup</>}
          </button>
        </div>
        {backups.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Available backups</p>
            {backups.map((b) => (
              <div key={b.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{b.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(b.size_bytes)} · {new Date(b.created_at).toLocaleString()}</p>
                </div>
                <a href={api.admin.downloadBackup(b.name)} className="btn-ghost !py-1.5 text-xs shrink-0" download>Download</a>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
