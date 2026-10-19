'use client';
import { useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useTheme } from 'next-themes';
import { pickMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';
import { cn } from '@/lib/utils';

/**
 * An app entrypoint's icon (OpenAI's spec, "Entrypoint Icons"): the tool's
 * own icon, else its server's, as the catalog resolved them, in the variant
 * for the current theme. With neither, or when the image fails to load, a
 * generic app mark. Icons are `https:` or image `data:` URLs only, and a
 * remote one loads without a referrer.
 */
export function EntrypointIcon({ icons, size = 16, className }: { icons?: readonly McpIcon[]; size?: number; className?: string }) {
  const { resolvedTheme } = useTheme();
  const icon = pickMcpIcon(icons, resolvedTheme === 'dark' ? 'dark' : 'light');
  const [failed, setFailed] = useState<string | null>(null);
  if (!icon || failed === icon.src) return <AppWindow size={size} aria-hidden className={cn('shrink-0 text-muted-foreground', className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon.src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(icon.src)}
    className={cn('shrink-0 object-contain', className)} style={{ width: size, height: size }} />;
}
