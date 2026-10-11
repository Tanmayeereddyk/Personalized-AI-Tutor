import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Mock frontend auth backed by localStorage. Replace login/signup/logout
 * with calls to a real auth provider later; the UI only uses this interface.
 */
export interface AuthUser {
  name: string;
  email: string;
}
interface Account extends AuthUser {
  password: string;
}

interface Auth {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => string | null;
  signup: (name: string, email: string, password: string) => string | null;
  loginWithGoogle: () => void;
  logout: () => void;
}

const SESSION = "studyai.session";
const ACCOUNTS = "studyai.accounts";
const Ctx = createContext<Auth | null>(null);

const readAccounts = (): Account[] => {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS) ?? "[]");
  } catch {
    return [];
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SESSION);
      if (s) setUser(JSON.parse(s));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const start = (u: AuthUser) => {
    localStorage.setItem(SESSION, JSON.stringify(u));
    setUser(u);
  };

  const value: Auth = {
    user,
    ready,
    login: (email, password) => {
      const acc = readAccounts().find((a) => a.email.toLowerCase() === email.toLowerCase());
      if (!acc || acc.password !== password) return "Incorrect email or password.";
      start({ name: acc.name, email: acc.email });
      return null;
    },
    signup: (name, email, password) => {
      const accounts = readAccounts();
      if (accounts.some((a) => a.email.toLowerCase() === email.toLowerCase()))
        return "An account with this email already exists.";
      localStorage.setItem(ACCOUNTS, JSON.stringify([...accounts, { name, email, password }]));
      start({ name, email });
      return null;
    },
    loginWithGoogle: () => start({ name: "Student", email: "student@gmail.com" }),
    logout: () => {
      localStorage.removeItem(SESSION);
      setUser(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth must be used inside AuthProvider");
  return a;
}
