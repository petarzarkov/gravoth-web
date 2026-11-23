/** A board's cursors (decision 223's pages): where a row stands, and a cursor the boards service minted read back. */
import { HttpError, HttpStatusCode } from '@dunx/http';
import { CursorError, decodeCursor } from '@dunx/infra/pagination/cursor';

/** The position a cursor or a row stands at, in board order. */
export interface Mark {
  readonly score: number;
  readonly achievedAt: Date;
  readonly id: string;
}

export const markOfRow = (row: {
  entry: { score: number; achievedAt: Date; id: string };
}): Mark => ({
  score: row.entry.score,
  achievedAt: row.entry.achievedAt,
  id: row.entry.id,
});

/**
 * A cursor this service minted: `<score>|<ISO time>` and the row id. Anything else is a 400 `INVALID_CURSOR`, raised
 * as an `HttpError` so the request log records the 400 the caller gets.
 */
export const markOf = (cursor: string): Mark => {
  const invalid = () =>
    new HttpError(HttpStatusCode.BAD_REQUEST, 'INVALID_CURSOR');
  let decoded;
  try {
    decoded = decodeCursor(cursor);
  } catch (error) {
    if (error instanceof CursorError) throw invalid();
    throw error;
  }
  const [score, at] = decoded.s.split('|');
  const achievedAt = new Date(at ?? '');
  if (
    score === undefined ||
    !/^\d+$/.test(score) ||
    Number.isNaN(achievedAt.getTime()) ||
    !/^[0-9a-f-]{36}$/.test(decoded.i)
  )
    throw invalid();
  return { score: Number(score), achievedAt, id: decoded.i };
};
