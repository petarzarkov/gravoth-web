import type {
  ChatModeratedMessage,
  ChatMuteView,
  ChatReportView,
} from '@gravoth/contracts';
import {
  Alert,
  Anchor,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { useState } from 'react';
import { api } from '../api.js';
import { PlayerAvatar } from '../components/avatar.js';
import {
  Empty,
  ErrorNote,
  Loaded,
  Panel,
  Spinner,
} from '../components/bits.js';
import {
  MessageLine,
  PlayerName,
  ReportCard,
  groupReports,
  muteEnds,
  problem,
} from '../components/chat-moderation.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatRelative } from '../format.js';
import { Link } from '../router.js';
import { useSession } from '../session.js';

type Tab = 'open' | 'closed' | 'mutes' | 'global';

const TABS: readonly { label: string; value: Tab }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
  { label: 'Mutes', value: 'mutes' },
  { label: 'Global', value: 'global' },
];

/** The open or closed reports, one card per message, 50 at a time. */
const Reports = ({ state }: { state: 'open' | 'closed' }) => {
  const [round, setRound] = useState(0);
  const [load, reload] = useLoad(`reports:${state}:${round}`, () =>
    api.chatReports(state),
  );
  const [more, setMore] = useState<readonly ChatReportView[]>([]);
  const [end, setEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setMore([]);
    setEnd(false);
    setRound((value) => value + 1);
  };

  return (
    <Loaded load={load} retry={reload}>
      {({ reports: first }) => {
        const reports = [...first, ...more];
        if (reports.length === 0)
          return (
            <Empty>
              {state === 'open'
                ? 'No open reports. Players report a message from the game.'
                : 'No closed reports (they are kept 180 days).'}
            </Empty>
          );
        const loadMore = async () => {
          setError(null);
          try {
            const next = await api.chatReports(state, reports.at(-1)?.id);
            setMore((shown) => [...shown, ...next.reports]);
            if (next.reports.length < 50) setEnd(true);
          } catch (caught) {
            setError(problem(caught));
          }
        };
        return (
          <>
            {groupReports(reports).map((group) => (
              <ReportCard
                key={group.message.id}
                group={group}
                {...(state === 'open' ? { onDone: done } : {})}
              />
            ))}
            {first.length < 50 || end ? null : (
              <Button variant="default" onClick={() => void loadMore()}>
                Older reports
              </Button>
            )}
            {error === null ? null : (
              <Alert color="red" variant="light" mt="sm" role="alert">
                {error}
              </Alert>
            )}
          </>
        );
      }}
    </Loaded>
  );
};

const MuteRow = ({
  mute,
  onDone,
}: {
  mute: ChatMuteView;
  onDone: () => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const unmute = async () => {
    setError(null);
    try {
      await api.unmute(mute.player.userId);
      onDone();
    } catch (caught) {
      setError(problem(caught));
    }
  };
  return (
    <Stack gap={4} py={6} className="mute-row">
      <Group gap="sm" wrap="nowrap">
        <PlayerAvatar avatar={mute.player.avatar} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlayerName player={mute.player} />
          <Text size="xs" c="dimmed">
            Muted {muteEnds(mute.until)}, since {formatRelative(mute.createdAt)}
            {mute.reason === '' ? '' : `: ${mute.reason}`}
          </Text>
        </div>
        <Button size="xs" variant="default" onClick={() => void unmute()}>
          Unmute
        </Button>
      </Group>
      {error === null ? null : (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}
    </Stack>
  );
};

const Mutes = () => {
  const [round, setRound] = useState(0);
  const [load, reload] = useLoad(`mutes:${round}`, () => api.chatMutes());
  return (
    <Panel title="Muted players">
      <Loaded load={load} retry={reload}>
        {({ mutes }) =>
          mutes.length === 0 ? (
            <Empty>Nobody is muted. A mute is set from a report.</Empty>
          ) : (
            <Stack gap={0}>
              {mutes.map((mute) => (
                <MuteRow
                  key={mute.player.userId}
                  mute={mute}
                  onDone={() => setRound((value) => value + 1)}
                />
              ))}
            </Stack>
          )
        }
      </Loaded>
    </Panel>
  );
};

/** The global channel's newest messages first, hidden ones too, each with Hide. */
const GlobalMessages = () => {
  const [round, setRound] = useState(0);
  const [load, reload] = useLoad(`global:${round}`, () =>
    api.chatMessages({ take: 50 }),
  );
  const [older, setOlder] = useState<readonly ChatModeratedMessage[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(problem(caught));
    }
  };

  return (
    <Panel
      title="Global channel"
      actions={
        <Button
          size="xs"
          variant="default"
          onClick={() => {
            setOlder([]);
            setHidden(new Set());
            setRound((value) => value + 1);
          }}
        >
          Refresh
        </Button>
      }
    >
      <Loaded load={load} retry={reload}>
        {({ messages }) => {
          const shown = [...[...older, ...messages].reverse()];
          if (shown.length === 0)
            return <Empty>Nothing in the last 30 days.</Empty>;
          const oldest = shown.at(-1)?.id;
          return (
            <Stack gap="sm">
              {shown.map((message) => {
                const line = hidden.has(message.id)
                  ? { ...message, hidden: true }
                  : message;
                return (
                  <MessageLine key={message.id} message={line}>
                    {line.hidden ? null : (
                      <Button
                        size="xs"
                        color="red"
                        variant="outline"
                        onClick={() =>
                          void act(async () => {
                            await api.hideMessage(message.id);
                            setHidden((ids) => new Set([...ids, message.id]));
                          })
                        }
                      >
                        Hide
                      </Button>
                    )}
                  </MessageLine>
                );
              })}
              {messages.length < 50 ? null : (
                <Button
                  variant="default"
                  onClick={() =>
                    void act(async () => {
                      const next = await api.chatMessages({
                        before: oldest,
                        take: 50,
                      });
                      setOlder((kept) => [...next.messages, ...kept]);
                    })
                  }
                >
                  Older messages
                </Button>
              )}
            </Stack>
          );
        }}
      </Loaded>
      {error === null ? null : (
        <Alert color="red" variant="light" mt="sm" role="alert">
          {error}
        </Alert>
      )}
    </Panel>
  );
};

/**
 * Chat moderation (decision 228), for the `admin` role only: the open reports with their messages and the messages
 * around them, the outcomes (dismiss, hide, hide and mute), the closed reports, the mutes, and the global channel. A
 * signed-out visitor is asked to sign in; anyone else finds no page here. Players chat in the game, not on this site.
 */
export const AdminChatPage = () => {
  const { session } = useSession();
  const [account] = useLoad(`admin:${session?.user.id ?? 'none'}`, () =>
    session === null || session === undefined
      ? Promise.resolve(null)
      : api.account(),
  );
  const [tab, setTab] = useState<Tab>('open');

  if (session === undefined) return <Spinner />;
  if (session === null)
    return (
      <>
        <PageTitle title="Chat moderation" />
        <Empty>
          <Anchor component={Link} to="/sign-in?next=/admin/chat">
            Sign in
          </Anchor>{' '}
          to see this page.
        </Empty>
      </>
    );
  if (account.state === 'loading') return <Spinner />;
  if (account.state === 'error') return <ErrorNote error={account.error} />;
  if (account.value?.admin !== true)
    return (
      <>
        <PageTitle title="Not here" />
        <Empty>
          Nothing at this address. <Link to="/">Back to the start</Link>.
        </Empty>
      </>
    );

  return (
    <>
      <PageTitle
        title="Chat moderation"
        sub="Reports from the game, the mutes, and the global channel. Messages are shown as plain text, as players see them."
      />
      <SegmentedControl
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        data={[...TABS]}
        mb="lg"
        fullWidth
        className="admin-tabs"
      />
      {tab === 'open' || tab === 'closed' ? (
        <Reports key={tab} state={tab} />
      ) : tab === 'mutes' ? (
        <Mutes />
      ) : (
        <GlobalMessages />
      )}
    </>
  );
};
