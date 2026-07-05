/**
 * Self-host login gate — asserts the middleware funnels unauthenticated /app
 * visits through /auth/login (the gateway every /app/*.astro page guard uses,
 * which routes password/oidc installs to /auth/local) rather than the
 * WorkOS-oriented /login, whose SSO buttons are inert on self-host.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
}));
vi.mock('./lib/session.ts', () => ({ getSession: getSessionMock }));

import { onRequest } from './middleware.ts';

type MiddlewareContext = {
  cookies: Record<string, never>;
  request: Request;
  locals: Record<string, unknown>;
  redirect: ReturnType<typeof vi.fn>;
};

function makeContext(path: string): MiddlewareContext {
  return {
    cookies: {},
    request: new Request(`http://localhost:4321${path}`),
    locals: {},
    redirect: vi.fn(
      (to: string) => new Response(null, { status: 302, headers: { Location: to } }),
    ),
  };
}

const run = (ctx: MiddlewareContext, next: () => Promise<Response>) =>
  (onRequest as unknown as (c: MiddlewareContext, n: () => Promise<Response>) => Promise<Response>)(
    ctx,
    next,
  );

describe('session middleware — /app login gate', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  it('redirects an unauthenticated /app visit to /auth/login, not /login', async () => {
    getSessionMock.mockResolvedValue(null);
    const ctx = makeContext('/app');
    const next = vi.fn(async () => new Response('page'));

    await run(ctx, next);

    expect(ctx.redirect).toHaveBeenCalledWith('/auth/login');
    expect(ctx.redirect).not.toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects nested /app paths too', async () => {
    getSessionMock.mockResolvedValue(null);
    const ctx = makeContext('/app/content/doc-123');
    const next = vi.fn(async () => new Response('page'));

    await run(ctx, next);

    expect(ctx.redirect).toHaveBeenCalledWith('/auth/login');
  });

  it('lets an authenticated /app visit through and populates locals.auth', async () => {
    const session = { user_id: 'u1' };
    getSessionMock.mockResolvedValue(session);
    const ctx = makeContext('/app');
    const next = vi.fn(async () => new Response('page'));

    await run(ctx, next);

    expect(ctx.locals.auth).toBe(session);
    expect(ctx.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('leaves public pages viewable without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    const ctx = makeContext('/');
    const next = vi.fn(async () => new Response('marketing'));

    await run(ctx, next);

    expect(ctx.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
