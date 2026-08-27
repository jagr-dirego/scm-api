import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type {
  ObjectStoragePort,
  PutObjectRequest,
  StoredObjectMetadata,
  StoredObjectReference,
} from '../../application/ports/object-storage.port';

export type S3ObjectStorageOptions = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  requestTimeoutMs: number;
}>;

export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async putStream(request: PutObjectRequest): Promise<StoredObjectReference> {
    const key = this.resolveKey(request.key);
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: Readable.from(request.body),
        ContentLength: request.contentLength,
        ContentType: request.contentType,
      }),
      this.sendOptions(),
    );

    return {
      key,
      ...(response.ETag ? { etag: response.ETag } : {}),
    };
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const resolvedKey = this.resolveKey(key);

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: resolvedKey,
        }),
        this.sendOptions(),
      );

      return {
        key: resolvedKey,
        contentLength: response.ContentLength ?? 0,
        ...(response.ContentType ? { contentType: response.ContentType } : {}),
        ...(response.ETag ? { etag: response.ETag } : {}),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: this.resolveKey(key),
      }),
      this.sendOptions(),
    );

    if (!response.Body || !(Symbol.asyncIterator in Object(response.Body))) {
      throw new Error('Object storage returned an empty response body');
    }

    return response.Body as AsyncIterable<Uint8Array>;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: this.resolveKey(key),
      }),
      this.sendOptions(),
    );
  }

  destroy(): void {
    this.client.destroy();
  }

  private sendOptions() {
    return {
      abortSignal: AbortSignal.timeout(this.options.requestTimeoutMs),
    };
  }

  private resolveKey(key: string): string {
    const normalizedKey = key.replaceAll('\\', '/');
    if (
      normalizedKey.length === 0 ||
      normalizedKey.startsWith('/') ||
      normalizedKey.split('/').includes('..')
    ) {
      throw new Error('Invalid object storage key');
    }

    return normalizedKey.startsWith(this.options.keyPrefix)
      ? normalizedKey
      : `${this.options.keyPrefix}${normalizedKey}`;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchKey')
  );
}
