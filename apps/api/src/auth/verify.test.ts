import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifier, UnauthorizedError } from './verify';

const SECRET = 'unit-test-secret-unit-test-secret';
const secretKey = new TextEncoder().encode(SECRET);
const now = () => Math.floor(Date.now() / 1000);

function hs256(
  claims: Record<string, unknown>,
  key: Uint8Array = secretKey,
  expiresAt = now() + 60,
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience((claims.aud as string | undefined) ?? 'authenticated')
    .setExpirationTime(expiresAt)
    .sign(key);
}

describe('createVerifier with a shared secret', () => {
  const verify = createVerifier({ audience: 'authenticated', secret: SECRET });

  it('returns the claims of a valid token', async () => {
    const claims = await verify(await hs256({ sub: 'user-1', household_id: 'house-1' }));
    expect(claims.sub).toBe('user-1');
    expect(claims.household_id).toBe('house-1');
  });

  it('refuses a token signed with another secret', async () => {
    const other = new TextEncoder().encode('another-secret-another-secret-00');
    await expect(verify(await hs256({ sub: 'user-1' }, other))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('refuses an expired token', async () => {
    const token = await hs256({ sub: 'user-1' }, secretKey, now() - 60);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a token for another audience', async () => {
    await expect(
      verify(await hs256({ sub: 'user-1', aud: 'someone-else' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a token with no subject', async () => {
    await expect(verify(await hs256({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a token with no expiry', async () => {
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .sign(secretKey);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('refuses %j', async (token) => {
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses an unsigned token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', aud: 'authenticated', exp: now() + 60 })}.`;
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('createVerifier with a published key set', () => {
  let server: Server;
  let jwksUrl: string;
  let sign: (claims: Record<string, unknown>) => Promise<string>;
  let publicKeyBytes: Uint8Array;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
    publicKeyBytes = new TextEncoder().encode(JSON.stringify(jwk));
    sign = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setAudience('authenticated')
        .setExpirationTime(now() + 60)
        .sign(privateKey);

    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('accepts a token signed by the published key', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    expect((await verify(await sign({ sub: 'user-1' }))).sub).toBe('user-1');
  });

  it('refuses a token signed by a key that is not published', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    const stranger = await generateKeyPair('ES256');
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 60)
      .sign(stranger.privateKey);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses an HS256 token signed with the public key as the secret', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    const token = await hs256({ sub: 'user-1' }, publicKeyBytes);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('reports an unreachable key set as a server problem, not a refusal', async () => {
    // Port 9 (discard) is closed: the key set cannot be fetched.
    const verify = createVerifier({
      audience: 'authenticated',
      jwksUrl: 'http://127.0.0.1:9/jwks.json',
    });
    const outcome = await verify(await sign({ sub: 'user-1' })).then(
      () => 'accepted',
      (error: unknown) => (error instanceof UnauthorizedError ? 'unauthorized' : 'server-error'),
    );
    expect(outcome).toBe('server-error');
  });
});
