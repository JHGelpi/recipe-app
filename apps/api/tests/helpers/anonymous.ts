import { env } from '../../../../test-support/env';
import { connect, createAsAnonymous } from '../../src/db/asUser';
import { afterAll } from 'vitest';

const sql = connect(env.apiDbUrl);
/** The API's own anonymous helper: the authenticated role with no claims. */
export const asAnonymous = createAsAnonymous(sql);
afterAll(async () => {
  await sql.end();
});
