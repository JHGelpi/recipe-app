import { importJWK, SignJWT, type JWK } from 'jose';
import { env } from './env';

type Options = { audience?: string; expiresInSeconds?: number };

/**
 * Signs a token with the stack's own signing key. Tests use it to make tokens
 * GoTrue would never issue: already expired, for another audience, or for a
 * user with no household.
 */
export async function signTestToken(
  claims: Record<string, unknown>,
  options: Options = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(claims)
    .setAudience(options.audience ?? 'authenticated')
    .setIssuedAt(now - 600)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300));

  const keys = env.jwtKeys ? (JSON.parse(env.jwtKeys) as (JWK & { kid?: string })[]) : [];
  const jwk = keys[0];
  if (!jwk) {
    // Shared-secret fallback (see Task 3, "If the gate fails on signing").
    return jwt.setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(env.jwtSecret));
  }
  const key = await importJWK(
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    'ES256',
  );
  return jwt.setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(key);
}
