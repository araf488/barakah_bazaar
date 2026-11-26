import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/account/securityActions', () => ({
  endSessionAction: vi.fn(),
  endAllSessionsAction: vi.fn(),
}));

const { EndSessionButton, SignOutEverywhere } = await import('../DeviceActions');
const { endSessionAction, endAllSessionsAction } =
  await import('../../../lib/account/securityActions');

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Sign out of all devices' }));

beforeEach(() => vi.clearAllMocks());

describe('EndSessionButton', () => {
  it('names the device it signs out and sends its session id', async () => {
    vi.mocked(endSessionAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<EndSessionButton id="s2" device="Chrome on Android" />);

    const button = screen.getByRole('button', { name: 'Sign out Chrome on Android' });
    fireEvent.submit(button.closest('form')!);

    await waitFor(() => expect(endSessionAction).toHaveBeenCalled());
    expect(Object.fromEntries(vi.mocked(endSessionAction).mock.calls[0]![1])).toEqual({
      id: 's2',
    });
  });

  it('says so when the device could not be signed out', async () => {
    vi.mocked(endSessionAction).mockResolvedValue({ status: 'error', error: 'failed', at: 1 });
    renderWithIntl(<EndSessionButton id="s2" device="Chrome on Android" />);
    fireEvent.submit(screen.getByRole('button').closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That did not work. Please try again in a moment.',
    );
  });
});

describe('SignOutEverywhere', () => {
  it('asks before signing everything out, so one tap cannot do it', () => {
    renderWithIntl(<SignOutEverywhere />);
    expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).not.toBeInTheDocument();

    open();

    expect(screen.getByRole('form', { name: 'Sign out of every device?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toHaveFocus();
    expect(endAllSessionsAction).not.toHaveBeenCalled();
  });

  it('signs out everywhere once confirmed', async () => {
    vi.mocked(endAllSessionsAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<SignOutEverywhere />);
    open();
    fireEvent.submit(screen.getByRole('form', { name: 'Sign out of every device?' }));

    await waitFor(() => expect(endAllSessionsAction).toHaveBeenCalled());
  });

  it('goes back to the button, focused, when the visitor stays signed in', async () => {
    renderWithIntl(<SignOutEverywhere />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));

    const button = screen.getByRole('button', { name: 'Sign out of all devices' });
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('closes the question with Escape', () => {
    renderWithIntl(<SignOutEverywhere />);
    open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sign out everywhere' }), {
      key: 'Escape',
    });

    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('says so when signing out everywhere failed', async () => {
    vi.mocked(endAllSessionsAction).mockResolvedValue({ status: 'error', error: 'failed', at: 1 });
    renderWithIntl(<SignOutEverywhere />);
    open();
    fireEvent.submit(screen.getByRole('form', { name: 'Sign out of every device?' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work.');
  });
});
