import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, Loader2, RefreshCw, Trash2, UserRound, X } from 'lucide-react';
import { shrinkImageForUpload } from '../../utils/image.js';

interface Props {
  /** The photo as a data URL, or null for none. */
  value: string | null;
  onChange: (photo: string | null) => void;
  disabled?: boolean;
  /** Shown under the buttons. */
  hint?: string;
}

/**
 * A phone or tablet has a camera the browser can open straight from a file
 * input. A laptop does not — `capture` is ignored there and the shop would get
 * a file dialog — so a mouse-driven screen gets a webcam window instead.
 */
function prefersNativeCamera(): boolean {
  if (typeof window === 'undefined') return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const canStream = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  return coarse || !canStream;
}

/**
 * The customer's photo, taken at the counter: "Camera" opens the camera,
 * "Choose file" picks a photo already on the phone or computer. Either way the
 * picture is shrunk in the browser before it is ever sent.
 */
export const CustomerPhotoPicker: React.FC<Props> = ({ value, onChange, disabled, hint }) => {
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);

  const busy = disabled || processing;

  const accept = async (file: File | Blob | undefined | null) => {
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      const asFile = file instanceof File ? file : new File([file], 'photo.jpg', { type: file.type || 'image/jpeg' });
      onChange(await shrinkImageForUpload(asFile));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be used. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file can be chosen again after a removal.
    e.target.value = '';
    void accept(file);
  };

  const openCamera = () => {
    setError(null);
    if (prefersNativeCamera()) cameraInput.current?.click();
    else setWebcamOpen(true);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border-2 border-ink-900 bg-paper-200">
        {value ? (
          <img src={value} alt="Customer photo" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink-400">
            <UserRound className="h-10 w-10" aria-hidden="true" />
          </div>
        )}
        {processing && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-ink-700" aria-label="Preparing photo" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openCamera} disabled={busy} className="btn-secondary px-3 py-1.5 text-caption">
            {value ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
            <span>{value ? 'Retake' : 'Camera'}</span>
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="btn-secondary px-3 py-1.5 text-caption"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            <span>Choose file</span>
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={busy}
              className="btn-ghost px-2.5 py-1.5 text-caption text-critical-700"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>Remove</span>
            </button>
          )}
        </div>
        {hint && !error && <p className="mt-1.5 text-micro text-ink-400">{hint}</p>}
        {error && (
          <p role="alert" className="mt-1.5 text-caption font-semibold text-critical-700">
            {error}
          </p>
        )}
      </div>

      {/* The shop photographs the customer, so the back camera. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="customer-photo-camera"
        onChange={onPicked}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="customer-photo-file"
        onChange={onPicked}
      />

      {webcamOpen && (
        <WebcamCapture
          onCancel={() => setWebcamOpen(false)}
          onCapture={(blob) => {
            setWebcamOpen(false);
            void accept(blob);
          }}
          onUnavailable={() => {
            // No webcam, or permission refused: fall back to the file dialog.
            setWebcamOpen(false);
            setError('The camera could not be opened here. Choose a photo file instead.');
          }}
        />
      )}
    </div>
  );
};

/** A webcam window for a laptop or desktop counter. */
const WebcamCapture: React.FC<{
  onCapture: (photo: Blob) => void;
  onCancel: () => void;
  onUnavailable: () => void;
}> = ({ onCapture, onCancel, onUnavailable }) => {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onUnavailable();
      });
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
    // Opened once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.9);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take the customer's photo"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4"
      onClick={onCancel}
    >
      <div className="surface w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-ink-900 px-4 py-3">
          <p className="font-display text-title font-black text-ink-900">Customer photo</p>
          <button type="button" onClick={onCancel} className="btn-ghost px-2" aria-label="Close camera">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="relative aspect-[4/3] bg-ink-900">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center text-white">
              <Loader2 className="h-7 w-7 animate-spin" aria-label="Starting camera" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-caption text-ink-500">Face in the middle, good light.</p>
          <button type="button" onClick={snap} disabled={!ready} className="btn-primary">
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>Take photo</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
