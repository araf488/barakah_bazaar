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
 * **Character-class rules are required here, by the repo owner's explicit decision
 * (2026-09-14).** A password must carry an uppercase letter, a lowercase letter, a digit and a
 * special character (`AuthConstants.PasswordSpecialCharacters`).
 *
 * This file previously argued the opposite, and the argument is recorded rather than deleted
 * because it is still the reason to be careful: composition rules reject
 * "marbled kingfisher 41" while accepting "Password123!", which is the trade NIST SP 800-63B
 * and the OWASP ASVS both tell implementations to stop making. The decision was made with that
 * in front of it, and spec §4.4 carries the same note.
 *
 * Composition is checked **last**, so every more specific diagnosis still wins: a common
 * password is reported as common, not as missing a symbol.
 *
 * That ordering does **not** rescue the case the guidance warns about, and the comment should
 * not pretend it does. `password123` is on the bundled list; `password123!` is not, so
 * `Password123!` satisfies every rule here and is accepted. The denylist is a list of exact
 * strings, and decorating a listed password with one symbol steps off it — which is precisely
 * the behaviour composition rules encourage. Worth knowing before anyone treats this rule as
 * having raised the floor.
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
    // Last, deliberately. Every check above names something true about *this* password — it is
    // common, it carries your name, it repeats one character. Composition can only say "add a
    // symbol", so it is the fallback once nothing more specific applies.
    if (!PasswordPolicy.hasRequiredCharacterClasses(password)) {
      return AuthMessages.PasswordMissingCharacterClasses;
    }

    return null;
  }

  /**
   * Whether the password carries all four required classes: an uppercase letter, a lowercase
   * letter, a digit and a special character.
   *
   * Tested against the raw password, not the lower-cased copy the other rules use — lowering
   * it first would destroy the very distinction the uppercase test is looking for.
   */
  private static hasRequiredCharacterClasses(password: string): boolean {
    let hasUpper = false;
    let hasLower = false;
    let hasDigit = false;
    let hasSpecial = false;

    for (const character of password) {
      if (character >= 'A' && character <= 'Z') {
        hasUpper = true;
      } else if (character >= 'a' && character <= 'z') {
        hasLower = true;
      } else if (character >= '0' && character <= '9') {
        hasDigit = true;
      } else if (AuthConstants.PasswordSpecialCharacters.includes(character)) {
        hasSpecial = true;
      }
    }

    return hasUpper && hasLower && hasDigit && hasSpecial;
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
