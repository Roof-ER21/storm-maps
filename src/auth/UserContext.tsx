/**
 * UserContext — the authenticated-user context object + `useUser` hook (the
 * client's single source of truth for the logged-in user). The provider
 * component lives in ./UserProvider, split out so each file exports only
 * components OR only non-components (react-refresh / Fast Refresh).
 */
import { createContext, useContext } from "react";
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

export interface UserContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  markWelcomeSeen: () => Promise<void>;
}

export const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  markWelcomeSeen: async () => {},
});

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
