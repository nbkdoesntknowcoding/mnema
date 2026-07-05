import type { JwtClaims } from '@boppl/shared';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/env.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

type SignableClaims = Omit<JwtClaims, 'iat' | 'exp' | 'iss' | 'aud'>;

export async function signJwt(claims: SignableClaims, opts?: { expiresIn?: string }): Promise<string> {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? '1h')
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  return payload as unknown as JwtClaims;
}
