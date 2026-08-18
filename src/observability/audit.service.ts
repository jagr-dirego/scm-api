import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditRepository } from './audit.repository';
import { parseAuditPayload } from './audit.contracts';
import type { AuditEventInput, AuditTransaction } from './audit.types';
import { AuditContextError, AuditValidationError } from './errors/audit.error';
import { RequestContextService } from './request-context.service';
import { isRequestId } from './request-id';

const commonSchema = z.object({
  actor: z.object({
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
    organizationId: z.string().uuid(),
  }),
  entityId: z.string().uuid(),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().max(1024).optional(),
});

@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  async record(
    input: AuditEventInput,
    transaction?: AuditTransaction,
  ): Promise<string> {
    const requestId = this.requestContext.getRequestId();
    if (!isRequestId(requestId)) throw new AuditContextError();

    const parsed = commonSchema.safeParse(input);
    if (!parsed.success) throw new AuditValidationError();
    const payload = parseAuditPayload(input);

    return this.repository.insert(
      {
        organizationId: parsed.data.actor.organizationId,
        actorUserId: parsed.data.actor.userId,
        actorSessionId: parsed.data.actor.sessionId,
        action: payload.action,
        entityName: payload.entityName,
        entityId: parsed.data.entityId,
        ...(payload.beforeData ? { beforeData: payload.beforeData } : {}),
        ...(payload.afterData ? { afterData: payload.afterData } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
        ...(parsed.data.ipAddress ? { ipAddress: parsed.data.ipAddress } : {}),
        ...(parsed.data.userAgent ? { userAgent: parsed.data.userAgent } : {}),
        requestId,
      },
      transaction,
    );
  }
}
