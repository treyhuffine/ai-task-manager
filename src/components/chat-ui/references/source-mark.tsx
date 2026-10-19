'use client';

import { AppWindow, Server } from 'lucide-react';
import { INTEGRATION_ICONS } from '@/components/integrations/integration-icon-data';
import { IntegrationLogo, isDarkBrandMark } from '@/components/integrations/integration-logo';
import { AppMark } from '@/components/local-apps/app-mark';
import type { SourceMark as Mark } from '@/lib/chat-sources/types';
import { cn } from '@/lib/utils';

/**
 * The glyph for a mentioned app or account, the same mark the library and the
 * rail use: the service's logo (Gmail's own inside Google), a server for an
 * MCP server you added, or an installed app's tile. Unknown or unresolved
 * sources get a plain app window. Decorative: the label beside it names it.
 */
export function SourceMark({ mark, name, size = 14, className }: { mark?: Mark; name: string; size?: number; className?: string }) {
  if (mark?.kind === 'provider') {
    const id = INTEGRATION_ICONS[mark.toolkitId] ? mark.toolkitId : mark.providerId;
    const icon = INTEGRATION_ICONS[id];
    // At chip size a logo tile would shrink the glyph to a speck, so draw the glyph itself.
    if (icon) {
      // Near-black marks (Notion, X) take the surrounding text color, so they stay
      // visible on a dark page and inside an inverted message bubble alike.
      const dark = isDarkBrandMark(icon.hex);
      return (
        <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className={cn('shrink-0', className)} fill={dark ? 'currentColor' : `#${icon.hex}`}>
          <path d={icon.path} />
        </svg>
      );
    }
    return (
      <span aria-hidden className={cn('inline-flex shrink-0', className)}>
        <IntegrationLogo providerId={id} name={name} size={size} className="rounded-[4px] ring-0" />
      </span>
    );
  }
  if (mark?.kind === 'app') return <AppMark name={name} icon={mark.icon} size="xs" className={className} />;
  const Icon = mark?.kind === 'server' ? Server : AppWindow;
  return <Icon aria-hidden size={size} className={cn('shrink-0', className)} />;
}
