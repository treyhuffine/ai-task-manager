import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {staticFixture} from '@ri/app-kit/testing';
import {exportPackage, validateArtifact} from '@ri/app-kit/build';
import {archiveDigest} from './catalog';
import {LocalAppsService} from './service';

vi.mock('@/lib/service/maintenance', () => ({beginActivity: () => () => {}}));
let root: string, service: LocalAppsService;
afterEach(async () => {
  await service?.dispose();
  if (root) await fs.rm(root, {recursive: true, force: true});
  delete process.env.RI_ROOT; delete process.env.RI_LOCAL_APPS; delete process.env.RI_LOCAL_APPS_CATALOG_DIR;
});

/** Stage one version of a fictional included app in the private catalog. */
async function stage(heading: string) {
  const source = path.join(root, `source-${heading.replace(/\W/g, '')}`);
  staticFixture(source, 'ri-fixture');
  await fs.writeFile(path.join(source, 'dist/ui.html'), `<html><body><h1>${heading}</h1></body></html>`);
  const validated = validateArtifact(source);
  const catalog = process.env.RI_LOCAL_APPS_CATALOG_DIR!;
  const archive = path.join(catalog, 'ri-fixture.tar.gz');
  await exportPackage(validated, archive);
  await fs.writeFile(path.join(catalog, 'ri-fixture.json'), JSON.stringify({
    formatVersion: 1, packageId: 'ri-fixture', version: '0.1.0', name: 'Fixture', description: 'Fictional included app', source: 'Test', license: 'UNLICENSED',
    hostApi: 1, runtime: 'static', target: null, artifactDigest: validated.digest, archiveDigest: await archiveDigest(archive), capabilities: [],
    demo: {heading: 'Example', caption: 'Fictional', columns: ['Record'], rows: [['Example']]},
  }));
  return validated.digest;
}

it('refreshes an untouched preview from an older included package in place, and never overwrites an edited one', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-catalog-refresh-'));
  process.env.RI_ROOT = path.join(root, 'home');
  process.env.RI_LOCAL_APPS = '1';
  process.env.RI_LOCAL_APPS_CATALOG_DIR = path.join(root, 'catalog');
  await fs.mkdir(process.env.RI_LOCAL_APPS_CATALOG_DIR, {recursive: true});
  service = new LocalAppsService();
  await service.initialize();

  const first = await stage('Old interface');
  const draft = await service.addCatalog('ri-fixture');
  expect(draft.validatedDigest).toBe(first);
  const dir = path.join(process.env.RI_ROOT, 'app-drafts', draft.id);
  await fs.mkdir(path.join(dir, 'data'), {recursive: true});
  await fs.writeFile(path.join(dir, 'data', 'preview.json'), '{"fictional":true}');
  // The same version reuses the same preview.
  expect((await service.addCatalog('ri-fixture')).id).toBe(draft.id);

  const second = await stage('New interface');
  const refreshed = await service.addCatalog('ri-fixture');
  expect(refreshed.id).toBe(draft.id);
  expect(refreshed.validatedDigest).toBe(second);
  expect(refreshed.catalogSource?.artifactDigest).toBe(second);
  expect(await fs.readFile(path.join(dir, 'package/dist/ui.html'), 'utf8')).toContain('New interface');
  await expect(fs.access(path.join(dir, 'data', 'preview.json'))).rejects.toThrow();
  expect(service.store.read().drafts).toHaveLength(1);
  expect((await service.artifact(draft.id, true)).digest).toBe(second);
  expect((await fs.readdir(dir)).filter((name) => name.startsWith('previous-'))).toEqual([]);

  // A preview whose source someone changed is kept, and the new version gets its own preview.
  await fs.writeFile(path.join(dir, 'package/README.md'), 'Edited in the builder');
  const third = await stage('Newest interface');
  const separate = await service.addCatalog('ri-fixture');
  expect(separate.id).not.toBe(draft.id);
  expect(separate.validatedDigest).toBe(third);
  expect(await fs.readFile(path.join(dir, 'package/README.md'), 'utf8')).toBe('Edited in the builder');
  expect(service.store.read().drafts.map((item) => item.id).sort()).toEqual([draft.id, separate.id].sort());
});
