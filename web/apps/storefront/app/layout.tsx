import type { ReactNode } from 'react';

export const metadata = { title: 'Barakah Bazaar' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
