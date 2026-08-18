import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ImportAuthorizationRepository } from './import-authorization.repository';
import type {
  ImportAuthorizationDecision,
  ImportAuthorizationInput,
} from './import-authorization.types';

const importAuthorizationInputSchema = z.object({
  identity: z.object({
    userId: z.string().uuid(),
    organizationId: z.string().uuid(),
    sessionId: z.string().uuid(),
    tokenId: z.string().uuid(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  }),
  actionPermissionCode: z
    .string()
    .trim()
    .regex(/^imports\.[a-z0-9_.]+$/),
  documentTypeCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/),
  fileBranchCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/),
});

@Injectable()
export class ImportAuthorizationService {
  constructor(private readonly repository: ImportAuthorizationRepository) {}

  async authorize(
    input: ImportAuthorizationInput,
  ): Promise<ImportAuthorizationDecision> {
    const parsed = importAuthorizationInputSchema.safeParse(input);
    if (!parsed.success) return { allowed: false, profile: null };
    return this.repository.resolve(parsed.data);
  }
}
