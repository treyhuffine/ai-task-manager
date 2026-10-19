/**
 * MCP `Icon` objects a server supplies about itself or a tool, reduced to what
 * Ri displays: at most four, each an `https:` or image `data:` URL of 64 KiB at
 * most, with its declared type, sizes and theme. Anything else is dropped, so
 * an icon can never be a script URL or an unbounded payload.
 */
export interface McpIcon { src: string; mimeType?: string; sizes?: string[]; theme?: 'light' | 'dark' }

export const MAX_ICON_SRC_BYTES = 64 * 1024;
const MAX_ICONS = 4;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function safeMcpIcon(raw: unknown): McpIcon | null {
  const icon = record(raw);
  const src = typeof icon.src === 'string' && icon.src.length <= MAX_ICON_SRC_BYTES ? icon.src : undefined;
  if (!src || !(/^https:\/\//i.test(src) || /^data:image\//i.test(src))) return null;
  const sizes = Array.isArray(icon.sizes) ? icon.sizes.filter((size): size is string => typeof size === 'string' && size.length <= 40).slice(0, 8) : undefined;
  const mimeType = typeof icon.mimeType === 'string' && icon.mimeType.length <= 100 ? icon.mimeType : undefined;
  return { src, ...(mimeType ? { mimeType } : {}), ...(sizes?.length ? { sizes } : {}),
    ...(icon.theme === 'light' || icon.theme === 'dark' ? { theme: icon.theme } : {}) };
}

export function safeMcpIcons(raw: unknown): McpIcon[] {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_ICONS).flatMap(icon => {
    const safe = safeMcpIcon(icon);
    return safe ? [safe] : [];
  });
}

/** The icon for the current theme: one marked for it, else one with no theme, else the first. */
export function pickMcpIcon(icons: readonly McpIcon[] | undefined, theme: 'light' | 'dark'): McpIcon | undefined {
  if (!icons?.length) return undefined;
  return icons.find(icon => icon.theme === theme) ?? icons.find(icon => !icon.theme) ?? icons[0];
}
