import type { BoardView, EntryView, HeroPath } from '@gravoth/contracts';
import {
  HERO_PATHS,
  HERO_PATH_NAMES,
  avatarBorderOf,
  isHeroPath,
} from '@gravoth/contracts/constants';
import {
  Anchor,
  Box,
  Button,
  Group,
  NativeSelect,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { api, withQuery } from '../api.js';
import { PlayerAvatar } from '../components/avatar.js';
import {
  Empty,
  ErrorNote,
  HardcoreBadge,
  HeroBadges,
  Loaded,
  Panel,
  Spinner,
  VerdictBadge,
} from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatCompact, formatScore } from '../format.js';
import { Link, useNavigation, useQuery } from '../router.js';
import { isGuest, useSession } from '../session.js';

/**
 * The rank, the hero (with its class and hardcore badges under the names) and the score on a phone; the class, level,
 * DPS, EHP and check columns from `sm` up. Each picture wears its hero's avatar border; while any row has one, every
 * picture sits in a frame's square so the names line up.
 */
const EntryTable = ({
  board,
  entries,
  me,
}: {
  board: BoardView;
  entries: readonly EntryView[];
  me?: string | undefined;
}) => {
  const framed = entries.some(
    (entry) => avatarBorderOf(entry.build.extras['border']) !== null,
  );
  return (
    <Table.ScrollContainer minWidth={320}>
      <Table highlightOnHover verticalSpacing="sm" className="board-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={48}>#</Table.Th>
            <Table.Th>Hero</Table.Th>
            <Table.Th visibleFrom="sm">Class</Table.Th>
            <Table.Th visibleFrom="sm" className="num">
              Lvl
            </Table.Th>
            <Table.Th className="num">
              {board.format === 'time_ms' ? 'Time' : 'Score'}
            </Table.Th>
            <Table.Th visibleFrom="md" className="num">
              DPS
            </Table.Th>
            <Table.Th visibleFrom="md" className="num">
              EHP
            </Table.Th>
            <Table.Th visibleFrom="md">Check</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((entry) => (
            <Table.Tr
              key={entry.id}
              className={
                me !== undefined && entry.player.userId === me
                  ? 'row-mine'
                  : undefined
              }
            >
              <Table.Td>
                <Text ff="heading" fz="lg" c="dimmed">
                  {entry.rank}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap="sm" wrap="nowrap">
                  <PlayerAvatar
                    avatar={entry.player.avatar}
                    size={34}
                    border={
                      framed
                        ? (entry.build.extras['border'] ?? null)
                        : undefined
                    }
                  />
                  <div style={{ minWidth: 0 }}>
                    <Anchor
                      component={Link}
                      to={`/builds/${entry.build.id}`}
                      c="gray.0"
                      fw={600}
                      className="hero-link"
                    >
                      {entry.hero.name}
                    </Anchor>
                    {entry.player.userId === null ? (
                      <Text size="xs" c="dimmed">
                        {entry.player.displayName}
                      </Text>
                    ) : (
                      <Anchor
                        component={Link}
                        to={`/players/${entry.player.userId}`}
                        size="xs"
                        c="dimmed"
                        display="block"
                        className="player-link"
                      >
                        {entry.player.displayName}
                      </Anchor>
                    )}
                    <Box hiddenFrom="sm" mt={4}>
                      <HeroBadges hero={entry.hero} size="xs" />
                    </Box>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td visibleFrom="sm">
                <HeroBadges hero={entry.hero} />
              </Table.Td>
              <Table.Td visibleFrom="sm" className="num">
                {entry.build.level}
              </Table.Td>
              <Table.Td className="num score">
                {formatScore(entry.score, board.format)}
              </Table.Td>
              <Table.Td visibleFrom="md" className="num">
                {formatCompact(entry.build.dps)}
              </Table.Td>
              <Table.Td visibleFrom="md" className="num">
                {formatCompact(entry.build.ehp)}
              </Table.Td>
              <Table.Td visibleFrom="md">
                <VerdictBadge verdict={entry.verdict} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
};

/** The caller's best on this board and the rows around it. */
const MyPlace = ({
  boardKey,
  scope,
}: {
  boardKey: string;
  scope: {
    hardcore: boolean;
    path?: HeroPath | undefined;
    view: 'all' | 'friends';
  };
}) => {
  const { session } = useSession();
  const [around] = useLoad(`${boardKey}:${JSON.stringify(scope)}:me`, () =>
    api.aroundMe(boardKey, { ...scope, around: 2 }),
  );
  if (around.state === 'loading') return <Spinner label="Finding your place" />;
  if (around.state === 'error') return <ErrorNote error={around.error} />;
  const { entry, neighbours, board } = around.value;
  return (
    <Panel title="Your place">
      {entry === null ? (
        <Empty>
          None of your heroes is on this board yet. The boards take online
          heroes' records, read from their realm on the server.
        </Empty>
      ) : (
        <EntryTable board={board} entries={neighbours} me={session?.user.id} />
      )}
    </Panel>
  );
};

export const BoardPage = ({ boardKey }: { boardKey: string }) => {
  const query = useQuery();
  const { navigate } = useNavigation();
  const { session } = useSession();
  const signedIn = session !== null && session !== undefined;
  const hardcore = query.get('hardcore') === 'true';
  // Decision 230: the heroes' main talent path (the class every hero since the classless change shares said nothing).
  const pathParam = query.get('path');
  const path = isHeroPath(pathParam) ? pathParam : undefined;
  const view =
    query.get('view') === 'friends' && signedIn && !isGuest(session)
      ? 'friends'
      : 'all';
  const cursor = query.get('cursor') ?? undefined;
  const direction =
    query.get('direction') === 'backward' ? 'backward' : 'forward';

  const scope = { hardcore, path, view } as const;
  const [page, reload] = useLoad(
    `${boardKey}:${hardcore}:${path}:${view}:${cursor}:${direction}:${session?.user.id}`,
    () => api.board(boardKey, { ...scope, take: 50, cursor, direction }),
  );

  /** A filter change starts the board from its top again. */
  const go = (changes: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = {
      hardcore: hardcore ? 'true' : undefined,
      path,
      view: view === 'friends' ? 'friends' : undefined,
      cursor: undefined,
      direction: undefined,
      ...changes,
    };
    navigate(withQuery(`/boards/${boardKey}`, next), { replace: true });
  };

  return (
    <Loaded load={page} retry={reload}>
      {({ board, entries }) => (
        <>
          <PageTitle
            title={board.title}
            sub={
              <Group gap="xs">
                {board.hardcore ? <HardcoreBadge /> : null}
                <span>
                  {board.sort === 'asc' ? 'Fastest first.' : 'Highest first.'}{' '}
                  Online heroes only; each row opens the build that set it.
                </span>
              </Group>
            }
          >
            <Button
              component={Link}
              to={board.hardcore ? '/boards?hardcore=true' : '/boards'}
              variant="default"
            >
              All boards
            </Button>
          </PageTitle>

          <Group className="filters" gap="md" mb="lg" align="flex-end">
            <SegmentedControl
              radius="xl"
              aria-label="Mode"
              value={hardcore ? 'hardcore' : 'normal'}
              onChange={(value) =>
                go({ hardcore: value === 'hardcore' ? 'true' : undefined })
              }
              data={[
                { value: 'normal', label: 'Normal' },
                { value: 'hardcore', label: 'Hardcore' },
              ]}
            />
            <NativeSelect
              aria-label="Path"
              value={path ?? ''}
              onChange={(event) =>
                go({
                  path:
                    event.currentTarget.value === ''
                      ? undefined
                      : event.currentTarget.value,
                })
              }
              data={[
                { value: '', label: 'All paths' },
                ...HERO_PATHS.map((value) => ({
                  value,
                  label: HERO_PATH_NAMES[value],
                })),
              ]}
            />
            {signedIn && !isGuest(session) ? (
              <SegmentedControl
                radius="xl"
                aria-label="Who"
                value={view}
                onChange={(value) =>
                  go({ view: value === 'friends' ? 'friends' : undefined })
                }
                data={[
                  { value: 'all', label: 'Everyone' },
                  { value: 'friends', label: 'Friends' },
                ]}
              />
            ) : null}
          </Group>

          {signedIn ? <MyPlace boardKey={boardKey} scope={scope} /> : null}

          <Panel
            title={view === 'friends' ? 'You and your friends' : 'The board'}
          >
            <Stack gap="md">
              {entries.data.length === 0 ? (
                <Empty>
                  {path === undefined
                    ? 'No records yet.'
                    : `No ${HERO_PATH_NAMES[path]} records yet.`}
                </Empty>
              ) : (
                <EntryTable
                  board={board}
                  entries={entries.data}
                  me={session?.user.id}
                />
              )}
              {entries.meta.hasPreviousPage || entries.meta.hasNextPage ? (
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={
                      !entries.meta.hasPreviousPage ||
                      entries.meta.previousCursor === null
                    }
                    onClick={() =>
                      go({
                        cursor: entries.meta.previousCursor ?? undefined,
                        direction: 'backward',
                      })
                    }
                  >
                    Higher
                  </Button>
                  <Button
                    variant="default"
                    disabled={
                      !entries.meta.hasNextPage ||
                      entries.meta.nextCursor === null
                    }
                    onClick={() =>
                      go({ cursor: entries.meta.nextCursor ?? undefined })
                    }
                  >
                    Lower
                  </Button>
                </Group>
              ) : null}
            </Stack>
          </Panel>
        </>
      )}
    </Loaded>
  );
};
