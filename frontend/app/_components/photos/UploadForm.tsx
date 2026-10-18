'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import CameraView from './CameraView';
import styles from '../ui.module.css';

// Same limits the backend enforces; checked here too so guests get instant feedback
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DESCRIPTION = 500;

type Step = 'choose' | 'camera' | 'preview' | 'done';
type Source = 'camera' | 'device';

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// token: the event's share token from the URL; photos are uploaded to that event
export default function UploadForm({ token, onUploaded }: { token: string; onUploaded?: () => void }) {
  const [step, setStep] = useState<Step>('choose');
  const [source, setSource] = useState<Source>('device');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Release the preview image's memory when it's replaced or the form unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (step === 'preview') descriptionRef.current?.focus();
  }, [step]);

  const showPreview = (chosen: File, from: Source) => {
    if (chosen.type && !chosen.type.startsWith('image/')) {
      setError('That file isn’t an image. Choose a photo instead.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setError(`That photo is ${formatMb(chosen.size)}. The limit is 10 MB.`);
      return;
    }
    setError(null);
    setFile(chosen);
    setSource(from);
    setPreviewFailed(false);
    setPreviewUrl(URL.createObjectURL(chosen));
    setStep('preview');
  };

  const onFileChosen = (from: Source) => (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires a change
    if (chosen) showPreview(chosen, from);
  };

  const takePhoto = () => {
    setError(null);
    // The in-page camera needs a secure context (HTTPS or localhost). Over plain HTTP, e.g. a phone
    // on http://<server-ip>:3000, fall back to the phone's own camera app via the capture input.
    // (navigator.mediaDevices is undefined outside a secure context, despite what the DOM types say)
    if (window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function') setStep('camera');
    else cameraInputRef.current?.click();
  };

  const retake = () => {
    setError(null);
    if (source === 'camera') takePhoto();
    else deviceInputRef.current?.click();
  };

  const reset = () => {
    setStep('choose');
    setFile(null);
    setPreviewUrl(null);
    setDescription('');
    setError(null);
  };

  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    const text = description.trim();
    if (!text) {
      setError('Add a short description before uploading.');
      descriptionRef.current?.focus();
      return;
    }

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('description', text);

    try {
      // Same-origin proxy to the NestJS backend (see app/api/backend/[...path]/route.ts)
      const response = await fetch(`/api/backend/events/share/${encodeURIComponent(token)}/photos`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        setStep('done');
        onUploaded?.();
      } else if (response.status === 413) {
        setError('That photo is too large. The limit is 10 MB.');
      } else if (response.status === 404) {
        setError('This event no longer exists. Ask the host for a new link.');
      } else if (response.status === 504) {
        setError('The upload took too long, probably because the connection is slow. Try again on a stronger signal.');
      } else {
        // NestJS validation errors put the reason in `message` (a string, or a list of strings)
        const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
        setError(message || 'Something went wrong during upload. Please try again.');
      }
    } catch {
      setError('Could not connect to the server. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="upload-heading">
      <h2 id="upload-heading" className={styles.sectionTitle}>
        {step === 'preview' ? 'Check your photo' : step === 'done' ? 'Photo uploaded' : 'Add a photo'}
      </h2>

      {/* Hidden inputs: one opens the file picker, the other asks phones to open the camera app */}
      <input ref={deviceInputRef} type="file" accept="image/*" className={styles.hiddenInput} onChange={onFileChosen('device')} />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenInput}
        onChange={onFileChosen('camera')}
      />

      {step === 'choose' && (
        <div className={styles.choices}>
          <button type="button" className={styles.choice} onClick={takePhoto}>
            <span className={styles.choiceIcon} aria-hidden>
              📷
            </span>
            <span className={styles.choiceLabel}>Take a photo</span>
            <span className={styles.choiceHint}>Use your camera</span>
          </button>
          <button type="button" className={styles.choice} onClick={() => deviceInputRef.current?.click()}>
            <span className={styles.choiceIcon} aria-hidden>
              🖼️
            </span>
            <span className={styles.choiceLabel}>Choose a photo</span>
            <span className={styles.choiceHint}>From your device · up to 10 MB</span>
          </button>
        </div>
      )}

      {step === 'camera' && (
        <CameraView onCapture={(captured) => showPreview(captured, 'camera')} onCancel={() => setStep('choose')} />
      )}

      {step === 'preview' && previewUrl && (
        <form onSubmit={upload} noValidate>
          <div className={styles.media}>
            {previewFailed ? (
              <div className={styles.mediaMessage}>
                Your browser can’t preview this file type, but it can still be uploaded.
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not optimisable
              <img src={previewUrl} alt="Preview of the photo you’re about to upload" onError={() => setPreviewFailed(true)} />
            )}
          </div>

          <label htmlFor="description" className={styles.label}>
            Description
          </label>
          <textarea
            id="description"
            ref={descriptionRef}
            className={styles.textarea}
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(e) => {
              setDescription(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Who’s in it, what’s happening…"
            aria-describedby="description-count"
            required
          />
          <div id="description-count" className={styles.counter}>
            {description.length}/{MAX_DESCRIPTION}
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Looks good, upload'}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={retake} disabled={uploading}>
              {source === 'camera' ? 'Retake' : 'Choose another'}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={reset} disabled={uploading}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div>
          <div className={styles.done} role="status">
            {previewUrl && !previewFailed && (
              // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not optimisable
              <img src={previewUrl} alt="" className={styles.doneThumb} />
            )}
            <div>
              <div className={styles.status} style={{ marginTop: 0 }}>
                <span className={`${styles.statusIcon} ${styles.good}`} aria-hidden>
                  ✓
                </span>
                <span>Thanks! Your photo has been added to the gallery.</span>
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={reset}>
              Add another photo
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.status} role="alert">
          <span className={`${styles.statusIcon} ${styles.critical}`} aria-hidden>
            !
          </span>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
