import type { BoardPage, BoardView } from '@gravoth/contracts';
import {
  Anchor,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { api } from '../api.js';
import { PlayerAvatar } from '../components/avatar.js';
import { ClassBadge, Empty, Loaded } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatScore } from '../format.js';
import { Link, useNavigation, useQuery } from '../router.js';

export const boardHref = (board: Pick<BoardView, 'key' | 'hardcore'>) =>
  `/boards/${board.key}${board.hardcore ? '?hardcore=true' : ''}`;

const RANK_COLOURS = ['var(--gold)', '#d9d9d9', '#d98f52'];

/** One board's card: its top three, and the way in. */
const BoardCard = ({ board }: { board: BoardView }) => {
  const [top] = useLoad<BoardPage>(`${board.key}:${board.hardcore}`, () =>
    api.board(board.key, { hardcore: board.hardcore, take: 3 }),
  );
  return (
    <Card className="board-card">
      <UnstyledButton component={Link} to={boardHref(board)} mb="md">
        <Title order={2} size="h4">
          {board.title}
        </Title>
        <Text size="xs" c="dimmed" tt="uppercase" lts="0.12em">
          {board.sort === 'asc' ? 'Fastest first' : 'Highest first'}
        </Text>
      </UnstyledButton>
      <Loaded load={top}>
        {(page) =>
          page.entries.data.length === 0 ? (
            <Empty>No records yet. Be the first.</Empty>
          ) : (
            <Stack gap={6}>
              {page.entries.data.map((entry) => (
                <Card
                  key={entry.id}
                  padding="xs"
                  bg="dark.7"
                  withBorder={false}
                >
                  <Group gap="sm" wrap="nowrap">
                    <Text
                      ff="heading"
                      fz="lg"
                      w={24}
                      ta="center"
                      c={RANK_COLOURS[entry.rank - 1] ?? 'dimmed'}
                    >
                      {entry.rank}
                    </Text>
                    <PlayerAvatar avatar={entry.player.avatar} size={30} />
                    <UnstyledButton
                      component={Link}
                      to={`/builds/${entry.build.id}`}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text fw={600} truncate>
                        {entry.hero.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {entry.player.displayName}
                      </Text>
                    </UnstyledButton>
                    <ClassBadge heroClass={entry.hero.class} />
                    <Text className="score">
                      {formatScore(entry.score, board.format)}
                    </Text>
                  </Group>
                </Card>
              ))}
            </Stack>
          )
        }
      </Loaded>
      <Anchor component={Link} to={boardHref(board)} size="sm" mt="md">
        Whole board
      </Anchor>
    </Card>
  );
};

/** `/boards`: every board with its top three, normal or hardcore. */
export const BoardsPage = () => {
  const query = useQuery();
  const { navigate } = useNavigation();
  const hardcore = query.get('hardcore') === 'true';
  const [boards, reload] = useLoad(`boards:${hardcore}`, () =>
    api.boards(hardcore),
  );

  return (
    <>
      <PageTitle
        title="Leaderboards"
        sub="Every record on the boards, with the whole build that set it: skills, gear, every affix."
      >
        <SegmentedControl
          className="filters"
          radius="xl"
          value={hardcore ? 'hardcore' : 'normal'}
          onChange={(value) =>
            navigate(
              value === 'hardcore' ? '/boards?hardcore=true' : '/boards',
              {
                replace: true,
              },
            )
          }
          data={[
            { value: 'normal', label: 'Normal' },
            { value: 'hardcore', label: 'Hardcore' },
          ]}
        />
      </PageTitle>
      <Loaded load={boards} retry={reload}>
        {(list) =>
          list.boards.length === 0 ? (
            <Empty>No boards yet.</Empty>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
              {list.boards.map((board) => (
                <BoardCard
                  key={`${board.key}:${board.hardcore}`}
                  board={board}
                />
              ))}
            </SimpleGrid>
          )
        }
      </Loaded>
    </>
  );
};
