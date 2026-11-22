import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api.js';

export type Load<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: ApiError }
  | { readonly state: 'ready'; readonly value: T };

/** What a finished load answered, and for which key and round. */
interface Settled<T> {
  readonly key: string;
  readonly round: number;
  readonly load: Load<T>;
}

const LOADING = { state: 'loading' } as const;

/**
 * Loads once per change of `key`, and again on `reload`. A load that a newer
 * one replaced never lands, so a fast click through pages shows the last. A
 * reload keeps showing what it had until the new answer comes; a new key shows
 * loading at once (worked out while rendering, not set from an effect).
 */
export const useLoad = <T>(
  key: string,
  load: () => Promise<T>,
): [Load<T>, () => void] => {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [round, setRound] = useState(0);
  const loader = useRef(load);

  // The latest function, so the effect below needs only the key and the round.
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    let live = true;
    loader
      .current()
      .then((value) => {
        if (live) setSettled({ key, round, load: { state: 'ready', value } });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setSettled({
          key,
          round,
          load: {
            state: 'error',
            error:
              error instanceof ApiError ? error : new ApiError(0, 'NETWORK'),
          },
        });
      });
    return () => {
      live = false;
    };
  }, [key, round]);

  const reload = useCallback(() => setRound((value) => value + 1), []);

  if (settled === null || settled.key !== key) return [LOADING, reload];
  if (settled.round !== round && settled.load.state !== 'ready')
    return [LOADING, reload];
  return [settled.load, reload];
};
