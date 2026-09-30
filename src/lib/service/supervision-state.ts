import fs from 'node:fs';
import path from 'node:path';
import { servicePaths } from './paths';

/** Filesystem-only status for the Electron shell. Installation and ownership
 * locks belong to the ordinary-Node service, never the Electron process. */
export function supervisionRecord() { return path.join(servicePaths().identity.config, 'service-supervision.json'); }
export function hasLoginSupervision() { return fs.existsSync(supervisionRecord()); }
