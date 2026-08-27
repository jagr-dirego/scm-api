import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { IMPORT_BATCH_QUEUED_EVENT } from './dispatcher.contracts';
import { ImportOutboxDispatcherService } from './import-outbox-dispatcher.service';
import type {
  ClaimedImportOutboxEvent,
  ImportOutboxRepository,
} from './ports/import-outbox.repository.port';
import type { ImportQueuePublisherPort } from './ports/import-queue-publisher.port';

const claimTime = new Date('2026-08-27T18:00:00.000Z');
const actionTime = new Date('2026-08-27T18:00:01.000Z');

describe('ImportOutboxDispatcherService', () => {
  let repository: ImportOutboxRepository;
  let publisher: ImportQueuePublisherPort;
  let service: ImportOutboxDispatcherService;
  let claimPending: Mock<ImportOutboxRepository['claimPending']>;
  let markPublished: Mock<ImportOutboxRepository['markPublished']>;
  let reschedule: Mock<ImportOutboxRepository['reschedule']>;
  let publish: Mock<ImportQueuePublisherPort['publish']>;

  beforeEach(() => {
    claimPending = vi.fn().mockResolvedValue([]);
    markPublished = vi.fn().mockResolvedValue(undefined);
    reschedule = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(undefined);
    repository = {
      claimPending,
      markPublished,
      reschedule,
    };
    publisher = { publish };
    service = new ImportOutboxDispatcherService(
      repository,
      publisher,
      {
        workerId: 'worker-1',
        lockMs: 60_000,
        batchSize: 20,
        backoffMs: [30_000, 120_000, 300_000],
      },
      {
        now: vi.fn().mockReturnValueOnce(claimTime).mockReturnValue(actionTime),
      },
    );
  });

  it('claims one bounded batch without scheduling itself', async () => {
    await expect(service.dispatchOnce()).resolves.toEqual({
      claimed: 0,
      published: 0,
      rescheduled: 0,
      failed: 0,
    });
    expect(claimPending).toHaveBeenCalledWith({
      workerId: 'worker-1',
      now: claimTime,
      lockExpiresAt: new Date('2026-08-27T18:01:00.000Z'),
      limit: 20,
    });
  });

  it('publishes and confirms a supported event', async () => {
    claimPending.mockResolvedValue([event()]);

    await expect(service.dispatchOnce()).resolves.toEqual({
      claimed: 1,
      published: 1,
      rescheduled: 0,
      failed: 0,
    });
    expect(publish).toHaveBeenCalledWith({
      jobId: event().batchId,
      batchId: event().batchId,
    });
    expect(markPublished).toHaveBeenCalledWith(
      event().id,
      'worker-1',
      actionTime,
    );
  });

  it('reschedules queue failures using the approved backoff', async () => {
    claimPending.mockResolvedValue([event({ attemptCount: 2 })]);
    publish.mockRejectedValue(new Error('redis down'));

    await expect(service.dispatchOnce()).resolves.toEqual({
      claimed: 1,
      published: 0,
      rescheduled: 1,
      failed: 0,
    });
    expect(reschedule).toHaveBeenCalledWith({
      eventId: event().id,
      workerId: 'worker-1',
      availableAt: new Date('2026-08-27T18:02:01.000Z'),
      errorCode: 'QUEUE_PUBLISH_FAILED',
    });
  });

  it('uses a safe code for unsupported events', async () => {
    claimPending.mockResolvedValue([event({ eventType: 'unknown.event.v1' })]);

    await service.dispatchOnce();

    expect(publish).not.toHaveBeenCalled();
    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'OUTBOX_EVENT_UNSUPPORTED' }),
    );
  });

  it('reschedules confirmation failures after queue publication', async () => {
    claimPending.mockResolvedValue([event()]);
    markPublished.mockRejectedValue(new Error('database unavailable'));

    await service.dispatchOnce();

    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'OUTBOX_CONFIRM_FAILED' }),
    );
  });

  it('continues processing when one event cannot be rescheduled', async () => {
    const second = event({
      id: '019c9c3c-8118-7a25-9136-f58ba13ef410',
      batchId: '019c9c3c-93ae-73cf-8c60-4d8d4f918cb2',
    });
    claimPending.mockResolvedValue([event(), second]);
    publish
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);
    reschedule.mockRejectedValueOnce(new Error('database down'));

    await expect(service.dispatchOnce()).resolves.toEqual({
      claimed: 2,
      published: 1,
      rescheduled: 0,
      failed: 1,
    });
    expect(markPublished).toHaveBeenCalledWith(
      second.id,
      'worker-1',
      actionTime,
    );
  });

  it('caps retry delay at the last configured backoff', async () => {
    claimPending.mockResolvedValue([event({ attemptCount: 8 })]);
    publish.mockRejectedValue(new Error('redis down'));

    await service.dispatchOnce();

    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({
        availableAt: new Date('2026-08-27T18:05:01.000Z'),
      }),
    );
  });
});

function event(
  overrides: Partial<ClaimedImportOutboxEvent> = {},
): ClaimedImportOutboxEvent {
  return {
    id: '019c9c3c-8118-7a25-9136-f58ba13ef409',
    batchId: '019c9c3c-93ae-73cf-8c60-4d8d4f918ca1',
    eventType: IMPORT_BATCH_QUEUED_EVENT,
    attemptCount: 1,
    lockedBy: 'worker-1',
    lockExpiresAt: new Date('2026-08-27T18:01:00.000Z'),
    ...overrides,
  };
}
