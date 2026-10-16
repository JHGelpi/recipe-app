import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createVerifier } from './auth/verify';
import { loadConfig } from './config';
import { connect, createAsUser, createPing } from './db/asUser';

const config = loadConfig();
const sql = connect(config.databaseUrl);
const verify = createVerifier(config.verifier);
const app = createApp({ verify, asUser: createAsUser(sql, verify), ping: createPing(sql) });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' });
console.log(JSON.stringify({ event: 'listening', port: config.port }));

function shutdown() {
  server.close(() => {
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
