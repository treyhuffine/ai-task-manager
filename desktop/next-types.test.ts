import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { writeConfigurationDefaults } from 'next/dist/lib/typescript/writeConfigurationDefaults';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profiles = [
  { config: 'tsconfig.json', dist: '.next' },
  { config: 'tsconfig.desktop.json', dist: '.next-desktop' },
  { config: 'tsconfig.desktop-dev.json', dist: '.next-desktop-dev' },
  { config: 'tsconfig.smoke.json', dist: '.next-smoke' },
];
const sourceFiles = [
  'src/app/page.tsx',
  'src/app/api/example/route.ts',
  'src/cli/index.ts',
  'desktop/main.ts',
  'scripts/check.ts',
  'scripts/check.mts',
  'instrumentation.ts',
  'root-check.mts',
];
const fixtures: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(root: string, relative: string, content: string) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function validatorPaths(dist: string) {
  return [`${dist}/types/validator.ts`, `${dist}/dev/types/validator.ts`];
}

function routeValidator(root: string, relative: string, valid: boolean) {
  const route = path.relative(path.dirname(path.join(root, relative)), path.join(root, 'src/app/api/example/route'));
  return `import { GET } from ${JSON.stringify(route)};
const handler: (request: Request, context: { params: ${valid ? 'Promise<{ id: string }>' : '{ id: string }'} }) => Promise<Response> = GET;
export { handler };
`;
}

function fixture(selectedDist: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-next-types-'));
  fixtures.push(root);
  for (const { config } of profiles) {
    fs.copyFileSync(path.join(repoRoot, config), path.join(root, config));
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write(root, 'src/types/next.d.ts', fs.readFileSync(path.join(repoRoot, 'src/types/next.d.ts'), 'utf8'));
  for (const source of sourceFiles) write(root, source, 'export const value: number = 1;\n');
  write(root, 'src/app/page.tsx', `import logo from './logo.png';
export default function Page() { const width: number = logo.width; return <img alt="Ri" src={logo.src} width={width} />; }
`);
  write(root, 'src/app/logo.png', '');
  write(root, 'src/app/api/example/route.ts', `export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return Response.json({ id: (await context.params).id });
}
`);

  // Next rewrites this root declaration for whichever build ran last. Its
  // import must never pull another profile's generated files into the program.
  write(root, 'next-env.d.ts', 'import "./.next-obsolete/types/poison";\n');
  write(root, '.next-obsolete/types/poison.ts', 'export const stale: number = "removed route";\n');
  for (const { dist } of profiles) {
    for (const validator of validatorPaths(dist)) {
      const removedRoute = path.relative(path.dirname(path.join(root, validator)), path.join(root, 'src/app/api/takeover-cancel/route'));
      write(root, validator, dist === selectedDist
        ? routeValidator(root, validator, true)
        : `import { POST } from ${JSON.stringify(removedRoute)};\nexport const stale = POST;\n`);
    }
  }
  return root;
}

function parse(root: string, config: string) {
  const configPath = path.join(root, config);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(read.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  expect(parsed.errors).toEqual([]);
  return parsed;
}

function compile(root: string, config: string) {
  const parsed = parse(root, config);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false });
  const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  return { parsed, program, errors };
}

function describeErrors(errors: readonly ts.Diagnostic[]) {
  return errors.map((error) => `${error.file?.fileName ?? 'config'}: TS${error.code} ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
}

describe('isolated Next route types', () => {
  it.each(profiles)('$config ignores stale foreign routes and the volatile root declaration', ({ config, dist }) => {
    const root = fixture(dist);
    const { parsed, program, errors } = compile(root, config);
    expect(describeErrors(errors)).toEqual([]);
    const selectedFiles = parsed.fileNames.map((file) => path.relative(root, file));
    expect(selectedFiles).toEqual(expect.arrayContaining([...sourceFiles, 'src/types/next.d.ts', ...validatorPaths(dist)]));
    expect(selectedFiles.filter((file) => file.startsWith('.next')).sort()).toEqual(validatorPaths(dist).sort());
    expect(selectedFiles).not.toContain('next-env.d.ts');
    const importedFiles = program.getSourceFiles().map((file) => path.relative(root, file.fileName));
    expect(importedFiles).not.toContain('next-env.d.ts');
    expect(importedFiles.filter((file) => file.startsWith('.next')).sort()).toEqual(validatorPaths(dist).sort());
  }, 30_000);

  it.each(profiles)('$config still rejects incompatible selected routes and errors throughout the source tree', ({ config, dist }) => {
    const root = fixture(dist);
    for (const validator of validatorPaths(dist)) write(root, validator, routeValidator(root, validator, false));
    const checkedSources = sourceFiles.filter((source) => source !== 'src/app/api/example/route.ts');
    for (const source of checkedSources) write(root, source, 'export const value: number = "invalid source";\n');
    const { errors } = compile(root, config);
    const errorFiles = errors.map((error) => error.file && path.relative(root, error.file.fileName));
    expect(errorFiles.sort()).toEqual([...checkedSources, ...validatorPaths(dist)].sort());
    expect(errors.every((error) => error.code === 2322)).toBe(true);
  }, 30_000);

  it.each(profiles.slice(1))('Next does not append foreign caches to $config or its base config', async ({ config, dist }) => {
    const root = fixture(dist);
    const before = new Map(profiles.map(({ config: file }) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
    // Exercise Next's actual config rewriter, including a second profile's
    // output directory, rather than mocking its extends early return.
    for (const output of [dist, '.next-obsolete']) {
      await writeConfigurationDefaults(ts.version, path.join(root, config), false, true, output, false, true);
    }
    for (const [file, contents] of before) expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(contents);
    expect(parse(root, config).fileNames.filter((file) => path.relative(root, file).startsWith('.next')).map((file) => path.relative(root, file)).sort())
      .toEqual(validatorPaths(dist).sort());
  });
});

describe('Next build profile selection', () => {
  it.each([
    ...profiles,
    { dist: '', config: 'tsconfig.json' },
    { dist: '.next-custom', config: 'tsconfig.next-f74ec513e376870b.json' },
  ])('uses $config for NEXT_DIST_DIR=$dist without disabling type checks', async ({ config, dist }) => {
    vi.stubEnv('NEXT_DIST_DIR', dist);
    vi.resetModules();
    const { default: nextConfig } = await import('../next.config');
    expect(nextConfig.distDir).toBe(dist || '.next');
    expect(nextConfig.typescript?.tsconfigPath).toBe(config);
    expect(nextConfig.typescript?.ignoreBuildErrors).not.toBe(true);
  });
});
