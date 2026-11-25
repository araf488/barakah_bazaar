import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalizedName, pickLocalized } from '../LocalizedName';

const doi = { nameEn: 'Sweet Doi', nameBn: 'মিষ্টি দই' };

describe('pickLocalized', () => {
  it('picks the Bangla name under bn', () => {
    expect(pickLocalized(doi, 'bn')).toEqual({ text: 'মিষ্টি দই', isFallback: false });
  });

  it('picks the English name under en', () => {
    expect(pickLocalized(doi, 'en')).toEqual({ text: 'Sweet Doi', isFallback: false });
  });

  it('falls back to English when the Bangla name is empty', () => {
    expect(pickLocalized({ nameEn: 'Almonds', nameBn: '' }, 'bn')).toEqual({
      text: 'Almonds',
      isFallback: true,
    });
  });

  it('treats whitespace-only as missing', () => {
    expect(pickLocalized({ nameEn: 'Almonds', nameBn: '   ' }, 'bn')).toEqual({
      text: 'Almonds',
      isFallback: true,
    });
  });

  it('falls back to Bangla when the English name is empty', () => {
    expect(pickLocalized({ nameEn: '', nameBn: 'কাজু' }, 'en')).toEqual({
      text: 'কাজু',
      isFallback: true,
    });
  });

  it('falls back to Bangla when the English name is whitespace-only', () => {
    expect(pickLocalized({ nameEn: '   ', nameBn: 'কাজু' }, 'en')).toEqual({
      text: 'কাজু',
      isFallback: true,
    });
  });
});

describe('<LocalizedName>', () => {
  it('renders the Bangla name under bn with its language tagged', () => {
    render(<LocalizedName entity={doi} locale="bn" />);
    const el = screen.getByText('মিষ্টি দই');
    expect(el).toHaveAttribute('lang', 'bn');
    expect(el).not.toHaveAttribute('data-fallback-locale');
  });

  it('marks a fallback so a missing translation is visible to tooling', () => {
    render(<LocalizedName entity={{ nameEn: 'Almonds', nameBn: '' }} locale="bn" />);
    const el = screen.getByText('Almonds');
    expect(el).toHaveAttribute('lang', 'en');
    expect(el).toHaveAttribute('data-fallback-locale', 'bn');
  });
});
