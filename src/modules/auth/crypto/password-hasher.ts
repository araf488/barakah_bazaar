import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppConfigService } from '../../../config';
import { AuthConstants } from '../auth.constants';

// `scrypt` is overloaded (with/without an options object); `promisify` only infers the
// first overload's signature (no options), so the 4-argument call below fails to typecheck
// without this explicit cast to the options-taking overload.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** The tunables that go into, and come back out of, a stored hash. */
export interface ScryptParameters {
  readonly costLog2: number;
  readonly blockSize: number;
  readonly parallelism: number;
}

/**
 * Password hashing with Node's built-in scrypt.
 *
 * On the OWASP approved list, and chosen over argon2 because it adds no dependency and no
 * native build that could break Docker or CI.
 *
 * The stored format is self-describing — `scrypt$N$r$p$salt$hash` — so raising the cost
 * later does not invalidate existing hashes: each is verified with the parameters it was
 * written with, and rewritten on the next successful login (see `needsRehash`).
 */
@Injectable()
export class PasswordHasher {
  /**
   * A real hash of a fixed value, verified against when no user matches, so the login
   * endpoint takes the same time whether or not an address exists. Without it, response
   * time alone tells an attacker which addresses are registered.
   *
   * Generated once, offline, at the production parameters (N=2^15, r=8, p=3) by hashing a
   * throwaway string — a genuine scrypt$ hash, not a placeholder, so verifying against it
   * costs the same as verifying a real one.
   */
  static readonly DUMMY_HASH =
    'scrypt$32768$8$3$uxfBrWOfHETBg1Nd+BenRg==$' + 'XepkEUVc5I1lol4gaOUWVe/8o+FCjOuRQQ/cMeU470Y=';

  private readonly params: ScryptParameters;

  constructor(@Inject(ConfigService) configOrParams: AppConfigService | ScryptParameters) {
    this.params = PasswordHasher.resolveParameters(configOrParams);
  }

  async hash(plain: string): Promise<string> {
    const { costLog2, blockSize, parallelism } = this.params;
    const cost = 2 ** costLog2;
    const salt = randomBytes(AuthConstants.PasswordSaltBytes);
    const derived = await PasswordHasher.derive(plain, salt, cost, blockSize, parallelism);

    return [
      AuthConstants.PasswordHashAlgorithm,
      cost,
      blockSize,
      parallelism,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join(AuthConstants.PasswordHashSeparator);
  }

  /** False for a wrong password AND for anything unparseable — never throws. */
  async verify(plain: string, stored: string): Promise<boolean> {
    const parsed = PasswordHasher.parse(stored);
    if (!parsed) {
      return false;
    }

    const derived = await PasswordHasher.derive(
      plain,
      parsed.salt,
      parsed.cost,
      parsed.blockSize,
      parsed.parallelism,
    );

    return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  }

  /** True when the stored hash is weaker than the current configuration. */
  needsRehash(stored: string): boolean {
    const parsed = PasswordHasher.parse(stored);
    if (!parsed) {
      return true;
    }
    return parsed.cost < 2 ** this.params.costLog2;
  }

  private static derive(
    plain: string,
    salt: Buffer,
    cost: number,
    blockSize: number,
    parallelism: number,
  ): Promise<Buffer> {
    // Node's default maxmem is 32 MiB and THROWS above it. scrypt needs 128 * N * r, so it
    // must be raised explicitly or every hash at the configured cost fails at runtime. A flat
    // safety margin is added on top of the textbook figure — see ScryptMaxMemSafetyBytes for
    // why the exact 128*N*r value alone still throws.
    const maxmem =
      AuthConstants.ScryptMaxMemFactor * cost * blockSize + AuthConstants.ScryptMaxMemSafetyBytes;

    return scryptAsync(plain.normalize('NFKC'), salt, AuthConstants.PasswordKeyBytes, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem,
    });
  }

  private static parse(stored: string): {
    cost: number;
    blockSize: number;
    parallelism: number;
    salt: Buffer;
    hash: Buffer;
  } | null {
    const parts = stored.split(AuthConstants.PasswordHashSeparator);

    if (parts.length !== AuthConstants.PasswordHashPartCount) {
      return null;
    }
    if (parts[0] !== AuthConstants.PasswordHashAlgorithm) {
      return null;
    }

    const [cost, blockSize, parallelism] = [parts[1], parts[2], parts[3]].map(Number);
    if (![cost, blockSize, parallelism].every((n) => Number.isInteger(n) && n > 0)) {
      return null;
    }

    return {
      cost,
      blockSize,
      parallelism,
      salt: Buffer.from(parts[4], 'base64'),
      hash: Buffer.from(parts[5], 'base64'),
    };
  }

  private static resolveParameters(source: AppConfigService | ScryptParameters): ScryptParameters {
    if ('costLog2' in source) {
      return source;
    }
    return {
      costLog2: source.get('SCRYPT_COST_LOG2', { infer: true }),
      blockSize: source.get('SCRYPT_BLOCK_SIZE', { infer: true }),
      parallelism: source.get('SCRYPT_PARALLELISM', { infer: true }),
    };
  }
}
