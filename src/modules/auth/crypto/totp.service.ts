import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthConstants } from '../auth.constants';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Whether a code was accepted, and which 30-second step it belonged to. */
export interface TotpVerification {
  readonly ok: boolean;
  readonly step: number;
}

/**
 * RFC 6238 time-based one-time passwords, implemented here.
 *
 * No package and no service: authentication decisions do not leave this application. The
 * user scans a standard `otpauth://` URI into whichever authenticator app they already
 * have. The server deliberately does NOT render the QR code — posting a shared secret to
 * an image service would hand the second factor to a third party. The client draws it.
 */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return TotpService.toBase32(randomBytes(AuthConstants.TotpSecretBytes));
  }

  buildUri(secret: string, email: string): string {
    const label = encodeURIComponent(`${AuthConstants.TotpIssuer}:${email}`);
    const params: Record<string, string> = {
      secret,
      issuer: AuthConstants.TotpIssuer,
      algorithm: AuthConstants.TotpAlgorithm.toUpperCase(),
      digits: String(AuthConstants.TotpDigits),
      period: String(AuthConstants.TotpStepSeconds),
    };

    // Built by hand rather than with URLSearchParams: its form-encoding turns the space in
    // "Barakah Bazaar" into "+", which is valid for a query string but not what any
    // authenticator app's otpauth:// parser expects — they read %-encoding only.
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');

    return `otpauth://totp/${label}?${query}`;
  }

  codeFor(secret: string, atMs: number = Date.now()): string {
    return TotpService.codeAtStep(secret, TotpService.stepAt(atMs));
  }

  /**
   * Accepts the previous, current and next step, because handset clocks drift. A step that
   * has already been spent is refused however valid it looks, so a code read over someone's
   * shoulder cannot be replayed inside its own 30-second window.
   */
  verify(
    secret: string,
    code: string,
    lastUsedStep: number | null,
    atMs: number = Date.now(),
  ): TotpVerification {
    const current = TotpService.stepAt(atMs);

    if (code.length !== AuthConstants.TotpDigits) {
      return { ok: false, step: current };
    }

    for (
      let offset = -AuthConstants.TotpDriftSteps;
      offset <= AuthConstants.TotpDriftSteps;
      offset += 1
    ) {
      const step = current + offset;

      if (lastUsedStep !== null && step <= lastUsedStep) {
        continue;
      }
      if (TotpService.matches(TotpService.codeAtStep(secret, step), code)) {
        return { ok: true, step };
      }
    }

    return { ok: false, step: current };
  }

  private static stepAt(atMs: number): number {
    return Math.floor(atMs / 1000 / AuthConstants.TotpStepSeconds);
  }

  private static codeAtStep(secret: string, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));

    const digest = createHmac(AuthConstants.TotpAlgorithm, TotpService.fromBase32(secret))
      .update(counter)
      .digest();

    // RFC 4226 dynamic truncation: the low nibble of the last byte picks the offset.
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    return String(binary % 10 ** AuthConstants.TotpDigits).padStart(AuthConstants.TotpDigits, '0');
  }

  private static matches(expected: string, actual: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);

    return a.length === b.length && timingSafeEqual(a, b);
  }

  private static toBase32(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
  }

  private static fromBase32(encoded: string): Buffer {
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const character of TotpService.stripPadding(encoded.toUpperCase())) {
      const index = BASE32_ALPHABET.indexOf(character);
      if (index === -1) {
        continue;
      }

      value = (value << 5) | index;
      bits += 5;

      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }

    return Buffer.from(bytes);
  }

  /**
   * Trailing `=` padding, stripped by hand rather than with a regex: a `+$`-anchored pattern
   * over untrusted-length input reads as backtracking-prone to static analysis even though
   * this one is linear, so a plain loop sidesteps the flag instead of suppressing it.
   */
  private static stripPadding(value: string): string {
    let end = value.length;
    while (end > 0 && value[end - 1] === '=') {
      end -= 1;
    }
    return value.slice(0, end);
  }
}
