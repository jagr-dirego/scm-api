import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  it('checks connectivity without changing data', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const pool = {
      query,
    } as unknown as Pool;
    const service = new DatabaseService(pool);

    await service.checkConnection();

    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('closes the pool during application shutdown', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const pool = { end } as unknown as Pool;
    const service = new DatabaseService(pool);

    await service.onModuleDestroy();

    expect(end).toHaveBeenCalledOnce();
  });
});
