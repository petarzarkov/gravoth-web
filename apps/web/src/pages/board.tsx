import type { BoardView, EntryView, HeroClass } from '@gravoth/contracts';
import { HERO_CLASSES } from '@gravoth/contracts/constants';
import {
  Anchor,
  Button,
  Group,
  NativeSelect,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { api, withQuery } from '../api.js';
import {
  ClassBadge,
  Empty,
  ErrorNote,
  HardcoreBadge,
  Loaded,
  Panel,
  Spinner,
  VerdictBadge,
} from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { CLASS_NAMES, formatCompact, formatScore } from '../format.js';
import { Link, useNavigation, useQuery } from '../router.js';
import { isGuest, useSession } from '../session.js';

const isClass = (value: string | null): value is HeroClass =>
  value !== null && (HERO_CLASSES as readonly string[]).includes(value);

/** The rank, the hero and the score on a phone; the class, level, DPS, EHP and check from `sm` up. */
const EntryTable = ({
  board,
  entries,
  me,
}: {
  board: BoardView;
  entries: readonly EntryView[];
  me?: string | undefined;
}) => (
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
              <Anchor
                component={Link}
                to={`/builds/${entry.build.id}`}
                c="gray.0"
                fw={600}
                className="hero-link"
              >
                {entry.hero.name}
              </Anchor>
              <Text size="xs" c="dimmed">
                {entry.player.displayName}
              </Text>
            </Table.Td>
            <Table.Td visibleFrom="sm">
              <ClassBadge heroClass={entry.hero.class} />
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

/** The caller's best on this board and the rows around it. */
const MyPlace = ({
  boardKey,
  scope,
}: {
  boardKey: string;
  scope: {
    hardcore: boolean;
    class?: HeroClass | undefined;
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
          None of your heroes is on this board yet. Records are posted from the
          game.
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
  const classParam = query.get('class');
  const heroClass = isClass(classParam) ? classParam : undefined;
  const view =
    query.get('view') === 'friends' && signedIn && !isGuest(session)
      ? 'friends'
      : 'all';
  const cursor = query.get('cursor') ?? undefined;
  const direction =
    query.get('direction') === 'backward' ? 'backward' : 'forward';

  const scope = { hardcore, class: heroClass, view } as const;
  const [page, reload] = useLoad(
    `${boardKey}:${hardcore}:${heroClass}:${view}:${cursor}:${direction}:${session?.user.id}`,
    () => api.board(boardKey, { ...scope, take: 50, cursor, direction }),
  );

  /** A filter change starts the board from its top again. */
  const go = (changes: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = {
      hardcore: hardcore ? 'true' : undefined,
      class: heroClass,
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
                  Each row opens the build that set it.
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
              aria-label="Class"
              value={heroClass ?? ''}
              onChange={(event) =>
                go({
                  class:
                    event.currentTarget.value === ''
                      ? undefined
                      : event.currentTarget.value,
                })
              }
              data={[
                { value: '', label: 'All classes' },
                ...HERO_CLASSES.map((value) => ({
                  value,
                  label: CLASS_NAMES[value],
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
                  {heroClass === undefined
                    ? 'No records yet.'
                    : `No ${CLASS_NAMES[heroClass]} records yet.`}
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
