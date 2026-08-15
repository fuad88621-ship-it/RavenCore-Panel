import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Badge, Card, GlowButton, Icons, SectionHeader, cn, useConfirm, useToast } from '../../components/ui.jsx';

export default function Users() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', root_admin: false });
  const [error, setError] = useState('');
  const confirm = useConfirm();

  async function load() {
    try {
      const d = await api.admin.users();
      setUsers(d.users);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.admin.createUser(form);
      setForm({ username: '', email: '', password: '', root_admin: false });
      setShowForm(false);
      toast.push('User created');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAdmin(u) {
    await api.admin.updateUser(u.id, { root_admin: !u.root_admin });
    load();
  }

  async function toggleSuspend(u) {
    await api.admin.updateUser(u.id, { suspended: !u.suspended });
    load();
  }

  async function remove(u) {
    if (!await confirm(`Delete user ${u.username}? This deletes all their servers.`)) return;
    try {
      await api.admin.deleteUser(u.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Users"
        sub="Manage panel accounts."
        action={<GlowButton onClick={() => setShowForm(!showForm)}><Icons.Plus className="h-4 w-4" /> New User</GlowButton>}
      />
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={create} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><label className="label">Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-zinc-300 pb-2">
                <input type="checkbox" checked={form.root_admin} onChange={(e) => setForm({ ...form, root_admin: e.target.checked })} className="accent-violet-500" />
                Admin
              </label>
            </div>
            <div className="col-span-4"><button className="btn-primary">Create user</button></div>
          </form>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-4 py-3">User</th>
              <th scope="col" className="px-4 py-3">Email</th>
              <th scope="col" className="px-4 py-3">Servers</th>
              <th scope="col" className="px-4 py-3">Role</th>
              <th scope="col" className="px-4 py-3">Created</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <span className="font-medium text-white">{u.username}</span>
                  {u.suspended && <Badge tone="red" className="ml-2">suspended</Badge>}
                </td>
                <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                <td className="px-4 py-3">{u.server_count}</td>
                <td className="px-4 py-3">
                  <Badge tone={u.root_admin ? 'violet' : 'zinc'}>{u.root_admin ? 'Admin' : 'User'}</Badge>
                </td>
                <td className="px-4 py-3 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => toggleAdmin(u)}>{u.root_admin ? 'Demote' : 'Promote'}</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs mr-1" onClick={() => toggleSuspend(u)}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                  <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => remove(u)}>Delete</button>
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
