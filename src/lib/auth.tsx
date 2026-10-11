import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "./api";

/**
 * Authentication context backed by the FastAPI backend:
 *
 *   POST /api/auth/signup   -> create the account (Supabase Auth)
 *   POST /api/auth/login    -> email/password sign-in, returns a token
 *   GET  /api/auth/me       -> validate the stored token, load profile
 *   POST /api/auth/logout   -> revoke the token at Supabase
 *
 * Only the access token is kept in localStorage. Passwords are
 * sent straight to the backend (which forwards them to Supabase
 * Auth) and are never stored on the client.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
}

export type AuthResult =
  { ok: true } | { ok: false; error: string; fields: Record<string, string> };

export type SignupResult =
  | { ok: true; requiresEmailConfirmation: true; message: string }
  | { ok: true; requiresEmailConfirmation: false }
  | { ok: false; error: string; fields: Record<string, string> };

interface Auth {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (name: string, email: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
}

/** Backend response shapes (see app/schemas/auth.py). */
interface AuthUserPayload {
  id: string;
  email: string | null;
}
interface SessionPayload {
  access_token: string;
  token_type: string;
  user: AuthUserPayload;
}
interface SignupPayload {
  message: string;
  user: AuthUserPayload;
  access_token: string | null;
  token_type: string;
}
interface ProfilePayload {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface MePayload {
  user: AuthUserPayload;
  profile: ProfilePayload | null;
}
interface MessagePayload {
  message: string;
}

const TOKEN_KEY = "studyai.access_token";

const Ctx = createContext<Auth | null>(null);

const readToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const writeToken = (token: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
};

const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

const toAuthUser = (payload: MePayload): AuthUser => ({
  id: payload.user.id,
  email: payload.user.email,
  name: payload.profile?.full_name ?? payload.user.email ?? "Student",
});

const toFailure = (
  error: unknown,
): { ok: false; error: string; fields: Record<string, string> } => {
  if (error instanceof ApiError)
    return { ok: false, error: error.message, fields: error.fields ?? {} };
  if (error instanceof Error) return { ok: false, error: error.message, fields: {} };
  return { ok: false, error: "Something went wrong. Please try again.", fields: {} };
};

/** Validate the stored token and load the current user (null if signed out). */
const fetchMe = async (): Promise<AuthUser | null> => {
  const token = readToken();
  if (!token) return null;
  try {
    const payload = await apiRequest<MePayload>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return toAuthUser(payload);
  } catch {
    // Missing, invalid or expired token: treat as signed out.
    clearToken();
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Restore the session from the stored token (client-only, after mount).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await fetchMe();
      if (!cancelled) {
        setUser(me);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: Auth = {
    user,
    ready,
    login: async (email, password) => {
      try {
        const session = await apiRequest<SessionPayload>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        writeToken(session.access_token);
        setUser(await fetchMe());
        return { ok: true };
      } catch (error) {
        return toFailure(error);
      }
    },
    signup: async (name, email, password) => {
      try {
        const result = await apiRequest<SignupPayload>("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password, full_name: name }),
        });
        // With email confirmation enabled Supabase returns no session,
        // so the user must confirm before signing in.
        if (!result.access_token) {
          return { ok: true, requiresEmailConfirmation: true, message: result.message };
        }
        writeToken(result.access_token);
        setUser(await fetchMe());
        return { ok: true, requiresEmailConfirmation: false };
      } catch (error) {
        return toFailure(error);
      }
    },
    logout: async () => {
      const token = readToken();
      // Clear the local session first, then revoke the token server-side.
      clearToken();
      setUser(null);
      if (!token) return;
      try {
        await apiRequest<MessagePayload>("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Local session is already cleared; revocation failing
        // (e.g. an expired token) is not fatal.
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth must be used inside AuthProvider");
  return a;
}
