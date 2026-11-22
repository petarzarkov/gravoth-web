import {
  PASSWORD_LIMITS,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from '@gravoth/contracts/constants';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api.js';
import { Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { messageFor } from '../format.js';
import { useNavigation, useQuery } from '../router.js';
import { useSession } from '../session.js';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  discord: 'Discord',
};

/** Only a path on this site: a `next` of `//evil.example` or `https://...` goes home instead. */
export const safeNext = (next: string | null): string =>
  next !== null && next.startsWith('/') && !next.startsWith('//')
    ? next
    : '/account';

export const SignInPage = () => {
  const { session, methods, refresh } = useSession();
  const { navigate } = useNavigation();
  const query = useQuery();
  const next = safeNext(query.get('next'));
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(query.get('error'));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session !== null && session !== undefined)
      navigate(next, { replace: true });
  }, [session, next, navigate]);

  const providers = SOCIAL_PROVIDERS.filter((provider) =>
    methods.includes(provider),
  );

  const fail = (caught: unknown) =>
    setError(
      caught instanceof ApiError
        ? messageFor(caught.code)
        : "Can't reach the server.",
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'forgot') {
        await api.requestPasswordReset(email.trim());
        setNotice('If an account uses that email, a reset link is on its way.');
      } else {
        if (mode === 'sign-up')
          await api.signUp(
            name.trim() === '' ? 'Hero' : name.trim(),
            email.trim(),
            password,
          );
        else await api.signIn(email.trim(), password);
        await refresh();
      }
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const social = async (provider: SocialProvider) => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.signInSocial(provider, next);
      if (answer.url === undefined) throw new ApiError(500, 'NO_REDIRECT');
      window.location.assign(answer.url);
    } catch (caught) {
      fail(caught);
      setBusy(false);
    }
  };

  const title =
    mode === 'sign-up'
      ? 'Create an account'
      : mode === 'forgot'
        ? 'Reset your password'
        : 'Sign in';

  return (
    <>
      <PageTitle
        title={title}
        sub="The same account as in the game: your heroes, records and friends."
      />
      <div className="auth">
        <Panel>
          <div
            className="segmented segmented-full"
            role="tablist"
            aria-label="Sign in or create an account"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'sign-in'}
              className={mode === 'sign-in' ? 'segment active' : 'segment'}
              onClick={() => setMode('sign-in')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'sign-up'}
              className={mode === 'sign-up' ? 'segment active' : 'segment'}
              onClick={() => setMode('sign-up')}
            >
              Create account
            </button>
          </div>

          {providers.length === 0 || mode === 'forgot' ? null : (
            <>
              <div className="providers">
                {providers.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`button button-provider provider-${provider}`}
                    disabled={busy}
                    onClick={() => void social(provider)}
                  >
                    Continue with {PROVIDER_NAMES[provider]}
                  </button>
                ))}
              </div>
              <p className="divider">
                <span>or with email</span>
              </p>
            </>
          )}

          <form className="form" onSubmit={(event) => void submit(event)}>
            {mode === 'sign-up' ? (
              <label className="field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="nickname"
                  maxLength={40}
                  placeholder="Shown until you pick a display name"
                />
              </label>
            ) : null}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>
            {mode === 'forgot' ? null : (
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  required
                  minLength={PASSWORD_LIMITS.min}
                  maxLength={PASSWORD_LIMITS.max}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={
                    mode === 'sign-up' ? 'new-password' : 'current-password'
                  }
                />
              </label>
            )}
            {error === null ? null : (
              <p className="note note-error" role="alert">
                {messageFor(error)}
              </p>
            )}
            {notice === null ? null : (
              <p className="note" role="status">
                {notice}
              </p>
            )}
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              {busy
                ? 'One moment'
                : mode === 'sign-up'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Sign in'}
            </button>
          </form>

          <p className="auth-foot">
            {mode === 'forgot' ? (
              <button
                type="button"
                className="link"
                onClick={() => setMode('sign-in')}
              >
                Back to sign in
              </button>
            ) : (
              <button
                type="button"
                className="link"
                onClick={() => setMode('forgot')}
              >
                Forgot your password?
              </button>
            )}
          </p>
        </Panel>
      </div>
    </>
  );
};
