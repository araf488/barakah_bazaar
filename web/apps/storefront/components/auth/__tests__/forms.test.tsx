import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/auth/actions', () => ({
  signInAction: vi.fn(),
  verifyMfaAction: vi.fn(),
  registerAction: vi.fn(),
  verifyEmailAction: vi.fn(),
  resendVerificationAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
  resetPasswordAction: vi.fn(),
}));

const actions = await import('../../../lib/auth/actions');
const { SignInForm } = await import('../SignInForm');
const { RegisterForm } = await import('../RegisterForm');
const { VerifyEmailForm } = await import('../VerifyEmailForm');
const { ForgotPasswordForm, ResetPasswordForm } = await import('../PasswordResetForms');

/**
 * Submits the form the named button belongs to. Dispatching `submit` skips the browser's own
 * `required` check, which is not what these tests are about: they cover what each action's
 * answer does to the form.
 */
const submit = async (button: string | RegExp) => {
  const form = screen.getByRole('button', { name: button }).closest('form');
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
};

beforeEach(() => vi.clearAllMocks());

describe('SignInForm', () => {
  it('labels its fields and links to reset and registration', () => {
    renderWithIntl(<SignInForm next="/" />);

    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/en/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/en/register',
    );
  });

  it('shows and hides the password on request', () => {
    renderWithIntl(<SignInForm next="/" />);

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('shows the refusal next to the form and marks the field, keeping what was typed', async () => {
    vi.mocked(actions.signInAction).mockResolvedValue({ status: 'error', error: 'credentials' });
    renderWithIntl(<SignInForm next="/" />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong one' } });

    await submit('Sign in');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That email and password do not match an account.',
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email address')).toHaveValue('a@b.co');
  });

  it('moves to the code step for an account with two-step verification, and back', async () => {
    vi.mocked(actions.signInAction).mockResolvedValue({ status: 'mfa' });
    renderWithIntl(<SignInForm next="/p/ajwa" />);

    await submit('Sign in');

    expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    expect(screen.getByLabelText('6-digit code')).toHaveAttribute('autocomplete', 'one-time-code');
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lets the server validate, so errors appear in the page’s language, not the browser’s', () => {
    const { container } = renderWithIntl(<SignInForm next="/" />, 'bn');
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('carries the page to return to', () => {
    const { container } = renderWithIntl(<SignInForm next="/p/ajwa" />);
    expect(container.querySelector('input[name="next"]')).toHaveValue('/p/ajwa');
  });
});

describe('RegisterForm', () => {
  it('asks for a 12-character password and says so', () => {
    renderWithIntl(<RegisterForm />);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 12 characters.',
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('minlength', '12');
  });

  it('moves on to the emailed code once registered, with the email filled in', async () => {
    vi.mocked(actions.registerAction).mockResolvedValue({ status: 'sent', email: 'a@b.co' });
    renderWithIntl(<RegisterForm />);

    await submit('Create account');

    expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue('a@b.co');
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });
});

describe('VerifyEmailForm', () => {
  it('confirms an emailed link only when the visitor presses the button', async () => {
    vi.mocked(actions.verifyEmailAction).mockResolvedValue({ status: 'done' });
    const { container } = renderWithIntl(<VerifyEmailForm token="tok" intro="Confirm it." />);

    expect(actions.verifyEmailAction).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="token"]')).toHaveValue('tok');
    await submit('Confirm my email');

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your email is confirmed. You can sign in now.',
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/sign-in');
  });

  it('offers a new link when the old one has expired', async () => {
    vi.mocked(actions.verifyEmailAction).mockResolvedValue({ status: 'error', error: 'expired' });
    vi.mocked(actions.resendVerificationAction).mockResolvedValue({
      status: 'sent',
      email: 'a@b.co',
    });
    renderWithIntl(<VerifyEmailForm intro="Enter the code." />);

    await submit('Confirm email');
    expect(screen.getByRole('alert')).toHaveTextContent('This link or code has expired');

    fireEvent.change(screen.getAllByLabelText('Email address')[1]!, {
      target: { value: 'a@b.co' },
    });
    await submit('Send a new link');
    expect(screen.getByRole('status')).toHaveTextContent('a new link is on its way');
  });
});

describe('password reset', () => {
  it('answers the same for every address, then points to the code form', async () => {
    vi.mocked(actions.forgotPasswordAction).mockResolvedValue({ status: 'sent', email: 'a@b.co' });
    renderWithIntl(<ForgotPasswordForm />);

    await submit('Send reset link');

    expect(screen.getByRole('status')).toHaveTextContent(
      'If a@b.co has an account, a reset link and code are on their way.',
    );
    expect(screen.getByRole('link', { name: 'Choose a new password' })).toHaveAttribute(
      'href',
      '/en/reset-password',
    );
  });

  it('needs only the new password when it came from the emailed link', () => {
    const { container } = renderWithIntl(<ResetPasswordForm token="tok" />);

    expect(container.querySelector('input[name="token"]')).toHaveValue('tok');
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('says other devices were signed out once the password changes', async () => {
    vi.mocked(actions.resetPasswordAction).mockResolvedValue({ status: 'done' });
    renderWithIntl(<ResetPasswordForm />);

    await submit('Update password');

    expect(screen.getByRole('status')).toHaveTextContent('every other device has been signed out');
  });

  it('marks the confirmation when the passwords differ', async () => {
    vi.mocked(actions.resetPasswordAction).mockResolvedValue({
      status: 'error',
      error: 'passwordMismatch',
    });
    renderWithIntl(<ResetPasswordForm token="tok" />);

    await submit('Update password');

    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.');
  });
});
