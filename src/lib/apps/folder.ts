import fs from 'node:fs';
import { getAppSource } from '@/lib/db/queries';

/**
 * Where an app's builder chat works: a change's own working copy while one is open, else the app's
 * folder (docs/personal-apps.md "Building and changing apps"). Kept apart from the builder so the
 * executor loads only this.
 */
export function builderFolder(sourceId: string): string | null {
  const source = getAppSource(sourceId);
  const folder = source?.changeFolder ?? source?.folder;
  return folder && fs.existsSync(/* turbopackIgnore: true */ folder) ? folder : null;
}
