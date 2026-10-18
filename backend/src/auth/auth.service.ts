import { Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'photorepo_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

// Failed-login throttle: after this many wrong passwords in the window, every login attempt is
// refused until the window passes. Deliberately global (the backend only sees the frontend's IP
// behind the proxy), which is enough to stop password guessing for a single shared host password.
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

// Single shared host password (ADMIN_PASSWORD), no user accounts: the brief puts "complex user
// account systems" out of scope. Sessions are stateless HMAC-signed expiry timestamps, keyed from
// the password, so changing ADMIN_PASSWORD logs every host out.
@Injectable()
export class AuthService {
  private failures: number[] = [];

  // Read on each call (not at construction) so tests and restarts pick up the current value
  private get password(): string | undefined {
    return process.env.ADMIN_PASSWORD || undefined;
  }

  isConfigured(): boolean {
    return !!this.password;
  }

  checkPassword(candidate: unknown): boolean {
    const password = this.password;
    if (!password || typeof candidate !== 'string') return false;
    // Hash both sides first so the comparison is constant-time regardless of length
    return timingSafeEqual(sha256(candidate), sha256(password));
  }

  isLockedOut(now = Date.now()): boolean {
    this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    return this.failures.length >= MAX_FAILURES;
  }

  recordFailure(now = Date.now()): void {
    this.failures.push(now);
  }

  clearFailures(): void {
    this.failures = [];
  }

  createSession(now = Date.now()): string {
    const expires = String(Math.floor(now / 1000) + SESSION_TTL_SECONDS);
    return `${expires}.${this.sign(expires)}`;
  }

  verifySession(value: string | undefined, now = Date.now()): boolean {
    if (!value || !this.password) return false;
    const [expires, signature, ...rest] = value.split('.');
    if (!expires || !signature || rest.length) return false;

    const expected = Buffer.from(this.sign(expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

    return Number(expires) * 1000 > now;
  }

  private sign(payload: string): string {
    const key = sha256(`photorepo-session:${this.password}`);
    return createHmac('sha256', key).update(payload).digest('base64url');
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sessionCookie(value: string, { secure, maxAge }: { secure: boolean; maxAge: number }): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
