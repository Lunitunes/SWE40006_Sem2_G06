import type { Metadata } from 'next';
import { connection } from 'next/server';
import HostDashboard from './HostDashboard';
import styles from '../_components/ui.module.css';

export const metadata: Metadata = {
  title: 'Host',
  robots: { index: false, follow: false },
};

export default async function HostPage() {
  // Read PUBLIC_URL per request, not at build time, so one image works in every environment
  await connection();
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '') || null;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <HostDashboard publicUrl={publicUrl} />
      </div>
    </main>
  );
}
