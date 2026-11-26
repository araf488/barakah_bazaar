import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/admin/actions', () => ({
  staffSignInAction: vi.fn(),
  verifyStaffCodeAction: vi.fn(),
  acceptInvitationAction: vi.fn(),
}));

const actions = await import('../../../lib/admin/actions');
const { StaffSignInForm } = await import('../StaffSignInForm');
const { StaffCodeForm } = await import('../StaffCodeForm');
const { AcceptInvitationForm } = await import('../AcceptInvitationForm');

const submit = (button: string) =>
  fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);
const sent = (action: unknown): Record<string, FormDataEntryValue> => {
  const calls = vi.mocked(action as (prev: unknown, form: FormData) => unknown).mock.calls;
  return Object.fromEntries(calls[0]![1]);
};

beforeEach(() => vi.clearAllMocks());

describe('StaffSignInForm', () => {
  it('sends the email, password and where to go next', async () => {
    vi.mocked(actions.staffSignInAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<StaffSignInForm next="/admin/orders" />);

    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ops@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret pass' } });
    submit('Continue');

    await waitFor(() => expect(actions.staffSignInAction).toHaveBeenCalled());
    expect(sent(actions.staffSignInAction)).toEqual({
      next: '/admin/orders',
      email: 'ops@b.test',
      password: 'secret pass',
    });
  });

  it('shows a refusal, marks both fields and keeps what was typed', async () => {
    vi.mocked(actions.staffSignInAction).mockResolvedValue({
      status: 'error',
      error: 'credentials',
      at: 1,
    });
    renderWithIntl(<StaffSignInForm next="/admin" />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ops@b.test' } });
    submit('Continue');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match a staff account.',
    );
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email address')).toHaveValue('ops@b.test');
  });

  it('links to password reset and to the shop, in English', () => {
    renderWithIntl(<StaffSignInForm next="/admin" />);

    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/en/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Shopping? Go to the shop' })).toHaveAttribute(
      'href',
      '/en/',
    );
  });
});

describe('StaffCodeForm', () => {
  it('sends the authenticator code by default', async () => {
    vi.mocked(actions.verifyStaffCodeAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<StaffCodeForm next="/admin" />);

    expect(screen.getByLabelText('6-digit code')).toHaveAttribute('autocomplete', 'one-time-code');
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    submit('Sign in');

    await waitFor(() => expect(actions.verifyStaffCodeAction).toHaveBeenCalled());
    expect(sent(actions.verifyStaffCodeAction)).toEqual({
      next: '/admin',
      method: 'code',
      code: '123456',
    });
  });

  it('switches to a recovery code and back', async () => {
    vi.mocked(actions.verifyStaffCodeAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<StaffCodeForm next="/admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: '0123456789abcdef0123' },
    });
    submit('Sign in');

    await waitFor(() => expect(actions.verifyStaffCodeAction).toHaveBeenCalled());
    expect(sent(actions.verifyStaffCodeAction)).toMatchObject({
      method: 'recovery',
      recoveryCode: '0123456789abcdef0123',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use the authenticator code instead' }));
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('says when the account is locked after too many codes', async () => {
    vi.mocked(actions.verifyStaffCodeAction).mockResolvedValue({
      status: 'error',
      error: 'locked',
      at: 1,
    });
    renderWithIntl(<StaffCodeForm next="/admin" />);
    submit('Sign in');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many incorrect codes. Try again in 15 minutes.',
    );
  });
});

describe('AcceptInvitationForm', () => {
  it('sends the token, name and both passwords, stating the password rule first', async () => {
    vi.mocked(actions.acceptInvitationAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<AcceptInvitationForm token="tok" />);

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.',
    );
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Rahim' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Mango-season-2026' } });
    fireEvent.change(screen.getByLabelText('Password again'), {
      target: { value: 'Mango-season-2026' },
    });
    submit('Create my account');

    await waitFor(() => expect(actions.acceptInvitationAction).toHaveBeenCalled());
    expect(sent(actions.acceptInvitationAction)).toEqual({
      token: 'tok',
      fullName: 'Rahim',
      password: 'Mango-season-2026',
      confirm: 'Mango-season-2026',
    });
  });

  it('names a broken password rule and marks the password', async () => {
    vi.mocked(actions.acceptInvitationAction).mockResolvedValue({
      status: 'error',
      error: 'passwordCommon',
      at: 1,
    });
    renderWithIntl(<AcceptInvitationForm token="tok" />);
    submit('Create my account');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That password is too common. Choose a different one.',
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password again')).not.toHaveAttribute('aria-invalid');
  });

  it('says the account is ready and leads to sign-in', async () => {
    vi.mocked(actions.acceptInvitationAction).mockResolvedValue({ status: 'accepted' });
    renderWithIntl(<AcceptInvitationForm token="tok" />);
    submit('Create my account');

    expect(
      await screen.findByRole('heading', { name: 'Your account is ready' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute(
      'href',
      '/admin/sign-in',
    );
  });
});
