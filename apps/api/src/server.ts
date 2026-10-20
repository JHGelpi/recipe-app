import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createVerifier } from './auth/verify';
import { aiMode, loadConfig } from './config';
import { connect, createAsAnonymous, createAsClaims, createAsUser, createPing } from './db/asUser';
import { fetchPage, FETCH_DEFAULTS } from './import/fetchPage';
import { createImportService } from './import/service';
import { createImportStore } from './import/store';
import { createHouseholdService } from './household/service';
import { createSharingService } from './sharing/service';
import { createSignupService } from './signup/service';
import { createRateLimiter } from './rateLimit';
import { createGateway } from './llm/gateway';
import { createSubstitutionService } from './substitutions/service';
import { createPhotoService } from './photos/service';
import { createDiskPhotoStore } from './photos/store';

const config = loadConfig();
console.log(JSON.stringify({ event: 'ai_mode', mode: aiMode(config.ai) }));
const sql = connect(config.databaseUrl);
const verify = createVerifier(config.verifier);
const photoStore = createDiskPhotoStore(config.photosDir);
// Spec §3: leftovers of interrupted uploads are cleared once a day old.
void photoStore
  .sweep(86_400_000)
  .then((removed) => removed && console.log(JSON.stringify({ event: 'photo_sweep', removed })))
  .catch((error: unknown) => console.error('Photo sweep failed', error));
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
const household = createHouseholdService({
  asUser: createAsUser(sql, verify),
  photos: photoStore,
  log: (event) => console.log(JSON.stringify(event)),
});
const sharing = createSharingService({
  asUser: createAsUser(sql, verify),
  asAnonymous: createAsAnonymous(sql),
  store: photoStore,
});
const signup = createSignupService({ asAnonymous: createAsAnonymous(sql) });
// 10 asks per email, 30 per link and 30 per address an hour, 300 in all;
// GoTrue rate-limits the emails themselves.
const limits = {
  email: createRateLimiter({ limit: 10, windowMs: 3_600_000 }),
  code: createRateLimiter({ limit: 30, windowMs: 3_600_000 }),
  ip: createRateLimiter({ limit: 30, windowMs: 3_600_000 }),
  all: createRateLimiter({ limit: 300, windowMs: 3_600_000 }),
};
const app = createApp({
  verify,
  asUser: createAsUser(sql, verify),
  ping: createPing(sql),
  imports,
  photos,
  substitutions,
  household,
  sharing,
  signup,
  limits,
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
