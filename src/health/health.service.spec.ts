import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports readiness when PostgreSQL is available', async () => {
    const database = {
      checkConnection: vi.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;
    const service = new HealthService(database);

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      service: 'scm-api',
      checks: { database: 'available' },
    });
  });

  it('reports unavailability without exposing connection details', async () => {
    const database = {
      checkConnection: vi.fn().mockRejectedValue(new Error('secret host')),
    } as unknown as DatabaseService;
    const service = new HealthService(database);

    await expect(service.ready()).rejects.toEqual(
      new ServiceUnavailableException({
        status: 'unavailable',
        service: 'scm-api',
        checks: { database: 'unavailable' },
      }),
    );
  });
});
