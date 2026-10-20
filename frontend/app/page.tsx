import Link from 'next/link';
import styles from './_components/ui.module.css';

// Guests normally arrive straight on their event's page (/e/<token>) from the host's QR code or
// link, so this page is for anyone who lands on the bare address
export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Photo Repo Live</h1>
        <p className={styles.lead}>Collect everyone’s photos from your event in one place.</p>

        <section className={styles.card} aria-labelledby="guest-heading">
          <h2 id="guest-heading" className={styles.sectionTitle}>
            Here to add photos?
          </h2>
          <p className={styles.lead} style={{ marginTop: 0 }}>
            Scan the QR code at the event, or open the link the host shared with you. It takes you straight to the
            event’s upload page.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="host-heading">
          <h2 id="host-heading" className={styles.sectionTitle}>
            Hosting an event?
          </h2>
          <p className={styles.lead} style={{ marginTop: 0 }}>
            Create an event to get a share link and QR code for your guests.
          </p>
          <div className={styles.actions}>
            <Link href="/host" className={styles.button} style={{ flex: '0 0 auto' }}>
              Go to host dashboard
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
