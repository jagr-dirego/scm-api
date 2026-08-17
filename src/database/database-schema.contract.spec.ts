import {
  products,
  requiredPostgresExtensions,
} from '@jagr-dirego/scm-database/schema';
import { describe, expect, it } from 'vitest';

type ProductRecord = typeof products.$inferSelect;

const requiredProductFields = [
  'id',
  'organizationId',
  'productExternalId',
] as const satisfies readonly (keyof ProductRecord)[];

describe('@jagr-dirego/scm-database', () => {
  it('exposes the approved schema contract without creating a client', () => {
    expect(products).toBeDefined();
    expect(requiredProductFields).toEqual([
      'id',
      'organizationId',
      'productExternalId',
    ]);
    expect(requiredPostgresExtensions).toEqual(['pgcrypto', 'citext']);
  });
});
