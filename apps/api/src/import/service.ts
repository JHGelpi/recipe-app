import type { TokenClaims, VerifyToken } from '../auth/verify';
import type { ImageResult } from './fetchPage';
import { processImport, type ProcessDeps } from './process';
import type { ClaimedImport, ClaimOutcome } from './store';

export type ImportService = {
  claim(token: string, id: string): Promise<{ outcome: ClaimOutcome; claims: TokenClaims }>;
  process(claims: TokenClaims, row: ClaimedImport): Promise<void>;
  usage(token: string): Promise<{ spentUsd: number; capUsd: number }>;
  /** #116: the draft's picture, fetched by the server; the app can't read other sites. */
  image(
    token: string,
    id: string,
  ): Promise<
    { kind: 'ok'; bytes: Uint8Array; type: string } | { kind: 'missing' | 'forbidden' | 'failed' }
  >;
};

const WRITERS = ['admin', 'member'];

/**
 * The token is verified once, when the request arrives. The parse that
 * follows uses those claims, so a token expiring mid-parse loses nothing.
 */
export function createImportService(
  deps: ProcessDeps & { verify: VerifyToken; fetchImage: (url: string) => Promise<ImageResult> },
): ImportService {
  return {
    async claim(token, id) {
      const claims = await deps.verify(token);
      if (!WRITERS.includes(String(claims.household_role))) {
        return { outcome: { kind: 'forbidden' }, claims };
      }
      return { outcome: await deps.store.claim(claims, id), claims };
    },
    process: (claims, row) => processImport(deps, claims, row),
    async usage(token) {
      const claims = await deps.verify(token);
      return { spentUsd: (await deps.store.spent(claims)) / 1_000_000, capUsd: deps.ai.capUsd };
    },
    async image(token, id) {
      const claims = await deps.verify(token);
      if (!WRITERS.includes(String(claims.household_role))) return { kind: 'forbidden' };
      // Only the link the parse stored: the app can never name what to fetch.
      const url = await deps.store.imageUrl(claims, id);
      if (!url) return { kind: 'missing' };
      const result = await deps.fetchImage(url);
      return result.ok
        ? { kind: 'ok', bytes: result.bytes, type: result.type }
        : { kind: 'failed' };
    },
  };
}
