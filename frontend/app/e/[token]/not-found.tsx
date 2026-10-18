import styles from '../../_components/ui.module.css';

export default function EventNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Event not found</h1>
        <p className={styles.lead}>
          This link doesn’t match an event. It may have been mistyped, or the host may have closed the event. Ask the
          host for a new link or QR code.
        </p>
      </div>
    </main>
  );
}
