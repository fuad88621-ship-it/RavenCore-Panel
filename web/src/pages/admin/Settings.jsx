import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, SectionHeader, Select } from '../../components/ui.jsx';

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

  useEffect(() => {
    api.admin.settings().then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
  }, []);

  async function save() {
    try {
      await api.admin.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
    </div>
  );
}
