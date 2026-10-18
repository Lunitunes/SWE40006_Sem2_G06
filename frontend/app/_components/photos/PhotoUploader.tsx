'use client';

import { useEffect, useState } from 'react';
import UploadForm from './UploadForm';
import Gallery from './Gallery';

// Holds the shared state between the form and the gallery: each successful upload bumps the
// key, which makes the gallery fetch the photo list again
export default function PhotoUploader({ token }: { token: string }) {
  const [galleryVersion, setGalleryVersion] = useState(0);
  const [isHost, setIsHost] = useState(false);

  // Hosts viewing their own event page can also delete photos
  useEffect(() => {
    let cancelled = false;
    fetch('/api/backend/auth/me')
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((body: { authenticated?: boolean }) => {
        if (!cancelled) setIsHost(!!body.authenticated);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <UploadForm token={token} onUploaded={() => setGalleryVersion((v) => v + 1)} />
      <Gallery token={token} refreshKey={galleryVersion} canDelete={isHost} />
    </>
  );
}
