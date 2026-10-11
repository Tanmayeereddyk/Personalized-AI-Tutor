import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, clearToken, getToken, setToken } from "./api";

/**
 * Real authentication, backed by the FastAPI + Supabase backend.
 *
 * The access token lives in localStorage and is attached to every API
 * call by src/lib/api.ts. On mount we re-validate it with /api/auth/me so
 * a stale or revoked token never leaves the UI in a "logged in" state.
 * The cached query data is cleared whenever the signed-in user changes,
 * so one account can never see another account's courses.
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface SignupOutcome {
  error?: string;
  confirmationRequired?: boolean;
  message?: string;
}

interface Auth {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  signup: (name: string, email: string, password: string) => Promise<SignupOutcome>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  // Restore the session on first load.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const me = await api.auth.me();
        if (active) setUser(me);
      } catch {
        clearToken();
        if (active) setUser(null);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop all cached data whenever the account changes (login / logout / switch).
  useEffect(() => {
    if (previousUserId.current !== (user?.id ?? null)) {
      queryClient.clear();
      previousUserId.current = user?.id ?? null;
    }
  }, [user, queryClient]);

  const login: Auth["login"] = async (email, password) => {
    try {
      const me = await api.auth.login(email, password);
      setUser(me);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Could not sign in.";
    }
  };

  const signup: Auth["signup"] = async (name, email, password) => {
    try {
      const result = await api.auth.signup(name, email, password);
      if (!result.accessToken) {
        // Email confirmation is enabled: no session until the link is clicked.
        return { confirmationRequired: true, message: result.message };
      }
      setUser(result.user);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not create your account." };
    }
  };

  const logout: Auth["logout"] = async () => {
    await api.auth.logout();
    clearToken();
    setUser(null);
  };

  const value: Auth = { user, ready, login, signup, logout };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth must be used inside AuthProvider");
  return a;
}

// Re-export so callers that only need the token helpers stay simple.
export { setToken };
