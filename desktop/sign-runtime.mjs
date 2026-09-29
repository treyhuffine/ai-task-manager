import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Sign nested executable bytes before their immutable manifest is computed.
// Builder must not re-sign these resources afterwards.
export function signRuntime(root, identity, entitlements) {
  const magic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const header = Buffer.alloc(4); const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
        if (!magic.has(header.toString('hex'))) continue;
        execFileSync('/usr/bin/codesign', ['--force', '--timestamp', '--options', 'runtime', '--entitlements', entitlements, '--sign', identity, file], { stdio: 'inherit' });
      }
    }
  }
  walk(path.join(root, 'node')); walk(path.join(root, 'server'));
}
