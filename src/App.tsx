/**
 * RIQ 21 — Roofing IQ entry shell.
 *
 * Pure intel platform. No storm-map UI, no legacy dashboard, no shared-report
 * route — all of that lived in `LegacyApp.tsx` and has been retired.
 * The Hail Yes product (hailyes.up.railway.app) handles storm maps + radar.
 */
import { useEffect } from 'react';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { IntelligenceHub } from './components/IntelligenceHub';
import { UserProvider } from './auth/UserProvider';

const TOKEN_KEY = 'hailyes_token'; // kept for backcompat with server sessions
const USER_KEY = 'hailyes_user';

// One-shot admin bootstrap so /api/intel/* + /api/admin/* work without a PIN
// prompt. Silent on failure — IntelligenceHub renders anonymously either way.
function useAdminBootstrap() {
  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY) && localStorage.getItem(USER_KEY)) return;
    let cancelled = false;
    (async () => {
      try {
        const storedPin = localStorage.getItem('hailyes_bootstrap_pin') ?? '';
        const url = storedPin
          ? `/api/auth/admin-bootstrap?pin=${encodeURIComponent(storedPin)}`
          : '/api/auth/admin-bootstrap';
        const res = await fetch(url);
        if (!res.ok) {
          if (storedPin) localStorage.removeItem('hailyes_bootstrap_pin');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data?.token && data?.user) {
          localStorage.setItem(TOKEN_KEY, data.token);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
      } catch {
        // Non-fatal — UI keeps rendering anonymously.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

export default function App() {
  useAdminBootstrap();
  return (
    <ErrorBoundary>
      <UserProvider>
        <IntelligenceHub />
      </UserProvider>
    </ErrorBoundary>
  );
}
