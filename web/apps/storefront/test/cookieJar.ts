import { vi } from 'vitest';

/** A cookie jar that records what was set and deleted, shaped like Next's. */
export const fakeJar = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const options = new Map<string, Record<string, unknown>>();
  return {
    values,
    options,
    get: vi.fn((name: string) =>
      values.has(name) ? { name, value: values.get(name) as string } : undefined,
    ),
    has: vi.fn((name: string) => values.has(name)),
    set: vi.fn((name: string, value: string, opts: Record<string, unknown> = {}) => {
      values.set(name, value);
      options.set(name, opts);
    }),
    delete: vi.fn((name: string) => {
      values.delete(name);
    }),
  };
};
