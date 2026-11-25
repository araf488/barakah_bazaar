import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money } from '../Money';
import { formatCount, formatPoysha } from '../poysha';

describe('formatPoysha', () => {
  it('renders 125000 poysha as ৳1,250.00', () => {
    expect(formatPoysha(125000)).toBe('৳1,250.00');
  });

  it('renders whole taka with two decimals', () => {
    expect(formatPoysha(8000)).toBe('৳80.00');
  });

  it('renders sub-taka amounts without losing the poysha', () => {
    expect(formatPoysha(5)).toBe('৳0.05');
  });

  it('groups thousands with Latin digits, matching the prototype', () => {
    expect(formatPoysha(120000000)).toBe('৳1,200,000.00');
  });

  it('writes Bangla prices in Bengali digits with the lakh grouping', () => {
    expect(formatPoysha(125000, 'bn')).toBe('৳১,২৫০.০০');
    expect(formatPoysha(123456750, 'bn')).toBe('৳১২,৩৪,৫৬৭.৫০');
  });

  it('keeps English prices in Latin digits', () => {
    expect(formatPoysha(125000, 'en')).toBe('৳1,250.00');
  });

  it('refuses a non-integer, because that means a float leaked into money', () => {
    expect(() => formatPoysha(1250.5)).toThrow('poysha must be an integer');
  });
});

describe('<Money>', () => {
  it('formats from the integer when no server string is given', () => {
    render(<Money poysha={125000} />);
    expect(screen.getByText('৳1,250.00')).toBeInTheDocument();
  });

  it('prefers the API-supplied priceFormatted over formatting locally', () => {
    render(<Money poysha={125000} formatted="৳1,250" />);
    expect(screen.getByText('৳1,250')).toBeInTheDocument();
    expect(screen.queryByText('৳1,250.00')).not.toBeInTheDocument();
  });

  it('exposes the raw poysha for assertions and debugging', () => {
    render(<Money poysha={8000} />);
    expect(screen.getByText('৳80.00')).toHaveAttribute('data-poysha', '8000');
  });
});

describe('formatCount', () => {
  it('writes counts in the reader’s digits', () => {
    expect(formatCount(12, 'bn')).toBe('১২');
    expect(formatCount(12, 'en')).toBe('12');
  });
});

describe('<Money> in Bangla', () => {
  it('formats in Bengali digits when given the bn locale', () => {
    render(<Money poysha={125000} locale="bn" />);
    expect(screen.getByText('৳১,২৫০.০০')).toBeInTheDocument();
  });
});
