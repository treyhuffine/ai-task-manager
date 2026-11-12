import { describe, expect, it } from 'vitest';
import type { LibrarySources } from '../library-model';
import { collectionItems, discoverable, itemType, matchesReview, primaryLabel, reviewItems } from './catalog';

const sources: LibrarySources = {
  providers: [{ id: 'google', displayName: 'Google', method: 'oauth2', configured: true }, { id: 'linear', displayName: 'Linear', method: 'api_key', configured: true }],
  connections: [{ id: 'work', providerId: 'google', accountId: 'work', email: 'work@example.test', status: 'active', scopes: [], ownerId: 'local', createdAt: '2026-10-01', updatedAt: '2026-10-01' }],
  servers: [{ id: 'company', slug: 'company-data', displayName: 'Company data', url: 'https://example.test/mcp', enabled: false, auth: { kind: 'none' }, lastStatus: 'ok', createdAt: '2026-10-01', updatedAt: '2026-10-01' }],
  skills: [
    { ref: 'ri:private-workflow', name: 'Private workflow', description: 'Our internal process', location: { kind: 'ri' }, hasErrors: false },
    { ref: 'draft:work-in-progress', name: 'Work in progress', description: 'Not installed yet', location: { kind: 'draft' }, hasErrors: false },
  ] as LibrarySources['skills'],
};

describe('one library across Apps', () => {
  it('includes custom MCPs and installed skills without publishing private additions in discovery', () => {
    const items = reviewItems(sources);
    expect(items.filter(item => item.added && !item.draft).map(item => item.key).sort()).toEqual(['mcp:company', 'provider:google', 'skill:ri:private-workflow']);
    expect(items.filter(discoverable).some(item => item.target.kind === 'mcp' || item.key === 'skill:ri:private-workflow')).toBe(false);
    expect(items.find(item => item.key === 'skill:draft:work-in-progress')).toMatchObject({ draft: true });
    expect(items.filter(discoverable).some(item => item.kind === 'skills')).toBe(true);
    expect(itemType(items.find(item => item.key === 'mcp:company')!)).toBe('Connector');
    expect(itemType(items.find(item => item.key === 'skill:ri:private-workflow')!)).toBe('Skill');
    expect(primaryLabel(items.find(item => item.key === 'skill:ri:private-workflow')!)).toBe('Edit skill');
    expect(primaryLabel(items.find(item => item.key === 'provider:google')!)).toBe('Manage connection');
  });
  it('never pretends that a paused server is ready to use', () => {
    const item = reviewItems(sources).find(item => item.key === 'mcp:company')!;
    expect(item.enabled).toBe(false);
    expect(primaryLabel(item)).toBe('Manage');
  });
  it('offers starter skills as previews and unconnected services to connect', () => {
    const items = reviewItems(sources);
    const starter = items.find(item => item.name === 'Research brief')!;
    expect(starter).toMatchObject({ added: false, target: { kind: 'catalog-skill', id: 'research-brief' } });
    expect(primaryLabel(starter)).toBe('Preview skill');
    expect(primaryLabel(items.find(item => item.key === 'provider:linear')!)).toBe('Connect');
  });
  it('finds additions by name, purpose and type', () => {
    const items = reviewItems(sources);
    const brief = items.find(item => item.name === 'Research brief')!;
    expect(matchesReview(brief, 'help me with a research question')).toBe(true);
    expect(matchesReview(brief, '', 'Skills')).toBe(true);
    expect(matchesReview(brief, '', 'Apps')).toBe(false);
    expect(matchesReview(items.find(item => item.key === 'mcp:company')!, 'company', 'Connectors')).toBe(true);
  });
  it('promotes a connection with an interface to an app', () => {
    const items = reviewItems({ ...sources, connectedApps: [{ id: 'company', name: 'Company data', toolkitName: 'Company data', available: true, account: 'Company data', sourceRef: null, icons: [], standalone: true, entrypoints: [{ name: 'home', title: 'Company data', icons: [] }], threads: [], files: [], settings: false, mentions: false, views: [], recent: [] }] });
    const app = items.find(item => item.key === 'mcp:company')!;
    expect(app).toMatchObject({ kind: 'apps', view: true, connectedAppId: 'company' });
    expect(itemType(app)).toBe('App');
    expect(matchesReview(app, '', 'Apps')).toBe(true);
  });
  it('curates small goal collections instead of copying the entire provider catalog', () => {
    const items = reviewItems({ ...sources, providers: [...sources.providers!, { id: 'hubspot', displayName: 'HubSpot', method: 'oauth2', configured: true }] });
    const business = collectionItems(items, 'business');
    expect(business.map(item => item.name)).toContain('Google');
    expect(business.map(item => item.name)).toContain('Proposal writer');
    // A CRM fits the people a small business keeps. A project tracker does not.
    expect(business.map(item => item.name)).toContain('HubSpot');
    expect(business.map(item => item.name)).not.toContain('Linear');
    expect(new Set(business.map(item => item.kind))).toEqual(new Set(['connectors', 'skills']));
    expect(business.length).toBeLessThanOrEqual(4);
    expect(business.some(item => item.target.kind === 'mcp')).toBe(false);
  });
});
