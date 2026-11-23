import type {
  PlayerHero,
  PlayerPage as PlayerPageView,
} from '@gravoth/contracts';
import {
  AVATAR_BORDERS,
  BOARDS,
  HARDCORE_PREFIX,
  avatarBorderOf,
  hardcoreTitle,
  type AvatarBorder,
} from '@gravoth/contracts/constants';
import {
  Anchor,
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { api } from '../api.js';
import { PlayerAvatar } from '../components/avatar.js';
import { Empty, ErrorNote, HeroBadges, Spinner } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { CLASS_NAMES, formatCompact, formatScore } from '../format.js';
import { Link } from '../router.js';

/** A record's board as the boards name it: its title, the hardcore twin's own, and how its score reads. */
export const recordBoard = (
  key: string,
): { title: string; format: 'number' | 'time_ms'; path: string } => {
  const hardcore = key.startsWith(HARDCORE_PREFIX);
  const base = hardcore ? key.slice(HARDCORE_PREFIX.length) : key;
  const board = BOARDS.find((b) => b.key === base);
  if (board === undefined) return { title: key, format: 'number', path: '' };
  return {
    title: hardcore ? hardcoreTitle(board.title) : board.title,
    format: board.format,
    path: `/boards/${base}${hardcore ? '?hardcore=true' : ''}`,
  };
};

/** The best avatar border any of the player's heroes wears (`AVATAR_BORDERS` is worst to best), or null. */
export const bestBorder = (
  heroes: readonly PlayerHero[],
): AvatarBorder | null => {
  let best: AvatarBorder | null = null;
  for (const { build } of heroes) {
    const border = avatarBorderOf(build?.extras['border']);
    if (
      border !== null &&
      (best === null ||
        AVATAR_BORDERS.indexOf(border) > AVATAR_BORDERS.indexOf(best))
    )
      best = border;
  }
  return best;
};

/** One hero as a card: name (to its build), class and hardcore, online, level, DPS and EHP, and its records. */
const HeroCard = ({ entry }: { entry: PlayerHero }) => {
  const { hero, build, records } = entry;
  return (
    <Card className="player-hero" padding="md">
      <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          {build === null ? (
            <Text fw={700} fz="lg" className="hero-link">
              {hero.name}
            </Text>
          ) : (
            <Anchor
              component={Link}
              to={`/builds/${build.id}`}
              c="gray.0"
              fw={700}
              fz="lg"
              className="hero-link"
            >
              {hero.name}
            </Anchor>
          )}
          <HeroBadges hero={hero} size="xs" mt={4} />
        </div>
        {hero.online ? (
          <Badge
            className="online-badge"
            color="teal"
            size="xs"
            title="An online hero: its save is on the server, and its records are on the boards"
          >
            Online
          </Badge>
        ) : null}
      </Group>
      {build === null ? (
        <Text size="sm" c="dimmed" mt="sm">
          No build yet.
        </Text>
      ) : (
        <SimpleGrid cols={3} spacing="xs" mt="sm" className="hero-numbers">
          <div>
            <Text fw={700} className="num" ta="left">
              {build.level}
            </Text>
            <Text size="xs" c="dimmed">
              Level
            </Text>
          </div>
          <div>
            <Text fw={700} className="num" ta="left" c="gold">
              {formatCompact(build.dps)}
            </Text>
            <Text size="xs" c="dimmed">
              DPS
            </Text>
          </div>
          <div>
            <Text fw={700} className="num" ta="left" c="gold">
              {formatCompact(build.ehp)}
            </Text>
            <Text size="xs" c="dimmed">
              EHP
            </Text>
          </div>
        </SimpleGrid>
      )}
      {build?.ascendancy === undefined || build.ascendancy === null ? null : (
        <Text size="xs" c="dimmed" mt={6}>
          {build.ascendancy}
        </Text>
      )}
      {records.length === 0 ? null : (
        <Stack gap={4} mt="sm" className="hero-records">
          {records.map((record) => {
            const board = recordBoard(record.board);
            return (
              <Group
                key={record.board}
                justify="space-between"
                gap="xs"
                wrap="nowrap"
              >
                {board.path === '' ? (
                  <Text size="sm">{board.title}</Text>
                ) : (
                  <Anchor component={Link} to={board.path} size="sm" c="gray.2">
                    {board.title}
                  </Anchor>
                )}
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" className="score">
                    {formatScore(record.score, board.format)}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    #{record.rank}
                  </Badge>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}
    </Card>
  );
};

/**
 * A player page (decision 226): their picture (wearing their best hero's border), their name, and every hero as a
 * card, each opening its build. A hidden player's page answers only their friends and themselves; to anyone else the
 * server says there is no such player.
 */
export const PlayerPage = ({ userId }: { userId: string }) => {
  const [page, reload] = useLoad(`player:${userId}`, () => api.player(userId));
  if (page.state === 'loading') return <Spinner />;
  if (page.state === 'error') {
    if (page.error.status === 404)
      return (
        <>
          <PageTitle title="No such player" />
          <Empty>
            This player is not here, or their page is for their friends only.{' '}
            <Link to="/boards">Back to the boards</Link>.
          </Empty>
        </>
      );
    return <ErrorNote error={page.error} retry={reload} />;
  }
  const view: PlayerPageView = page.value;
  const border = bestBorder(view.heroes);
  // Decision 230: what the heroes are, as the game says it (their titles; the class only where the server has none).
  const classes = [
    ...new Set(
      view.heroes.map((h) => h.hero.title ?? CLASS_NAMES[h.hero.class]),
    ),
  ];
  return (
    <>
      <Group gap="md" mb="lg" wrap="nowrap" className="player-head">
        <PlayerAvatar
          avatar={view.player.avatar}
          size={border === null ? 72 : 64}
          label={view.player.displayName}
          {...(border === null ? {} : { border })}
        />
        <div style={{ minWidth: 0 }}>
          <PageTitle
            title={view.player.displayName}
            sub={
              <span>
                {view.heroes.length === 1
                  ? '1 hero'
                  : `${view.heroes.length} heroes`}
                {classes.length === 0 ? '' : ` · ${classes.join(', ')}`}
                {view.player.hidden ? ' · Hidden: friends only' : ''}
              </span>
            }
          />
        </div>
      </Group>
      <Title order={2} size="h5" className="panel-title" mb="md">
        Heroes
      </Title>
      {view.heroes.length === 0 ? (
        <Empty>
          No heroes yet. They show up here once the game sends them.
        </Empty>
      ) : (
        <SimpleGrid
          cols={{ base: 1, xs: 2, md: 3 }}
          spacing="md"
          className="player-heroes"
        >
          {view.heroes.map((entry) => (
            <HeroCard key={entry.hero.id} entry={entry} />
          ))}
        </SimpleGrid>
      )}
    </>
  );
};
