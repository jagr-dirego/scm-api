import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedContextRepository } from './authenticated-context.repository';
import { AuthenticatedContextService } from './authenticated-context.service';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

describe('AuthenticatedContextService', () => {
  it('preserves a missing context for the controller to reject later', async () => {
    const repository = { find: vi.fn().mockResolvedValue(null) };
    const service = new AuthenticatedContextService(
      repository as unknown as AuthenticatedContextRepository,
    );

    await expect(service.resolve(identity)).resolves.toBeNull();
  });

  it('validates the public contract before returning it', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue({
        user: {
          id: identity.userId,
          email: 'operator@dirego.test',
          displayName: 'SCM Operator',
        },
        organization: {
          id: identity.organizationId,
          code: 'DIREGO',
          name: 'DIREGO',
        },
        membership: {
          id: '10000000-0000-4000-8000-000000000005',
          defaultBranch: null,
        },
        session: {
          id: identity.sessionId,
          idleExpiresAt: '2026-08-25T01:00:00.000Z',
          absoluteExpiresAt: '2026-09-24T01:00:00.000Z',
        },
        capabilities: ['imports.read'],
      }),
    };
    const service = new AuthenticatedContextService(
      repository as unknown as AuthenticatedContextRepository,
    );

    await expect(service.resolve(identity)).resolves.toMatchObject({
      capabilities: ['imports.read'],
      membership: { defaultBranch: null },
    });
  });
});
