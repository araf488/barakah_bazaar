import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/payments/actions', () => ({ orderPaymentAction: vi.fn() }));

const { BkashPayPanel } = await import('../BkashPayPanel');
const { orderPaymentAction } = await import('../../../lib/payments/actions');

const PROPS = { orderId: 'order-1', totalPoysha: 256000, awaiting: true };
const payButton = () => screen.getByRole('button', { name: 'Pay ৳2,560.00 with bKash' });
const switchButton = () => screen.getByRole('button', { name: 'Pay in cash on delivery instead' });

beforeEach(() => vi.clearAllMocks());

describe('BkashPayPanel', () => {
  it('offers to pay the total with bKash or to switch to cash', () => {
    renderWithIntl(<BkashPayPanel {...PROPS} />);
    expect(
      screen.getByRole('heading', { name: 'Waiting for your bKash payment' }),
    ).toBeInTheDocument();
    expect(payButton()).toBeEnabled();
    expect(switchButton()).toBeEnabled();
  });

  it('pays with bKash for this order', async () => {
    vi.mocked(orderPaymentAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<BkashPayPanel {...PROPS} />);
    fireEvent.click(payButton());

    await waitFor(() => expect(orderPaymentAction).toHaveBeenCalled());
    const form = vi.mocked(orderPaymentAction).mock.calls[0]![1];
    expect(Object.fromEntries(form)).toEqual({ orderId: 'order-1' });
  });

  it('asks to switch this order to cash', async () => {
    vi.mocked(orderPaymentAction).mockResolvedValue({ status: 'switched' });
    renderWithIntl(<BkashPayPanel {...PROPS} />);
    fireEvent.click(switchButton());

    await waitFor(() => expect(orderPaymentAction).toHaveBeenCalled());
    const form = vi.mocked(orderPaymentAction).mock.calls[0]![1];
    expect(Object.fromEntries(form)).toEqual({ orderId: 'order-1', intent: 'cod' });
  });

  it('shows why the payment could not start before the page opened', () => {
    renderWithIntl(<BkashPayPanel {...PROPS} initialError="gateway" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'bKash could not start the payment. Please try again.',
    );
  });

  it('replaces that reason with the result of its own attempt', async () => {
    vi.mocked(orderPaymentAction).mockResolvedValue({ status: 'error', error: 'tooFast', at: 1 });
    renderWithIntl(<BkashPayPanel {...PROPS} initialError="gateway" />);
    fireEvent.click(payButton());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many tries'));
  });

  it('says it is done once the page shows the order switched to cash', async () => {
    vi.mocked(orderPaymentAction).mockResolvedValue({ status: 'switched' });
    const { rerender } = renderWithIntl(<BkashPayPanel {...PROPS} />);
    fireEvent.click(switchButton());
    await waitFor(() => expect(orderPaymentAction).toHaveBeenCalled());

    rerender(<BkashPayPanel {...PROPS} awaiting={false} />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Done. You will pay in cash when the order arrives.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says why when the order stopped waiting for payment', async () => {
    vi.mocked(orderPaymentAction).mockResolvedValue({
      status: 'error',
      error: 'alreadyPaid',
      at: 1,
    });
    const { rerender } = renderWithIntl(<BkashPayPanel {...PROPS} />);
    fireEvent.click(payButton());
    await screen.findByRole('alert');

    rerender(<BkashPayPanel {...PROPS} awaiting={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This order is already paid.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing for an order that does not wait for bKash', () => {
    const { container } = renderWithIntl(<BkashPayPanel {...PROPS} awaiting={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('writes the total in Bengali digits on a Bangla page', () => {
    renderWithIntl(<BkashPayPanel {...PROPS} />, 'bn');
    expect(
      screen.getByRole('button', { name: 'bKash-এ ৳২,৫৬০.০০ পরিশোধ করুন' }),
    ).toBeInTheDocument();
  });
});
