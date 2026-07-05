import { and, eq, isNull } from 'drizzle-orm';
import { docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { verifyJwt } from '../lib/jwt.js';

export interface ConnectionContext {
  user_id: string;
  tenant_id: string;
  email: string;
  doc_id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

interface AuthenticateInput {
  token: string;
  documentName: string;
}

export async function authenticateConnection(
  opts: AuthenticateInput,
): Promise<ConnectionContext> {
  const claims = await verifyJwt(opts.token);

  if (!isUuid(opts.documentName)) {
    throw new Error('Invalid document name (not a UUID)');
  }
  const doc_id = opts.documentName;

  // Verify the doc exists in this tenant. RLS prevents cross-tenant access.
  const exists = await withTenant(claims.tenant_id, async (tx) => {
    const rows = await tx
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.id, doc_id), isNull(docs.deletedAt)))
      .limit(1);
    return rows.length > 0;
  });

  if (!exists) {
    throw new Error('Doc not found or not accessible');
  }

  return {
    user_id: claims.sub,
    tenant_id: claims.tenant_id,
    email: claims.email,
    doc_id,
  };
}
