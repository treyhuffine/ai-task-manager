'use client';

/**
 * ConnectorLogo — the brand mark for a provider, on a subtle rounded tile.
 *
 * Real logos come from the vendored simple-icons path data (connector-icon-data.ts).
 * Near-black brand marks (Notion, Resend, Plaid…) render in the theme foreground
 * color instead of their literal hex, so they stay visible in dark mode. Providers
 * with no vendored logo fall back to a brand-colored monogram tile.
 */
import { CONNECTOR_ICONS } from './connector-icon-data';
import { connectorMeta } from './connector-meta';
import { cn } from '@/lib/utils';

/** WCAG relative luminance (0 = black, 1 = white) for a 6-digit hex. */
function luminance(hex: string): number {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Stable brand color for a monogram when no explicit hex is set. */
function hashHex(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hues = ['4F46E5', '0EA5E9', '059669', 'D97706', 'DB2777', '7C3AED', '0891B2', 'DC2626'];
  return hues[h % hues.length]!;
}

export function ConnectorLogo({
  providerId,
  name,
  size = 36,
  className,
}: {
  providerId: string;
  /** Display name, used for the monogram letter + a11y label. */
  name?: string;
  size?: number;
  className?: string;
}) {
  const icon = CONNECTOR_ICONS[providerId];
  const label = name ?? icon?.title ?? providerId;

  const tile = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-inset ring-border/50',
    className,
  );

  if (icon) {
    // Dark marks adapt to the theme; colored marks keep their brand hue.
    const dark = luminance(icon.hex) < 0.18;
    return (
      <span className={cn(tile, 'bg-muted/50')} style={{ width: size, height: size }}>
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 24 24"
          width={Math.round(size * 0.55)}
          height={Math.round(size * 0.55)}
          fill={dark ? 'currentColor' : `#${icon.hex}`}
          className={dark ? 'text-foreground' : undefined}
        >
          <path d={icon.path} />
        </svg>
      </span>
    );
  }

  // Monogram fallback for brands without a vendored logo.
  const hex = connectorMeta(providerId).brandHex ?? hashHex(providerId);
  return (
    <span
      className={cn(tile, 'font-semibold text-white')}
      style={{ width: size, height: size, backgroundColor: `#${hex}`, fontSize: Math.round(size * 0.42) }}
      aria-label={label}
      role="img"
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
