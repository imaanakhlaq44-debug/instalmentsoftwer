import { useEffect, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';
import { isValidImei } from '../../utils/saleValidation.js';

/** The barcode types printed on phone boxes for the IMEI. */
const FORMATS = ['code_128', 'ean_13', 'code_39', 'itf'];

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

/** The first barcode that reads as a valid 15-digit IMEI, or null. */
export function pickImei(codes: DetectedBarcode[]): string | null {
  for (const c of codes) {
    const digits = (c.rawValue ?? '').replace(/\D/g, '');
    if (digits.length === 15 && isValidImei(digits)) return digits;
  }
  return null;
}

type Status = 'idle' | 'opening' | 'scanning' | 'unsupported' | 'denied';

/**
 * "Scan" beside the IMEI box: opens the rear camera and reads the IMEI barcode
 * off the phone box. A JavaScript reader covers WebViews without BarcodeDetector;
 * when camera access is unavailable, typing the IMEI still works.
 */
export function ImeiScanButton({ onScan }: { onScan: (imei: string) => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const opening = useRef(false);

  const stop = () => {
    generation.current++;
    opening.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Never leave the camera on when the form closes.
  useEffect(() => stop, []);

  const close = () => {
    stop();
    setStatus('idle');
  };

  const start = async () => {
    if (opening.current || status === 'scanning') return;
    stop();
    opening.current = true;
    const run = generation.current;
    setStatus('opening');
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) {
      opening.current = false;
      setStatus('unsupported');
      return;
    }
    let detector: BarcodeDetectorLike;
    try {
      if (!Detector) throw new Error('Use the JavaScript barcode reader.');
      detector = new Detector({ formats: FORMATS });
    } catch {
      try {
        const { BrowserMultiFormatOneDReader } = await import('@zxing/browser');
        if (run !== generation.current) return;
        const reader = new BrowserMultiFormatOneDReader();
        detector = { detect: async video => [{ rawValue: reader.decode(video).getText() }] };
      } catch {
        if (run === generation.current) { opening.current = false; setStatus('unsupported'); }
        return;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (run !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
    } catch {
      if (run === generation.current) { opening.current = false; setStatus('denied'); }
      return;
    }
    opening.current = false;
    setStatus('scanning');
    let busy = false;
    timerRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || busy) return;
      if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
      busy = true;
      try {
        const imei = pickImei(await detector.detect(video));
        if (imei && run === generation.current) {
          onScan(imei);
          close();
        }
      } catch {
        // No frame yet; try again on the next tick.
      } finally {
        busy = false;
      }
    }, 250);
  };

  return (
    <>
      <button
        type="button"
        disabled={status === 'opening'}
        onClick={() => void start()}
        className="btn-secondary shrink-0 inline-flex items-center gap-1.5"
        aria-label="Scan the IMEI barcode on the box"
        title="Scan the IMEI barcode on the box"
      >
        <ScanLine className="h-4 w-4" aria-hidden="true" />
        <span>Scan</span>
      </button>
      {status !== 'idle' && (
        <div className="surface mt-2 w-full basis-full rounded-xl border-2 border-ink p-3" role="status">
          {status === 'scanning' && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="mb-2 aspect-video w-full rounded-lg border-2 border-ink bg-ink object-cover"
            />
          )}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold">
              {status === 'opening' && 'Opening camera…'}
              {status === 'scanning' && (
                <span className="bg-sun px-1">Point the camera at the IMEI barcode on the box.</span>
              )}
              {status === 'unsupported' && 'Camera scan does not work on this device. Please type the IMEI.'}
              {status === 'denied' && 'Could not open the camera. Allow camera access, or type the IMEI.'}
            </p>
            <button
              type="button"
              onClick={close}
              className="btn-secondary shrink-0 inline-flex items-center gap-1"
              aria-label="Close camera"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
