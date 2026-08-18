import { z } from 'zod';
import { AuditValidationError } from './errors/audit.error';
import type { AuditData } from './audit.types';

const timestamp = z.union([z.string().datetime(), z.date()]).nullable();
const reasonMetadata = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

const contracts = {
  'users.status_changed': {
    entities: ['users'],
    before: z
      .object({ status: z.string(), deactivatedAt: timestamp.optional() })
      .strict(),
    after: z
      .object({ status: z.string(), deactivatedAt: timestamp.optional() })
      .strict(),
    metadata: reasonMetadata,
  },
  'roles.assignment_changed': {
    entities: ['user_role_assignments'],
    before: z
      .object({
        roleId: z.string().uuid(),
        branchId: z.string().uuid().nullable().optional(),
        scope: z.enum(['global', 'organization', 'branch']),
        status: z.string(),
        deactivatedAt: timestamp.optional(),
      })
      .strict(),
    after: z
      .object({
        roleId: z.string().uuid(),
        branchId: z.string().uuid().nullable().optional(),
        scope: z.enum(['global', 'organization', 'branch']),
        status: z.string(),
        deactivatedAt: timestamp.optional(),
      })
      .strict(),
    metadata: reasonMetadata,
  },
  'authorization.override_changed': {
    entities: [
      'user_permission_overrides',
      'user_import_type_overrides',
      'user_import_branch_overrides',
    ],
    before: z
      .object({
        allowed: z.boolean(),
        status: z.string(),
        deactivatedAt: timestamp.optional(),
      })
      .strict(),
    after: z
      .object({
        allowed: z.boolean(),
        status: z.string(),
        deactivatedAt: timestamp.optional(),
      })
      .strict(),
    metadata: reasonMetadata,
  },
  'imports.batch_status_changed': {
    entities: ['import_batches'],
    before: z.object({ statusCode: z.string() }).strict(),
    after: z.object({ statusCode: z.string() }).strict(),
    metadata: z
      .object({
        reason: z.string().trim().min(1).max(500).optional(),
        previousBatchId: z.string().uuid().optional(),
      })
      .strict(),
  },
} as const;

type AuditAction = keyof typeof contracts;

export interface ApprovedAuditPayload {
  action: AuditAction;
  entityName: string;
  beforeData?: AuditData;
  afterData?: AuditData;
  metadata?: AuditData;
}

export const parseAuditPayload = (input: {
  action: string;
  entityName: string;
  beforeData?: AuditData;
  afterData?: AuditData;
  metadata?: AuditData;
}): ApprovedAuditPayload => {
  if (!Object.hasOwn(contracts, input.action)) throw new AuditValidationError();
  const action = input.action as AuditAction;
  const contract = contracts[action];
  if (!(contract.entities as readonly string[]).includes(input.entityName)) {
    throw new AuditValidationError();
  }

  try {
    return {
      action,
      entityName: input.entityName,
      ...(input.beforeData
        ? { beforeData: contract.before.parse(input.beforeData) }
        : {}),
      ...(input.afterData
        ? { afterData: contract.after.parse(input.afterData) }
        : {}),
      ...(input.metadata
        ? { metadata: contract.metadata.parse(input.metadata) }
        : {}),
    };
  } catch {
    throw new AuditValidationError();
  }
};
