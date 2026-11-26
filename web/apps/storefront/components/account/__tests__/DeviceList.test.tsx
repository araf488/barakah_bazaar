import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import type { DeviceSession } from '../../../lib/account/security';
import { renderWithIntl } from '../../../test/intl';

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) =>
    createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
  ),
}));
vi.mock('../../../lib/account/security', () => ({ getDeviceSessions: vi.fn() }));
vi.mock('../../../lib/account/securityActions', () => ({
  endSessionAction: vi.fn(),
  endAllSessionsAction: vi.fn(),
}));
vi.mock('../../../lib/auth/actions', () => ({ signOutAction: vi.fn() }));

const { DeviceList, DeviceRow } = await import('../DeviceList');
const { SignOutEverywhere } = await import('../DeviceActions');
const { getDeviceSessions } = await import('../../../lib/account/security');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const session = (overrides: Partial<DeviceSession> = {}): DeviceSession => ({
  id: 's1',
  deviceId: 'device-1',
  userAgent: ANDROID_CHROME,
  ipAddress: '203.0.113.0',
  createdAt: '2026-11-20T04:00:00.000Z',
  lastUsedAt: '2026-11-25T10:30:00.000Z',
  current: false,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('DeviceRow', () => {
  it('names the device, when it was used and from which network', async () => {
    renderWithIntl(await DeviceRow({ session: session(), locale: 'en' }));

    expect(screen.getByText('Chrome on Android')).toBeInTheDocument();
    expect(screen.getByText('Last active 25 Nov, 4:30 pm')).toBeInTheDocument();
    expect(screen.getByText(/Signed in 20 Nov, 10:00 am/)).toBeInTheDocument();
    expect(screen.getByText('203.0.113.0')).toHaveAttribute('dir', 'ltr');
  });

  it('offers to sign another device out, by name', async () => {
    renderWithIntl(await DeviceRow({ session: session(), locale: 'en' }));

    expect(screen.getByRole('button', { name: 'Sign out Chrome on Android' })).toBeInTheDocument();
    expect(screen.queryByText('This device')).not.toBeInTheDocument();
  });

  it('marks this device and signs it out the ordinary way', async () => {
    renderWithIntl(await DeviceRow({ session: session({ current: true }), locale: 'en' }));

    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign out Chrome/ })).not.toBeInTheDocument();
  });

  it('says so when it cannot name the device, and leaves out what it does not know', async () => {
    renderWithIntl(
      await DeviceRow({
        session: session({ userAgent: null, ipAddress: null, lastUsedAt: null }),
        locale: 'en',
      }),
    );

    expect(screen.getByText('Unknown device')).toBeInTheDocument();
    expect(screen.queryByText(/Last active/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Network/)).not.toBeInTheDocument();
  });
});

describe('DeviceList', () => {
  it('lists every session in the order it was given, then signing out everywhere', async () => {
    const sessions = [session({ id: 'here', current: true }), session({ id: 'phone' })];
    vi.mocked(getDeviceSessions).mockResolvedValue({ ok: true, sessions });

    const tree = elementsOf(await DeviceList());

    expect(tree.filter((el) => el.type === DeviceRow).map((el) => el.key)).toEqual([
      'here',
      'phone',
    ]);
    expect(tree.some((el) => el.type === SignOutEverywhere)).toBe(true);
    expect(tree.some((el) => el.props.children === en.security.devices.only)).toBe(false);
  });

  it('says when no other device is signed in', async () => {
    vi.mocked(getDeviceSessions).mockResolvedValue({
      ok: true,
      sessions: [session({ current: true })],
    });

    const tree = elementsOf(await DeviceList());

    expect(
      tree.some((el) => el.props.children === 'No other device is signed in to your account.'),
    ).toBe(true);
  });

  it('says so and offers the page again when the list could not be read', async () => {
    vi.mocked(getDeviceSessions).mockResolvedValue({ ok: false });

    const tree = elementsOf(await DeviceList());

    const alert = tree.find((el) => el.props.role === 'alert');
    expect(alert).toBeDefined();
    expect(
      tree.some((el) => el.props.children === 'We could not load your devices just now.'),
    ).toBe(true);
    expect(tree.find((el) => el.props.href === '/account/security')?.props.children).toBe(
      'Try again',
    );
    expect(tree.some((el) => el.type === SignOutEverywhere)).toBe(false);
  });
});
