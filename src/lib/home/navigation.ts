import { spaceIdFromPath, SPACE_PATH_PREFIX } from '@/lib/spaces/document';

/** Restore only a relative document belonging to the explicitly chosen Home. */
export function restoredHomeNavigation(target: string | null, saved: string | null): string | null {
  if (!saved?.startsWith('/') || saved.startsWith('//') || saved.includes('\\')) return null;
  try {
    const url = new URL(saved, 'https://home.invalid');
    if (url.origin !== 'https://home.invalid' || url.hash) return null;
    const belongs = target ? spaceIdFromPath(url.pathname) === target : !url.pathname.startsWith(SPACE_PATH_PREFIX);
    return belongs ? url.pathname + url.search : null;
  } catch { return null; }
}
