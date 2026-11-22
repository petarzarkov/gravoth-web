import type { SessionView, SignInMethod } from '@gravoth/contracts';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.js';

/**
 * Who is signed in, from better-auth's `get-session` (the session cookie), and
 * which sign-in methods the server offers. `refresh` after a sign-in or out.
 */
interface SessionState {
  /** Undefined while the first check is in flight. */
  readonly session: SessionView | null | undefined;
  readonly methods: readonly SignInMethod[];
  readonly refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const [methods, setMethods] = useState<readonly SignInMethod[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSession((await api.session()) ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api
      .methods()
      .then((answer) => setMethods(answer.methods))
      .catch(() => setMethods(['email']));
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ session, methods, refresh }}>{children}</SessionContext.Provider>
  );
};

export const useSession = (): SessionState => {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession outside <SessionProvider>');
  return value;
};

/** A guest (made by the game, never by this site) has no friends list and no password. */
export const isGuest = (session: SessionView | null | undefined): boolean =>
  session?.user.isAnonymous === true;
