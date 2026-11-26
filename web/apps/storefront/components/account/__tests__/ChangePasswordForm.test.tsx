import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/account/securityActions', () => ({ changePasswordAction: vi.fn() }));

const { ChangePasswordForm } = await import('../ChangePasswordForm');
const { changePasswordAction } = await import('../../../lib/account/securityActions');

const fill = () => {
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'Old-password-1' },
  });
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'Mango-season-2026' },
  });
  fireEvent.change(screen.getByLabelText('New password again'), {
    target: { value: 'Mango-season-2026' },
  });
};
const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: 'Change password' }).closest('form')!);

beforeEach(() => vi.clearAllMocks());

describe('ChangePasswordForm', () => {
  it('sends the three fields under the names the action reads', async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({ status: 'changed', at: 1 });
    renderWithIntl(<ChangePasswordForm />);
    fill();
    submit();

    await waitFor(() => expect(changePasswordAction).toHaveBeenCalled());
    const form = vi.mocked(changePasswordAction).mock.calls[0]![1];
    expect(Object.fromEntries(form)).toEqual({
      currentPassword: 'Old-password-1',
      newPassword: 'Mango-season-2026',
      confirmPassword: 'Mango-season-2026',
    });
  });

  it('says the password changed and empties every field', async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({ status: 'changed', at: 1 });
    renderWithIntl(<ChangePasswordForm />);
    fill();
    submit();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed. Every other device has been signed out.',
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('New password again')).toHaveValue('');
  });

  it('keeps what was typed and marks the current password after a wrong one', async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({
      status: 'error',
      error: 'currentWrong',
      at: 1,
    });
    renderWithIntl(<ChangePasswordForm />);
    fill();
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your current password is not right.',
    );
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('New password')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('New password')).toHaveValue('Mango-season-2026');
  });

  it('marks the new password when the API names the rule it broke', async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({
      status: 'error',
      error: 'passwordClasses',
      at: 1,
    });
    renderWithIntl(<ChangePasswordForm />);
    fill();
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Include an uppercase letter, a lowercase letter, a number and a symbol.',
    );
    const field = screen.getByLabelText('New password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('marks the confirmation when the two do not match', async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({
      status: 'error',
      error: 'passwordMismatch',
      at: 1,
    });
    renderWithIntl(<ChangePasswordForm />);
    fill();
    submit();

    await screen.findByRole('alert');
    expect(screen.getByLabelText('New password again')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reads in Bangla', () => {
    renderWithIntl(<ChangePasswordForm />, 'bn');
    expect(screen.getByLabelText('বর্তমান পাসওয়ার্ড')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পাসওয়ার্ড বদলান' })).toBeInTheDocument();
  });
});
