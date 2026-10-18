'use client';

import { useEffect, useState } from 'react';
import styles from '../ui.module.css';

interface PhotoItem {
  id: number;
  description: string;
  image_name: string;
  uploaded_at: string;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Props = {
  // The event's share token: the gallery only ever shows that event's photos
  token: string;
  // Changes after each upload, which re-runs the fetch below
  refreshKey?: number;
  // Hosts get a delete button on each photo
  canDelete?: boolean;
};

export default function Gallery({ token, refreshKey = 0, canDelete = false }: Props) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const base = `/api/backend/events/share/${encodeURIComponent(token)}/photos`;

  // Fetch the photo details array on mount, and again whenever refreshKey changes
  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: PhotoItem[]) => {
        if (cancelled) return;
        setPhotos(data);
        setFailed(false);
      })
      .catch((error) => {
        console.error('Error fetching gallery metadata:', error);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, refreshKey]);

  const remove = async (photo: PhotoItem) => {
    if (!window.confirm(`Delete “${photo.description}”? This can’t be undone.`)) return;
    setDeleteError(null);
    const res = await fetch(`/api/backend/photos/${photo.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setPhotos((current) => current.filter((p) => p.id !== photo.id));
    else setDeleteError(res?.status === 401 ? 'Your host login has expired. Log in again to delete photos.' : 'The photo could not be deleted. Try again.');
  };

  return (
    <section className={styles.gallery} aria-labelledby="gallery-heading">
      <div className={styles.galleryHead}>
        <h2 id="gallery-heading" className={styles.sectionTitle}>
          Gallery
        </h2>
        {!loading && !failed && (
          <span className={styles.count}>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </span>
        )}
      </div>

      {deleteError && (
        <div className={styles.status} role="alert" style={{ marginBottom: 12 }}>
          <span className={`${styles.statusIcon} ${styles.critical}`} aria-hidden>
            !
          </span>
          <span>{deleteError}</span>
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading photos…</p>
      ) : failed ? (
        <p className={styles.empty} role="alert">
          The gallery couldn’t be loaded right now. Try refreshing the page.
        </p>
      ) : photos.length === 0 ? (
        <p className={styles.empty}>No photos yet. Be the first to add one!</p>
      ) : (
        <ul className={styles.grid}>
          {photos.map((item) => (
            <li key={item.id} className={styles.photo}>
              {/* The gallery loads small thumbnails (~40 KB); tapping opens the full photo */}
              <a href={`${base}/${item.id}/image`} target="_blank" rel="noopener" className={styles.photoLink}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the backend via the proxy */}
                <img src={`${base}/${item.id}/image?size=thumb`} alt={item.description} loading="lazy" />
              </a>
              <div className={styles.photoBody}>
                <p className={styles.photoCaption}>{item.description}</p>
                <p className={styles.photoMeta}>{dateFormat.format(new Date(item.uploaded_at))}</p>
                {canDelete && (
                  <button type="button" className={styles.linkDanger} onClick={() => remove(item)}>
                    Delete photo
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
