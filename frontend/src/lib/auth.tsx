import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi, tokenStorage } from "@/lib/api";
import type { User } from "@/lib/types";

function withInitials(user: User): User {
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return { ...user, initials: initials || "U" };
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  function setUser(nextUser: User | null) {
    setUserState(nextUser ? withInitials(nextUser) : null);
  }

  // Ao carregar o app (ex: F5), tenta restaurar a sessão a partir do
  // refreshToken salvo — se não houver, ou se estiver expirado/revogado,
  // segue como deslogado sem erro visível pro usuário.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!tokenStorage.getRefreshToken()) {
        setLoading(false);
        return;
      }
      try {
        // `me()` sem accessToken em memória vai bater 401 -> o interceptor
        // do api.ts já tenta o refresh automaticamente antes de desistir.
        const profile = await authApi.me();
        if (!cancelled) setUser(profile);
      } catch {
        tokenStorage.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => { cancelled = true; };
  }, []);

  async function login(email: string, password: string) {
    const profile = await authApi.login({ email, password });
    setUser(profile);
    return profile;
  }

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, setUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
