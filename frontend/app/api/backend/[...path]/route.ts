import type { NextRequest } from 'next/server';

// Read at request time, so one built image works in every environment (compose sets http://backend:3001)
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

export const dynamic = 'force-dynamic';

// The browser calls /api/backend/upload/... on the frontend's own origin and this forwards it, so phones
// opening the QR link (where "localhost" is the phone) and EC2 deployments work without CORS or a
// backend URL baked into the bundle. Only the upload API is exposed.
async function proxy(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== 'upload') return Response.json({ message: 'Not found' }, { status: 404 });

  const url = new URL(`/${path.map(encodeURIComponent).join('/')}`, BACKEND_URL);
  url.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let res: Response;
  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    res = await fetch(url, {
      method: request.method,
      headers,
      // Stream uploads straight through instead of buffering them in the frontend
      body: hasBody ? request.body : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    } as RequestInit);
  } catch {
    return Response.json({ message: 'Could not reach the backend.' }, { status: 502 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'cache-control', 'x-content-type-options']) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST };
