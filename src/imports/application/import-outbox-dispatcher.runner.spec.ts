import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportOutboxDispatcherRunner } from './import-outbox-dispatcher.runner';
import { ImportOutboxDispatcherService } from './import-outbox-dispatcher.service';

describe('ImportOutboxDispatcherRunner', () => {
  const dispatchOnce = vi.fn<ImportOutboxDispatcherService['dispatchOnce']>();

  beforeEach(() => {
    vi.useFakeTimers();
    dispatchOnce.mockReset();
    dispatchOnce.mockResolvedValue(emptyResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts immediately and waits the poll interval after each run', async () => {
    const runner = createRunner();

    runner.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchOnce).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(999);
    expect(dispatchOnce).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(dispatchOnce).toHaveBeenCalledTimes(2);

    await runner.stop();
  });

  it('does not overlap dispatch executions', async () => {
    let finishFirstRun: (() => void) | undefined;
    dispatchOnce.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstRun = () => resolve(emptyResult());
        }),
    );
    const runner = createRunner();

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(dispatchOnce).toHaveBeenCalledOnce();

    finishFirstRun?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dispatchOnce).toHaveBeenCalledTimes(2);

    await runner.stop();
  });

  it('continues after a failed cycle without exposing the error', async () => {
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    dispatchOnce.mockRejectedValueOnce(new Error('sensitive detail'));
    const runner = createRunner();

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(dispatchOnce).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      'Import outbox dispatch cycle failed',
    );

    await runner.stop();
  });

  it('cancels pending work when stopped', async () => {
    const runner = createRunner();

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    await runner.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dispatchOnce).toHaveBeenCalledOnce();
  });

  function createRunner(): ImportOutboxDispatcherRunner {
    return new ImportOutboxDispatcherRunner(
      { dispatchOnce } as unknown as ImportOutboxDispatcherService,
      1_000,
    );
  }
});

function emptyResult() {
  return {
    claimed: 0,
    published: 0,
    rescheduled: 0,
    failed: 0,
  };
}
