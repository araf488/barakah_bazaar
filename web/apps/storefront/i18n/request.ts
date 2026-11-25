import { getRequestConfig } from 'next-intl/server';

import { loadMessages, resolveRequestLocale } from './messages';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveRequestLocale(await requestLocale);
  return { locale, messages: await loadMessages(locale) };
});
