/**
 * UserContext — single source of truth for the authenticated user on the
 * client. Fetches `/api/auth/me` on mount and exposes the result via
 * `useUser()`. Falls back gracefully when unauthenticated.
 *
 * The legacy admin-bootstrap flow in App.tsx still primes localStorage; this
 * provider just reads `/api/auth/me` over the resulting session cookie.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "./roles";

export interface User {
  id: number;
  email: string;
  display_name: string | null;
  role: Role;
  is_root_admin: boolean;
  pin_length: 4 | 6;
  welcome_seen_at?: string | null;
}

interface UserContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  markWelcomeSeen: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  markWelcomeSeen: async () => {},
});

async function fetchMe(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const u = await fetchMe();
    setUser(u);
    setLoading(false);
  };

  const markWelcomeSeen = async () => {
    try {
      await fetch("/api/auth/welcome-seen", { method: "POST", credentials: "include" });
    } catch {
      // Non-fatal — modal still closes; flag retries on next mount.
    }
    setUser((prev) => (prev ? { ...prev, welcome_seen_at: new Date().toISOString() } : prev));
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, refresh, markWelcomeSeen }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
