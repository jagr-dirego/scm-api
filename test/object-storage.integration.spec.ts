import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { S3ObjectStorageAdapter } from '../src/imports/infrastructure/object-storage/s3-object-storage.adapter';

const endpoint = process.env.TEST_OBJECT_STORAGE_ENDPOINT;
const describeWithObjectStorage = endpoint ? describe : describe.skip;

describeWithObjectStorage('S3ObjectStorageAdapter integration', () => {
  const adapter = new S3ObjectStorageAdapter({
    endpoint: endpoint!,
    region: process.env.TEST_OBJECT_STORAGE_REGION ?? 'us-east-1',
    bucket: process.env.TEST_OBJECT_STORAGE_BUCKET ?? 'dirego-scm-test',
    accessKeyId:
      process.env.TEST_OBJECT_STORAGE_ACCESS_KEY_ID ?? 'scm_test_access_key',
    secretAccessKey:
      process.env.TEST_OBJECT_STORAGE_SECRET_ACCESS_KEY ??
      'scm_test_secret_key_change_only_for_local_tests',
    keyPrefix: 'integration/',
    forcePathStyle: true,
    requestTimeoutMs: 10_000,
  });

  afterAll(() => {
    adapter.destroy();
  });

  it('writes, inspects, streams and deletes an object', async () => {
    const key = `${randomUUID()}/sample.xlsx`;
    const chunks = [Buffer.from('DIREGO '), Buffer.from('SCM')];
    const contentLength = chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );

    const storedKey = `integration/${key}`;

    try {
      const stored = await adapter.putStream({
        key,
        body: Readable.from(chunks),
        contentLength,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      expect(stored.key).toBe(storedKey);
      expect(stored.etag).toBeTruthy();
      await expect(adapter.head(stored.key)).resolves.toMatchObject({
        key: stored.key,
        contentLength,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const body = await adapter.getStream(stored.key);
      expect(await collect(body)).toEqual(Buffer.concat(chunks));

      await adapter.delete(stored.key);
      await expect(adapter.head(stored.key)).resolves.toBeNull();
    } finally {
      await adapter.delete(storedKey);
    }
  });

  it.each(['', '/absolute.xlsx', '../outside.xlsx', 'folder/../outside.xlsx'])(
    'rejects unsafe key %j',
    async (key) => {
      await expect(adapter.head(key)).rejects.toThrow(
        'Invalid object storage key',
      );
    },
  );
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
