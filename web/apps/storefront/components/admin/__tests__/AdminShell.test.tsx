import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

const pathname = { current: '/admin' };
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('../../../lib/admin/actions', () => ({ staffSignOutAction: vi.fn() }));

const { AdminShell, displayNameOf } = await import('../AdminShell');

const USER = {
  id: 'u1',
  email: 'rahim@barakah.test',
  fullName: 'Rahim Uddin',
  phoneVerified: false,
  role: 'OPS' as const,
  createdAt: '2026-11-01',
};

beforeEach(() => {
  pathname.current = '/admin';
});

describe('AdminShell', () => {
  it('names who is signed in and their role, and signs out through the action', () => {
    renderWithIntl(
      <AdminShell user={USER}>
        <p>page</p>
      </AdminShell>,
    );

    expect(screen.getAllByText('Rahim Uddin')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Operations')[0]).toBeInTheDocument();
    const signOut = screen.getAllByRole('button', { name: 'Sign out' })[0]!;
    expect(signOut.closest('form')).toHaveAttribute('action');
    expect(screen.getByRole('main')).toHaveTextContent('page');
  });

  it('marks the current section in the navigation', () => {
    renderWithIntl(<AdminShell user={USER}>x</AdminShell>);

    const nav = screen.getAllByRole('navigation', { name: 'Admin sections' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark the overview while on another admin page', () => {
    pathname.current = '/admin/orders';
    renderWithIntl(<AdminShell user={USER}>x</AdminShell>);

    const nav = screen.getAllByRole('navigation', { name: 'Admin sections' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('offers a skip link to the page content', () => {
    renderWithIntl(<AdminShell user={USER}>x</AdminShell>);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#admin-main',
    );
  });
});

describe('displayNameOf', () => {
  it('falls back to the email’s local part without a name', () => {
    expect(displayNameOf({ ...USER, fullName: '  ' })).toBe('rahim');
    expect(displayNameOf(USER)).toBe('Rahim Uddin');
  });
});
