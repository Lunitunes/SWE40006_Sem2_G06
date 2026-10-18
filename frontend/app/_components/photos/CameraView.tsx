'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../ui.module.css';

type Props = {
  onCapture: (file: File) => void;
  onCancel: () => void;
};

type Facing = 'environment' | 'user';

function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "Camera access was blocked. Allow camera access in your browser's site settings, or choose a photo from your device instead.";
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. You can choose a photo from your device instead.';
}

// Live in-page camera. Only used where getUserMedia is available (HTTPS or localhost); elsewhere the
// upload form falls back to the phone's own camera app via <input capture>.
export default function CameraView({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The browser shows its camera permission prompt here, the first time
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);
        // Device labels/count are only reliable after permission is granted
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div>
      <div className={styles.media}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setReady(true)}
          // Mirror the selfie camera so it behaves like a mirror; the captured photo isn't mirrored
          className={facing === 'user' ? styles.mirrored : undefined}
          aria-label="Camera preview"
        />
        {(error || !ready) && (
          <div className={styles.mediaMessage} role={error ? 'alert' : 'status'}>
            {error ?? 'Starting camera… If your browser asks, allow camera access.'}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={capture} disabled={!ready || !!error}>
          <span className={styles.icon} aria-hidden>
            ◉
          </span>
          Take photo
        </button>
        {canSwitch && !error && (
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => {
              setReady(false);
              setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
            }}
          >
            Switch camera
          </button>
        )}
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          {error ? 'Back' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
