/**
 * `value` without its trailing slashes. A loop rather than a regex, so no input can make it
 * backtrack.
 */
export const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
};

/**
 * Joins a base URL and a relative path with exactly one slash, keeping any path the base already
 * carries. `new URL(path, base)` would drop the base's last segment when it has no trailing slash.
 */
export const joinUrl = (base: string, path: string): string =>
  `${stripTrailingSlashes(base)}/${path}`;
