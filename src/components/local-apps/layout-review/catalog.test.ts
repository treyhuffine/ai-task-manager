import { describe, expect, it } from 'vitest';
import type { LibrarySources } from '../library-model';
import { collectionItems, discoverable, matchesReview, primaryLabel, quickItems, reviewItems, type CatalogEntry, type ReviewItem } from './catalog';
import { parsePreferences } from './preferences';
import { isLayoutChoice, LAYOUT_OPTIONS } from './options';

const sources: LibrarySources = {
  providers: [{ id: 'google', displayName: 'Google', method: 'oauth2', configured: true }, { id: 'linear', displayName: 'Linear', method: 'api_key', configured: true }],
  connections: [{ id: 'work', providerId: 'google', accountId: 'work', email: 'work@example.test', status: 'active', scopes: [], ownerId: 'local', createdAt: '2026-10-01', updatedAt: '2026-10-01' }],
  servers: [{ id: 'company', slug: 'company-data', displayName: 'Company data', url: 'https://example.test/mcp', enabled: false, auth: { kind: 'none' }, lastStatus: 'ok', createdAt: '2026-10-01', updatedAt: '2026-10-01' }],
  skills: [
    { ref: 'ri:private-workflow', name: 'Private workflow', description: 'Our internal process', location: { kind: 'ri' }, hasErrors: false },
    { ref: 'draft:work-in-progress', name: 'Work in progress', description: 'Not installed yet', location: { kind: 'draft' }, hasErrors: false },
  ] as LibrarySources['skills'],
};

describe('one library across the Apps layouts', () => {
  it('includes custom MCPs and installed skills without publishing private additions in discovery', () => {
    const items = reviewItems(sources);
    expect(items.filter(item => item.added && !item.draft).map(item => item.key).sort()).toEqual(['mcp:company', 'provider:google', 'skill:ri:private-workflow']);
    expect(items.filter(discoverable).some(item => item.target.kind === 'mcp' || item.key === 'skill:ri:private-workflow')).toBe(false);
    expect(items.find(item => item.key === 'skill:draft:work-in-progress')).toMatchObject({ draft: true });
    expect(items.filter(discoverable).some(item => item.kind === 'skills')).toBe(true);
  });
  it('never pretends that a paused server is ready to use', () => {
    const item = reviewItems(sources).find(item => item.key === 'mcp:company')!;
    expect(primaryLabel(item)).toBe('Manage');
    expect(quickItems([item], [item.key], [item.key], 6)).toEqual([]);
  });
  it('keeps every addition in the library when quick access runs out of room', () => {
    const base = reviewItems(sources).find(item => item.key === 'provider:google')!;
    const library = Array.from({ length: 50 }, (_, index): ReviewItem => ({ ...base, key: `provider:${index}`, name: `Service ${index}` }));
    const visible = quickItems(library, ['provider:34', 'deleted'], ['provider:17', 'provider:34'], 4);
    expect(visible.map(item => item.key)).toEqual(['provider:34', 'provider:17', 'provider:0', 'provider:1']);
    expect(library).toHaveLength(50);
    expect(quickItems(library, [], [], 0)).toEqual([]);
  });
  it('keeps a preview distinct from installation and finds purpose-based queries', () => {
    const items = reviewItems(sources, [{ packageId: 'finances', name: 'Finances', description: 'Your spending in one place.' }] as CatalogEntry[]);
    const finances = items.find(item => item.name === 'Finances')!;
    expect(finances.added).toBe(false);
    expect(primaryLabel(finances)).toBe('Preview app');
    expect(matchesReview(finances, 'help me manage money')).toBe(true);
    expect(matchesReview(finances, '', 'Added')).toBe(false);
    expect(matchesReview(items.find(item => item.key === 'mcp:company')!, 'company', 'Custom MCP')).toBe(true);
  });
  it('curates small goal collections instead of copying the entire provider catalog', () => {
    const items = reviewItems(sources);
    const business = collectionItems(items, 'business');
    expect(business.map(item => item.name)).toContain('Google');
    expect(business.map(item => item.name)).toContain('Proposal writer');
    expect(business.length).toBeLessThanOrEqual(4);
    expect(business.some(item => item.target.kind === 'mcp')).toBe(false);
  });
  it('tolerates damaged preferences and keeps all twelve choices addressable', () => {
    expect(parsePreferences('null').layout).toBe('discover');
    expect(parsePreferences('{broken')).toEqual({ layout: 'discover', pinned: [], recent: [] });
    expect(parsePreferences('{"layout":"split","pinned":["a",null,"a"],"recent":"oops"}')).toEqual({ layout: 'split', pinned: ['a'], recent: [] });
    expect(LAYOUT_OPTIONS).toHaveLength(12);
    expect(new Set(LAYOUT_OPTIONS.map(option => option.id)).size).toBe(12);
    expect(isLayoutChoice('original')).toBe(true);
    expect(isLayoutChoice('removed-layout')).toBe(false);
  });
});
