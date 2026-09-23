import type { Context, MiddlewareHandler } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { readSecrets } from '../env';

const COOKIE = 'trashboard_session';
const SESSION_DAYS = 30;

const encoder = new TextEncoder();

// Compares the digests, not the strings, so the time taken does not depend on
// how much of the password is correct.
const sameSecret = async ({ given, expected }: { given: string; expected: string }): Promise<boolean> => {
  const [a, b] = await Promise.all(
    [given, expected].map((text) => crypto.subtle.digest('SHA-256', encoder.encode(text))),
  );
  return a !== undefined && b !== undefined && crypto.subtle.timingSafeEqual(a, b);
};

export const checkPassword = ({ env, password }: { env: Env; password: string }) =>
  sameSecret({ given: password, expected: readSecrets(env).DASHBOARD_PASSWORD });

export const startSession = (c: Context<{ Bindings: Env }>): Promise<void> => {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return setSignedCookie(c, COOKIE, String(expires), readSecrets(c.env).SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
};

export const endSession: MiddlewareHandler = async (c, next) => {
  deleteCookie(c, COOKIE, { path: '/' });
  await next();
};

export const requireSession: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const value = await getSignedCookie(c, readSecrets(c.env).SESSION_SECRET, COOKIE);
  const expires = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(expires) || expires < Date.now()) {
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  await next();
};
