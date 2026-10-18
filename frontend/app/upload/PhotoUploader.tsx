'use client';

import { useState } from 'react';
import UploadForm from './UploadForm';
import Gallery from './Gallery';

// Holds the shared state between the form and the gallery: each successful upload bumps the
// key, which makes the gallery fetch the photo list again
export default function PhotoUploader() {
  const [galleryVersion, setGalleryVersion] = useState(0);

  return (
    <>
      <UploadForm onUploaded={() => setGalleryVersion((v) => v + 1)} />
      <hr style={{ maxWidth: '800px', margin: '40px auto', border: '0', borderTop: '1px solid #eee' }} />
      <Gallery refreshKey={galleryVersion} />
    </>
  );
}
