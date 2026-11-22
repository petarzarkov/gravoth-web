import type {
  ProfileView,
  SessionView,
  SignInMethod,
} from '@gravoth/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api.js';

/**
 * Who is signed in, from better-auth's `get-session` (the session cookie), and
 * which sign-in methods the server offers. `refresh` after a sign-in or out.
 * `profile` is the signed-in player's own (the header's name and picture);
 * `setProfile` after a change to it.
 */
interface SessionState {
  /** Undefined while the first check is in flight. */
  readonly session: SessionView | null | undefined;
  readonly methods: readonly SignInMethod[];
  readonly refresh: () => Promise<void>;
  /** Null while signed out or until it loads. */
  readonly profile: ProfileView | null;
  readonly setProfile: (profile: ProfileView) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<SessionView | null | undefined>(
    undefined,
  );
  const [methods, setMethods] = useState<readonly SignInMethod[]>([]);
  // Kept with its player, so a new session never shows the last one's profile.
  const [loaded, setLoaded] = useState<ProfileView | null>(null);
  const userId = session?.user.id;
  const profile = loaded?.userId === userId ? loaded : null;

  const refresh = useCallback(async () => {
    try {
      setSession((await api.session()) ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  // The first check, and the methods the server offers; `refresh` is for after a sign-in or out.
  useEffect(() => {
    let live = true;
    api
      .session()
      .then((answer) => live && setSession(answer ?? null))
      .catch(() => live && setSession(null));
    api
      .methods()
      .then((answer) => live && setMethods(answer.methods))
      .catch(() => live && setMethods(['email']));
    return () => {
      live = false;
    };
  }, []);

  // The signed-in player's profile, again for each new player.
  useEffect(() => {
    if (userId === undefined) return;
    let live = true;
    api
      .profile()
      .then((answer) => live && setLoaded(answer))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId]);

  return (
    <SessionContext.Provider
      value={{ session, methods, refresh, profile, setProfile: setLoaded }}
    >
      {children}
    </SessionContext.Provider>
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
