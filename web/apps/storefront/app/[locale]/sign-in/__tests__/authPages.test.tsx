import { screen } from '@testing-library/react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../../test/intl';

const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}));
vi.mock('../../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../i18n/navigation')>()),
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../lib/auth/actions', () => ({}));

const { default: SignInPage } = await import('../page');
const { default: VerifyEmailPage } = await import('../../verify-email/page');
const { default: ResetPasswordPage } = await import('../../reset-password/page');
const { getCurrentUser } = await import('../../../../lib/auth/session');
const { redirect } = await import('../../../../i18n/navigation');
const { AuthShell } = await import('../../../../components/auth/AuthShell');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};
const findProps = (tree: AnyElement[], name: string) =>
  tree.find((el) => typeof el.type === 'function' && el.type.name === name)?.props;

const params = Promise.resolve({ locale: 'en' });

describe('sign-in page', () => {
  beforeEach(() => vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null));

  it('passes a safe return path to the form', async () => {
    const tree = elementsOf(
      await SignInPage({ params, searchParams: Promise.resolve({ next: '//evil.example' }) }),
    );
    expect(findProps(tree, 'SignInForm')?.next).toBe('/');
  });

  it('sends a signed-in visitor straight on', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never);
    await expect(
      SignInPage({ params, searchParams: Promise.resolve({ next: '/p/ajwa' }) }),
    ).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({ href: '/p/ajwa', locale: 'en' });
  });
});

describe('email and reset link pages', () => {
  it('hands the emailed token to the verify form', async () => {
    const tree = elementsOf(
      await VerifyEmailPage({ params, searchParams: Promise.resolve({ token: ' tok ' }) }),
    );
    expect(findProps(tree, 'VerifyEmailForm')).toMatchObject({
      token: 'tok',
      intro: 't:linkIntro',
    });
  });

  it('asks for the code when the verify page has no token', async () => {
    const tree = elementsOf(await VerifyEmailPage({ params, searchParams: Promise.resolve({}) }));
    expect(findProps(tree, 'VerifyEmailForm')).toEqual({ intro: 't:codeIntro' });
  });

  it('hands the emailed token to the reset form', async () => {
    const tree = elementsOf(
      await ResetPasswordPage({ params, searchParams: Promise.resolve({ token: 'tok' }) }),
    );
    expect(findProps(tree, 'ResetPasswordForm')).toEqual({ token: 'tok' });
  });
});

describe('AuthShell', () => {
  it('states only facts the API enforces, with no testimonial or certification claim', () => {
    renderWithIntl(
      <AuthShell view="signIn">
        <p>form</p>
      </AuthShell>,
    );

    expect(screen.getByText('Cold-chain delivery for doi and rosmalai')).toBeInTheDocument();
    expect(screen.queryByText(/certified|same-day|member since/i)).not.toBeInTheDocument();
    expect(screen.getByText('form')).toBeInTheDocument();
  });
});
