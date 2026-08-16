import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { useAuth, useSettings } from '../App.jsx';
import { Icons } from '../components/ui.jsx';

export default function Login() {
  const settings = useSettings();
  const [liveSettings, setLiveSettings] = useState(null);
  useEffect(() => {
    api.settings().then((d) => setLiveSettings(d.settings)).catch(() => {});
  }, []);
  const effective = liveSettings || settings;
  const registrationOpen = effective['panel.registration'] !== 'false';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="relative flex min-h-screen w-full items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Logo + greeting */}
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mb-5 inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600/40 via-violet-500/20 to-fuchsia-500/20 ring-1 ring-white/10 shadow-[0_0_40px_rgb(139_92_246/0.25)]"
          >
            <Icons.Server className="h-10 w-10 text-violet-200" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Welcome back
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-2 text-sm text-zinc-400"
          >
            Sign in to manage your servers.
          </motion.p>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0b0b0f]/80 p-7 shadow-2xl backdrop-blur-2xl sm:p-8"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
          <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />

          <form onSubmit={submit} className="relative space-y-5">
            {/* Identifier */}
            <div className="group">
              <label htmlFor="identifier" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 transition-colors group-focus-within:text-violet-400">
                Username or email
              </label>
              <div className="relative">
                <Icons.User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-violet-400" />
                <input
                  id="identifier"
                  className="input !rounded-xl !bg-white/[0.04] !py-3 !pl-10"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="group">
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 transition-colors group-focus-within:text-violet-400">
                Password
              </label>
              <div className="relative">
                <Icons.Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-violet-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input !rounded-xl !bg-white/[0.04] !py-3 !pl-10 !pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300 focus:text-violet-400"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <Icons.EyeOff className="h-4 w-4" /> : <Icons.Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-200"
              >
                <Icons.Exclamation className="h-4 w-4 shrink-0" />
                {error}
              </motion.div>
            )}

            <button
              className="btn-primary w-full !rounded-xl !py-3 text-base font-semibold shadow-[0_0_32px_rgb(139_92_246/0.35)]"
              disabled={busy}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in…
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-6 text-center text-sm text-zinc-500"
        >
          {registrationOpen ? (
            <>
              No account?{' '}
              <Link to="/register" className="font-semibold text-violet-400 transition hover:text-violet-300">
                Create one
              </Link>
            </>
          ) : (
            'Registration is disabled by the administrator.'
          )}
        </motion.p>
      </motion.div>
    </div>
  );
}
