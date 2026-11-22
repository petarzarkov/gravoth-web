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
  Divider,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api.js';
import { PageTitle } from '../components/layout.js';
import { messageFor } from '../format.js';
import { useNavigation, useQuery } from '../router.js';
import { useSession } from '../session.js';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  discord: 'Discord',
};

/** Only a path on this site: a `next` of `//evil.example` or `https://...` goes to the account instead. */
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
      <Box maw={440}>
        <Card>
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

          {providers.length === 0 || mode === 'forgot' ? null : (
            <>
              <Stack gap="sm">
                {providers.map((provider) => (
                  <Button
                    key={provider}
                    variant="default"
                    size="md"
                    fullWidth
                    disabled={busy}
                    onClick={() => void social(provider)}
                  >
                    Continue with {PROVIDER_NAMES[provider]}
                  </Button>
                ))}
              </Stack>
              <Divider label="or with email" labelPosition="center" my="lg" />
            </>
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
              />
              {mode === 'forgot' ? null : (
                <PasswordInput
                  label="Password"
                  required
                  minLength={PASSWORD_LIMITS.min}
                  maxLength={PASSWORD_LIMITS.max}
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  autoComplete={
                    mode === 'sign-up' ? 'new-password' : 'current-password'
                  }
                />
              )}
              {error === null ? null : (
                <Alert color="red" variant="light" role="alert">
                  {messageFor(error)}
                </Alert>
              )}
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
        </Card>
      </Box>
    </>
  );
};
