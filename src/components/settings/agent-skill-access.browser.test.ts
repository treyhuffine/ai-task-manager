import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Ri's user-level skills in Settings: the Get started item (the real checklist
// hook) and the MCP access block, against a fake server that keeps state.
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;

const LABEL = 'Let your coding tools manage tasks and notes';
const CONFLICT = '~/.claude/skills/agent-work-tasks-notes_ri';
const FOLDERS = 'in ~/.agents/skills, ~/.claude/skills and ~/.gemini/config/skills';

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
      import {Toaster} from 'sonner';
      import {GetStartedSection} from './src/components/settings/sections/get-started-section';
      import {AgentSkillAccess} from './src/components/settings/agent-skill-access';
      import {useSetupChecklist} from './src/components/settings/use-setup-checklist';
      function App() {
        const checklist = useSetupChecklist(true);
        return <div className='flex gap-8 p-6'>
          <main aria-label='Get started' style={{flex:1}}><GetStartedSection checklist={checklist}/></main>
          <aside aria-label='MCP access' style={{flex:1}}><AgentSkillAccess/></aside>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><App/><Toaster/></QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'agent-skill-fixture', setup(b) {
      b.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      b.onResolve({ filter: /hooks\/use-user-state$/ }, () => ({ path: 'user-state', namespace: 'fixture' }));
      b.onResolve({ filter: /lib\/api\/settings$/ }, () => ({ path: 'settings', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents: {
        'user-state': `export const useUserState=()=>({data:{description:'',defaultHarness:'claude'}});`,
        settings: `export const settingsApi={getBaseUrls:async()=>({tunnel:null})};`,
        api: `
          const params=new URLSearchParams(location.search);
          const desktop=params.has('desktop');const blocked=params.has('blocked');
          window.skillCalls=[];
          let skill={appOnly:desktop,enabled:!desktop,configured:true,installed:!desktop&&!blocked,conflicts:blocked?['${CONFLICT}']:[],folders:desktop?[]:['~/.agents/skills','~/.claude/skills','~/.gemini/config/skills']};
          const query=(name,fn)=>({queryKey:()=>[name],queryOptions:()=>({queryKey:[name],queryFn:async()=>fn()})});
          export const trpc={harness:{skillsGlobalGet:query('skill',()=>skill)}};
          export const trpcClient={
            harness:{skillsGlobalPut:{mutate:async({body})=>{
              window.skillCalls.push(body.enabled);
              skill={...skill,enabled:body.enabled,configured:true};
              if(body.enabled&&skill.conflicts.length)throw new Error('Another skill is already at ${CONFLICT}, so Ri left it alone. Remove or rename it, then install again.');
              skill={...skill,installed:body.enabled};
              return {};
            }}},
            notifications:{channelsGet:{query:async()=>({channels:[]})}},
            integrations:{connectionsGet:{query:async()=>({connections:[]})}},
            browser:{list:{query:async()=>({enabled:false,config:{detected:[]}})}},
          };
        `,
      }[path]! }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    res.setHeader('content-type', url.pathname === '/bundle.js' ? 'text/javascript' : url.pathname === '/style.css' ? 'text/css' : 'text/html');
    res.end(url.pathname === '/bundle.js' ? bundle.outputFiles[0].text : url.pathname === '/style.css' ? css.css : '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
  browser.on('context', context => context.on('page', page => page.setDefaultTimeout(5_000)));
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function screenshot(page: Page, name: string) {
  if (!process.env.RI_ARTIFACT_SCREENSHOTS) return;
  await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, name), animations: 'disabled' });
}

const row = (page: Page): Locator => page.getByRole('listitem').filter({ hasText: LABEL });
const calls = (page: Page) => page.evaluate('window.skillCalls');

it.skipIf(!enabled)('says the skills are on and takes them off and back in one click, from either place', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(address);
    const external = page.getByRole('complementary', { name: 'MCP access' });
    await row(page).getByText('Uninstall in one click any time.', { exact: false }).waitFor();
    await external.getByText(FOLDERS, { exact: true }).waitFor();
    // Every harness, so switching later loses nothing.
    await external.getByText('Codex, Claude Code, Cursor, OpenCode and Antigravity can manage your tasks', { exact: false }).waitFor();
    await page.getByText('2/7 done', { exact: true }).waitFor();
    await screenshot(page, 'agent-skill-on.png');

    // Uninstall from MCP access: both places follow, and the toast can undo it.
    await external.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await external.getByText('Not installed', { exact: true }).waitFor();
    await row(page).getByText('Install it here or in MCP access any time.', { exact: true }).waitFor();
    await page.getByText('1/7 done', { exact: true }).waitFor();
    expect(await calls(page)).toEqual([false]);
    await screenshot(page, 'agent-skill-uninstalled.png');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await external.getByText(FOLDERS, { exact: true }).waitFor();
    expect(await calls(page)).toEqual([false, true]);

    // The same from the Get started row, which never asks to undo a choice.
    await row(page).getByRole('button', { name: 'Uninstall', exact: true }).click();
    await row(page).getByText('Install it here or in MCP access any time.', { exact: true }).waitFor();
    expect(await row(page).getByRole('button', { name: 'Skip', exact: true }).count()).toBe(0);
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    await row(page).getByText('Uninstall in one click any time.', { exact: false }).waitFor();
    expect(await calls(page)).toEqual([false, true, false, true]);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('names what holds the skill name and lets the row be skipped', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${address}/?blocked=1`);
    const external = page.getByRole('complementary', { name: 'MCP access' });
    await external.getByRole('alert').getByText(`Another skill is already at ${CONFLICT}`, { exact: false }).waitFor();
    await row(page).getByText('MCP access shows where.', { exact: false }).waitFor();
    await screenshot(page, 'agent-skill-blocked.png');

    await external.getByRole('button', { name: 'Install', exact: true }).click();
    await page.getByText('Could not install the skills', { exact: true }).waitFor();
    await external.getByRole('alert').waitFor();
    expect(await calls(page)).toEqual([true]);

    await row(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await row(page).getByText('Install it in MCP access any time.', { exact: true }).waitFor();
    await row(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await row(page).getByRole('button', { name: 'Set up', exact: true }).waitFor();
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('offers nothing in the desktop app, where the skills stay inside it', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${address}/?desktop=1`);
    const external = page.getByRole('complementary', { name: 'MCP access' });
    await external.getByText('In the desktop app, task and note access stays inside Ri.', { exact: false }).waitFor();
    await page.getByText('1/6 done', { exact: true }).waitFor();
    expect(await row(page).count()).toBe(0);
    expect(await external.getByRole('button').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
