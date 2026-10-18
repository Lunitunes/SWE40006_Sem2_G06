import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import PhotoUploader from '../../_components/photos/PhotoUploader';
import styles from '../../_components/ui.module.css';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

// Shared by generateMetadata and the page, so the backend is only asked once per request
const getEvent = cache(async (token: string): Promise<{ name: string } | null> => {
  const res = await fetch(`${BACKEND_URL}/events/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend returned ${res.status} for event lookup`);
  return res.json();
});

export async function generateMetadata({ params }: PageProps<'/e/[token]'>): Promise<Metadata> {
  const event = await getEvent((await params).token);
  return {
    title: event?.name ?? 'Event not found',
    // Event links are private; keep them out of search engines
    robots: { index: false, follow: false },
  };
}

// The guest page: reached from the host's QR code or link, no account needed
export default async function EventPage({ params }: PageProps<'/e/[token]'>) {
  const { token } = await params;
  const event = await getEvent(token);
  if (!event) notFound();

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>{event.name}</h1>
        <p className={styles.lead}>Take a photo or choose one from your device, check it, then add it to the event gallery.</p>
        <PhotoUploader token={token} />
      </div>
    </main>
  );
}
