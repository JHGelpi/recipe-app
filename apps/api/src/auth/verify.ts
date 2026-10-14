import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

export type TokenClaims = JWTPayload & { sub: string };
export type VerifyToken = (token: string) => Promise<TokenClaims>;

export type VerifierConfig =
  { audience: string; jwksUrl: string } | { audience: string; secret: string };

/** The token is missing, malformed, expired, for another audience, or not signed by our auth service. */
export class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = 'UnauthorizedError';
  }
}

// Failures caused by the token itself. Anything else (for example the key set
// could not be fetched) is a server problem and must not look like a refusal:
// a 401 signs the user out, a 5xx makes the client retry.
const TOKEN_FAULTS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

export function createVerifier(config: VerifierConfig): VerifyToken {
  // One key source and one algorithm family per deployment. Accepting both
  // would let a token signed with the public key as an HMAC secret pass.
  let check: (token: string) => Promise<JWTPayload>;
  if ('jwksUrl' in config) {
    const keys = createRemoteJWKSet(new URL(config.jwksUrl));
    check = async (token) =>
      (await jwtVerify(token, keys, { audience: config.audience, algorithms: ['ES256', 'RS256'] }))
        .payload;
  } else {
    const key = new TextEncoder().encode(config.secret);
    check = async (token) =>
      (await jwtVerify(token, key, { audience: config.audience, algorithms: ['HS256'] })).payload;
  }

  return async (token) => {
    let payload: JWTPayload;
    try {
      payload = await check(token);
    } catch (error) {
      if (TOKEN_FAULTS.some((kind) => error instanceof kind)) {
        throw new UnauthorizedError((error as Error).message);
      }
      throw error;
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new UnauthorizedError('token has no subject');
    }
    if (typeof payload.exp !== 'number') throw new UnauthorizedError('token has no expiry');
    return payload as TokenClaims;
  };
}
