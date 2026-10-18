import type { NextRequest } from 'next/server';

// Read at request time, so one built image works in every environment (compose sets http://backend:3001)
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export const dynamic = 'force-dynamic';

// The timeout covers the whole request, including the time the guest's phone spends sending the
// photo. A 10 MB photo on weak event Wi-Fi (~50 KB/s) takes over 3 minutes, so uploads get 240s.
// That stays under Node's 300s server requestTimeout (Next.js and NestJS), so the guest gets a clear
// 504 instead of a dropped connection. Reads only fetch from the backend, so 30s is plenty.
const UPLOAD_TIMEOUT_MS = 240_000;
const READ_TIMEOUT_MS = 30_000;

// Backend route groups the browser may reach. /metrics and /health stay internal.
const ALLOWED_PREFIXES = new Set(['events', 'photos', 'auth']);

// The browser calls /api/backend/... on the frontend's own origin and this forwards it, so phones
// opening the QR link (where "localhost" is the phone) and EC2 deployments work without CORS or a
// backend URL baked into the bundle. Same-origin also means the host's session cookie just works.
async function proxy(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!ALLOWED_PREFIXES.has(path[0])) return Response.json({ message: 'Not found' }, { status: 404 });

  const url = new URL(`/${path.map(encodeURIComponent).join('/')}`, BACKEND_URL);
  url.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ['content-type', 'accept', 'cookie']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Lets the backend mark the session cookie Secure when the site is served over HTTPS
  headers.set('x-forwarded-proto', request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', ''));

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const timeoutMs = hasBody ? UPLOAD_TIMEOUT_MS : READ_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(url, {
      method: request.method,
      headers,
      // Stream uploads straight through instead of buffering them in the frontend
      body: hasBody ? request.body : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return Response.json(
        { message: `The request took longer than ${timeoutMs / 1000} seconds and was stopped.` },
        { status: 504 },
      );
    }
    return Response.json({ message: 'Could not reach the backend.' }, { status: 502 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'cache-control', 'x-content-type-options']) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) out.append('set-cookie', cookie);
  // 204 responses must not have a body
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
