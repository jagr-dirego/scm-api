import type { PoolClient } from 'pg';
import type { VerifiedAccessToken } from '../auth/token.service';

export type AuditData = Record<string, unknown>;

export interface AuditEventInput {
  actor: VerifiedAccessToken;
  action: string;
  entityName: string;
  entityId: string;
  beforeData?: AuditData;
  afterData?: AuditData;
  metadata?: AuditData;
  ipAddress?: string;
  userAgent?: string;
}

export interface PersistedAuditEvent {
  organizationId: string;
  actorUserId: string;
  actorSessionId: string;
  action: string;
  entityName: string;
  entityId: string;
  beforeData?: AuditData;
  afterData?: AuditData;
  metadata?: AuditData;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
}

export type AuditTransaction = PoolClient;
