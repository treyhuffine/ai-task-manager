'use client';
import { AppWindow } from 'lucide-react';
import type { McpIcon } from '@/lib/integrations/mcp-icons';
import { cn } from '@/lib/utils';
import { McpIconImage } from './mcp-icon';

/**
 * An app entrypoint's icon (OpenAI's spec, "Entrypoint Icons"): the tool's
 * own icon, else its server's, as the catalog resolved them, in the variant
 * for the current theme. With neither, or when the image fails to load, a
 * generic app mark.
 */
export function EntrypointIcon({ icons, size = 16, className }: { icons?: readonly McpIcon[]; size?: number; className?: string }) {
  return <McpIconImage icons={icons} size={size} className={className}
    fallback={<AppWindow size={size} aria-hidden className={cn('shrink-0 text-muted-foreground', className)} />} />;
}
