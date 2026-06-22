export interface MatrixProvisionResult {
  status: number;
  body: Record<string, unknown>;
}

interface ReplayEntry {
  expiresAt: number;
  result: MatrixProvisionResult;
}

export class MatrixProvisionReplayCache {
  private inFlight = new Map<string, Promise<MatrixProvisionResult>>();
  private replays = new Map<string, ReplayEntry>();

  constructor(private ttlMs = 10 * 60 * 1000) {}

  async run(
    key: string,
    create: () => Promise<MatrixProvisionResult>,
    now = Date.now(),
  ): Promise<MatrixProvisionResult> {
    this.prune(now);

    const replay = this.replays.get(key);
    if (replay && replay.expiresAt >= now) {
      return replayResult(replay.result);
    }

    const current = this.inFlight.get(key);
    if (current) {
      const result = await current;
      return isReplayable(result) ? replayResult(result) : result;
    }

    const promise = create();
    this.inFlight.set(key, promise);

    try {
      const result = await promise;
      if (isReplayable(result)) {
        this.replays.set(key, { result, expiresAt: now + this.ttlMs });
      }
      return result;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  private prune(now: number): void {
    for (const [key, replay] of this.replays) {
      if (replay.expiresAt < now) this.replays.delete(key);
    }
  }
}

function isReplayable(result: MatrixProvisionResult): boolean {
  return result.status >= 200
    && result.status < 300
    && typeof result.body.secret_key === 'string'
    && !!result.body.secret_key;
}

function replayResult(result: MatrixProvisionResult): MatrixProvisionResult {
  return {
    status: 200,
    body: {
      ...result.body,
      replayed: true,
    },
  };
}
