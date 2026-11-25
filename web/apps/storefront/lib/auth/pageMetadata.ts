import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { StorefrontLocale } from '../../i18n/messages';

type TitledView = 'signIn' | 'register' | 'verify' | 'forgot' | 'reset';

/** Auth pages are titled per view and kept out of search results. */
export const authPageMetadata = async (locale: string, view: TitledView): Promise<Metadata> => {
  const t = await getTranslations({ locale: locale as StorefrontLocale });
  return {
    title: `${t(`auth.${view}.title`)} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
};
