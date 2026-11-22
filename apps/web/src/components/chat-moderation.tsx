import type {
  ChatModeratedMessage,
  ChatPlayer,
  ChatReportView,
  ReportAction,
  ReportReason,
  ResolveReport,
} from '@gravoth/contracts';
import { CHAT_LIMITS } from '@gravoth/contracts/constants';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { ApiError, api } from '../api.js';
import { formatDateTime, formatRelative, messageFor } from '../format.js';
import { Link } from '../router.js';
import { PlayerAvatar } from './avatar.js';

/** A report's reason as the game's REPORT menu names it. */
export const REASON_NAMES: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  cheating: 'Cheating',
  other: 'Other',
};

export const ACTION_NAMES: Record<ReportAction, string> = {
  dismiss: 'Dismissed',
  hide: 'Hidden',
  mute: 'Hidden and muted',
};

/** The mutes the admin page offers (decision 228): an hour, a day, a week, or for good (ten years). */
export const MUTE_CHOICES: readonly { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '1 day', hours: 24 },
  { label: '1 week', hours: 168 },
  { label: 'For good', hours: CHAT_LIMITS.MAX_MUTE_HOURS },
];

/** When a mute ends, or "for good" for one more than five years away. */
export const muteEnds = (until: string, now = Date.now()): string =>
  Date.parse(until) - now > 5 * 365 * 86_400_000
    ? 'for good'
    : `until ${formatDateTime(until)}`;

/** One message's reports, the newest first, as the open list shows them together. */
export interface ReportGroup {
  readonly message: ChatReportView['message'];
  readonly reports: readonly ChatReportView[];
}

/** Reports grouped by their message, in the order their newest report came. */
export const groupReports = (
  reports: readonly ChatReportView[],
): readonly ReportGroup[] => {
  const groups = new Map<number, ChatReportView[]>();
  for (const report of reports) {
    const group = groups.get(report.message.id);
    if (group === undefined) groups.set(report.message.id, [report]);
    else group.push(report);
  }
  return [...groups.values()].map((group) => ({
    message: group[0]!.message,
    reports: group,
  }));
};

export const problem = (caught: unknown): string =>
  caught instanceof ApiError
    ? messageFor(caught.code)
    : "Can't reach the server.";

/** A player's name, to their player page. */
export const PlayerName = ({ player }: { player: ChatPlayer }) =>
  player.displayName === '' ? (
    <Text span size="sm" c="dimmed">
      A deleted player
    </Text>
  ) : (
    <Anchor
      component={Link}
      to={`/players/${player.userId}`}
      size="sm"
      fw={600}
      c="gray.0"
    >
      {player.displayName}
    </Anchor>
  );

/** A message as moderation reads it: who wrote it (and to whom), when, the text as plain text, and whether it is hidden. */
export const MessageLine = ({
  message,
  focus,
  children,
}: {
  message: ChatModeratedMessage;
  focus?: boolean;
  children?: ReactNode;
}) => (
  <Group
    gap="sm"
    align="flex-start"
    wrap="nowrap"
    className={focus === true ? 'chat-line chat-line-focus' : 'chat-line'}
  >
    <PlayerAvatar avatar={message.from.avatar} size={32} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <Group gap={6} style={{ rowGap: 2 }}>
        <PlayerName player={message.from} />
        {message.to === null ? null : (
          <>
            <Text span size="xs" c="dimmed">
              to
            </Text>
            <PlayerName player={message.to} />
          </>
        )}
        <Text span size="xs" c="dimmed">
          {formatDateTime(message.at)}
        </Text>
        {message.hidden ? (
          <Badge color="red" variant="light" size="xs">
            Hidden
          </Badge>
        ) : null}
      </Group>
      <Text size="sm" className="chat-body">
        {message.body}
      </Text>
    </div>
    {children === undefined ? null : (
      <Group gap={6} wrap="nowrap">
        {children}
      </Group>
    )}
  </Group>
);

/**
 * One reported message with every report of it: the reasons, notes and reporters, the messages around it on request,
 * and for an open report the outcomes (dismiss, hide, or hide and mute for a while). An outcome closes every open
 * report of the message.
 */
export const ReportCard = ({
  group,
  onDone,
}: {
  group: ReportGroup;
  onDone?: () => void;
}) => {
  const { message, reports } = group;
  const latest = reports[0]!;
  const [context, setContext] = useState<
    readonly ChatModeratedMessage[] | null
  >(null);
  const [muting, setMuting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone?.();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  };
  const resolve = (outcome: ResolveReport) =>
    run(() => api.resolveReport(latest.id, outcome));
  const around = () =>
    run(async () => {
      const answer = await api.chatMessages({
        around: message.id,
        take: 10,
        ...(message.to === null
          ? {}
          : { userId: message.from.userId, peerId: message.to.userId }),
      });
      setContext(answer.messages);
    });

  return (
    <Card className="report-card" mb="md">
      <Group justify="space-between" mb="sm" gap="xs">
        <Group gap="xs">
          <Badge>{message.channel === 'global' ? 'Global' : 'Direct'}</Badge>
          <Badge color="red" variant="light">
            {latest.reports === 1 ? '1 report' : `${latest.reports} reports`}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          reported {formatRelative(latest.createdAt)}
        </Text>
      </Group>
      <MessageLine message={message} />
      <Stack gap={6} mt="sm" className="report-reasons">
        {reports.map((report) => (
          <Group key={report.id} gap="xs" style={{ rowGap: 2 }}>
            <Badge size="sm" color="gold">
              {REASON_NAMES[report.reason]}
            </Badge>
            {report.note === '' ? null : (
              <Text size="sm" className="chat-body">
                {report.note}
              </Text>
            )}
            <Text span size="xs" c="dimmed">
              by
            </Text>
            <PlayerName player={report.reporter} />
            {report.resolved === null ? null : (
              <Text span size="xs" c="dimmed">
                {ACTION_NAMES[report.resolved.action]} by{' '}
                {report.resolved.by || 'a moderator'},{' '}
                {formatDateTime(report.resolved.at)}
              </Text>
            )}
          </Group>
        ))}
      </Stack>
      {context === null ? null : (
        <Stack gap={8} mt="md" className="report-context">
          {context.length === 0 ? (
            <Text size="sm" c="dimmed">
              The messages around it are gone (kept 30 days).
            </Text>
          ) : (
            context.map((line) => (
              <MessageLine
                key={line.id}
                message={line}
                focus={line.id === message.id}
              />
            ))
          )}
        </Stack>
      )}
      <Group gap="xs" mt="md">
        {context === null ? (
          <Button
            size="xs"
            variant="default"
            disabled={busy}
            onClick={() => void around()}
          >
            Messages around it
          </Button>
        ) : null}
        {onDone === undefined ? null : (
          <>
            <Button
              size="xs"
              variant="default"
              disabled={busy}
              onClick={() => void resolve({ action: 'dismiss' })}
            >
              Dismiss
            </Button>
            <Button
              size="xs"
              color="red"
              variant="outline"
              disabled={busy}
              onClick={() => void resolve({ action: 'hide' })}
            >
              Hide
            </Button>
            <Button
              size="xs"
              color="red"
              disabled={busy}
              onClick={() => setMuting((open) => !open)}
            >
              Hide and mute
            </Button>
          </>
        )}
      </Group>
      {muting ? (
        <Group gap="xs" mt="sm" className="mute-choices">
          <Text size="sm">Mute {message.from.displayName} for</Text>
          {MUTE_CHOICES.map((choice) => (
            <Button
              key={choice.hours}
              size="xs"
              color="red"
              variant="light"
              disabled={busy}
              onClick={() =>
                void resolve({
                  action: 'mute',
                  hours: choice.hours,
                  reason: REASON_NAMES[latest.reason],
                })
              }
            >
              {choice.label}
            </Button>
          ))}
        </Group>
      ) : null}
      {error === null ? null : (
        <Alert color="red" variant="light" mt="sm" role="alert">
          {error}
        </Alert>
      )}
    </Card>
  );
};
