import type { BoardPage, BoardView } from '@gravoth/contracts';
import { api } from '../api.js';
import { ClassBadge, Empty, Loaded, Panel } from '../components/bits.js';
import { PageTitle } from '../components/layout.js';
import { useLoad } from '../components/use-load.js';
import { formatScore } from '../format.js';
import { Link, useNavigation, useQuery } from '../router.js';

export const boardHref = (board: Pick<BoardView, 'key' | 'hardcore'>) =>
  `/boards/${board.key}${board.hardcore ? '?hardcore=true' : ''}`;

/** One board's card: its top three, and the way in. */
const BoardCard = ({ board }: { board: BoardView }) => {
  const [top] = useLoad<BoardPage>(`${board.key}:${board.hardcore}`, () =>
    api.board(board.key, { hardcore: board.hardcore, take: 3 }),
  );
  return (
    <Panel className="board-card">
      <Link to={boardHref(board)} className="board-card-title">
        <h2>{board.title}</h2>
        <span className="board-card-hint">
          {board.sort === 'asc' ? 'Fastest first' : 'Highest first'}
        </span>
      </Link>
      <Loaded load={top}>
        {(page) =>
          page.entries.data.length === 0 ? (
            <Empty>No records yet. Be the first.</Empty>
          ) : (
            <ol className="podium">
              {page.entries.data.map((entry) => (
                <li
                  key={entry.id}
                  className={`podium-row podium-${entry.rank}`}
                >
                  <span className="podium-rank">{entry.rank}</span>
                  <Link to={`/builds/${entry.build.id}`} className="podium-who">
                    <span className="podium-hero">{entry.hero.name}</span>
                    <span className="podium-player">
                      {entry.player.displayName}
                    </span>
                  </Link>
                  <ClassBadge heroClass={entry.hero.class} />
                  <span className="podium-score">
                    {formatScore(entry.score, board.format)}
                  </span>
                </li>
              ))}
            </ol>
          )
        }
      </Loaded>
      <Link to={boardHref(board)} className="board-card-more">
        Whole board
      </Link>
    </Panel>
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
        <div className="segmented" role="group" aria-label="Mode">
          <button
            type="button"
            className={hardcore ? 'segment' : 'segment active'}
            aria-pressed={!hardcore}
            onClick={() => navigate('/boards', { replace: true })}
          >
            Normal
          </button>
          <button
            type="button"
            className={hardcore ? 'segment active' : 'segment'}
            aria-pressed={hardcore}
            onClick={() => navigate('/boards?hardcore=true', { replace: true })}
          >
            Hardcore
          </button>
        </div>
      </PageTitle>
      <Loaded load={boards} retry={reload}>
        {(list) =>
          list.boards.length === 0 ? (
            <Empty>No boards yet.</Empty>
          ) : (
            <div className="board-grid">
              {list.boards.map((board) => (
                <BoardCard
                  key={`${board.key}:${board.hardcore}`}
                  board={board}
                />
              ))}
            </div>
          )
        }
      </Loaded>
    </>
  );
};
