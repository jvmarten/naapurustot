import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSync, getSyncStatus, retryAllSyncs, __resetSyncStatus } from '../utils/syncStatus';

// Flush a couple of microtask turns so save().then(...) settles.
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('syncStatus (PO-5)', () => {
  beforeEach(() => {
    __resetSyncStatus();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is syncing during a save and idle after success', async () => {
    runSync('favorites', () => Promise.resolve({}));
    expect(getSyncStatus()).toBe('syncing');
    await flush();
    expect(getSyncStatus()).toBe('idle');
  });

  it('reports error on failure and retries with backoff', async () => {
    let calls = 0;
    runSync('favorites', () => {
      calls++;
      return Promise.resolve(calls === 1 ? { error: 'network' } : {});
    });
    await flush();
    expect(getSyncStatus()).toBe('error');
    expect(calls).toBe(1);

    // First backoff is 2000ms; firing it re-runs the saver, which now succeeds.
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(calls).toBe(2);
    expect(getSyncStatus()).toBe('idle');
  });

  it('retryAllSyncs immediately re-runs errored domains', async () => {
    let calls = 0;
    runSync('notes', () => {
      calls++;
      return Promise.resolve(calls < 2 ? { error: 'x' } : {});
    });
    await flush();
    expect(getSyncStatus()).toBe('error');

    retryAllSyncs();
    await flush();
    expect(calls).toBe(2);
    expect(getSyncStatus()).toBe('idle');
  });

  it('stays errored while any domain is failing, even if another succeeds', async () => {
    runSync('favorites', () => Promise.resolve({}));
    runSync('notes', () => Promise.resolve({ error: 'x' }));
    await flush();
    expect(getSyncStatus()).toBe('error');
  });
});
