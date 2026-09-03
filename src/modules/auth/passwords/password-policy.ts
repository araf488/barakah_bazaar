import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthConstants, AuthMessages } from '../auth.constants';

/**
 * Rejects weak passwords without calling anyone.
 *
 * The usual tool for this is HaveIBeenPwned's range API, which is an outbound call in the
 * authentication path — this project makes none. A bundled list plus contextual rules
 * covers the same ground offline: the head of the password distribution is where real
 * choices cluster, and the contextual rules catch what a generic list never can.
 *
 * Length is the one hard rule: at least 12 characters, at most 128. The minimum is above the
 * 8 that NIST and OWASP now call a floor rather than a target; the maximum is well clear of
 * the 64 they ask implementations to accept, and nothing here truncates or strips what is
 * typed.
 *
 * There are deliberately no character-class rules. Requiring an uppercase letter, a digit and
 * a symbol would reject "marbled kingfisher 41" while accepting "Password123!", which is the
 * trade NIST SP 800-63B and the OWASP ASVS both tell implementations to stop making: length
 * and a common-password check, not composition. Please don't add them back.
 */
@Injectable()
export class PasswordPolicy {
  private denylist: Set<string> | null = null;

  /** The rejection reason, or null when the password is acceptable. */
  check(password: string, context: { email: string; fullName?: string | null }): string | null {
    const lowered = password.toLowerCase();
    // Code points, not UTF-16 units: an emoji is one character to the person who typed it.
    const length = [...password].length;

    if (length < AuthConstants.PasswordMinLength) {
      return AuthMessages.PasswordTooShort;
    }
    if (length > AuthConstants.PasswordMaxLength) {
      return AuthMessages.PasswordTooLong;
    }
    if (this.isCommon(lowered)) {
      return AuthMessages.PasswordTooCommon;
    }
    if (PasswordPolicy.containsIdentity(lowered, context)) {
      return AuthMessages.PasswordContainsIdentity;
    }
    if (AuthConstants.PasswordBannedWords.some((word) => lowered.includes(word))) {
      return AuthMessages.PasswordContainsShopName;
    }
    if (new Set(lowered).size < AuthConstants.PasswordMinDistinctCharacters) {
      return AuthMessages.PasswordTooFewDistinct;
    }
    if (PasswordPolicy.hasLongRun(lowered)) {
      return AuthMessages.PasswordSequential;
    }

    return null;
  }

  /** Loaded on first use, not at boot — a fresh clone should not pay for it to start. */
  private isCommon(lowered: string): boolean {
    this.denylist ??= PasswordPolicy.loadDenylist();
    return this.denylist.has(lowered);
  }

  private static loadDenylist(): Set<string> {
    const path = join(__dirname, '..', 'data', AuthConstants.CommonPasswordsFileName);

    try {
      const lines = readFileSync(path, 'utf8').split('\n');
      return new Set(lines.map((line) => line.trim().toLowerCase()).filter(Boolean));
    } catch {
      // A missing asset must not stop anyone registering. The contextual rules still apply.
      return new Set<string>();
    }
  }

  private static containsIdentity(
    lowered: string,
    context: { email: string; fullName?: string | null },
  ): boolean {
    const localPart = context.email.split('@')[0]?.toLowerCase() ?? '';
    const candidates = [localPart, context.fullName?.toLowerCase() ?? ''];

    // Short fragments are excluded: a two-letter name would reject almost every password.
    return candidates.some(
      (value) => value.length >= AuthConstants.PasswordIdentityMinLength && lowered.includes(value),
    );
  }

  /** Six or more consecutive characters ascending or descending by one code point. */
  private static hasLongRun(lowered: string): boolean {
    let ascending = 1;
    let descending = 1;

    for (let index = 1; index < lowered.length; index += 1) {
      const delta = lowered.charCodeAt(index) - lowered.charCodeAt(index - 1);

      ascending = delta === 1 ? ascending + 1 : 1;
      descending = delta === -1 ? descending + 1 : 1;

      if (Math.max(ascending, descending) >= AuthConstants.PasswordMaxSequentialRun) {
        return true;
      }
    }

    return false;
  }
}
