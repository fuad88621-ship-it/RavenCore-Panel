import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { useAuth, useSettings } from '../App.jsx';
import { Icons } from '../components/ui.jsx';
export default function Login() {
  const settings = useSettings();
  const registrationOpen = settings['panel.registration'] !== 'false';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.login(identifier, password);
      setUser(d.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/10 ring-1 ring-white/10">
            <Icons.Server className="h-8 w-8 text-violet-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-zinc-500">Log in to manage your servers.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#08080a]/80 p-6 backdrop-blur-xl">
          <div>
            <label className="label">Username or email</label>
            <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {registrationOpen ? (
            <>No account?{' '}
            <Link to="/register" className="font-medium text-violet-400 hover:text-violet-300">Create one</Link></>
          ) : (
            'Registration is disabled by the administrator.'
          )}
        </p>
      </motion.div>
    </div>
  );
}
