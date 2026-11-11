import { NestExpressApplication } from '@nestjs/platform-express';
import { ApplicationConstants } from '../common/constants/app.constants';
import { AppConfigService } from './index';

/** The one Express call `applyTrustProxy` needs, so a test can hand in a stub. */
export type TrustProxyTarget = Pick<NestExpressApplication, 'set'>;

/**
 * Whether Express should trust X-Forwarded-For at all. Zero hops — the default — leaves the
 * setting untouched, so `req.ip` stays the socket peer and no client can forge it.
 */
export const shouldTrustProxy = (hops: number): boolean => hops > 0;

/**
 * Applies `TRUST_PROXY_HOPS` to the Express instance, and only when it is positive.
 *
 * Every per-IP rate-limit bucket keys on `req.ip`. Behind a load balancer without this, that is
 * the balancer's address, so all callers share one count; the bKash callback then 429s real
 * customers. A hop count rather than `true` means Express takes the address exactly that many
 * proxies back, so a client cannot choose its own IP by sending the header itself.
 *
 * Must run before the web mount and `listen`, so the first request already sees it.
 *
 * @returns the hop count applied, or `undefined` when the setting was left alone.
 */
export const applyTrustProxy = (
  app: TrustProxyTarget,
  config: AppConfigService,
): number | undefined => {
  const hops = config.get('TRUST_PROXY_HOPS', { infer: true });

  if (!shouldTrustProxy(hops)) {
    return undefined;
  }

  app.set(ApplicationConstants.TrustProxySetting, hops);
  return hops;
};
