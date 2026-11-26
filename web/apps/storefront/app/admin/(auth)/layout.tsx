import type { ReactNode } from 'react';

import { BrandMark } from '../../../components/shell/BrandMark';
import { SHELL_COPY } from '../../../lib/admin/copy';

/** Sign-in, its second steps and invitation acceptance: one card on the brand's dark green. */
export default function AdminAuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-dark px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <BrandMark tone="onDark" />
          <span className="rounded-full border border-white/20 px-2.5 py-1 text-xs font-semibold text-white/80">
            {SHELL_COPY.portalLabel}
          </span>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">{children}</div>
      </div>
    </main>
  );
}
