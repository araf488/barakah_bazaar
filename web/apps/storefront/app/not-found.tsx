import { DEFAULT_LOCALE } from '@barakah/ui';

/** Bilingual on purpose: this page sits outside every locale, so it cannot know which to use. */
export const GLOBAL_NOT_FOUND_HEADING = 'পৃষ্ঠাটি পাওয়া যায়নি · Page not found';

/** Label of the way back; `/` is redirected into the default locale by the proxy. */
export const GLOBAL_NOT_FOUND_HOME_LABEL = 'হোমে ফিরুন · Back to home';

const HOME_PATH = '/';

/**
 * Reached only by a request the locale proxy did not redirect (a path with a file extension
 * that does not exist). It has no locale layout around it, so it owns its document shell.
 */
export default function GlobalNotFound() {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <main>
          <h1>{GLOBAL_NOT_FOUND_HEADING}</h1>
          <a href={HOME_PATH}>{GLOBAL_NOT_FOUND_HOME_LABEL}</a>
        </main>
      </body>
    </html>
  );
}
