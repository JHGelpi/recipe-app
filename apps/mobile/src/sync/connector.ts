import type { PowerSyncBackendConnector } from '@powersync/web';
import { config } from '../config';
import { auth } from '../session/auth';
import { sendOps, toUploadOps } from './upload';

const UPLOAD_URL = `${config.apiUrl}/upload`;

export function createConnector(): PowerSyncBackendConnector {
  return {
    async fetchCredentials() {
      const { data } = await auth.getSession();
      if (!data.session) return null;
      return { endpoint: config.powersyncUrl, token: data.session.access_token };
    },

    // PowerSync calls this whenever local writes are queued, and retries
    // with backoff when it throws.
    async uploadData(database) {
      const transaction = await database.getNextCrudTransaction();
      if (!transaction) return;

      const { data } = await auth.getSession();
      if (!data.session) throw new Error('Not signed in; upload will retry');

      const ops = toUploadOps(transaction.crud);
      if (ops.length > 0) {
        const result = await sendOps(ops, {
          fetch: (input, init) => fetch(input, init),
          url: UPLOAD_URL,
          token: data.session.access_token,
        });

        if (result.outcome === 'retry') throw new Error('Upload failed; will retry');
        if (result.outcome === 'reauth') {
          const { error } = await auth.refreshSession();
          if (error) await auth.signOut({ scope: 'local' });
          throw new Error('Session was refused; will retry after refresh');
        }
        for (const rejection of result.rejected) {
          // Dropped on purpose: the next sync restores the server's version.
          console.warn(`Upload rejected for ${rejection.id}: ${rejection.reason}`);
        }
      }

      await transaction.complete();
    },
  };
}
