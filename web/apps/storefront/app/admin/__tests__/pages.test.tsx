import { screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';
import { renderWithIntl } from '../../../test/intl';

const jar = { current: fakeJar() };
const REDIRECTED = new Error('NEXT_REDIRECT');
const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/headers', () => ({ cookies: async () => jar.current }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
  usePathname: () => '/admin',
}));
vi.mock('../../../lib/admin/session', () => ({ getStaffUser: vi.fn(), requireStaff: vi.fn() }));
vi.mock('../../../lib/admin/actions', () => ({}));
vi.mock('../../fonts', () => ({ fontVariables: 'fonts' }));

const { default: SignInPage } = await import('../(auth)/sign-in/page');
const { default: VerifyPage } = await import('../(auth)/sign-in/verify/page');
const { default: SetupPage } = await import('../(auth)/sign-in/setup/page');
const { default: AcceptInvitationPage } = await import('../(auth)/accept-invitation/page');
const { default: PortalLayout } = await import('../(portal)/layout');
const { default: OverviewPage } = await import('../(portal)/page');
const { metadata } = await import('../layout');
const { default: UnknownAdminPage } = await import('../[...rest]/page');
const { default: AdminNotFound } = await import('../not-found');
const { StaffSignInForm } = await import('../../../components/admin/StaffSignInForm');
const { StaffCodeForm } = await import('../../../components/admin/StaffCodeForm');
const { MfaSetup } = await import('../../../components/admin/MfaSetup');
const { AcceptInvitationForm } = await import('../../../components/admin/AcceptInvitationForm');
const { AdminShell } = await import('../../../components/admin/AdminShell');
const { getStaffUser, requireStaff } = await import('../../../lib/admin/session');
const { redirect } = await import('next/navigation');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const query = (values: Record<string, string>) => ({ searchParams: Promise.resolve(values) });
const USER = {
  id: 'u1',
  email: 'rahim@barakah.test',
  fullName: 'Rahim Uddin',
  phoneVerified: false,
  role: 'WAREHOUSE' as const,
  createdAt: '2026-11-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  jar.current = fakeJar();
});

describe('admin root layout', () => {
  it('keeps every portal page out of search results and names it in the tab', () => {
    expect(metadata).toMatchObject({
      title: { default: 'Barakah Bazaar Admin', template: '%s · Barakah Bazaar Admin' },
      robots: { index: false, follow: false },
    });
  });
});

describe('sign-in page', () => {
  it('shows the form, carrying a safe destination', async () => {
    vi.mocked(getStaffUser).mockResolvedValue(null);

    const page = (await SignInPage(query({ next: '/admin/orders' }))) as AnyElement;

    expect(page.type).toBe(StaffSignInForm);
    expect(page.props.next).toBe('/admin/orders');
  });

  it('sends a signed-in staff member straight on', async () => {
    vi.mocked(getStaffUser).mockResolvedValue(USER);

    await expect(SignInPage(query({ next: 'https://evil.example' }))).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith('/admin');
  });
});

describe('second-step pages', () => {
  it('opens the code step only with an MFA challenge pending', async () => {
    jar.current = fakeJar({ bb_staff_challenge: 'mfa:m' });
    const page = (await VerifyPage(query({ next: '/admin/x' }))) as AnyElement;
    expect(page.type).toBe(StaffCodeForm);
    expect(page.props.next).toBe('/admin/x');

    jar.current = fakeJar({ bb_staff_challenge: 'enrolment:e' });
    await expect(VerifyPage(query({}))).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith('/admin/sign-in');
  });

  it('lets authenticator setup start only with an enrolment challenge pending', async () => {
    jar.current = fakeJar({ bb_staff_challenge: 'enrolment:e' });
    const pending = (await SetupPage()) as AnyElement;
    expect(pending.type).toBe(MfaSetup);
    expect(pending.props.active).toBe(true);

    // No redirect: the page is drawn again right after setup ends, codes still on screen.
    jar.current = fakeJar({ bb_staff_challenge: 'mfa:m' });
    const lapsed = (await SetupPage()) as AnyElement;
    expect(lapsed.type).toBe(MfaSetup);
    expect(lapsed.props.active).toBe(false);
  });
});

describe('accept-invitation page', () => {
  it('hands the token to the form', async () => {
    const page = (await AcceptInvitationPage(query({ token: ' tok ' }))) as AnyElement;

    expect(page.type).toBe(AcceptInvitationForm);
    expect(page.props.token).toBe('tok');
  });

  it('says the link is not valid when it carries no token', async () => {
    renderWithIntl((await AcceptInvitationPage(query({}))) as AnyElement);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This invitation link is not valid. Ask a super admin to send a new one.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('portal', () => {
  it('wraps a signed-in staff member’s page in the shell', async () => {
    vi.mocked(getStaffUser).mockResolvedValue(USER);

    const layout = (await PortalLayout({ children: 'page' })) as AnyElement;

    expect(layout.type).toBe(AdminShell);
    expect(layout.props.user).toBe(USER);
  });

  it('draws no shell without a session, leaving the page to redirect', async () => {
    vi.mocked(getStaffUser).mockResolvedValue(null);

    await expect(PortalLayout({ children: 'page' })).resolves.toBe('page');
  });

  it('greets the staff member on the overview, with their email and role', async () => {
    vi.mocked(requireStaff).mockResolvedValue(USER);

    renderWithIntl((await OverviewPage()) as AnyElement);

    expect(requireStaff).toHaveBeenCalledWith('/admin');
    expect(screen.getByRole('heading', { name: 'Welcome back, Rahim Uddin' })).toBeInTheDocument();
    expect(screen.getByText('rahim@barakah.test')).toBeInTheDocument();
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });
});

describe('unknown admin paths', () => {
  it('answers inside the portal, not with the shop’s 404', () => {
    expect(() => UnknownAdminPage()).toThrow(NOT_FOUND);

    renderWithIntl(<AdminNotFound />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});
