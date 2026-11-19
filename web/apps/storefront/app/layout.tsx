import type { ReactNode } from 'react';

/**
 * Next requires a root layout, but `<html lang>` depends on the locale, so the real document
 * shell is `app/[locale]/layout.tsx`. This one only passes through (next-intl's documented
 * pattern), which also lets `app/not-found.tsx` render outside any locale.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
