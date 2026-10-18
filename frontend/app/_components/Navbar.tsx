'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchIsHost, onHostSessionChanged } from './hostSession';
import styles from './Navbar.module.css';

// Guests arrive on their event page from the QR code, so the links are for hosts
const APP_LINKS = [
  { href: '/host', label: 'Events' },
  { href: '/admin/metrics', label: 'Metrics' },
];

// Grafana runs on the same server, port 3002, behind its own login. Only shown to logged-in hosts,
// since guests see this bar. Prometheus and Alertmanager stay unlinked: they're only reachable
// from the server itself (see the README).
const GRAFANA_PORT = 3002;

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isHost, setIsHost] = useState(false);

  // Re-checked on navigation and whenever the host dashboard logs in or out
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetchIsHost().then((host) => {
        if (!cancelled) setIsHost(host);
      });
    check();
    const unsubscribe = onHostSessionChanged(check);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const close = () => setOpen(false);
  // isHost is only ever true in the browser, so window is safe to use here
  const grafanaUrl = isHost ? `http://${window.location.hostname}:${GRAFANA_PORT}` : null;

  return (
    <header className={styles.bar}>
      <nav className={styles.nav} aria-label="Main">
        <Link href="/" className={styles.brand} onClick={close}>
          Photo Repo
        </Link>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.toggleIcon} aria-hidden>
            {open ? '✕' : '☰'}
          </span>
          Menu
        </button>

        <div id="nav-menu" className={`${styles.menu} ${open ? styles.menuOpen : ''}`}>
          <ul className={styles.links}>
            {APP_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={styles.link}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  onClick={close}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {grafanaUrl && (
              <li>
                <a href={grafanaUrl} className={styles.link} target="_blank" rel="noopener noreferrer" onClick={close}>
                  Grafana
                  <span className={styles.external} aria-hidden>
                    ↗
                  </span>
                  <span className={styles.srOnly}> (opens in a new tab)</span>
                </a>
              </li>
            )}
          </ul>
        </div>
      </nav>
    </header>
  );
}
