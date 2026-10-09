import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { typeScriptConfigPath } from '../../../next.config';

const repo = path.resolve(import.meta.dirname, '../../..');
const fixtures: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-next-types-'));
  fixtures.push(root);
  fs.copyFileSync(path.join(repo, 'tsconfig.json'), path.join(root, 'tsconfig.json'));
  const files = {
    'src/app/page.tsx': 'export default function Page() { return null; }',
    '.next/types/validator.ts': 'export type Page = typeof import("../../src/app/page.js");',
    '.next-verify/dev/types/validator.ts': 'export type RemovedPage = typeof import("../../../src/app/finance/page.js");',
    '.next-apps-42251/types/validator.ts': 'export type RemovedPage = typeof import("../../src/app/finance/page.js");',
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function parse(root: string, configPath: string) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, configPath), { types: [] }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!config) throw new Error('Could not parse the TypeScript configuration');
  expect(config.errors).toEqual([]);
  return config;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Next route type isolation', () => {
  it('checks current routes without importing removed routes from trial builds', () => {
    const root = fixture();
    const config = parse(root, 'tsconfig.json');
    const program = ts.createProgram(config.fileNames, { ...config.options, incremental: false });
    const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(errors).toEqual([]);
    expect(config.fileNames).toContain(path.join(root, '.next/types/validator.ts'));
    expect(config.fileNames.some((file) => file.includes('.next-verify') || file.includes('.next-apps'))).toBe(false);
  });

  it('keeps custom builds separate from the root and from each other', () => {
    const root = fixture();
    const original = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8');
    const first = typeScriptConfigPath('.next-apps-42251', root);
    const second = typeScriptConfigPath('.next-verify', root);
    expect(first).not.toBe(second);
    const firstFiles = parse(root, first).fileNames;
    expect(firstFiles).toContain(path.join(root, '.next-apps-42251/types/validator.ts'));
    expect(firstFiles).not.toContain(path.join(root, '.next-verify/dev/types/validator.ts'));
    expect(firstFiles).not.toContain(path.join(root, '.next/types/validator.ts'));
    expect(parse(root, second).fileNames).toContain(path.join(root, '.next-verify/dev/types/validator.ts'));
    expect(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).toBe(original);
  });

  it('still checks errors in the active custom build', () => {
    const root = fixture();
    const config = parse(root, typeScriptConfigPath('.next-apps-42251', root));
    const program = ts.createProgram(config.fileNames, { ...config.options, incremental: false });
    const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code);
    expect(errors).toContain(2307);
  });

  it('preserves the existing production, desktop and smoke configurations', () => {
    const root = fixture();
    expect(typeScriptConfigPath('.next', root)).toBe('tsconfig.json');
    expect(typeScriptConfigPath('.next-desktop', root)).toBe('tsconfig.desktop.json');
    expect(typeScriptConfigPath('.next-desktop-dev', root)).toBe('tsconfig.desktop-dev.json');
    expect(typeScriptConfigPath('.next-smoke', root)).toBe('tsconfig.smoke.json');
    expect(fs.readdirSync(root).filter((file) => file.startsWith('tsconfig.next-'))).toEqual([]);
  });
});
