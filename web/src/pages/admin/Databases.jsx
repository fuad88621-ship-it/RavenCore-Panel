import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, SectionHeader, useConfirm } from '../../components/ui.jsx';

export default function Databases() {
  const [databases, setDatabases] = useState([]);
  const confirm = useConfirm();
  const [error, setError] = useState('');

  async function load() {
    try {
      const d = await api.admin.databases();
      setDatabases(d.databases);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(db) {
    if (!await confirm(`Delete database ${db.database_name}? This cannot be undone.`)) return;
    await api.admin.deleteDatabase(db.id);
    load();
  }

  async function rotate(db) {
    await api.admin.rotateDatabase(db.id);
    load();
  }

  return (
    <div>
      <SectionHeader title="Databases" sub="All MySQL databases across the panel." />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">Database</th>
              <th scope="col" className="px-4 py-3">Server</th>
              <th scope="col" className="px-4 py-3">Owner</th>
              <th scope="col" className="px-4 py-3">Username</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {databases.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No databases yet.</td></tr>
            )}
            {databases.map((db) => (
              <tr key={db.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-white">{db.database_name}</td>
                <td className="px-4 py-3 text-zinc-400">{db.server_name} <span className="text-zinc-600">({db.server_identifier})</span></td>
                <td className="px-4 py-3 text-zinc-400">{db.owner_username}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">{db.username}</td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-ghost !px-3 !py-1 text-xs mr-2" onClick={() => rotate(db)}>Rotate</button>
                  <button className="btn-danger !px-3 !py-1 text-xs" onClick={() => remove(db)}>Delete</button>
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
