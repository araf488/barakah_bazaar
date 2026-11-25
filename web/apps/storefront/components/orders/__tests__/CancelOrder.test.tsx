import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/orders/actions', () => ({ cancelOrderAction: vi.fn() }));

const { CancelOrder } = await import('../CancelOrder');
const { cancelOrderAction } = await import('../../../lib/orders/actions');

const PROPS = { orderId: 'order-1', orderNumber: 'BB-1', canCancel: true };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel this order' }));
const confirm = () => screen.getByRole('button', { name: 'Yes, cancel the order' });

beforeEach(() => vi.clearAllMocks());

describe('CancelOrder', () => {
  it('asks before cancelling, so one tap cannot do it', () => {
    renderWithIntl(<CancelOrder {...PROPS} />);
    expect(screen.queryByRole('button', { name: 'Yes, cancel the order' })).not.toBeInTheDocument();

    open();

    expect(screen.getByRole('form', { name: 'Cancel order BB-1?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Why are you cancelling? (optional)')).toHaveFocus();
    expect(cancelOrderAction).not.toHaveBeenCalled();
  });

  it('sends the order and the reason', async () => {
    vi.mocked(cancelOrderAction).mockResolvedValue({ status: 'cancelled' });
    renderWithIntl(<CancelOrder {...PROPS} />);
    open();
    fireEvent.change(screen.getByLabelText('Why are you cancelling? (optional)'), {
      target: { value: 'Ordered twice' },
    });
    fireEvent.submit(confirm().closest('form')!);

    await waitFor(() => expect(cancelOrderAction).toHaveBeenCalled());
    const form = vi.mocked(cancelOrderAction).mock.calls[0]![1];
    expect(Object.fromEntries(form)).toEqual({ orderId: 'order-1', reason: 'Ordered twice' });
  });

  it('goes back to the button when the shopper keeps the order', async () => {
    renderWithIntl(<CancelOrder {...PROPS} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my order' }));

    const button = screen.getByRole('button', { name: 'Cancel this order' });
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('keeps the reason and says why after a refusal while the order can still be cancelled', async () => {
    vi.mocked(cancelOrderAction).mockResolvedValue({ status: 'error', error: 'changed', at: 1 });
    renderWithIntl(<CancelOrder {...PROPS} />);
    open();
    const reason = screen.getByLabelText('Why are you cancelling? (optional)');
    fireEvent.change(reason, { target: { value: 'Too slow' } });
    fireEvent.submit(confirm().closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('This order just changed.');
    expect(reason).toHaveValue('Too slow');
  });

  it('says it is done once the page shows the order cancelled', async () => {
    vi.mocked(cancelOrderAction).mockResolvedValue({ status: 'cancelled' });
    const { rerender } = renderWithIntl(<CancelOrder {...PROPS} />);
    open();
    fireEvent.submit(confirm().closest('form')!);
    await waitFor(() => expect(cancelOrderAction).toHaveBeenCalled());

    rerender(<CancelOrder {...PROPS} canCancel={false} />);

    expect(await screen.findByRole('status')).toHaveTextContent('Your order is cancelled.');
  });

  it('says why when the page shows it is now too late', async () => {
    vi.mocked(cancelOrderAction).mockResolvedValue({ status: 'error', error: 'tooLate', at: 1 });
    const { rerender } = renderWithIntl(<CancelOrder {...PROPS} />);
    open();
    fireEvent.submit(confirm().closest('form')!);
    await screen.findByRole('alert');

    rerender(<CancelOrder {...PROPS} canCancel={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent('It is too late to cancel');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing for an order that could never be cancelled here', () => {
    const { container } = renderWithIntl(<CancelOrder {...PROPS} canCancel={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
