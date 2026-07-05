import { SignJWT } from 'jose';

// Defaults match Phase 2.1 placeholder values; override via env to mint
// tokens scoped to a real workspace + user (Phase 2.3 live smoke).
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const sub = process.env.MINT_SUB ?? '00000000-0000-0000-0000-000000000001';
const tenantId =
  process.env.MINT_TENANT_ID ?? '00000000-0000-0000-0000-000000000002';
const email = process.env.MINT_EMAIL ?? 'curl-test@boppl.test';
const scopes = (process.env.MINT_SCOPES ?? 'docs:read').split(',');

const token = await new SignJWT({
  sub,
  tenant_id: tenantId,
  email,
  scopes,
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('1h')
  .setIssuer(process.env.JWT_ISSUER)
  .setAudience(process.env.JWT_AUDIENCE)
  .sign(secret);

process.stdout.write(token);
