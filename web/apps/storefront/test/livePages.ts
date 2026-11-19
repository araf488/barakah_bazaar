import { LIVE_PAGES, type LivePage } from '../lib/routes';

const ALL_PAGES = Object.keys(LIVE_PAGES) as LivePage[];
const SHIPPED = { ...LIVE_PAGES };

/** Marks pages as built for one test, so the links that wait on them render. */
export const setLivePages = (pages: LivePage[] | 'all'): void => {
  const live = pages === 'all' ? ALL_PAGES : pages;
  for (const page of ALL_PAGES) {
    LIVE_PAGES[page] = live.includes(page);
  }
};

/** Puts the registry back to what production ships. Call in `afterEach`. */
export const restoreLivePages = (): void => {
  Object.assign(LIVE_PAGES, SHIPPED);
};
