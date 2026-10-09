import {createRequire} from 'node:module';
import path from 'node:path';

/** Use native resolution rather than a bundler's synthetic module filename. */
export function kitAsset(name: string) {
  const native = createRequire(import.meta.url);
  const resolve = native.resolve.bind(native);
  const entry = resolve(['@ri/app-kit','build'].join('/'));
  return path.join(path.dirname(entry),name);
}
