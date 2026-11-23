import {
  DISPLAY_NAME_PATTERN,
  SUGGESTION_LIMITS,
} from '@gravoth/contracts/constants';
import {
  Alert,
  Anchor,
  Button,
  Grid,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AvatarView, SuggestionView } from '@gravoth/contracts';
import { ApiError, api } from '../api.js';
import { PlayerAvatar } from '../components/avatar.js';
import { Empty, Loaded, Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatDate, messageFor } from '../format.js';
import { Link, useNavigation } from '../router.js';
import { isGuest, useSession } from '../session.js';

const problem = (caught: unknown): string =>
  caught instanceof ApiError
    ? messageFor(caught.code)
    : "Can't reach the server.";

interface Message {
  readonly error: boolean;
  readonly text: string;
}

/** What an action answered: a line in red for an error, else plain. */
const Outcome = ({ message }: { message: Message | null }) =>
  message === null ? null : (
    <Alert
      {...(message.error ? { color: 'red' } : {})}
      variant="light"
      role={message.error ? 'alert' : 'status'}
    >
      {message.text}
    </Alert>
  );

/** A name box with one action: ask to be friends, or block. */
const ByName = ({
  label,
  action,
  danger,
  onDone,
}: {
  label: string;
  action: (name: string) => Promise<string>;
  danger?: boolean;
  onDone: () => void;
}) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!DISPLAY_NAME_PATTERN.test(trimmed)) {
      setMessage({ error: true, text: messageFor('PLAYER_NOT_FOUND') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ error: false, text: await action(trimmed) });
      setName('');
      onDone();
    } catch (caught) {
      setMessage({ error: true, text: problem(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm" mb="sm">
      <form onSubmit={(event) => void submit(event)}>
        <Group align="flex-end" gap="sm" wrap="nowrap">
          <TextInput
            label="Display name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={20}
            autoComplete="off"
            style={{ flex: 1 }}
          />
          <Button
            type="submit"
            {...(danger === true ? { color: 'red' } : {})}
            variant={danger === true ? 'outline' : 'filled'}
            loading={busy}
            disabled={name.trim() === ''}
          >
            {label}
          </Button>
        </Group>
      </form>
      <Outcome message={message} />
    </Stack>
  );
};

/** One player's row: the picture and name (to their player page, given `userId`), when, then the actions at the far end. */
const Person = ({
  name,
  avatar,
  when,
  userId,
  children,
}: {
  name: string;
  avatar?: AvatarView;
  when: string;
  userId?: string;
  children: ReactNode;
}) => (
  <Group gap="sm" py={6} className="person-row" wrap="nowrap">
    {avatar === undefined ? null : <PlayerAvatar avatar={avatar} size={36} />}
    {userId === undefined ? (
      <Text fw={600} className="person">
        {name}
      </Text>
    ) : (
      <Anchor
        component={Link}
        to={`/players/${userId}`}
        fw={600}
        c="gray.0"
        className="person"
      >
        {name}
      </Anchor>
    )}
    <Text size="xs" c="dimmed" style={{ flex: 1 }}>
      {when}
    </Text>
    <Group gap={6} wrap="nowrap">
      {children}
    </Group>
  </Group>
);

export const FriendsPage = () => {
  const { session } = useSession();
  const { navigate } = useNavigation();
  const [round, setRound] = useState(0);
  const key = `${session?.user.id}:${round}`;
  const [friends] = useLoad(`friends:${key}`, () => api.friends());
  const [incoming] = useLoad(`incoming:${key}`, () => api.incoming());
  const [outgoing] = useLoad(`outgoing:${key}`, () => api.outgoing());
  const [blocks] = useLoad(`blocks:${key}`, () => api.blocks());
  const [suggested] = useLoad(`suggested:${key}`, () => api.suggestions());
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Message | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const refresh = () => setRound((value) => value + 1);

  useEffect(() => {
    if (session === null) navigate('/sign-in?next=/friends', { replace: true });
  }, [session, navigate]);

  if (session === null || session === undefined) return null;
  if (isGuest(session)) {
    return (
      <>
        <PageTitle title="Friends" />
        <Empty>
          Guest accounts have no friends list. Create an account in the game or
          on this site first.
        </Empty>
      </>
    );
  }

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      refresh();
    } catch (caught) {
      setError(problem(caught));
    }
  };

  /** Add or Hide on a suggestion, its answer shown in the panel. */
  const onSuggestion = async (
    item: SuggestionView,
    work: () => Promise<string>,
  ) => {
    setSuggestion(null);
    setAsking(item.userId);
    try {
      setSuggestion({ error: false, text: await work() });
      refresh();
    } catch (caught) {
      setSuggestion({ error: true, text: problem(caught) });
    } finally {
      setAsking(null);
    }
  };

  return (
    <>
      <PageTitle
        title="Friends"
        sub="Friends see each other's heroes on their player pages, and each other on the friends view of every board."
      />
      {error === null ? null : (
        <Alert color="red" variant="light" mb="lg" role="alert">
          {error}
        </Alert>
      )}
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Panel title="Add a friend" className="add-friend">
            <ByName
              label="Send request"
              onDone={refresh}
              action={async (name) => {
                const outcome = await api.askFriend(name);
                return outcome.status === 'accepted'
                  ? `${outcome.friend.displayName} had asked you too: you're friends now.`
                  : `Request sent to ${outcome.request.displayName}.`;
              }}
            />
          </Panel>
          <Panel title="Waiting for you">
            <Loaded load={incoming}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>No requests.</Empty>
                ) : (
                  <Stack gap={0}>
                    {page.data.map((item) => (
                      <Person
                        key={item.id}
                        name={item.displayName}
                        avatar={item.avatar}
                        userId={item.userId}
                        when={formatDate(item.createdAt)}
                      >
                        <Button
                          size="xs"
                          onClick={() => void act(() => api.accept(item.id))}
                        >
                          Accept
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => void act(() => api.decline(item.id))}
                        >
                          Decline
                        </Button>
                      </Person>
                    ))}
                  </Stack>
                )
              }
            </Loaded>
          </Panel>
          <Panel title="You asked">
            <Loaded load={outgoing}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>Nothing pending.</Empty>
                ) : (
                  <Stack gap={0}>
                    {page.data.map((item) => (
                      <Person
                        key={item.id}
                        name={item.displayName}
                        avatar={item.avatar}
                        userId={item.userId}
                        when={formatDate(item.createdAt)}
                      >
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => void act(() => api.cancel(item.id))}
                        >
                          Cancel
                        </Button>
                      </Person>
                    ))}
                  </Stack>
                )
              }
            </Loaded>
          </Panel>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Panel title="Friends">
            <Loaded load={friends}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>
                    No friends yet. Ask someone by their display name.
                  </Empty>
                ) : (
                  <Stack gap={0} className="friend-list">
                    {page.data.map((friend) => (
                      <Person
                        key={friend.userId}
                        name={friend.displayName}
                        avatar={friend.avatar}
                        userId={friend.userId}
                        when={`since ${formatDate(friend.since)}`}
                      >
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() =>
                            void act(() => api.unfriend(friend.userId))
                          }
                        >
                          Remove
                        </Button>
                        <Button
                          size="xs"
                          color="red"
                          variant="outline"
                          onClick={() =>
                            void act(() => api.block(friend.displayName))
                          }
                        >
                          Block
                        </Button>
                      </Person>
                    ))}
                  </Stack>
                )
              }
            </Loaded>
          </Panel>
          <Panel title="Suggested" className="suggested">
            <Stack gap="sm">
              <Outcome message={suggestion} />
              <Loaded load={suggested}>
                {({ items }) =>
                  items.length === 0 ? (
                    <Empty>
                      No suggestions right now. Players who share friends with
                      you, play near you on the boards or chat with you in
                      Global show up here.
                    </Empty>
                  ) : (
                    <Stack gap={0} className="suggestion-list">
                      {items.map((item) => (
                        <Person
                          key={item.userId}
                          name={item.displayName}
                          avatar={item.avatar}
                          userId={item.userId}
                          when={item.note}
                        >
                          <Button
                            size="xs"
                            disabled={asking === item.userId}
                            onClick={() =>
                              void onSuggestion(item, async () => {
                                const outcome = await api.askFriend(
                                  item.displayName,
                                );
                                return outcome.status === 'accepted'
                                  ? `${outcome.friend.displayName} had asked you too: you're friends now.`
                                  : `Request sent to ${outcome.request.displayName}.`;
                              })
                            }
                          >
                            Add
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            disabled={asking === item.userId}
                            onClick={() =>
                              void onSuggestion(item, async () => {
                                await api.dismissSuggestion(item.userId);
                                return `${item.displayName} won't be suggested for ${SUGGESTION_LIMITS.DISMISS_DAYS} days.`;
                              })
                            }
                          >
                            Hide
                          </Button>
                        </Person>
                      ))}
                    </Stack>
                  )
                }
              </Loaded>
            </Stack>
          </Panel>
          <Panel title="Blocked">
            <ByName
              label="Block"
              danger
              onDone={refresh}
              action={async (name) =>
                `${(await api.block(name)).displayName} is blocked.`
              }
            />
            <Loaded load={blocks}>
              {(page) =>
                page.data.length === 0 ? (
                  <Empty>Nobody blocked.</Empty>
                ) : (
                  <Stack gap={0}>
                    {page.data.map((block) => (
                      <Person
                        key={block.userId}
                        name={block.displayName}
                        when={formatDate(block.blockedAt)}
                      >
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() =>
                            void act(() => api.unblock(block.userId))
                          }
                        >
                          Unblock
                        </Button>
                      </Person>
                    ))}
                  </Stack>
                )
              }
            </Loaded>
          </Panel>
        </Grid.Col>
      </Grid>
    </>
  );
};
