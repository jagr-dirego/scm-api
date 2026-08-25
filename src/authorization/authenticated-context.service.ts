import { Injectable } from '@nestjs/common';
import type { VerifiedAccessToken } from '../auth/token.service';
import { AuthenticatedContextRepository } from './authenticated-context.repository';
import {
  authenticatedContextSchema,
  type AuthenticatedContext,
} from './schemas/authenticated-context.schema';

@Injectable()
export class AuthenticatedContextService {
  constructor(private readonly repository: AuthenticatedContextRepository) {}

  async resolve(
    identity: VerifiedAccessToken,
  ): Promise<AuthenticatedContext | null> {
    const context = await this.repository.find(identity);
    return context ? authenticatedContextSchema.parse(context) : null;
  }
}
