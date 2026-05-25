/**
 * UserProvider — the auth provider component. Split out of UserContext.tsx so that
 * file exports only the context + `useUser` hook (non-components) and this file
 * exports only the component (react-refresh / Fast Refresh).
 */
import { useEffect, useState, type ReactNode } from "react";
import { UserContext, type User } from "./UserContext";

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
