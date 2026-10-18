'use client';

import React, { useEffect, useState } from 'react';

interface PhotoItem {
  id: number;
  description: string;
  image_name: string;
  uploaded_at: string;
}

// refreshKey changes after each upload, which re-runs the fetch below
export default function Gallery({ refreshKey = 0 }: { refreshKey?: number }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch the photo details array on mount, and again whenever refreshKey changes
  useEffect(() => {
    let cancelled = false;
    fetch('/api/backend/upload/all')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: PhotoItem[]) => {
        if (!cancelled) setPhotos(data);
      })
      .catch((error) => console.error('Error fetching gallery metadata:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) return <div style={{ textAlign: 'center', marginTop: '20px' }}>Loading gallery...</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h3>🖼️ Database Photo Gallery</h3>
      
      {photos.length === 0 ? (
        <p style={{ color: '#666', textAlign: 'center' }}>No photos uploaded yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
          {photos.map((item) => (
            <div key={item.id} style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
              
              {/* 🌟 Directly point the src to your new NestJS raw binary streaming endpoint */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={`/api/backend/upload/image/${item.id}`}
                alt={item.image_name}
                style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block' }}
              />
              
              <div style={{ padding: '12px' }}>
                <p style={{ margin: '0 0 5px 0', fontWeight: 'bold', fontSize: '15px' }}>{item.description}</p>
                <small style={{ color: '#888', display: 'block' }}>
                  {new Date(item.uploaded_at).toLocaleDateString()}
                </small>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}
