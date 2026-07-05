import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/session.ts';

/**
 * Session middleware.
 *
 * Phase 4.3: populates `locals.auth` for every route (including public
 * marketing pages) so the PublicHeader can render "Open app" instead of
 * "Sign in" for already-signed-in visitors. The redirect-to-/auth/login
 * gate only fires for `/app/*` — marketing pages stay viewable to anyone.
 *
 * Session read is best-effort: a missing or unsealed cookie is treated as
 * "no session" rather than an error.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const session = await getSession(context.cookies);
  if (session) {
    context.locals.auth = session;
  }

  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/app') && !session) {
    return context.redirect('/login');
  }
  return next();
});
