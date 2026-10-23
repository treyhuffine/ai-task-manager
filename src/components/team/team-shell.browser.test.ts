/** Actual HomeShell, contextual TeamRail, shared navigation and production CSS. Data adapters only. */
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react';import{createRoot}from'react-dom/client';
    import{HomeShell}from'./src/components/home/home-shell';import{TeamRail}from'./src/components/team/team-rail';import{TipProvider}from'./src/components/ui/tip';
    createRoot(document.getElementById('root')).render(<TipProvider><HomeShell navigation={<TeamRail/>} phoneHeader={<header data-testid="phone-header">Phone Home</header>} phoneNavigation={<nav data-testid="phone-nav">Phone tabs</nav>}><article>Shared work</article></HomeShell></TipProvider>);
  `, [{ name: 'team-rail-data', setup(b) {
    const modules: Record<string, string> = {
      'home-context': `export const useHomeStorageScope=()=>({homeId:'team',viewerId:'maya'});export const useHomeContext=()=>({capabilities:{configureAgents:true,administerMembers:false},executionChoices:[]});`,
      'team-context': `export const useTeam=()=>({team:{id:'team',name:'Shared Team'},member:{name:'Maya'}});export const useTeamNav=()=>({view:'board',show:()=>{},openPanel:()=>{},filterArea:()=>{}});`,
      'use-workspaces': `export const useWorkspaces=()=>({data:[]});`,
      'use-areas': `export const useAreas=()=>({data:[]});`,
      'team-chat': `export const useTeamAiStatus=()=>({data:{enabled:false}});`,
      'space-selector': `export const SpaceSelector=()=> <button>Shared Home selector</button>;`,
    };
    for (const [name, contents] of Object.entries(modules)) { b.onResolve({ filter: new RegExp('/'+name+'$') }, () => ({ path:name, namespace:'rail-data' })); b.onLoad({ filter:new RegExp('^'+name+'$'),namespace:'rail-data' }, () => ({ contents,loader:'tsx',resolveDir:process.cwd() })); }
  } }], { css: true });
}, 120000);
afterAll(async () => { await fixture?.close(); });
it.skipIf(!enabled).each([390, 1280])('shows one responsive navigation tier at %ipx and preserves keyboard rail collapse', async width => {
  const page = await fixture.browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(8000);
  try {
    await page.goto(fixture.url);
    const phone = page.getByTestId('phone-header');
    expect(await phone.isVisible()).toBe(width < 768);
    expect(await page.getByTestId('phone-nav').isVisible()).toBe(width < 768);
    expect(await page.locator('aside').isVisible()).toBe(width >= 768);
    if (width >= 768) {
      await page.getByRole('button', { name: 'Collapse rail', exact:true }).click();
      await expect.poll(() => page.locator('aside').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(44);
      await page.keyboard.press('ControlOrMeta+\\');
      await expect.poll(() => page.locator('aside').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(256);
      await page.reload();
      await page.getByRole('button', { name: 'Collapse rail', exact:true }).waitFor();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, `team-shell-${width}.png`) });
  } finally { await page.close(); }
});
