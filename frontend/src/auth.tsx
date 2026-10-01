import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

export type Role = "admin" | "office" | "labour";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: string;
};

type AuthState = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function apiFetch(path: string, opts: RequestInit = {}, token?: string | null) {
  const headers: Record<string, string> = {
    ...(opts.headers as any),
  };
  if (!(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { detail: text };
  }
  if (!res.ok) {
    const msg = json?.detail || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return json;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem("st.token");
        const u = await AsyncStorage.getItem("st.user");
        if (t && u) {
          setToken(t);
          setUser(JSON.parse(u));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await AsyncStorage.setItem("st.token", res.token);
    await AsyncStorage.setItem("st.user", JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove(["st.token", "st.user"]);
    setToken(null);
    setUser(null);
    router.replace("/login");
  }, []);

  return (
    <Ctx.Provider value={{ user, token, loading, login, logout }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export function fileUrl(path: string, token: string | null) {
  if (!path) return "";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${BASE}/api/files/${encoded}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}
