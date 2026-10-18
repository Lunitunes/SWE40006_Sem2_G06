'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import styles from './Navbar.module.css';

// Ops tools (Grafana, Prometheus, Alertmanager) are deliberately not linked here: this bar is seen
// by guests uploading photos. Their URLs are in the README.
const APP_LINKS = [
  { href: '/upload', label: 'Upload' },
  { href: '/admin/metrics', label: 'Metrics' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const close = () => setOpen(false);

  return (
    <header className={styles.bar}>
      <nav className={styles.nav} aria-label="Main">
        <Link href="/upload" className={styles.brand} onClick={close}>
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
          </ul>
        </div>
      </nav>
    </header>
  );
}
