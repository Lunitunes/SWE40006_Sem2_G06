'use client';

import React, { useState, ChangeEvent, FormEvent } from 'react';

export default function UploadForm() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [description, setDescription] = useState<string>('');
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'loading' | null }>({
    message: '',
    type: null,
  });

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPhoto(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!photo || !description.trim()) {
      setStatus({ message: 'Please select a photo and add a description.', type: 'error' });
      return;
    }

    setStatus({ message: 'Uploading your content...', type: 'loading' });

    const formData = new FormData();
    formData.append('photo', photo);
    formData.append('description', description);

    try {
      // Connects directly to your local NestJS backend
      const response = await fetch('http://localhost:3001/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus({ message: '🎉 Photo successfully saved directly to PostgreSQL!', type: 'success' });
        setPhoto(null);
        setDescription('');
        (e.target as HTMLFormElement).reset();
      } else {
        setStatus({ message: data.message || 'Something went wrong during upload.', type: 'error' });
      }
    } catch (error) {
      setStatus({ message: 'Could not connect to the backend server.', type: 'error' });
      console.error('Upload error:', error);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2 style={{ marginTop: 0 }}>Upload to Postgres</h2>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Select Photo:</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={handleFileChange} 
            required 
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Description:</label>
          <input 
            type="text" 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter a brief description..." 
            required 
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>

        <button 
          type="submit" 
          disabled={status.type === 'loading'}
          style={{ 
            background: '#0070f3', 
            color: 'white', 
            border: 'none', 
            padding: '10px 15px', 
            cursor: status.type === 'loading' ? 'not-allowed' : 'pointer', 
            width: '100%',
            borderRadius: '4px'
          }}
        >
          {status.type === 'loading' ? 'Uploading...' : 'Upload to Database'}
        </button>
      </form>

      {status.message && (
        <div style={{ 
          marginTop: '15px', 
          fontWeight: 'bold', 
          textAlign: 'center',
          color: status.type === 'success' ? 'green' : status.type === 'error' ? 'red' : 'black'
        }}>
          {status.message}
        </div>
      )}
    </div>
  );
}
