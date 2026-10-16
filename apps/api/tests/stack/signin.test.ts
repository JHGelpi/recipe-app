import { randomUUID } from 'node:crypto';
import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { createVerifier, UnauthorizedError } from '../../src/auth/verify';

const verify = createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl });

describe('the auth service', () => {
  it('emails a 6-digit code and issues an ES256 token the API verifier accepts', async () => {
    const actor = await signInFresh(`gate-${randomUUID()}@example.test`);
    expect(decodeProtectedHeader(actor.accessToken).alg).toBe('ES256');
    const claims = await verify(actor.accessToken);
    expect(claims.sub).toBe(actor.userId);
    // With the token hook on, GoTrue v2.197.0 sends aud as ["authenticated"]
    // in the first token after it starts and as a string after that. Both are
    // valid JWT; the verifier has already checked the audience.
    expect([claims.aud].flat()).toEqual(['authenticated']);
  });

  it('publishes its public key and never the private half', async () => {
    const response = await fetch(env.jwksUrl);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys.length).toBeGreaterThan(0);
    expect(body.keys.every((key) => key.d === undefined && key.k === undefined)).toBe(true);
  });

  it('a token with a tampered signature is refused', async () => {
    const actor = await signInFresh(`tamper-${randomUUID()}@example.test`);
    const [header, payload, signature = ''] = actor.accessToken.split('.');
    const flipped = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    await expect(verify(`${header}.${payload}.${flipped}`)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('test tokens signed with the stack key verify, so refusals below are meaningful', async () => {
    const claims = await verify(await signTestToken({ sub: randomUUID() }));
    expect(claims.aud).toBe('authenticated');
  });

  it('an expired token is refused', async () => {
    const token = await signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 });
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('a token for another audience is refused', async () => {
    const token = await signTestToken({ sub: randomUUID() }, { audience: 'someone-else' });
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
