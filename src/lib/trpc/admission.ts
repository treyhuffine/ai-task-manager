/** Shared with the Node service, which admits a request before Next runs.
 * A batch drains only if EVERY operation is an ordinary document save. */
export const DRAIN_SAVE_PROCEDURES = ['tasks.update', 'notes.update', 'areas.update'] as const;
export function isDrainSaveProcedure(path: string): boolean {
  return (DRAIN_SAVE_PROCEDURES as readonly string[]).includes(path);
}
export function isTrpcDrainSave(method: string | undefined, pathname: string): boolean {
  if (method !== 'POST' || !pathname.startsWith('/api/trpc/')) return false;
  try {
    const paths = decodeURIComponent(pathname.slice('/api/trpc/'.length)).split(',');
    return paths.length > 0 && paths.every(isDrainSaveProcedure);
  } catch { return false; }
}
