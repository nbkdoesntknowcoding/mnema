export interface JwtClaims {
  sub: string;
  tenant_id: string;
  scopes: string[];
  email: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  /** True when this token was minted for an admin impersonation session. Sensitive
   *  mutations (api keys, members, invitations, billing) are blocked while set. */
  imp?: boolean;
}

export interface SessionData {
  user_id: string;
  email: string;
  tenant_id: string;
  workos_user_id: string;
  access_token: string;
  jwt: string;
  /** Present only while a staff member is impersonating another user (admin center). */
  impersonating?: {
    by_user_id: string;
    by_email: string;
    target_email: string;
    until: number; // epoch ms
  };
}
