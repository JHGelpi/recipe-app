import { env } from '../../../../test-support/env';

/**
 * A PowerSync client reduced to what the tests need: it opens the sync stream
 * the app opens, with the given token, and records the rows put to it.
 */
export type SyncStream = {
  /** Resolves once the first checkpoint is complete: the stream is live. */
  ready: Promise<void>;
  /** Resolves true once a row with this id arrives, false after `ms`. */
  receives(id: string, ms: number): Promise<boolean>;
  close(): void;
};

type Line = {
  checkpoint_complete?: unknown;
  data?: { data: { op: string; object_id?: string }[] };
};

export function openSyncStream(accessToken: string): SyncStream {
  const abort = new AbortController();
  const seen = new Set<string>();
  const waiters = new Set<() => void>();
  let markReady!: () => void;
  let failReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });

  const handle = (line: Line) => {
    if (line.checkpoint_complete) markReady();
    for (const op of line.data?.data ?? []) {
      if (op.op === 'PUT' && op.object_id) seen.add(op.object_id);
    }
    for (const wake of waiters) wake();
  };

  void (async () => {
    const response = await fetch(`${env.publicUrl}/sync/sync/stream`, {
      method: 'POST',
      headers: { Authorization: `Token ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_data: true,
        streams: { include_defaults: true, subscriptions: [] },
      }),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`sync stream: ${response.status} ${await response.text()}`);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (text) handle(JSON.parse(text) as Line);
      }
    }
  })().catch((error: unknown) => {
    if (!abort.signal.aborted) failReady(error);
  });

  return {
    ready,
    receives(id, ms) {
      return new Promise((resolve) => {
        const check = () => {
          if (!seen.has(id)) return;
          cleanup();
          resolve(true);
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, ms);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    },
    close: () => abort.abort(),
  };
}
