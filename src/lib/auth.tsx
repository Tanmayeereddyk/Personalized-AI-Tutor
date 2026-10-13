import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, clearSession, getToken, setToken, setUnauthorizedHandler } from "./api";
import { clearTutorChatHistory } from "./tutor-chat-storage";

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
  updateProfile: (fullName: string) => Promise<string | null>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  // A 401 from any authenticated request means the stored token is no longer
  // valid. End the session (the token itself is already cleared by api.ts) so
  // the route guard cleans up and sends the user back to /login, rather than
  // leaving the UI "signed in" with no token — which surfaces as
  // "Not authenticated" on every page.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

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
        clearSession();
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
      const loggedInUser = await api.auth.login(email, password);
      // The login payload only contains the auth identity (id + email); the
      // profile (with the display name) lives behind /api/auth/me. Fetch it
      // so the greeting and sidebar show the real name right after signing in.
      try {
        setUser(await api.auth.me());
      } catch {
        // Session is valid; the profile fetch is best-effort.
        setUser(loggedInUser);
      }
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
      clearTutorChatHistory();
      setUser(result.user);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not create your account." };
    }
  };

  const logout: Auth["logout"] = async () => {
    await api.auth.logout();
    clearSession();
    clearTutorChatHistory();
    setUser(null);
  };

  const updateProfile: Auth["updateProfile"] = async (fullName) => {
    try {
      setUser(await api.auth.updateProfile(fullName));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Could not update your profile.";
    }
  };

  const value: Auth = {
    user,
    ready,
    login,
    signup,
    logout,
    updateProfile,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth must be used inside AuthProvider");
  return a;
}

// Re-export so callers that only need the token helpers stay simple.
export { setToken };
