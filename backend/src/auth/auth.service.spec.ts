import { AuthService, parseCookies, SESSION_TTL_SECONDS, sessionCookie } from './auth.service.js';

describe('AuthService', () => {
  let auth: AuthService;
  const original = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'correct horse battery staple';
    auth = new AuthService();
  });

  afterAll(() => {
    process.env.ADMIN_PASSWORD = original;
  });

  it('accepts only the configured password', () => {
    expect(auth.checkPassword('correct horse battery staple')).toBe(true);
    expect(auth.checkPassword('wrong')).toBe(false);
    expect(auth.checkPassword('')).toBe(false);
    expect(auth.checkPassword(undefined)).toBe(false);
    expect(auth.checkPassword({ password: 'correct horse battery staple' })).toBe(false);
  });

  it('refuses every login when no password is configured', () => {
    delete process.env.ADMIN_PASSWORD;
    expect(auth.isConfigured()).toBe(false);
    expect(auth.checkPassword('')).toBe(false);
    expect(auth.verifySession(auth.createSession())).toBe(false);
  });

  it('issues sessions that verify until they expire', () => {
    const now = Date.now();
    const session = auth.createSession(now);
    expect(auth.verifySession(session, now)).toBe(true);
    expect(auth.verifySession(session, now + (SESSION_TTL_SECONDS - 60) * 1000)).toBe(true);
    expect(auth.verifySession(session, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
  });

  it('rejects tampered or forged sessions', () => {
    const session = auth.createSession();
    const [expires, signature] = session.split('.');
    const farFuture = String(Number(expires) + 365 * 24 * 3600);

    expect(auth.verifySession(`${farFuture}.${signature}`)).toBe(false); // extended expiry, old signature
    expect(auth.verifySession(`${expires}.${signature.slice(0, -2)}xx`)).toBe(false);
    expect(auth.verifySession(`${expires}`)).toBe(false);
    expect(auth.verifySession('')).toBe(false);
    expect(auth.verifySession(undefined)).toBe(false);
  });

  it('logs everyone out when the password changes', () => {
    const session = auth.createSession();
    process.env.ADMIN_PASSWORD = 'a new password';
    expect(auth.verifySession(session)).toBe(false);
  });

  it('locks out after 5 failures within a minute, then recovers', () => {
    const now = Date.now();
    for (let i = 0; i < 4; i++) auth.recordFailure(now);
    expect(auth.isLockedOut(now)).toBe(false);
    auth.recordFailure(now);
    expect(auth.isLockedOut(now)).toBe(true);
    expect(auth.isLockedOut(now + 61_000)).toBe(false);
  });
});

describe('cookies', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; photorepo_session=abc.def%3D; b=2')).toEqual({ a: '1', photorepo_session: 'abc.def=', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('builds an httpOnly session cookie, Secure only over HTTPS', () => {
    const plain = sessionCookie('v', { secure: false, maxAge: 60 });
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).not.toContain('Secure');
    expect(sessionCookie('v', { secure: true, maxAge: 60 })).toContain('Secure');
  });
});
