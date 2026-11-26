import { fireEvent, screen, waitFor } from '@testing-library/react';
import { encode } from 'uqr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/admin/actions', () => ({
  startMfaSetupAction: vi.fn(),
  enableMfaAction: vi.fn(),
}));

const actions = await import('../../../lib/admin/actions');
const { MfaSetup, grouped } = await import('../MfaSetup');
const { qrPath } = await import('../QrCode');

const READY = {
  status: 'ready' as const,
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Barakah%20Bazaar:ops@b.test?secret=JBSWY3DPEHPK3PXP',
};
const CODES = ['0123456789abcdef0123', 'fedcba9876543210fedc'];

const begin = async () => {
  vi.mocked(actions.startMfaSetupAction).mockResolvedValue(READY);
  renderWithIntl(<MfaSetup active />);
  fireEvent.click(screen.getByRole('button', { name: 'Show my setup code' }));
  await screen.findByRole('img', { name: 'QR code for your authenticator app' });
};

beforeEach(() => vi.clearAllMocks());

describe('MfaSetup', () => {
  it('waits for the staff member before fetching a key', () => {
    renderWithIntl(<MfaSetup active />);

    expect(screen.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
    expect(actions.startMfaSetupAction).not.toHaveBeenCalled();
  });

  it('shows the key as a QR code drawn in the page, and as grouped text', async () => {
    await begin();

    const qr = screen.getByRole('img', { name: 'QR code for your authenticator app' });
    expect(qr.querySelector('image, img, foreignObject')).toBeNull();
    expect(qr.querySelector('path')?.getAttribute('d')).toBe(qrPath(encode(READY.otpauthUri).data));
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
  });

  it('confirms with a code, then shows the recovery codes once', async () => {
    vi.mocked(actions.enableMfaAction).mockResolvedValue({
      status: 'enabled',
      recoveryCodes: CODES,
    });
    await begin();

    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm' }).closest('form')!);

    expect(
      await screen.findByRole('heading', { name: 'Save your recovery codes' }),
    ).toBeInTheDocument();
    expect(screen.getByText('01234 56789 abcde f0123')).toBeInTheDocument();
    expect(Object.fromEntries(vi.mocked(actions.enableMfaAction).mock.calls[0]![1])).toEqual({
      code: '123456',
    });
  });

  it('leads on to sign-in only once the codes are marked as saved', async () => {
    vi.mocked(actions.enableMfaAction).mockResolvedValue({
      status: 'enabled',
      recoveryCodes: CODES,
    });
    await begin();
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm' }).closest('form')!);
    await screen.findByRole('heading', { name: 'Save your recovery codes' });

    expect(screen.getByRole('button', { name: 'Continue to sign in' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have saved these codes'));
    expect(screen.getByRole('link', { name: 'Continue to sign in' })).toHaveAttribute(
      'href',
      '/admin/sign-in',
    );
  });

  it('keeps the key on screen when the first code is wrong', async () => {
    vi.mocked(actions.enableMfaAction).mockResolvedValue({
      status: 'error',
      error: 'code',
      at: 1,
      secret: READY.secret,
      otpauthUri: READY.otpauthUri,
    });
    await begin();
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm' }).closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work.');
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'QR code for your authenticator app' }),
      ).toBeInTheDocument(),
    );
  });

  it('says the sign-in timed out when the enrolment has lapsed', async () => {
    vi.mocked(actions.startMfaSetupAction).mockResolvedValue({
      status: 'error',
      error: 'expired',
      at: 1,
    });
    renderWithIntl(<MfaSetup active />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my setup code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in timed out.');
    expect(screen.getByRole('link', { name: 'Start again' })).toHaveAttribute(
      'href',
      '/admin/sign-in',
    );
  });
});

describe('MfaSetup without a pending enrolment', () => {
  it('says the sign-in timed out and offers no key to fetch', () => {
    renderWithIntl(<MfaSetup active={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in timed out.');
    expect(screen.queryByRole('button', { name: 'Show my setup code' })).not.toBeInTheDocument();
  });

  it('keeps the recovery codes on screen when the page is drawn again after confirming', async () => {
    vi.mocked(actions.enableMfaAction).mockResolvedValue({
      status: 'enabled',
      recoveryCodes: CODES,
    });
    vi.mocked(actions.startMfaSetupAction).mockResolvedValue(READY);
    const { rerender } = renderWithIntl(<MfaSetup active />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my setup code' }));
    await screen.findByRole('img', { name: 'QR code for your authenticator app' });
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm' }).closest('form')!);
    await screen.findByRole('heading', { name: 'Save your recovery codes' });

    // Confirming ends the enrolment cookie, so the next render of the page passes `active={false}`.
    rerender(<MfaSetup active={false} />);

    expect(screen.getByRole('heading', { name: 'Save your recovery codes' })).toBeInTheDocument();
    expect(screen.getByText('01234 56789 abcde f0123')).toBeInTheDocument();
  });
});

describe('grouped', () => {
  it('splits a value into fixed-size chunks', () => {
    expect(grouped('ABCDEFGHIJ', 4)).toBe('ABCD EFGH IJ');
    expect(grouped('', 4)).toBe('');
  });
});

describe('qrPath', () => {
  it('draws one square per dark module, inside the quiet zone', () => {
    expect(
      qrPath([
        [true, false],
        [false, true],
      ]),
    ).toBe('M4,4h1v1h-1zM5,5h1v1h-1z');
  });
});
