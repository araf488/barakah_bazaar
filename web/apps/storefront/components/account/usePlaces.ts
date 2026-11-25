'use client';

import { useEffect, useState } from 'react';

export type PlacesState<T> =
  | { status: 'idle'; items: T[] }
  | { status: 'loading'; items: T[] }
  | { status: 'ready'; items: T[] }
  | { status: 'error'; items: T[] };

const idle = <T>(): PlacesState<T> => ({ status: 'idle', items: [] });

/**
 * One level of the place chain. `load` is null until the level above is chosen; a new `key`
 * (the parent's value) refetches and drops any answer still on its way for the old one.
 */
export function usePlaces<T>(load: (() => Promise<T[]>) | null, key: string) {
  const [state, setState] = useState<PlacesState<T>>(idle<T>);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!load) {
      setState(idle<T>());
      return undefined;
    }
    let current = true;
    setState({ status: 'loading', items: [] });
    load()
      .then((items) => current && setState({ status: 'ready', items }))
      .catch(() => current && setState({ status: 'error', items: [] }));
    return () => {
      current = false;
    };
    // `load` is rebuilt every render on purpose; `key` and `attempt` decide a refetch.
  }, [key, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
