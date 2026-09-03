import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { AuthConstants } from '../auth.constants';

/**
 * AES-256-GCM for secrets that must survive a database dump unusable.
 *
 * A TOTP secret is a credential, not a preference: anyone holding it can mint valid codes
 * forever. Storing it in plaintext would mean a dump of `users` hands over every second
 * factor, which defeats the point of having one.
 *
 * Payload format: base64(iv) . base64(authTag) . base64(ciphertext), dot-separated.
 */
@Injectable()
export class SecretCipher {
  private readonly key: Buffer;

  constructor(
    @Inject(ConfigService) source: AppConfigService | string,
    @InjectPinoLogger(SecretCipher.name) logger?: PinoLogger,
  ) {
    this.key = SecretCipher.resolveKey(source, logger);
  }

  /**
   * Mirrors the `JWT_SECRET` default (design spec §10): unset degrades to a random key with
   * a warning rather than crashing boot — `enforceDeployedEnvRules` is what actually requires
   * a real key in staging and production, not this constructor. The cost of the random
   * default is that anything encrypted before a restart cannot be read after it.
   *
   * A *configured* key that decodes to the wrong length is a different situation — a typo
   * or truncated copy-paste, not an absent setting — so it throws instead of silently
   * swapping in a random key that would quietly orphan every already-enrolled secret.
   */
  private static resolveKey(source: AppConfigService | string, logger?: PinoLogger): Buffer {
    if (typeof source === 'string') {
      return SecretCipher.decodeKey(source);
    }

    const raw = source.get('TOTP_ENCRYPTION_KEY', { infer: true });
    if (!raw) {
      logger?.warn(
        'TOTP_ENCRYPTION_KEY is not set — using a random key; enrolled second factors will not survive a restart',
      );
      return randomBytes(AuthConstants.CipherKeyBytes);
    }

    return SecretCipher.decodeKey(raw);
  }

  private static decodeKey(raw: string): Buffer {
    const key = Buffer.from(raw, 'base64');

    if (key.length !== AuthConstants.CipherKeyBytes) {
      throw new Error(
        `TOTP_ENCRYPTION_KEY must decode to ${AuthConstants.CipherKeyBytes} bytes, got ${key.length}`,
      );
    }

    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(AuthConstants.CipherIvBytes);
    const cipher = createCipheriv(AuthConstants.CipherAlgorithm, this.key, iv);
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return [iv, cipher.getAuthTag(), sealed]
      .map((part) => part.toString('base64'))
      .join(AuthConstants.CipherSeparator);
  }

  /** Null for tampered, truncated or wrong-key input — GCM authentication is the check. */
  decrypt(payload: string): string | null {
    const parts = payload.split(AuthConstants.CipherSeparator);

    if (parts.length !== AuthConstants.CipherPartCount) {
      return null;
    }

    try {
      const [iv, authTag, sealed] = parts.map((part) => Buffer.from(part, 'base64'));
      const decipher = createDecipheriv(AuthConstants.CipherAlgorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
