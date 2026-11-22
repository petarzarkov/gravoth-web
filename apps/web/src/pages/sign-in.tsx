import {
  PASSWORD_LIMITS,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from '@gravoth/contracts/constants';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError, api } from '../api.js';
import {
  DiscordTile,
  GoogleMark,
  GravothTile,
} from '../components/brand-marks.js';
import { PageTitle } from '../components/layout.js';
import { messageFor } from '../format.js';
import { useNavigation, useQuery } from '../router.js';
import { useSession } from '../session.js';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  discord: 'Discord',
};

const PROVIDER_MARKS: Record<SocialProvider, ReactNode> = {
  google: <GoogleMark size={20} />,
  discord: <DiscordTile size={26} />,
};

/** Only a path on this site: a `next` of `//evil.example` or `https://...` goes to the account instead. */
export const safeNext = (next: string | null): string =>
  next !== null && next.startsWith('/') && !next.startsWith('//')
    ? next
    : '/account';

/**
 * One way in: a full-width dark button with its brand's mark on the left (Google's dark-theme colours for all three,
 * so they read as one set in the game's look) and the label centred.
 */
const WayIn = ({
  mark,
  busy,
  disabled,
  onClick,
  children,
}: {
  mark: ReactNode;
  busy?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <UnstyledButton
    className="way-in"
    disabled={disabled}
    aria-busy={busy === true}
    onClick={onClick}
  >
    <span className="way-in-mark">{mark}</span>
    <span className="way-in-label">{children}</span>
    <span className="way-in-end" aria-hidden="true">
      {busy === true ? <Loader size={16} color="gray.2" /> : null}
    </span>
  </UnstyledButton>
);

const Terms = () => (
  <Text ta="center" mt="lg" size="xs" c="dimmed">
    By continuing you agree to the{' '}
    <Anchor href="/terms/" inherit>
      terms of service
    </Anchor>{' '}
    and the{' '}
    <Anchor href="/privacy/" inherit>
      privacy policy
    </Anchor>
    .
  </Text>
);

export const SignInPage = () => {
  const { session, methods, refresh } = useSession();
  const { navigate } = useNavigation();
  const query = useQuery();
  const next = safeNext(query.get('next'));
  const [withEmail, setWithEmail] = useState(false);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [going, setGoing] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(query.get('error'));
  const [notice, setNotice] = useState<string | null>(null);
  const emailBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session !== null && session !== undefined)
      navigate(next, { replace: true });
  }, [session, next, navigate]);

  // The email form opens on its first box, for a keyboard as much as a pointer.
  useEffect(() => {
    if (withEmail) emailBox.current?.focus();
  }, [withEmail]);

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
    setGoing(provider);
    setError(null);
    try {
      const answer = await api.signInSocial(provider, next);
      if (answer.url === undefined) throw new ApiError(500, 'NO_REDIRECT');
      window.location.assign(answer.url);
    } catch (caught) {
      fail(caught);
      setBusy(false);
      setGoing(null);
    }
  };

  const openEmail = () => {
    setError(null);
    setNotice(null);
    setMode('sign-in');
    setWithEmail(true);
  };

  const title = !withEmail
    ? 'Sign in'
    : mode === 'sign-up'
      ? 'Create an account'
      : mode === 'forgot'
        ? 'Reset your password'
        : 'Sign in with email';

  const problem =
    error === null ? null : (
      <Alert color="red" variant="light" role="alert">
        {messageFor(error)}
      </Alert>
    );

  return (
    <>
      <PageTitle
        title={title}
        sub="The same account as in the game: your heroes, records and friends."
      />
      <Box maw={440}>
        <Card className="sign-in-card">
          {!withEmail ? (
            <>
              <Stack gap="sm" role="group" aria-label="Ways to sign in">
                {providers.map((provider) => (
                  <WayIn
                    key={provider}
                    mark={PROVIDER_MARKS[provider]}
                    busy={going === provider}
                    disabled={busy}
                    onClick={() => void social(provider)}
                  >
                    Continue with {PROVIDER_NAMES[provider]}
                  </WayIn>
                ))}
                <WayIn
                  mark={<GravothTile size={26} />}
                  disabled={busy}
                  onClick={openEmail}
                >
                  Continue with email
                </WayIn>
                {problem}
              </Stack>
              <Text ta="center" mt="md" size="sm" c="dimmed">
                {providers.length === 0
                  ? 'New to Gravoth Online? Continue with email to make your account.'
                  : 'New to Gravoth Online? Any of these makes your account.'}
              </Text>
              <Terms />
            </>
          ) : (
            <>
              <Anchor
                component="button"
                type="button"
                size="sm"
                mb="md"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setWithEmail(false);
                }}
              >
                ← All ways to sign in
              </Anchor>
              {mode === 'forgot' ? null : (
                <SegmentedControl
                  fullWidth
                  radius="xl"
                  mb="lg"
                  value={mode}
                  onChange={(value) => setMode(value as Mode)}
                  data={[
                    { value: 'sign-in', label: 'Sign in' },
                    { value: 'sign-up', label: 'Create account' },
                  ]}
                />
              )}

              <form onSubmit={(event) => void submit(event)}>
                <Stack gap="md">
                  {mode === 'sign-up' ? (
                    <TextInput
                      label="Name"
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                      autoComplete="nickname"
                      maxLength={40}
                      placeholder="Shown until you pick a display name"
                    />
                  ) : null}
                  <TextInput
                    label="Email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    autoComplete="email"
                    ref={emailBox}
                  />
                  {mode === 'forgot' ? null : (
                    <PasswordInput
                      label="Password"
                      required
                      minLength={PASSWORD_LIMITS.min}
                      maxLength={PASSWORD_LIMITS.max}
                      value={password}
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      autoComplete={
                        mode === 'sign-up' ? 'new-password' : 'current-password'
                      }
                    />
                  )}
                  {problem}
                  {notice === null ? null : (
                    <Alert variant="light" role="status">
                      {notice}
                    </Alert>
                  )}
                  <Button type="submit" loading={busy} fullWidth size="md">
                    {mode === 'sign-up'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset link'
                        : 'Sign in'}
                  </Button>
                </Stack>
              </form>

              {mode === 'forgot' ? null : <Terms />}

              <Text ta="center" mt="md" size="sm">
                {mode === 'forgot' ? (
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => setMode('sign-in')}
                  >
                    Back to sign in
                  </Anchor>
                ) : (
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => setMode('forgot')}
                  >
                    Forgot your password?
                  </Anchor>
                )}
              </Text>
            </>
          )}
        </Card>
      </Box>
    </>
  );
};
