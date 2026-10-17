import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createVerifier } from './auth/verify';
import { loadConfig } from './config';
import { connect, createAsClaims, createAsUser, createPing } from './db/asUser';
import { fetchPage, FETCH_DEFAULTS } from './import/fetchPage';
import { createImportService } from './import/service';
import { createImportStore } from './import/store';
import { createGateway } from './llm/gateway';
import { createSubstitutionService } from './substitutions/service';
import { createPhotoService } from './photos/service';
import { createDiskPhotoStore } from './photos/store';

const config = loadConfig();
const sql = connect(config.databaseUrl);
const verify = createVerifier(config.verifier);
const photoStore = createDiskPhotoStore(config.photosDir);
const photos = createPhotoService({
  asClaims: createAsClaims(sql),
  asUser: createAsUser(sql, verify),
  store: photoStore,
});
const gateway = createGateway(config.ai);
const imports = createImportService({
  verify,
  store: createImportStore(createAsClaims(sql)),
  gateway,
  fetchPage: (url) => fetchPage(url, { ...FETCH_DEFAULTS, allowHosts: config.fetchAllowHosts }),
  photos: photoStore,
  ai: config.ai,
  log: (event) => console.log(JSON.stringify(event)),
});
const substitutions = createSubstitutionService({
  verify,
  asClaims: createAsClaims(sql),
  gateway,
  ai: config.ai,
  log: (event) => console.log(JSON.stringify(event)),
});
const app = createApp({
  verify,
  asUser: createAsUser(sql, verify),
  ping: createPing(sql),
  imports,
  photos,
  substitutions,
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' });
console.log(JSON.stringify({ event: 'listening', port: config.port }));

function shutdown() {
  server.close(() => {
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
