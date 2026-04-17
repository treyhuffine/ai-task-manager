'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Camera, AlertCircle, Loader2 } from 'lucide-react';
import QrScanner from 'qr-scanner';
import { cn } from '@/lib/utils';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the raw decoded string (could be a URL or a bare token). */
  onDecoded: (raw: string) => void;
}

/**
 * Full-screen camera overlay for scanning pairing QR codes.
 * Uses navigator.mediaDevices.getUserMedia under the hood — requires a
 * secure context (HTTPS or localhost).
 */
export function QrScannerModal({ open, onClose, onDecoded }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'running' }
    | { kind: 'decoded' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    setStatus({ kind: 'starting' });

    const scanner = new QrScanner(
      video,
      (result) => {
        if (cancelled) return;
        setStatus({ kind: 'decoded' });
        onDecoded(result.data);
      },
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: 'environment',
      },
    );
    scannerRef.current = scanner;

    scanner
      .start()
      .then(() => {
        if (!cancelled) setStatus({ kind: 'running' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        const msg =
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Enable it in your browser settings.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera found on this device.'
              : 'Could not start the camera. Try again, or paste the token manually.';
        setStatus({ kind: 'error', message: msg });
      });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [open, onDecoded]);

  if (!open) return null;

  const showVideo = status.kind === 'running' || status.kind === 'starting' || status.kind === 'decoded';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white border-b border-white/10">
        <div className="flex items-center gap-2">
          <Camera size={16} />
          <span className="text-sm font-medium">Scan pairing QR</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Close scanner"
        >
          <X size={18} />
        </button>
      </div>

      {/* Video / status */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          className={cn(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-200',
            showVideo ? 'opacity-100' : 'opacity-0',
          )}
        />

        {status.kind === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">Starting camera…</span>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle size={22} className="text-red-400" />
            </div>
            <p className="text-sm text-white/90 max-w-xs leading-relaxed">{status.message}</p>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {status.kind === 'decoded' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2 text-white">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Validating…</span>
          </div>
        )}
      </div>

      {/* Footer hint */}
      {status.kind === 'running' && (
        <div className="px-6 py-3 text-center text-xs text-white/60 border-t border-white/10">
          Point your camera at the pairing QR code
        </div>
      )}
    </div>
  );
}
