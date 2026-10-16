import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { staticFixture } from '@ri/app-kit/testing';
import { exportPackage } from '@ri/app-kit/build';
import { archiveDigest, catalogArtifact, listCatalog } from './catalog';
import { hasIncludedArtifact, includedAppIds } from './included-catalog';

let root: string;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

const qualified = { platform: 'darwin', arch: 'arm64', nodeVersion: '26.5.0', nodeAbi: '147' };
it('includes Finances only on its qualified automatic-build target and the portable apps everywhere', () => {
  const portable = ['ri-people', 'ri-travel', 'ri-job-search', 'ri-tracker'];
  expect(includedAppIds(true, qualified)).toEqual(['ri-finance', ...portable]);
  for (const runtime of [
    { ...qualified, platform: 'linux' }, { ...qualified, arch: 'x64' },
    { ...qualified, nodeVersion: '26.6.0' }, { ...qualified, nodeAbi: '148' },
  ]) {
    expect(includedAppIds(true, runtime)).toEqual(portable);
    expect(includedAppIds(false, runtime)).toEqual(['ri-finance', ...portable]);
  }
});

it('reuses only complete digest-bound artifacts and repairs missing or damaged outputs', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-included-catalog-'));
  const catalog = path.join(root, 'catalog');
  expect(await hasIncludedArtifact('ri-tracker', catalog)).toBe(false);
  await fs.mkdir(catalog);
  const artifact = staticFixture(path.join(root, 'source'), 'ri-tracker');
  const archive = path.join(catalog, 'ri-tracker.tar.gz');
  await exportPackage(artifact, archive);
  const entry = {
    formatVersion: 1, packageId: 'ri-tracker', version: '0.1.0', name: 'Tracker',
    description: 'Synthetic test app', source: 'Test', license: 'UNLICENSED',
    hostApi: 1, runtime: 'static', target: null, artifactDigest: artifact.digest,
    archiveDigest: await archiveDigest(archive), capabilities: [],
    demo: { heading: 'Example', caption: 'Synthetic', columns: ['Record'], rows: [['Example']] },
  };
  const metadata = path.join(catalog, 'ri-tracker.json');
  await fs.writeFile(metadata, JSON.stringify(entry));
  expect(await hasIncludedArtifact('ri-tracker', catalog)).toBe(true);
  // An explicit checkout catalog stays independent of any inherited runtime path.
  expect(await listCatalog(catalog)).toEqual([entry]);
  expect((await catalogArtifact('ri-tracker', catalog)).file).toBe(archive);
  await fs.appendFile(archive, 'corrupt');
  expect(await hasIncludedArtifact('ri-tracker', catalog)).toBe(false);
  await exportPackage(artifact, archive);
  await fs.writeFile(metadata, '{incomplete');
  expect(await hasIncludedArtifact('ri-tracker', catalog)).toBe(false);
  await fs.writeFile(metadata, JSON.stringify(entry));
  await fs.rm(archive);
  expect(await hasIncludedArtifact('ri-tracker', catalog)).toBe(false);
});
