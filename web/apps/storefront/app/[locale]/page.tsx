import { serverApiBaseUrl } from '../../lib/api/config';

async function isApiUp(): Promise<boolean> {
  const base = serverApiBaseUrl();
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  const up = await isApiUp();
  return (
    <div data-locale={locale} className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <h1>Barakah Bazaar</h1>
      <p>{up ? 'API: up' : 'API: unavailable'}</p>
    </div>
  );
}
