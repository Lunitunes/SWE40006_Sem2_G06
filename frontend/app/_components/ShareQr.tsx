'use client';

import QRCode from 'qrcode';
import { useEffect, useState, useSyncExternalStore } from 'react';
import styles from './ui.module.css';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const noopSubscribe = () => () => {};

type Props = {
  // PUBLIC_URL from the server, if set; otherwise the address this page was opened on
  publicUrl: string | null;
  // Path guests should land on, e.g. /e/<token>
  path: string;
  // Used for the downloaded file name
  label: string;
};

export default function ShareQr({ publicUrl, path, label }: Props) {
  // The browser's own address is only known client-side
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => null,
  );
  const base = publicUrl ?? origin;
  const link = base ? `${base}${path}` : null;
  const isLocalhost = link !== null && LOCAL_HOSTS.has(new URL(link).hostname);

  const [qr, setQr] = useState<{ link: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    // Error correction M survives some glare/damage on printed codes; black on white scans best
    QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 480, color: { dark: '#000000', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setQr({ link, dataUrl });
      })
      .catch((err) => console.error('QR code generation failed:', err));
    return () => {
      cancelled = true;
    };
  }, [link]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API needs HTTPS or localhost; the link is visible to copy by hand anyway
      window.prompt('Copy this link:', link);
    }
  };

  const ready = qr && qr.link === link;
  const fileName = `${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-qr.png`;

  return (
    <div>
      <div className={styles.qrLayout}>
        <div className={styles.qrFrame}>
          {ready ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated data URL
            <img src={qr.dataUrl} alt={`QR code linking to ${link}`} />
          ) : (
            <div className={styles.qrPlaceholder} aria-hidden />
          )}
        </div>

        <div>
          <div className={styles.label} style={{ marginTop: 0 }}>
            Guest link
          </div>
          <code className={styles.url}>{link ?? '…'}</code>

          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={copy} disabled={!link}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            {ready && (
              <a className={styles.buttonSecondary} href={qr.dataUrl} download={fileName}>
                Download QR code
              </a>
            )}
          </div>
          <p className={styles.hint} role="status">
            {copied ? 'Link copied to the clipboard.' : 'Anyone with this link can add and view photos for this event.'}
          </p>
        </div>
      </div>

      {isLocalhost && (
        <p className={styles.note}>
          This code points to <strong>localhost</strong>, which only works on this computer. To test with a phone on
          the same Wi-Fi, open this page using your computer’s network address instead (for example{' '}
          <code>http://192.168.1.20:3000/host</code>), or set <code>PUBLIC_URL</code> in <code>.env</code>.
        </p>
      )}
    </div>
  );
}
