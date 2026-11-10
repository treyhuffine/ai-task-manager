import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { expect, it } from 'vitest';
import { packAppKit } from '../src/templates';

const kit = path.resolve(import.meta.dirname, '..');

it('packs the kit as an installed Ri holds it, outside any workspace and with workspace dev dependencies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-kit-pack-'));
  try {
    // An installed Ri carries the kit's manifest as written, and none of its dev dependencies.
    // pnpm refuses to pack that folder in place (ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL).
    const manifest = JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8'));
    const installed = path.join(root, 'release', 'node_modules', '@ri', 'app-kit');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({
      ...manifest, devDependencies: { ...manifest.devDependencies, '@ri/not-installed': 'workspace:*' },
    }));
    for (const entry of ['dist', 'schemas', 'README.md']) fs.cpSync(path.join(kit, entry), path.join(installed, entry), { recursive: true });

    const vendor = path.join(root, 'draft', 'vendor');
    const tarball = await packAppKit(vendor, path.join(root, 'draft'), installed);

    const out = path.join(root, 'out');
    fs.mkdirSync(out);
    await tar.x({ file: path.join(vendor, tarball), cwd: out });
    const packed = JSON.parse(fs.readFileSync(path.join(out, 'package', 'package.json'), 'utf8'));
    expect(packed.name).toBe('@ri/app-kit');
    expect(packed.dependencies).toEqual(manifest.dependencies);
    expect(packed.exports).toEqual(manifest.exports);
    // An app installs the kit, it never develops or builds it.
    expect(packed.devDependencies).toBeUndefined();
    expect(packed.scripts).toBeUndefined();
    expect(fs.existsSync(path.join(out, 'package', 'dist', 'build.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'package', 'schemas'))).toBe(true);
    // The kit's own folder is only read.
    expect(fs.readdirSync(installed).sort()).toEqual(['README.md', 'dist', 'package.json', 'schemas']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
