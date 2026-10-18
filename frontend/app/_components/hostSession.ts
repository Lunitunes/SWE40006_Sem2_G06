// Lets parts of the page react when the host logs in or out (e.g. the navbar showing host-only
// links). Login happens inside the host dashboard without a page change, so it's announced here.
const EVENT = 'photorepo:host-session-changed';

export function announceHostSessionChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onHostSessionChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export async function fetchIsHost(): Promise<boolean> {
  try {
    const res = await fetch('/api/backend/auth/me', { cache: 'no-store' });
    return res.ok && (await res.json()).authenticated === true;
  } catch {
    return false;
  }
}
