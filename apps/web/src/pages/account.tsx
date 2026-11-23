import type { ProfileView, UpdateProfile } from '@gravoth/contracts';
import {
  DISPLAY_NAME_PATTERN,
  DISPLAY_NAME_RULE,
} from '@gravoth/contracts/constants';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api.js';
import { Empty, HeroBadges, Loaded, Panel } from '../components/bits.js';
import { CloudSavePanel } from '../components/cloud-save-panel.js';
import { PageTitle } from '../components/layout.js';
import { PicturePicker } from '../components/picture-picker.js';
import { useLoad } from '../components/use-load.js';
import { formatDate, messageFor } from '../format.js';
import { Link, useNavigation } from '../router.js';
import { useSession } from '../session.js';

const problem = (caught: unknown): string =>
  caught instanceof ApiError
    ? messageFor(caught.code)
    : "Can't reach the server.";

const ProfileForm = ({
  profile,
  onSaved,
}: {
  profile: ProfileView;
  onSaved: (profile: ProfileView) => void;
}) => {
  // What the box shows: the player's edit, or the saved name when there is none.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? profile.displayName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (changes: UpdateProfile) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.updateProfile(changes));
      if (changes.displayName !== undefined) setDraft(null);
      setSaved(true);
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!DISPLAY_NAME_PATTERN.test(name)) {
      setError(
        DISPLAY_NAME_RULE.charAt(0).toUpperCase() +
          DISPLAY_NAME_RULE.slice(1) +
          '.',
      );
      return;
    }
    void save({ displayName: name });
  };

  const toggles: readonly [
    keyof UpdateProfile & keyof ProfileView,
    string,
    string,
  ][] = [
    [
      'publicProfile',
      'Public profile',
      'Off: your name shows as hidden on the boards, and you are never suggested as a friend.',
    ],
    [
      'allowFriendRequests',
      'Friend requests',
      'Let players ask to be your friend, and see you among their suggestions.',
    ],
    [
      'showOnline',
      'Show when online',
      'Friends see a green dot by your name while you play or use this site.',
    ],
    [
      'emailFriendRequests',
      'Mail me friend requests',
      'An email when someone asks.',
    ],
  ];

  return (
    <Panel title="Profile">
      <form onSubmit={rename}>
        <Group align="flex-end" gap="sm" wrap="nowrap">
          <TextInput
            label="Display name"
            description={
              profile.nameChosen
                ? 'What boards and friends see.'
                : 'Made from your sign-in. Pick your own: boards and friends see it.'
            }
            value={name}
            onChange={(event) => setDraft(event.currentTarget.value)}
            maxLength={20}
            autoComplete="nickname"
            style={{ flex: 1 }}
          />
          <Button type="submit" disabled={busy || name === profile.displayName}>
            Save
          </Button>
        </Group>
      </form>
      <Stack gap="sm" mt="lg" className="toggles">
        {toggles.map(([key, label, hint]) => (
          <Switch
            key={key}
            label={label}
            description={hint}
            checked={profile[key] === true}
            disabled={busy}
            onChange={(event) =>
              void save({ [key]: event.currentTarget.checked })
            }
          />
        ))}
      </Stack>
      {error === null ? null : (
        <Alert color="red" variant="light" mt="md" role="alert">
          {error}
        </Alert>
      )}
      {saved && error === null ? (
        <Alert variant="light" mt="md" role="status">
          Saved.
        </Alert>
      ) : null}
    </Panel>
  );
};

const METHOD_NAMES: Record<string, string> = {
  email: 'Email and password',
  google: 'Google',
  discord: 'Discord',
  guest: 'Guest',
};

export const AccountPage = () => {
  const { session, refresh, setProfile: setSessionProfile } = useSession();
  const { navigate } = useNavigation();
  const [account, reloadAccount] = useLoad(`account:${session?.user.id}`, () =>
    api.account(),
  );
  const [saved, setProfile] = useState<ProfileView | null>(null);
  const [profileLoad] = useLoad(`profile:${session?.user.id}`, () =>
    api.profile(),
  );
  const [heroes] = useLoad(`heroes:${session?.user.id}`, () => api.heroes());
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) navigate('/sign-in?next=/account', { replace: true });
  }, [session, navigate]);

  const profile =
    saved ?? (profileLoad.state === 'ready' ? profileLoad.value : null);
  // A change shows here and in the bar at once.
  const onSaved = (changed: ProfileView) => {
    setProfile(changed);
    setSessionProfile(changed);
  };

  if (session === null || session === undefined) return null;

  const signOut = async () => {
    try {
      await api.signOut();
    } finally {
      await refresh();
      navigate('/', { replace: true });
    }
  };

  const verify = async (email: string) => {
    setError(null);
    try {
      await api.sendVerification(email);
      setNotice(`A confirmation link is on its way to ${email}.`);
    } catch (caught) {
      setError(problem(caught));
    }
  };

  const remove = async (hasPassword: boolean) => {
    setError(null);
    try {
      await api.deleteAccount(hasPassword ? password : undefined);
      await refresh();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(problem(caught));
    }
  };

  return (
    <>
      <PageTitle
        title="Account"
        sub={
          profile === null ? undefined : `Signed in as ${profile.displayName}`
        }
      >
        <Button variant="default" onClick={() => void signOut()}>
          Sign out
        </Button>
      </PageTitle>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 6 }}>
          {profile === null ? (
            <Loaded load={profileLoad}>{() => null}</Loaded>
          ) : (
            <>
              <PicturePicker
                profile={profile}
                signIn={
                  account.state === 'ready' ? account.value.signIn : undefined
                }
                onSaved={onSaved}
              />
              <ProfileForm profile={profile} onSaved={onSaved} />
            </>
          )}
          <Panel title="Your heroes">
            <Loaded load={heroes}>
              {({ heroes: list }) =>
                list.length === 0 ? (
                  <Empty>
                    No heroes yet. A hero shows up here once the game sends its
                    build.
                  </Empty>
                ) : (
                  <Stack gap="xs" className="hero-list">
                    {list.map((hero) => (
                      <Group key={hero.id} gap="sm">
                        <Text fw={600} style={{ flex: 1 }}>
                          {hero.name}
                        </Text>
                        <HeroBadges hero={hero} />
                        <Text size="xs" c="dimmed">
                          since {formatDate(hero.createdAt)}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                )
              }
            </Loaded>
          </Panel>
          {account.state === 'ready' && !account.value.guest ? (
            <CloudSavePanel userId={account.value.id} />
          ) : null}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Loaded load={account} retry={reloadAccount}>
            {(view) => {
              const hasPassword = view.signIn.includes('email');
              return (
                <>
                  <Panel title="Sign-in">
                    <Table verticalSpacing="xs">
                      <Table.Tbody>
                        <Table.Tr>
                          <Table.Td c="dimmed">Email</Table.Td>
                          <Table.Td>
                            <Group gap="xs" justify="flex-end">
                              <Text
                                size="sm"
                                style={{ overflowWrap: 'anywhere' }}
                              >
                                {view.email ?? 'None (guest)'}
                              </Text>
                              {view.email ===
                              null ? null : view.emailVerified ? (
                                <Badge color="green">Confirmed</Badge>
                              ) : (
                                <Anchor
                                  component="button"
                                  type="button"
                                  size="sm"
                                  onClick={() => void verify(view.email ?? '')}
                                >
                                  Send a confirmation link
                                </Anchor>
                              )}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td c="dimmed">Signs in with</Table.Td>
                          <Table.Td ta="right">
                            {view.signIn
                              .map((method) => METHOD_NAMES[method] ?? method)
                              .join(', ')}
                          </Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Td c="dimmed">Since</Table.Td>
                          <Table.Td ta="right">
                            {formatDate(view.createdAt)}
                          </Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                    {notice === null ? null : (
                      <Alert variant="light" mt="md" role="status">
                        {notice}
                      </Alert>
                    )}
                  </Panel>
                  {view.admin ? (
                    <Panel title="Moderation" className="moderation-panel">
                      <Group justify="space-between" gap="sm">
                        <Text size="sm" c="dimmed">
                          Chat reports, mutes and the global channel.
                        </Text>
                        <Button
                          component={Link}
                          to="/admin/chat"
                          variant="default"
                        >
                          Chat moderation
                        </Button>
                      </Group>
                    </Panel>
                  ) : null}
                  <Panel title="Delete account" className="panel-danger">
                    {deleting ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void remove(hasPassword);
                        }}
                      >
                        <Stack gap="md">
                          <Text size="sm">
                            Your heroes, records, builds, cloud save, online
                            realm, friends and chat messages are deleted with
                            it. This can't be undone.
                          </Text>
                          {hasPassword ? (
                            <PasswordInput
                              label="Password"
                              required
                              value={password}
                              onChange={(event) =>
                                setPassword(event.currentTarget.value)
                              }
                              autoComplete="current-password"
                            />
                          ) : null}
                          <TextInput
                            label="Type DELETE to confirm"
                            value={confirm}
                            onChange={(event) =>
                              setConfirm(event.currentTarget.value)
                            }
                            autoComplete="off"
                          />
                          <Group gap="sm">
                            <Button
                              type="submit"
                              color="red"
                              disabled={confirm !== 'DELETE'}
                            >
                              Delete everything
                            </Button>
                            <Button
                              variant="default"
                              onClick={() => setDeleting(false)}
                            >
                              Keep my account
                            </Button>
                          </Group>
                        </Stack>
                      </form>
                    ) : (
                      <Button
                        color="red"
                        variant="outline"
                        onClick={() => setDeleting(true)}
                      >
                        Delete my account
                      </Button>
                    )}
                  </Panel>
                </>
              );
            }}
          </Loaded>
          {error === null ? null : (
            <Alert color="red" variant="light" role="alert">
              {error}
            </Alert>
          )}
        </Grid.Col>
      </Grid>
    </>
  );
};
