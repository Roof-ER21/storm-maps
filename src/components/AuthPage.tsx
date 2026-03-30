import { useState } from 'react';

interface AuthPageProps {
  onAuth: () => void;
  onBack: () => void;
  initialMode?: 'login' | 'signup';
}

export default function AuthPage({ onAuth, onBack, initialMode = 'signup' }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = mode === 'signup'
        ? { email, name, password }
        : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      // Store token
      localStorage.setItem('hail-yes:auth-token', data.token);
      localStorage.setItem('hail-yes:auth-user', JSON.stringify(data.user));
      onAuth();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white font-bold text-xl mb-4">H!</div>
          <h1 className="text-2xl font-bold text-white">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {mode === 'signup' ? 'Start your free 14-day trial' : 'Log in to your Hail Yes! account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-800 bg-slate-950 p-6 sm:p-8">
          {mode === 'signup' && (
            <div className="mb-4">
              <label htmlFor="auth-name" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Full Name</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="John Smith"
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none"
              />
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="auth-email" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="auth-password" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="6+ characters"
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Log In'}
          </button>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="text-sm text-slate-400 hover:text-white"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          </div>
        </form>

        <button type="button" onClick={onBack} className="mt-4 w-full text-center text-xs text-slate-600 hover:text-slate-400">
          Back to home
        </button>
      </div>
    </div>
  );
}
