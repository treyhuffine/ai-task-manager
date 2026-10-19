'use client';
import { useEffect, useState } from 'react';
import { pickMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';
import { cn } from '@/lib/utils';

/** The page's theme, following the `dark` class next-themes sets on the root. */
function usePageTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * An icon an MCP server supplied (`safeMcpIcons` already kept only `https:`
 * and image `data:` URLs), in the variant for the current theme. Decorative,
 * since a label always names what it marks. `fallback` shows when there is
 * none or it fails to load. A remote icon loads without a referrer.
 */
export function McpIconImage({ icons, size = 14, className, fallback = null }: { icons?: readonly McpIcon[]; size?: number; className?: string; fallback?: React.ReactNode }) {
  const icon = pickMcpIcon(icons, usePageTheme());
  const [failed, setFailed] = useState<string | null>(null);
  if (!icon || failed === icon.src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a server-supplied data or https URL, not a static asset
    <img src={icon.src} alt="" aria-hidden width={size} height={size} referrerPolicy="no-referrer" loading="lazy" decoding="async"
      onError={() => setFailed(icon.src)} className={cn('shrink-0 object-contain', className)} style={{ width: size, height: size }} />
  );
}
