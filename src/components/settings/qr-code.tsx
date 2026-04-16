'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cn } from '@/lib/utils';

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Client-side QR renderer. Uses the `qrcode` lib to generate a data URL so
 * we don't ship a React-specific QR dep. The QR itself is always rendered
 * black-on-white (high contrast for scanners) inside a white card so it
 * stays scannable regardless of the surrounding theme.
 */
export function QrCode({ value, size = 180, className }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2, // render at 2x for crispness
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-border bg-white p-2',
        className,
      )}
      style={{ width: size + 16, height: size + 16 }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          width={size}
          height={size}
          alt="QR code"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="w-full h-full animate-pulse bg-muted rounded-sm" />
      )}
    </div>
  );
}
