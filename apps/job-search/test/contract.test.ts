import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ContractValidator } from '@ri/app-kit/contract';
import { generateContract } from '@ri/app-kit/sdk';
import { definition } from '../src/actions.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/** The workflow index packaging derives from skills/<name>/SKILL.md. */
function workflows() {
  return fs.readdirSync(path.join(root, 'skills')).sort().map((name) => {
    const file = `skills/${name}/SKILL.md`;
    const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(root, file), 'utf8'))![1];
    return { name: /^name:\s*(.+)$/m.exec(front)![1].trim(), description: /^description:\s*(.+)$/m.exec(front)![1].trim(), file };
  });
}

describe('generated contract', () => {
  const validator = new ContractValidator();
  const manifest = validator.manifest(read('plugin.json'));
  const generated = generateContract(definition, workflows());

  it('validates against plugin.json, including every fictional example', () => {
    expect(() => validator.contract(generated, manifest)).not.toThrow();
    expect(generated.packageId).toBe('ri-job-search');
    expect(manifest.extensions['com.ri'].ui?.access).toEqual({ path: '/access', action: 'create_scope' });
  });

  it('matches the committed contract.json produced by packaging', () => {
    expect(read('contract.json')).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it('names every action the spec and foundation require, with honest audiences and effects', () => {
    const names = generated.actions.map((action) => action.name);
    for (const name of ['list_opportunities', 'get_opportunity', 'save_opportunity', 'change_stage', 'list_interviews', 'save_interview', 'list_materials', 'save_material_version', 'record_submission', 'get_preparation', 'save_preparation', 'resolve_match',
      'open_view', 'describe_view_context', 'create_scope', 'list_scopes', 'revoke_scope', 'list_sources', 'run_background_step', 'sync_step', 'enrich_step', 'continue_import', 'preview_import', 'apply_import', 'create_follow_up', 'delete_source_data'])
      expect(names).toContain(name);
    const by = (name: string) => generated.actions.find((action) => action.name === name)!;
    for (const name of ['run_background_step', 'sync_step', 'enrich_step']) expect(by(name)).toMatchObject({ audience: ['schedule'], effect: 'app_write', retry: 'idempotent', timeoutMs: 40_000 });
    expect(by('continue_import')).toMatchObject({ audience: ['user'], timeoutMs: 40_000 });
    for (const name of ['create_scope', 'list_scopes', 'revoke_scope', 'list_sources', 'set_source', 'delete_source_data', 'preview_import', 'apply_import', 'export_records']) {
      expect(by(name).audience).toEqual(['user']);
      expect(by(name).visibility).toBe('app');
    }
    expect(by('create_scope')).toMatchObject({ effect: 'app_write' });
    for (const action of generated.actions) {
      expect(action.effect).not.toBe('external_write');
      expect(action.retry === 'read_safe').toBe(action.effect === 'read');
      expect(action.examples.length).toBeGreaterThan(0);
    }
    for (const name of ['list_opportunities', 'list_interviews', 'list_materials', 'list_review']) {
      const input = by(name).inputSchema as { properties: Record<string, { default?: number; maximum?: number }> };
      expect(input.properties.limit).toMatchObject({ default: 50, maximum: 100 });
      expect(input.properties.cursor).toBeTruthy();
    }
  });

  it('declares entities with read, list and open paths, and a bounded context schema', () => {
    expect(generated.entities.map((entity) => [entity.type, entity.openPath])).toEqual([['opportunity', '/opportunities/{id}'], ['interview', '/interviews/{id}'], ['material', '/materials/{id}']]);
    const context = generated.contexts['ui://ri-job-search/main.html'] as { properties: { selected: { maxItems: number } } };
    expect(context.properties.selected.maxItems).toBe(50);
  });

  it('keeps user-visible and model-facing copy free of long dashes and semicolons', () => {
    for (const action of generated.actions) {
      expect(action.description).not.toMatch(/[—–]/);
      expect(action.description).not.toContain(';');
    }
    const files: string[] = [];
    const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) entry.isDirectory() ? walk(path.join(dir, entry.name)) : files.push(path.join(dir, entry.name)); };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'skills'));
    const isPattern = (literal: string) => literal.includes('(?:') || literal.includes('\\') || /=>|[{}]|\(\)/.test(literal);
    for (const file of [...files, path.join(root, 'README.md'), path.join(root, 'AGENTS.md')]) {
      const text = fs.readFileSync(file, 'utf8');
      const prose = /\.(md)$/.test(file);
      if (prose) expect(text, file).not.toMatch(/[—–]/);
      // String literals and JSX text shown to people avoid long dashes and semicolons. Parsing patterns are not prose.
      const literals = [...(text.match(/'[^'\n]{8,}'|`[^`\n]{8,}`|"[^"\n]{8,}"/g) ?? []), ...(file.endsWith('.tsx') ? text.match(/>[^<>{}\n]{8,}</g) ?? [] : [])];
      for (const literal of literals) {
        if (isPattern(literal) || !/[a-z] [a-z]/i.test(literal)) continue;
        expect(literal, file).not.toMatch(/[—–]/);
        expect(literal, file).not.toMatch(/[a-z]; [a-z]/i);
      }
      if (file.includes(`${path.sep}src${path.sep}`)) expect(text, file).not.toMatch(/Sparkle|Wand|✨/);
    }
  });
});
