import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClientError, availableRoles, type AppRole, type LoginInput, type RegisterInput, type UserDto } from '@krevia/shared';
import { api, onApiUnauthenticated, setApiToken } from './api';
import { tokenStore } from './token-store';

export type SessionState =
  | { status: 'restoring' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: UserDto }
  /** A stored token exists but the server could not be reached to validate it. */
  | { status: 'offline'; error: ApiClientError };

interface SessionContextValue {
  state: SessionState;
  user: UserDto | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserDto) => void;
  retryRestore: () => Promise<void>;
  /** Experience currently shown (Resident / Admin / Guard). */
  role: AppRole;
  roles: AppRole[];
  setRole: (role: AppRole) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'restoring' });
  const [chosenRole, setRole] = useState<AppRole | null>(null);

  const clearLocal = useCallback(async () => {
    setApiToken(null);
    await tokenStore.clear().catch(() => {});
    setState({ status: 'signedOut' });
  }, []);

  const restore = useCallback(async () => {
    setState({ status: 'restoring' });
    // An unreadable secure store (e.g. keychain unavailable) must not block launch: treat as signed out.
    const token = await tokenStore.get().catch(() => null);
    if (!token) {
      setState({ status: 'signedOut' });
      return;
    }
    setApiToken(token);
    try {
      const { user } = await api.me();
      setState({ status: 'signedIn', user });
    } catch (err) {
      const e = err as ApiClientError;
      if (e.isNetwork) setState({ status: 'offline', error: e });
      else await clearLocal();
    }
  }, [clearLocal]);

  useEffect(() => {
    // Any 401 from the API (expired or revoked session) signs the user out locally.
    onApiUnauthenticated(() => void clearLocal());
    void restore();
    return () => onApiUnauthenticated(null);
  }, [restore, clearLocal]);

  const start = useCallback(async (res: { user: UserDto; token?: string }) => {
    if (!res.token) throw new ApiClientError(500, 'INTERNAL', 'Sign-in failed. Please try again.');
    await tokenStore.set(res.token);
    setApiToken(res.token);
    setState({ status: 'signedIn', user: res.user });
  }, []);

  const roles = useMemo<AppRole[]>(
    () => (state.status === 'signedIn' ? availableRoles(state.user) : ['RESIDENT']),
    [state],
  );
  const role: AppRole = chosenRole && roles.includes(chosenRole) ? chosenRole : roles[0]!;

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      user: state.status === 'signedIn' ? state.user : null,
      login: async (input) => start(await api.login(input)),
      register: async (input) => start(await api.register(input)),
      logout: async () => {
        try {
          await api.logout();
        } catch {
          // Local sign-out still happens; the server session expires on its own.
        }
        setRole(null);
        await clearLocal();
      },
      setUser: (user) => setState({ status: 'signedIn', user }),
      retryRestore: restore,
      role,
      roles,
      setRole,
    }),
    [state, start, clearLocal, restore, role, roles],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
