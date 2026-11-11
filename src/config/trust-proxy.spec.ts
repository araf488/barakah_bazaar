import { createMockConfig } from '../../test/support/mocks';
import { TrustProxyTarget, applyTrustProxy, shouldTrustProxy } from './trust-proxy';

const stubApp = (): TrustProxyTarget & { set: jest.Mock } => ({ set: jest.fn() });

describe('shouldTrustProxy', () => {
  it('is false for zero hops, the default, so req.ip stays the socket peer', () => {
    expect(shouldTrustProxy(0)).toBe(false);
  });

  it.each([1, 2, 5])('is true for %d hops', (hops) => {
    expect(shouldTrustProxy(hops)).toBe(true);
  });
});

describe('applyTrustProxy', () => {
  it('leaves Express untouched when TRUST_PROXY_HOPS is 0', () => {
    const app = stubApp();

    const applied = applyTrustProxy(app, createMockConfig({ TRUST_PROXY_HOPS: 0 }));

    expect(applied).toBeUndefined();
    expect(app.set).not.toHaveBeenCalled();
  });

  it('sets trust proxy to the exact hop count, never to true', () => {
    const app = stubApp();

    const applied = applyTrustProxy(app, createMockConfig({ TRUST_PROXY_HOPS: 2 }));

    expect(applied).toBe(2);
    expect(app.set).toHaveBeenCalledTimes(1);
    expect(app.set).toHaveBeenCalledWith('trust proxy', 2);
  });

  it('applies a single hop, the common one-load-balancer deploy', () => {
    const app = stubApp();

    applyTrustProxy(app, createMockConfig({ TRUST_PROXY_HOPS: 1 }));

    expect(app.set).toHaveBeenCalledWith('trust proxy', 1);
  });
});
