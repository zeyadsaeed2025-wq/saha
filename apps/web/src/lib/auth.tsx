import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.js';
import type { Me } from '../types.js';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (organizationId: string) => Promise<void>;
  seedDemo: () => Promise<{ adminPhone: string; adminPassword: string }>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe(null);
      else throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (phone: string, password: string) => {
    await api('/auth/login', { method: 'POST', body: { phone, password } });
    await refresh();
  }, [refresh]);

  const register = useCallback(async (name: string, phone: string, password: string) => {
    await api('/auth/register', { method: 'POST', body: { name, phone, password } });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setMe(null);
  }, []);

  const switchOrg = useCallback(async (organizationId: string) => {
    await api('/auth/session/org', { method: 'POST', body: { organizationId } });
    await refresh();
  }, [refresh]);

  const seedDemo = useCallback(async () => {
    const result = await api<{ adminPhone: string; adminPassword: string; alreadySeeded: boolean }>(
      '/demo/seed', { method: 'POST' });
    await login(result.adminPhone, result.adminPassword);
    return result;
  }, [login]);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, login, register, logout, switchOrg, seedDemo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
