import { createContext, useContext, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { setAuthBridge } from '../api/http';

type AuthCtx = {
  accessToken: string;
  refreshToken: string;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshOnce: () => Promise<boolean>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  const refreshOnce = async () => {
    try {
      if (!refreshToken) return false;
      const t = await authApi.refresh(refreshToken);
      setAccessToken(t.accessToken);
      setRefreshToken(t.refreshToken || refreshToken);
      return true;
    } catch {
      setAccessToken('');
      setRefreshToken('');
      return false;
    }
  };

  const value = useMemo<AuthCtx>(() => ({
    accessToken,
    refreshToken,
    login: async (email, password) => {
      const t = await authApi.login(email, password);
      setAccessToken(t.accessToken);
      setRefreshToken(t.refreshToken || '');
    },
    signup: async (email, password) => {
      const t = await authApi.signup(email, password);
      setAccessToken(t.accessToken);
      setRefreshToken(t.refreshToken || '');
    },
    logout: () => { setAccessToken(''); setRefreshToken(''); },
    refreshOnce
  }), [accessToken, refreshToken]);

  setAuthBridge({
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    setTokens: (t) => { setAccessToken(t.accessToken); if (t.refreshToken) setRefreshToken(t.refreshToken); },
    clear: () => { setAccessToken(''); setRefreshToken(''); },
    refreshOnce
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuthContext() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
