import {createRequire} from 'node:module';
import path from 'node:path';

/** Resolve the installed kit even when a server bundle has a virtual filename. */
function kitEntry() {
  // Turbopack can rewrite a workspace module's URL to /ROOT/... even when
  // the public package is external. The host's real working directory is
  // the native resolution anchor in that case. Ordinary consumers retain
  // module-relative resolution, including when they change directory.
  const anchors = [import.meta.url, path.join(process.cwd(), 'package.json')];
  for (let index = 0; index < anchors.length; index++) {
    try {
      const native = createRequire(anchors[index]);
      return native.resolve(['@ri/app-kit','build'].join('/'));
    } catch (error) {
      if (index === anchors.length - 1 || (error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('The app SDK runtime assets could not be resolved');
}

export function kitAsset(name: string) {
  return path.join(path.dirname(kitEntry()), name);
}

/** Pinned dependencies must resolve from the actual SDK, not the host bundle. */
export function kitRequire() {
  return createRequire(kitEntry());
}
