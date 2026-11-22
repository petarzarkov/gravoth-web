import type { BoardView, EntryView, HeroClass } from '@gravoth/contracts';
import { HERO_CLASSES } from '@gravoth/contracts/constants';
import { api, withQuery } from '../api.js';
import { ClassBadge, Empty, ErrorNote, HardcoreBadge, Loaded, Panel, Spinner, VerdictBadge } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { CLASS_NAMES, formatCompact, formatScore } from '../format.js';
import { Link, useNavigation, useQuery } from '../router.js';
import { isGuest, useSession } from '../session.js';

const isClass = (value: string | null): value is HeroClass =>
  value !== null && (HERO_CLASSES as readonly string[]).includes(value);

const EntryRow = ({ entry, board, mine }: { entry: EntryView; board: BoardView; mine: boolean }) => (
  <tr className={mine ? 'row-mine' : undefined}>
    <td className="cell-rank">{entry.rank}</td>
    <td className="cell-hero">
      <Link to={`/builds/${entry.build.id}`} className="hero-link">
        {entry.hero.name}
      </Link>
      <span className="cell-player">{entry.player.hidden ? 'Hidden player' : entry.player.displayName}</span>
    </td>
    <td>
      <ClassBadge heroClass={entry.hero.class} />
    </td>
    <td className="cell-num">{entry.build.level}</td>
    <td className="cell-num cell-score">{formatScore(entry.score, board.format)}</td>
    <td className="cell-num cell-wide">{formatCompact(entry.build.dps)}</td>
    <td className="cell-num cell-wide">{formatCompact(entry.build.ehp)}</td>
    <td className="cell-wide">
      <VerdictBadge verdict={entry.verdict} />
    </td>
  </tr>
);

const EntryTable = ({ board, entries, me }: { board: BoardView; entries: readonly EntryView[]; me?: string | undefined }) => (
  <div className="table-wrap">
    <table className="board-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Hero</th>
          <th scope="col">Class</th>
          <th scope="col" className="cell-num">
            Lvl
          </th>
          <th scope="col" className="cell-num">
            {board.format === 'time_ms' ? 'Time' : 'Score'}
          </th>
          <th scope="col" className="cell-num cell-wide">
            DPS
          </th>
          <th scope="col" className="cell-num cell-wide">
            EHP
          </th>
          <th scope="col" className="cell-wide">
            Check
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} board={board} mine={me !== undefined && entry.player.userId === me} />
        ))}
      </tbody>
    </table>
  </div>
);

/** The caller's best on this board and the rows around it. */
const MyPlace = ({ boardKey, scope }: { boardKey: string; scope: { hardcore: boolean; class?: HeroClass | undefined; view: 'all' | 'friends' } }) => {
  const { session } = useSession();
  const [around] = useLoad(`${boardKey}:${JSON.stringify(scope)}:me`, () => api.aroundMe(boardKey, { ...scope, around: 2 }));
  if (around.state === 'loading') return <Spinner label="Finding your place" />;
  if (around.state === 'error') return <ErrorNote error={around.error} />;
  const { entry, neighbours, board } = around.value;
  return (
    <Panel title="Your place">
      {entry === null ? (
        <Empty>None of your heroes is on this board yet. Records are posted from the game.</Empty>
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
  const view = query.get('view') === 'friends' && signedIn && !isGuest(session) ? 'friends' : 'all';
  const cursor = query.get('cursor') ?? undefined;
  const direction = query.get('direction') === 'backward' ? 'backward' : 'forward';

  const scope = { hardcore, class: heroClass, view } as const;
  const [page, reload] = useLoad(`${boardKey}:${hardcore}:${heroClass}:${view}:${cursor}:${direction}:${session?.user.id}`, () =>
    api.board(boardKey, { ...scope, take: 50, cursor, direction }),
  );

  const go = (changes: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = {
      hardcore: hardcore ? 'true' : undefined,
      class: heroClass,
      view: view === 'friends' ? 'friends' : undefined,
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
              <>
                {board.hardcore ? <HardcoreBadge /> : null} {board.sort === 'asc' ? 'Fastest first.' : 'Highest first.'} Each row
                opens the build that set it.
              </>
            }
          >
            <Link to={board.hardcore ? '/?hardcore=true' : '/'} className="button button-quiet">
              All boards
            </Link>
          </PageTitle>

          <div className="filters" role="group" aria-label="Filters">
            <div className="segmented" role="group" aria-label="Mode">
              <button type="button" className={hardcore ? 'segment' : 'segment active'} aria-pressed={!hardcore} onClick={() => go({ hardcore: undefined, cursor: undefined, direction: undefined })}>
                Normal
              </button>
              <button type="button" className={hardcore ? 'segment active' : 'segment'} aria-pressed={hardcore} onClick={() => go({ hardcore: 'true', cursor: undefined, direction: undefined })}>
                Hardcore
              </button>
            </div>
            <label className="select">
              <span>Class</span>
              <select value={heroClass ?? ''} onChange={(event) => go({ class: event.target.value === '' ? undefined : event.target.value, cursor: undefined, direction: undefined })}>
                <option value="">All classes</option>
                {HERO_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {CLASS_NAMES[value]}
                  </option>
                ))}
              </select>
            </label>
            {signedIn && !isGuest(session) ? (
              <div className="segmented" role="group" aria-label="Who">
                <button type="button" className={view === 'all' ? 'segment active' : 'segment'} aria-pressed={view === 'all'} onClick={() => go({ view: undefined, cursor: undefined, direction: undefined })}>
                  Everyone
                </button>
                <button type="button" className={view === 'friends' ? 'segment active' : 'segment'} aria-pressed={view === 'friends'} onClick={() => go({ view: 'friends', cursor: undefined, direction: undefined })}>
                  Friends
                </button>
              </div>
            ) : null}
          </div>

          {signedIn ? <MyPlace boardKey={boardKey} scope={scope} /> : null}

          <Panel title={view === 'friends' ? 'You and your friends' : 'The board'}>
            {entries.data.length === 0 ? (
              <Empty>{heroClass === undefined ? 'No records yet.' : `No ${CLASS_NAMES[heroClass]} records yet.`}</Empty>
            ) : (
              <EntryTable board={board} entries={entries.data} me={session?.user.id} />
            )}
            {entries.meta.hasPreviousPage || entries.meta.hasNextPage ? (
              <div className="pager">
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={!entries.meta.hasPreviousPage || entries.meta.previousCursor === null}
                  onClick={() => go({ cursor: entries.meta.previousCursor ?? undefined, direction: 'backward' })}
                >
                  Higher
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={!entries.meta.hasNextPage || entries.meta.nextCursor === null}
                  onClick={() => go({ cursor: entries.meta.nextCursor ?? undefined, direction: undefined })}
                >
                  Lower
                </button>
              </div>
            ) : null}
          </Panel>
        </>
      )}
    </Loaded>
  );
};
