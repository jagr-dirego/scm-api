import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import {
  PASSWORD_HASH_OPTIONS,
  type PasswordHashOptions,
} from './password.constants';

@Injectable()
export class PasswordService {
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(PASSWORD_HASH_OPTIONS)
    private readonly options: PasswordHashOptions,
  ) {
    this.dummyHash = this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
      hashLength: this.options.hashLength,
    });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  needsRehash(passwordHash: string): boolean {
    try {
      const parts = passwordHash.split('$');
      const algorithm = parts[1];
      const encodedHash = parts[5];

      if (
        algorithm !== 'argon2id' ||
        !encodedHash ||
        Buffer.from(encodedHash, 'base64').length !== this.options.hashLength
      ) {
        return true;
      }

      return argon2.needsRehash(passwordHash, {
        memoryCost: this.options.memoryCost,
        timeCost: this.options.timeCost,
        parallelism: this.options.parallelism,
      });
    } catch {
      return true;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
