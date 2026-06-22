import { describe, expect, it } from 'vitest';
import { MatrixProvisionReplayCache } from './matrix-provision-replay.js';

describe('MatrixProvisionReplayCache', () => {
  it('coalesces concurrent provision attempts for the same Matrix user', async () => {
    const cache = new MatrixProvisionReplayCache();
    let calls = 0;
    let release!: () => void;
    const blocker = new Promise<void>(resolve => { release = resolve; });

    const create = async () => {
      calls++;
      await blocker;
      return { status: 201, body: { secret_key: 'secret', handle: 'alice' } };
    };

    const first = cache.run('shape:@alice:mtrx.test', create, 1_000);
    const second = cache.run('shape:@alice:mtrx.test', create, 1_000);
    release();

    await expect(first).resolves.toMatchObject({ status: 201, body: { secret_key: 'secret' } });
    await expect(second).resolves.toMatchObject({ status: 200, body: { secret_key: 'secret', replayed: true } });
    expect(calls).toBe(1);
  });

  it('replays a recent successful provision response', async () => {
    const cache = new MatrixProvisionReplayCache(10_000);
    const create = async () => ({ status: 201, body: { secret_key: 'secret', handle: 'alice' } });

    await cache.run('shape:@alice:mtrx.test', create, 1_000);
    const replay = await cache.run('shape:@alice:mtrx.test', async () => {
      throw new Error('should not run');
    }, 2_000);

    expect(replay).toMatchObject({ status: 200, body: { secret_key: 'secret', replayed: true } });
  });

  it('does not replay responses without a secret key', async () => {
    const cache = new MatrixProvisionReplayCache(10_000);
    let calls = 0;
    const create = async () => {
      calls++;
      return { status: 200, body: { alreadyLinked: true, handle: 'alice' } };
    };

    await cache.run('shape:@alice:mtrx.test', create, 1_000);
    await cache.run('shape:@alice:mtrx.test', create, 2_000);

    expect(calls).toBe(2);
  });

  it('does not convert concurrent non-secret responses into replay successes', async () => {
    const cache = new MatrixProvisionReplayCache();
    let release!: () => void;
    const blocker = new Promise<void>(resolve => { release = resolve; });
    const create = async () => {
      await blocker;
      return { status: 409, body: { error: 'Handle @alice is already taken.' } };
    };

    const first = cache.run('shape:@alice:mtrx.test', create, 1_000);
    const second = cache.run('shape:@alice:mtrx.test', create, 1_000);
    release();

    await expect(first).resolves.toMatchObject({ status: 409, body: { error: expect.stringContaining('@alice') } });
    await expect(second).resolves.toMatchObject({ status: 409, body: { error: expect.stringContaining('@alice') } });
  });
});
