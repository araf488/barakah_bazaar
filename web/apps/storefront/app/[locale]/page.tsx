/** Fallback when the build/runtime env does not name the API (the monolith's own port). */
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

async function isApiUp(): Promise<boolean> {
  const base = process.env.WEB_INTERNAL_API_BASE_URL ?? DEFAULT_API_BASE_URL;
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
    <main data-locale={locale}>
      <h1>Barakah Bazaar</h1>
      <p>{up ? 'API: up' : 'API: unavailable'}</p>
    </main>
  );
}
