import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api.js';

export type Load<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: ApiError }
  | { readonly state: 'ready'; readonly value: T };

/**
 * Loads once per change of `key`, and again on `reload`. A load that a newer
 * one replaced never lands, so a fast click through pages shows the last.
 */
export const useLoad = <T>(
  key: string,
  load: () => Promise<T>,
): [Load<T>, () => void] => {
  const [result, setResult] = useState<Load<T>>({ state: 'loading' });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const ticket = ++latest.current;
    setResult((previous) => (previous.state === 'ready' && round > 0 ? previous : { state: 'loading' }));
    loader
      .current()
      .then((value) => {
        if (ticket === latest.current) setResult({ state: 'ready', value });
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return;
        setResult({
          state: 'error',
          error: error instanceof ApiError ? error : new ApiError(0, 'NETWORK'),
        });
      });
  }, [key, round]);

  const reload = useCallback(() => setRound((value) => value + 1), []);
  return [result, reload];
};
