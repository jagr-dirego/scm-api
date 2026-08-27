export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export type StoredObjectReference = Readonly<{
  key: string;
  etag?: string;
}>;

export type PutObjectRequest = Readonly<{
  key: string;
  body: AsyncIterable<Uint8Array>;
  contentLength: number;
  contentType: string;
}>;

export type StoredObjectMetadata = StoredObjectReference &
  Readonly<{
    contentLength: number;
    contentType?: string;
  }>;

export interface ObjectStoragePort {
  putStream(request: PutObjectRequest): Promise<StoredObjectReference>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  getStream(key: string): Promise<AsyncIterable<Uint8Array>>;
  delete(key: string): Promise<void>;
}
