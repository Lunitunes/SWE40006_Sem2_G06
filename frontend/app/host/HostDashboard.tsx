'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import ShareQr from '../_components/ShareQr';
import { announceHostSessionChanged } from '../_components/hostSession';
import styles from '../_components/ui.module.css';

type EventSummary = {
  id: number;
  name: string;
  token: string;
  createdAt: string;
  photoCount: number;
  lastUploadAt: string | null;
};

const MAX_NAME = 100;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// JSON requests to the backend through the same-origin proxy; the session cookie rides along
async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`/api/backend/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
  return { ok: res.ok, status: res.status, data, message: message as string | undefined };
}

function ErrorMessage({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className={styles.status} role="alert">
      <span className={`${styles.statusIcon} ${styles.critical}`} aria-hidden>
        !
      </span>
      <span>{text}</span>
    </div>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api('auth/login', { method: 'POST', body: { password } }).catch(() => null);
    setBusy(false);
    if (res?.ok) onLoggedIn();
    else setError(res?.message ?? 'Could not reach the server. Try again.');
  };

  return (
    <section className={styles.card} aria-labelledby="login-heading">
      <h2 id="login-heading" className={styles.sectionTitle}>
        Host login
      </h2>
      <form onSubmit={submit}>
        <label htmlFor="host-password" className={styles.label} style={{ marginTop: 0 }}>
          Password
        </label>
        <input
          id="host-password"
          type="password"
          autoComplete="current-password"
          className={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className={styles.hint}>The host password is set by whoever runs the server (ADMIN_PASSWORD).</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={busy || !password}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </div>
        <ErrorMessage text={error} />
      </form>
    </section>
  );
}

function EventCard({
  event,
  publicUrl,
  initiallyShowQr,
  onChanged,
  onDeleted,
  onSessionExpired,
}: {
  event: EventSummary;
  publicUrl: string | null;
  initiallyShowQr: boolean;
  onChanged: (event: EventSummary) => void;
  onDeleted: (id: number) => void;
  onSessionExpired: () => void;
}) {
  const [showQr, setShowQr] = useState(initiallyShowQr);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(event.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (res: Awaited<ReturnType<typeof api>> | null, fallback: string) => {
    if (res?.status === 401) onSessionExpired();
    else setError(res?.message ?? fallback);
  };

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api(`events/${event.id}`, { method: 'PATCH', body: { name } }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onChanged(res.data);
      setRenaming(false);
    } else handle(res, 'The event could not be renamed.');
  };

  const remove = async () => {
    const photos = event.photoCount === 1 ? '1 photo' : `${event.photoCount} photos`;
    if (!window.confirm(`Delete “${event.name}” and its ${photos}? Guests’ links will stop working. This can’t be undone.`)) return;
    setBusy(true);
    setError(null);
    const res = await api(`events/${event.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDeleted(event.id);
    else handle(res, 'The event could not be deleted.');
  };

  return (
    <li className={styles.event}>
      {renaming ? (
        <form onSubmit={rename} className={styles.inlineForm}>
          <div className={styles.field}>
            <label htmlFor={`rename-${event.id}`} className={styles.label} style={{ marginTop: 0 }}>
              Event name
            </label>
            <input
              id={`rename-${event.id}`}
              className={styles.input}
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button type="submit" className={`${styles.button} ${styles.small}`} disabled={busy || !name.trim()}>
            Save
          </button>
          <button
            type="button"
            className={`${styles.buttonSecondary} ${styles.small}`}
            onClick={() => {
              setRenaming(false);
              setName(event.name);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className={styles.eventHead}>
          <h3 className={styles.eventName}>{event.name}</h3>
          <span className={styles.eventMeta}>
            {event.photoCount} {event.photoCount === 1 ? 'photo' : 'photos'}
            {event.lastUploadAt ? ` · last upload ${dateFormat.format(new Date(event.lastUploadAt))}` : ''}
          </span>
        </div>
      )}
      <p className={styles.eventMeta} style={{ margin: '4px 0 0' }}>
        Created {dateFormat.format(new Date(event.createdAt))}
      </p>

      <div className={styles.eventActions}>
        <button type="button" className={styles.linkButton} onClick={() => setShowQr((s) => !s)} aria-expanded={showQr}>
          {showQr ? 'Hide QR code' : 'Show QR code & link'}
        </button>
        <Link href={`/e/${event.token}`} className={styles.linkButton}>
          Open event page
        </Link>
        {!renaming && (
          <button type="button" className={styles.linkButton} onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        <button type="button" className={styles.linkDanger} onClick={remove} disabled={busy}>
          Delete event
        </button>
      </div>

      <ErrorMessage text={error} />

      {showQr && (
        <div className={styles.eventQr}>
          <ShareQr publicUrl={publicUrl} path={`/e/${event.token}`} label={event.name} />
        </div>
      )}
    </li>
  );
}

export default function HostDashboard({ publicUrl }: { publicUrl: string | null }) {
  const [auth, setAuth] = useState<'checking' | 'out' | 'in'>('checking');
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api('auth/me')
      .then((res) => {
        if (!cancelled) setAuth(res.data?.authenticated ? 'in' : 'out');
      })
      .catch(() => {
        if (!cancelled) setAuth('out');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (auth !== 'in') return;
    let cancelled = false;
    api('events')
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401) setAuth('out');
        else if (res.ok) setEvents(res.data);
        else setError(res.message ?? 'Your events could not be loaded.');
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the server. Try refreshing the page.');
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const sessionExpired = () => {
    setEvents(null);
    setAuth('out');
    announceHostSessionChanged();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const res = await api('events', { method: 'POST', body: { name: newName } }).catch(() => null);
    setCreating(false);
    if (res?.ok) {
      setEvents((current) => [res.data, ...(current ?? [])]);
      setJustCreated(res.data.id);
      setNewName('');
    } else if (res?.status === 401) sessionExpired();
    else setError(res?.message ?? 'The event could not be created.');
  };

  const logout = async () => {
    await api('auth/logout', { method: 'POST' }).catch(() => null);
    sessionExpired();
  };

  if (auth === 'checking') return <p className={styles.lead}>Loading…</p>;

  if (auth === 'out') {
    return (
      <>
        <h1 className={styles.title}>Host dashboard</h1>
        <p className={styles.lead}>Log in to create events and get a QR code for your guests.</p>
        <LoginForm
          onLoggedIn={() => {
            setReloadKey((k) => k + 1);
            announceHostSessionChanged();
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Your events</h1>
          <p className={styles.lead}>Each event has its own guest link and QR code. Guests only see that event’s photos.</p>
        </div>
        <button type="button" className={`${styles.buttonSecondary} ${styles.small}`} onClick={logout}>
          Log out
        </button>
      </div>

      <section className={styles.card} aria-labelledby="create-heading">
        <h2 id="create-heading" className={styles.sectionTitle}>
          New event
        </h2>
        <form onSubmit={create} className={styles.inlineForm}>
          <div className={styles.field}>
            <label htmlFor="event-name" className={styles.label} style={{ marginTop: 0 }}>
              Event name
            </label>
            <input
              id="event-name"
              className={styles.input}
              value={newName}
              maxLength={MAX_NAME}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sam & Alex’s wedding"
              required
            />
          </div>
          <button type="submit" className={styles.button} disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'Create event'}
          </button>
        </form>
        <ErrorMessage text={error} />
      </section>

      {events === null ? (
        <p className={styles.lead}>Loading events…</p>
      ) : events.length === 0 ? (
        <p className={styles.empty} style={{ marginTop: 20 }}>
          No events yet. Create one above to get a guest link and QR code.
        </p>
      ) : (
        <ul className={styles.events} aria-label="Your events">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              publicUrl={publicUrl}
              initiallyShowQr={event.id === justCreated}
              onChanged={(updated) => setEvents((current) => current!.map((e) => (e.id === updated.id ? updated : e)))}
              onDeleted={(id) => setEvents((current) => current!.filter((e) => e.id !== id))}
              onSessionExpired={sessionExpired}
            />
          ))}
        </ul>
      )}
    </>
  );
}
