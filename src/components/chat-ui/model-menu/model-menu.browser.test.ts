import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// RI_MODEL_MENU_BROWSER_TEST=1 pnpm exec vitest run src/components/chat-ui/model-menu/model-menu.browser.test.ts
const enabled = process.env.RI_MODEL_MENU_BROWSER_TEST === '1';
vi.setConfig({ testTimeout: 15_000 });
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TipProvider} from './src/components/ui/tip';
      import {ComposerProviderMenu} from './src/components/executions/composer-provider-menu';
      import {ModelMenuPreview} from './src/components/chat-ui/gallery/model-menu-preview';
      import {ModelControl} from './src/components/workspaces/launcher/launch-controls';
      import {RunsOnPicker} from './src/components/triggers/runs-on-picker';
      import {Dialog as DialogPrimitive} from 'radix-ui';
      import {useSettingsStore,openSettings} from './src/components/settings/settings-store';
      import {SettingsDestinationProvider} from './src/components/settings/settings-destination';
      function App() {
        const params = new URLSearchParams(location.search);
        const [open,setOpen] = useState(false);
        const [model,setModel] = useState('gpt-6.1-sol');
        const [effort,setEffort] = useState('high');
        const [speed,setSpeed] = useState('default');
        const [switched,setSwitched] = useState(null);
        const [launch,setLaunch] = useState({harness:'codex',model:'gpt-6.1-sol',effort:'high',variant:null});
        const [schedule,setSchedule] = useState({provider:'codex',model:'gpt-6.1-sol',effort:'high',serviceTier:null});
        const settings = useSettingsStore();
        const preview = params.get('preview');
        return <TipProvider><main style={params.has('bottom')?{position:'fixed',left:24,bottom:24}:{padding:24}}>
          {preview ? <ModelMenuPreview state={preview} /> : params.has('schedule') ? <>
            <RunsOnPicker value={schedule} onChange={change=>setSchedule(current=>({...current,...change}))}/>
            <output hidden aria-label="Schedule selection">{JSON.stringify(schedule)}</output>
          </> : params.has('launcher') ? <DialogPrimitive.Root open>
            <DialogPrimitive.Content aria-label="New chat" aria-describedby={undefined} style={{position:'fixed',top:100,left:100,width:600,padding:24,overflow:'hidden'}}>
              <DialogPrimitive.Title>New chat</DialogPrimitive.Title>
              <ModelControl selection={launch} label={launch.model === 'opus' ? 'Opus' : '6.1 Sol'} effort={launch.effort} serviceTier={launch.serviceTier} rememberedEfforts={{claude:'max'}} onChange={setLaunch} onEffortChange={effort=>setLaunch(current=>({...current,effort}))}/>
              <output hidden aria-label="Launch selection">{JSON.stringify(launch)}</output>
            </DialogPrimitive.Content>
          </DialogPrimitive.Root> : <>
            <ComposerProviderMenu open={open} onOpenChange={setOpen} currentProvider="codex" model={model} fallbackLabel={model === 'gpt-6.1-sol' ? '6.1 Sol' : '6 Astra'} effort={effort} serviceTier={speed} onSelectSpeed={setSpeed} onSelectEffort={setEffort} onSelectVariant={()=>{}} onSelectModel={setModel} onSwitchProvider={setSwitched} canChangeModel={!params.has('busy')} isEmpty={params.has('empty')} switching={params.has('switching')} selectionDisabled={params.has('busy')} />
            <output hidden aria-label="Speed selection">{speed}</output>
            <output hidden aria-label="Selection">{model + ':' + effort}</output>
            <output hidden aria-label="Switched">{JSON.stringify(switched)}</output>
            <output hidden aria-label="Settings">{settings.open ? settings.section : 'closed'}</output>
          </>}
        </main></TipProvider>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><SettingsDestinationProvider value={section=>location.search.includes('member')?null:()=>openSettings(section)}><App/></SettingsDestinationProvider></QueryClientProvider>);
    `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"production"}' },
    plugins: [
      {
        name: 'model-menu-fixtures',
        setup(builder) {
          builder.onResolve({filter:/home-context$/},()=>({path:'home',namespace:'home-fixture'}));
          builder.onLoad({filter:/.*/,namespace:'home-fixture'},()=>({loader:'js',contents:`
            export const useOptionalHomeContext=()=>location.search.includes('member')?{home:{id:'team',kind:'team'},viewer:{id:'member'},capabilities:{manageSignIns:false,privatePlanning:false,configureAgents:false}}:null;
            export const useHomeStorageScope=()=>location.search.includes('member')?{homeId:'team',viewerId:'member'}:null;
          `}));
          builder.onResolve(
            {
              filter:
                /^@\/hooks\/(use-harness-models|use-harness-connection|use-default-selection|use-harnesses)$/,
            },
            (args) => ({ path: args.path, namespace: 'menu-fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'menu-fixture' }, () => ({
            loader: 'js',
            contents: `
        const fixture = window.__modelMenuFixture ??= {saved:[], recent:{codex:['gpt-6.1-sol','gpt-6-astra'],claude:['opus']}, models:{
          codex:[{id:'gpt-6.1-sol',label:'6.1 Sol',supportedEfforts:['low','medium','high','xhigh']},{id:'gpt-6-astra',label:'6 Astra',supportedEfforts:['medium','high','max']}],
          claude:[{id:'opus',label:'Opus',supportedEfforts:['low','medium','high','max']}],
          cursor:[{id:'disconnected-model',label:'Disconnected model'}],opencode:[],antigravity:[]
        }};
        if(location.search.includes('all-enabled')) {
          fixture.models.codex.push({id:'gpt-6-sol',label:'6 Sol'},{id:'gpt-6-luna',label:'6 Luna'},{id:'gpt-5.6-sol',label:'5.6 Sol'},{id:'gpt-5.6-terra',label:'5.6 Terra'},{id:'gpt-5.6-luna',label:'5.6 Luna'});
          fixture.models.claude.push({id:'fable',label:'Fable'},{id:'sonnet',label:'Sonnet'},{id:'haiku',label:'Haiku'});
          fixture.recent.claude = ['opus','fable'];
        }
        if(location.search.includes('no-history')) fixture.recent = {};
        if(location.search.includes('all-providers')) {
          fixture.models.claude = [...fixture.models.claude,{id:'fable',label:'Fable'}];
          fixture.recent.claude = ['opus','fable'];
          fixture.models.cursor = [];
          fixture.models.antigravity = [{id:'gemini-flash',label:'Gemini 3.8 Flash (High)'}];
        }
        if(location.search.includes('speed')) {
          fixture.models.codex[0].serviceTiers = [{id:'default',name:'Standard',availability:'available'},{id:'priority',name:'Fast',availability:'unknown'},{id:'ultrafast',name:'Ultrafast',availability:'unknown'}];
          fixture.models.codex[1].serviceTiers = [{id:'default',name:'Standard',availability:'available'},{id:'priority',name:'Fast',availability:'unavailable',reason:'Disabled by provider'}];
          fixture.models.claude[0].serviceTiers = [{id:'default',name:'Standard',availability:'available'},{id:'fast',name:'Fast',availability:'unknown'}];
        }
        const extra = {codex:[{id:'gpt-6-luna',label:'6 Luna',supportedEfforts:['low','medium','high']},{id:'retired',label:'Retired model',availability:'unavailable'}],claude:[{id:'sonnet',label:'Sonnet',supportedEfforts:['low','medium','high']}],cursor:[],opencode:[],antigravity:[]};
        if(location.search.includes('all-providers')) {
          extra.cursor = Array.from({length:266},(_,i)=>({id:'cursor-model-'+i,label:'Cursor model '+i}));
          extra.antigravity = Array.from({length:12},(_,i)=>({id:'gemini-'+i,label:'Gemini '+i}));
        }
        export const useHarnessModels = (harness,options={}) => ({
          models:options.catalog ? [...(fixture.models[harness]??[]),...(extra[harness]??[])] : fixture.models[harness]??[],
          data: harness ? {recentModelIds:fixture.recent[harness]??[],enabledModelIds:(fixture.models[harness]??[]).map(model=>model.id), defaultModel:harness==='codex'?'gpt-6.1-sol':'opus',defaultVariant:'standard',defaultEffort:'xhigh'} : undefined,
          isLoading:false,isError:false,refetch:async()=>{}
        });
        export const useSaveHarnessModels = () => ({mutateAsync:async input=>{
          fixture.saved.push(input);
          if(location.search.includes('save-error')) throw new Error('Could not save');
          fixture.models[input.harness] = [...fixture.models[input.harness],...extra[input.harness].filter(model=>input.enabledModelIds.includes(model.id)&&!fixture.models[input.harness].some(row=>row.id===model.id))];
        }});
        export const useHarnesses = () => ({data:{harnesses:[]}});
        export const useAddCustomModel = () => ({});
        export const useRemoveCustomModel = () => ({});
        export const useHarnessConnection = harness => ({connection:{connected:harness==='codex'||harness==='claude'||(location.search.includes('all-providers')&&['cursor','antigravity'].includes(harness))}});
        export const useRecheckHarnessConnection = () => ({isPending:false,mutate(){}});
        export const useDefaultSelection = () => ({harness:'codex',model:'gpt-6.1-sol',effort:'high'});
        export const useSetDefaultSelection = () => ({isPending:false,mutate(){}});
      `,
          }));
        },
      },
    ],
  });
  const html = await fs.readFile(
    path.resolve('public/chat-ui-gallery/model-menu.html'),
    'utf8',
  );
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath:
      process.env.RI_REVIEW_CHROMIUM,
    headless: true,
  });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
}, 30_000);

async function openPage(query = '', width = 1000, height = 800, touch = false) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (error) => {
    console.error('Model menu fixture:', error.message);
  });
  page.setDefaultTimeout(10_000);
  await page.goto(`${address}/${query}`);
  await page.waitForSelector('main');
  return page;
}

async function openMenu(page: Page) {
  await page
    .getByRole('button', { name: 'Model and settings: 6.1 Sol, High effort' })
    .click();
  await page.getByRole('combobox', { name: 'Search models' }).waitFor();
  await page.locator('[data-slot="popover-content"]').evaluate(element =>
    Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
}

it.skipIf(!enabled)(
  'searches visible models by id and selects with the keyboard',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      expect(await page.getByRole('option').count()).toBe(3);
      expect(await page.getByText('No supported models match.').isVisible()).toBe(false);
      expect(
        await page.getByRole('option', { name: 'Disconnected model' }).count(),
      ).toBe(0);
      const search = page.getByRole('combobox', { name: 'Search models' });
      await search.fill('gpt-6-astra');
      expect(await page.getByRole('option').count()).toBe(1);
      await search.press('ArrowDown');
      await search.press('Enter');
      await page.waitForFunction(
        () =>
          document.querySelector('output[aria-label="Selection"]')
            ?.textContent === 'gpt-6-astra:high',
      );
      await page
        .getByRole('combobox', { name: 'Search models' })
        .waitFor({ state: 'hidden' });
      expect(await page.getByLabel('Switched').textContent()).toBe('null');
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'changes effort from the same menu and shows the value on the button',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      await page.getByRole('button', { name: 'Effort: High' }).click();
      await page
        .getByRole('menuitemradio', { name: 'Extra high', exact: false })
        .click();
      await page
        .getByRole('button', {
          name: 'Model and settings: 6.1 Sol, Extra high effort',
        })
        .waitFor();
      expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe(
        'gpt-6.1-sol:xhigh',
      );
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'expands each provider independently and selects an additional supported model',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      expect(
        await page.getByRole('option', { name: '6 Luna', exact: true }).count(),
      ).toBe(0);
      const more = page.getByRole('button', { name: /More Codex models/ });
      await more.click();
      await page.getByRole('option', { name: '6 Luna', exact: true }).waitFor();
      if (process.env.RI_MODEL_MENU_SCREENSHOTS) {
        await fs.mkdir(process.env.RI_MODEL_MENU_SCREENSHOTS, {
          recursive: true,
        });
        await page.screenshot({
          path: path.join(
            process.env.RI_MODEL_MENU_SCREENSHOTS,
            'model-menu-expanded.png',
          ),
          animations: 'disabled',
        });
      }
      expect(
        await page
          .getByRole('button', { name: /More Claude Code models/ })
          .getAttribute('aria-expanded'),
      ).toBe('false');
      expect(
        await page.getByRole('option', { name: 'Retired model' }).count(),
      ).toBe(0);
      await page.getByRole('button', { name: /Fewer Codex models/ }).click();
      expect(
        await page.getByRole('option', { name: '6 Luna', exact: true }).count(),
      ).toBe(0);
      await more.click();
      await page.getByRole('option', { name: '6 Luna', exact: true }).click();
      await expect
        .poll(() => page.getByLabel('Selection', { exact: true }).textContent())
        .toBe('gpt-6-luna:high');
      expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([
        {
          harness: 'codex',
          enabledModelIds: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
          defaultModel: 'gpt-6.1-sol',
          defaultVariant: 'standard',
          defaultEffort: 'xhigh',
        },
      ]);
      await page.getByRole('combobox').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: /Model and settings:/ }).click();
      await page.getByRole('option', { name: '6 Luna', exact: true }).waitFor();
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'finds additional models through search before expanding a provider',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      const search = page.getByRole('combobox');
      await search.fill('gpt-6-luna');
      await page.getByRole('option', { name: '6 Luna', exact: true }).waitFor();
      expect(await page.getByRole('option').count()).toBe(1);
      await search.fill('');
      expect(
        await page.getByRole('option', { name: '6 Luna', exact: true }).count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'keeps the current selection when enabling an additional model fails',
  async () => {
    const page = await openPage('?save-error');
    try {
      await openMenu(page);
      await page.getByRole('button', { name: /More Codex models/ }).click();
      await page.getByRole('option', { name: '6 Luna', exact: true }).click();
      await expect
        .poll(() => page.evaluate('window.__modelMenuFixture.saved.length'))
        .toBe(1);
      expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe(
        'gpt-6.1-sol:high',
      );
      await expect
        .poll(() =>
          page
            .getByRole('option', { name: '6 Luna', exact: true })
            .getAttribute('aria-disabled'),
        )
        .toBe('false');
      expect(await page.getByRole('combobox').isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'switches an empty chat immediately and preserves destination settings',
  async () => {
    const page = await openPage('?empty&speed');
    try {
      await page.evaluate(() => {
        localStorage.setItem('ri.agent.effort.v1', JSON.stringify({ claude: 'max' }));
        localStorage.setItem('ri.agent.speed.v1', JSON.stringify({ claude: 'fast' }));
      });
      await openMenu(page);
      await page.getByRole('option', { name: 'Opus, new chat' }).click();
      await expect.poll(async () => JSON.parse((await page.getByLabel('Switched').textContent())!))
        .toEqual({ harness: 'claude', model: 'opus', effort: 'max', serviceTier: 'fast' });
      expect(await page.getByText('Switch to Claude Code?').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Start new chat', exact: true }).count()).toBe(0);
      await page.getByRole('combobox').waitFor({ state: 'hidden' });
      expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6.1-sol:high');
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'switches an empty chat from an expanded provider model list',
  async () => {
    const page = await openPage('?empty');
    try {
      await openMenu(page);
      await page.getByRole('button', { name: /More Claude Code models/ }).click();
      await page.getByRole('option', { name: 'Sonnet, new chat' }).click();
      await expect.poll(async () => JSON.parse((await page.getByLabel('Switched').textContent())!))
        .toEqual({ harness: 'claude', model: 'sonnet', effort: 'medium' });
      expect(await page.getByRole('button', { name: 'Start new chat', exact: true }).count()).toBe(0);
      await page.getByRole('combobox').waitFor({ state: 'hidden' });
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'prevents duplicate provider switches while the new chat is being created',
  async () => {
    const page = await openPage('?empty&switching');
    try {
      expect(await page.getByRole('button', { name: /Model and settings:/ }).isDisabled()).toBe(true);
      expect(await page.getByLabel('Switched').textContent()).toBe('null');
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'confirms a provider switch after picking from that provider’s expanded list',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      await page
        .getByRole('button', { name: /More Claude Code models/ })
        .click();
      await page.getByRole('option', { name: 'Sonnet, new chat' }).click();
      await page.getByText('Switch to Claude Code?').waitFor();
      await page
        .getByRole('button', { name: 'Start new chat', exact: true })
        .click();
      expect(
        JSON.parse((await page.getByLabel('Switched').textContent())!),
      ).toEqual({ harness: 'claude', model: 'sonnet', effort: 'medium' });
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'confirms provider switches and preserves destination effort',
  async () => {
    const page = await openPage();
    try {
      await page.evaluate(() =>
        localStorage.setItem(
          'ri.agent.effort.v1',
          JSON.stringify({ claude: 'max' }),
        ),
      );
      await openMenu(page);
      await page.getByRole('option', { name: 'Opus, new chat' }).click();
      await page.getByText('Switch to Claude Code?').waitFor();
      expect(await page.getByLabel('Switched').textContent()).toBe('null');
      await page
        .getByRole('button', { name: 'Start new chat', exact: true })
        .click();
      expect(
        JSON.parse((await page.getByLabel('Switched').textContent())!),
      ).toEqual({ harness: 'claude', model: 'opus', effort: 'max' });
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'links to model visibility settings and resets search on reopen',
  async () => {
    const page = await openPage();
    try {
      await openMenu(page);
      await page.getByRole('combobox').fill('no-such-model');
      await page.getByText('No supported models match.').waitFor();
      await page.getByRole('button', { name: 'Manage models' }).click();
      expect(
        await page.getByLabel('Settings', { exact: true }).textContent(),
      ).toBe('models');
      await openMenu(page);
      expect(await page.getByRole('combobox').inputValue()).toBe('');
      expect(await page.getByRole('option').count()).toBe(3);
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'pauses effort changes during a turn while allowing a fresh chat',
  async () => {
    const page = await openPage('?busy');
    try {
      await openMenu(page);
      expect(
        await page.getByRole('button', { name: 'Effort: High' }).isDisabled(),
      ).toBe(true);
      await page.getByRole('option', { name: '6 Astra' }).click();
      await page.getByText('Start a new chat?', { exact: true }).waitFor();
      expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe(
        'gpt-6.1-sol:high',
      );
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'offers three speeds, updates the chip and hides unused models',
  async () => {
    const page = await openPage('?preview=full');
    try {
      await page.getByRole('button', { name: 'Speed: Normal' }).click();
      expect(await page.getByRole('menuitemradio').count()).toBe(3);
      await page
        .getByRole('menuitemradio', { name: 'Ultrafast', exact: true })
        .click();
      await page.getByRole('button', { name: 'Speed: Ultrafast' }).waitFor();
      expect(
        await page.getByLabel('Current model').getByLabel('Ultrafast').count(),
      ).toBe(1);
      await page.getByRole('button', { name: 'Manage models' }).click();
      await page.getByRole('checkbox', { name: 'Opus' }).uncheck();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      expect(
        await page.getByRole('option', { name: 'Opus, new chat' }).count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'limits the speed menu to the supplied modes and hides unsupported controls',
  async () => {
    const page = await openPage('?preview=fast-only');
    try {
      await page.getByRole('button', { name: 'Speed: Normal' }).click();
      expect(await page.getByRole('menuitemradio').allTextContents()).toEqual([
        'Normal',
        'Fast',
      ]);
      await page.goto(`${address}/?preview=unsupported`);
      await page.getByRole('combobox').waitFor();
      expect(await page.getByRole('button', { name: /^Speed:/ }).count()).toBe(
        0,
      );
      expect(await page.getByRole('button', { name: /^Effort:/ }).count()).toBe(
        0,
      );
      await page.goto(`${address}/?preview=pending`);
      expect(
        await page
          .getByRole('button', { name: 'Speed: Coming soon' })
          .isDisabled(),
      ).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)('saves native speed ids through the live composer menu', async () => {
  const page = await openPage('?speed');
  try {
    await openMenu(page);
    await page.getByRole('button', { name: 'Speed: Normal' }).click();
    expect(await page.getByRole('menuitemradio').allTextContents()).toEqual(['Normal', 'Fast', 'Ultrafast']);
    await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).click();
    await expect.poll(() => page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('priority');
    expect(await page.getByLabel('Fast', { exact: true }).isVisible()).toBe(true);
    await openMenu(page);
    await page.getByRole('button', { name: 'Speed: Fast' }).click();
    await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click();
    await expect.poll(() => page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('default');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('opens effort and speed on hover, preserves values, and keeps pointer transit and click working', async () => {
  const page = await openPage('?speed');
  try {
    await openMenu(page);
    const effort = page.getByRole('button', { name: 'Effort: High' });
    await effort.hover();
    await page.getByRole('menuitemradio', { name: /Extra high/ }).waitFor();
    expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6.1-sol:high');
    const choice = page.getByRole('menuitemradio', { name: /Extra high/ });
    const target = await choice.boundingBox();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
    await page.waitForTimeout(300);
    expect(await choice.isVisible()).toBe(true);
    const speed = page.getByRole('button', { name: 'Speed: Normal' });
    await speed.hover();
    await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).waitFor();
    await expect.poll(() => page.getByRole('menu').count()).toBe(1);
    expect(await page.getByRole('menuitemradio', { name: /Extra high/ }).count()).toBe(0);
    expect(await page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('default');
    await speed.click();
    expect(await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).isVisible()).toBe(true);
    await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).click();
    await expect.poll(() => page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('priority');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('closes a hover menu after leaving and never reopens it after the parent closes', async () => {
  const page = await openPage('?speed');
  try {
    await openMenu(page);
    await page.getByRole('button', { name: 'Effort: High' }).hover();
    await page.getByRole('menu').waitFor();
    await page.mouse.move(900, 700);
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    expect(await page.getByRole('combobox').isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Speed: Normal' }).hover();
    await page.getByRole('button', { name: /Model and settings:/ }).click();
    await page.waitForTimeout(300);
    expect(await page.getByRole('menu').count()).toBe(0);
    expect(await page.getByRole('combobox').count()).toBe(0);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('opens option menus with ArrowRight and restores keyboard focus on Escape', async () => {
  const page = await openPage('?speed');
  try {
    await openMenu(page);
    const effort = page.getByRole('button', { name: 'Effort: High' });
    await effort.focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('menu').waitFor();
    await expect.poll(() => page.getByRole('menuitemradio').first().evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    expect(await effort.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowRight');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    expect(await effort.evaluate(element => element === document.activeElement)).toBe(true);
    const speed = page.getByRole('button', { name: 'Speed: Normal' });
    await speed.focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).waitFor();
    await expect.poll(() => page.getByRole('menuitemradio', { name: 'Normal', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.getByRole('menuitemradio', { name: 'Fast', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('priority');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('uses tap on phones and does not open an option menu from hovering', async () => {
  const page = await openPage('?speed', 390, 800, true);
  try {
    await page.getByRole('button', { name: /Model and settings:/ }).tap();
    const effort = page.getByRole('button', { name: 'Effort: High' });
    await effort.hover();
    await page.waitForTimeout(250);
    expect(await page.getByRole('menu').count()).toBe(0);
    await effort.tap();
    await page.getByRole('menuitemradio', { name: /Extra high/ }).tap();
    await expect.poll(() => page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6.1-sol:xhigh');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('shows the providers below Claude without scrolling when desktop space is available', async () => {
  const page = await openPage('?all-providers&speed');
  try {
    await openMenu(page);
    const list = page.getByRole('listbox');
    const lastProvider = page.getByRole('button', { name: /More Antigravity models/ });
    const bounds = await list.boundingBox();
    const last = await lastProvider.boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    expect(await list.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await page.getByRole('button', { name: 'More models below', exact: true }).count()).toBe(0);
    if (process.env.RI_MODEL_MENU_SCREENSHOTS) {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await fs.mkdir(process.env.RI_MODEL_MENU_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.RI_MODEL_MENU_SCREENSHOTS, 'model-menu-all-providers.png'), animations: 'disabled' });
    }
  } finally { await page.close(); }
});

it.skipIf(!enabled)('makes overflow visible and scrollable while keeping search and settings fixed on a short screen', async () => {
  const page = await openPage('?all-providers&speed', 1000, 440);
  try {
    await openMenu(page);
    const list = page.getByRole('listbox');
    const effort = page.getByRole('button', { name: 'Effort: High' });
    const effortBefore = await effort.boundingBox();
    await page.getByRole('button', { name: 'More models below', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(10);
    expect(await page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6.1-sol:high');
    await page.getByRole('button', { name: 'More models above', exact: true }).waitFor();
    const effortAfter = await effort.boundingBox();
    expect(effortAfter!.y).toBe(effortBefore!.y);
    const panel = await page.getByRole('dialog').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(440);
    if (process.env.RI_MODEL_MENU_SCREENSHOTS) {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await fs.mkdir(process.env.RI_MODEL_MENU_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.RI_MODEL_MENU_SCREENSHOTS, 'model-menu-short-screen.png'), animations: 'disabled' });
    }
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByRole('button', { name: 'More models below', exact: true }).waitFor({ state: 'hidden' });
    const previous = await list.evaluate(element => element.scrollTop);
    await page.getByRole('button', { name: 'More models above', exact: true }).click();
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(previous - 10);
    await page.getByRole('combobox').fill('Gemini 3.8 Flash');
    await expect.poll(() => page.getByRole('option').count()).toBe(1);
    await expect.poll(() => page.getByRole('button', { name: /More models (above|below)/ }).count()).toBe(0);
    expect(await page.getByRole('option', { name: 'Gemini 3.8 Flash (High), new chat', exact: true }).isVisible()).toBe(true);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('keeps a large expanded provider searchable and signals its scrollable results', async () => {
  const page = await openPage('?all-providers&speed');
  try {
    await openMenu(page);
    const expand = page.getByRole('button', { name: /More Cursor models/ });
    await expand.focus();
    await page.keyboard.press('Enter');
    expect(await page.getByRole('button', { name: /Fewer Cursor models/ }).getAttribute('aria-expanded')).toBe('true');
    await page.getByRole('button', { name: 'More models below', exact: true }).waitFor();
    await page.getByRole('combobox').fill('cursor-model-265');
    await page.getByRole('option', { name: 'Cursor model 265, new chat', exact: true }).waitFor();
    await expect.poll(() => page.getByRole('option').count()).toBeLessThan(5);
    await expect.poll(() => page.getByRole('button', { name: 'More models below', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('fits above a bottom composer and opens its option menus within the viewport', async () => {
  const page = await openPage('?all-providers&speed&bottom');
  try {
    await openMenu(page);
    const panel = page.locator('[data-slot="popover-content"]');
    expect(await panel.getAttribute('data-side')).toBe('top');
    const bounds = await panel.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    await page.getByRole('button', { name: /More Antigravity models/ }).waitFor();
    expect(await page.getByRole('button', { name: 'More models below', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Speed: Normal' }).hover();
    await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).waitFor();
    await page.getByRole('menu').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const speed = await page.getByRole('menu').boundingBox();
    expect(speed!.y).toBeGreaterThanOrEqual(0);
    expect(speed!.y + speed!.height).toBeLessThanOrEqual(800);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('shows inherited schedule speed honestly until Normal is explicitly selected', async () => {
  const page = await openPage('?schedule&speed');
  try {
    await openMenu(page);
    expect(await page.getByRole('button', { name: 'Speed: Provider default' }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Speed: Normal', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Effort: High' }).click();
    await page.getByRole('menuitemradio', { name: /Extra high/ }).click();
    expect(JSON.parse((await page.getByLabel('Schedule selection').textContent())!).serviceTier).toBeNull();
    await page.getByRole('button', { name: /Model and settings: 6.1 Sol/ }).click();
    await page.getByRole('button', { name: 'Speed: Provider default' }).click();
    await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click();
    await expect.poll(async () => JSON.parse((await page.getByLabel('Schedule selection').textContent())!).serviceTier).toBe('default');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('carries the selected speed in the launcher and disables unavailable choices', async () => {
  const page = await openPage('?launcher&speed');
  try {
    await openMenu(page);
    await page.getByRole('button', { name: 'Speed: Normal' }).click();
    await page.getByRole('menuitemradio', { name: 'Ultrafast', exact: true }).click();
    await expect.poll(async () => JSON.parse((await page.getByLabel('Launch selection').textContent())!).serviceTier).toBe('ultrafast');
    await openMenu(page);
    await page.getByRole('button', { name: 'Speed: Ultrafast' }).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.goto(`${address}/?speed`);
    await openMenu(page);
    await page.getByRole('option', { name: '6 Astra', exact: true }).click();
    await page.getByRole('button', { name: /Model and settings: 6 Astra/ }).click();
    await page.getByRole('button', { name: 'Speed: Normal' }).click();
    expect(await page.getByRole('menuitemradio', { name: /Fast/ }).getAttribute('aria-disabled')).toBe('true');
    expect(await page.getByRole('menuitemradio', { name: 'Ultrafast', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
});

it.skipIf(!enabled)(
  'keeps the menu and its effort choices inside a phone viewport',
  async () => {
    const page = await openPage('', 360);
    try {
      await openMenu(page);
      await page.getByRole('button', { name: 'Effort: High' }).click();
      await expect
        .poll(async () => {
          const bounds = await page.getByRole('menu').boundingBox();
          return bounds && bounds.x >= 0 && bounds.x + bounds.width <= 360;
        })
        .toBe(true);
      await page.keyboard.press('Escape');
      if (process.env.RI_MODEL_MENU_SCREENSHOTS) {
        await page.getByRole('menu').waitFor({ state: 'hidden' });
        await fs.mkdir(process.env.RI_MODEL_MENU_SCREENSHOTS, {
          recursive: true,
        });
        await page.screenshot({
          path: path.join(
            process.env.RI_MODEL_MENU_SCREENSHOTS,
            'model-menu-phone.png',
          ),
          animations: 'disabled',
        });
        await page.setViewportSize({ width: 1000, height: 800 });
        await page.goto(`${address}/?preview=full`);
        await page.getByRole('button', { name: 'Speed: Normal' }).click();
        await page.getByRole('menu').waitFor();
        await page.screenshot({
          path: path.join(
            process.env.RI_MODEL_MENU_SCREENSHOTS,
            'model-menu-speed.png',
          ),
          animations: 'disabled',
        });
      }
    } finally {
      await page.close();
    }
  },
);

it.skipIf(!enabled)(
  'uses the combined menu inside the launcher dialog without a switch confirmation',
  async () => {
    const page = await openPage('?launcher');
    try {
      await openMenu(page);
      await page.getByRole('button', { name: 'Effort: High' }).click();
      await page
        .getByRole('menuitemradio', { name: 'Extra high', exact: false })
        .click();
      await page.getByRole('combobox').waitFor({ state: 'hidden' });
      expect(
        JSON.parse((await page.getByLabel('Launch selection').textContent())!)
          .effort,
      ).toBe('xhigh');
      await page
        .getByRole('button', {
          name: 'Model and settings: 6.1 Sol, Extra high effort',
        })
        .click();
      await page.getByRole('option', { name: 'Opus', exact: true }).click();
      expect(
        JSON.parse((await page.getByLabel('Launch selection').textContent())!),
      ).toEqual({
        harness: 'claude',
        model: 'opus',
        variant: null,
        serviceTier: null,
        effort: 'max',
      });
      expect(
        await page
          .getByRole('button', { name: 'Start new chat', exact: true })
          .count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  },
);


it.skipIf(!enabled)('Team members can select enabled models and speeds without changing the host model catalog', async () => {
  const page = await openPage('?member&speed');
  try {
    await openMenu(page);
    expect(await page.getByRole('button', { name: /Manage models/ }).count()).toBe(0);
    expect(await page.getByText('Make default', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Speed: Normal' }).click();
    await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).click();
    await expect.poll(() => page.getByLabel('Speed selection', { exact: true }).textContent()).toBe('priority');
    await openMenu(page);
    await page.getByRole('combobox', { name: 'Search models' }).fill('6 Luna');
    expect(await page.getByRole('option', { name: /6 Luna/ }).count()).toBe(0);
    expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([]);
    await page.getByRole('combobox', { name: 'Search models' }).fill('6 Astra');
    await page.getByRole('option', { name: /6 Astra/ }).click();
    expect(await page.locator('output[aria-label="Selection"]').textContent()).toBe('gpt-6-astra:high');
    expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([]);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('collapses a fully enabled catalog to Astra, 6.1, Opus and Fable, with independent provider expansion', async () => {
  const page = await openPage('?all-enabled');
  try {
    await openMenu(page);
    expect(await page.getByRole('option').allTextContents()).toEqual([
      expect.stringContaining('6.1 Sol'), expect.stringContaining('6 Astra'),
      expect.stringContaining('Opus'), expect.stringContaining('Fable'),
    ]);
    expect(await page.getByRole('option', { name: /5.6 Sol|Sonnet/ }).count()).toBe(0);
    if (process.env.RI_MODEL_MENU_SCREENSHOTS) {
      await fs.mkdir(process.env.RI_MODEL_MENU_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.RI_MODEL_MENU_SCREENSHOTS, 'model-menu-recent.png'), animations: 'disabled' });
    }
    await page.getByRole('button', { name: /More Codex models/ }).click();
    expect(await page.getByRole('option', { name: '5.6 Sol', exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('option', { name: /Sonnet/ }).count()).toBe(0);
    await page.getByRole('button', { name: /More Claude Code models/ }).click();
    expect(await page.getByRole('option', { name: 'Sonnet, new chat', exact: true }).isVisible()).toBe(true);
    await page.getByRole('button', { name: /Fewer Codex models/ }).click();
    expect(await page.getByRole('option', { name: '5.6 Sol', exact: true }).count()).toBe(0);
    expect(await page.getByRole('option', { name: 'Sonnet, new chat', exact: true }).isVisible()).toBe(true);
    await page.getByRole('combobox', { name: 'Search models' }).fill('gpt-5.6-sol');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-5.6-sol:high');
    expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([]);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('keeps a cold-start menu compact and lets an enabled model be selected from More without saving settings', async () => {
  const page = await openPage('?no-history');
  try {
    await openMenu(page);
    expect(await page.getByRole('option').count()).toBe(2);
    expect(await page.getByRole('option', { name: '6 Astra', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: /More Codex models/ }).click();
    await page.getByRole('option', { name: '6 Astra', exact: true }).click();
    await expect.poll(() => page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6-astra:high');
    expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([]);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('keeps remaining enabled models reachable for a member who cannot configure the catalog', async () => {
  const page = await openPage('?member&all-enabled');
  try {
    await openMenu(page);
    expect(await page.getByRole('option').count()).toBe(4);
    expect(await page.getByRole('button', { name: /Manage models/ }).count()).toBe(0);
    await page.getByRole('button', { name: /More Codex models/ }).click();
    await page.getByRole('option', { name: '6 Luna', exact: true }).click();
    await expect.poll(() => page.getByLabel('Selection', { exact: true }).textContent()).toBe('gpt-6-luna:high');
    expect(await page.evaluate('window.__modelMenuFixture.saved')).toEqual([]);
  } finally { await page.close(); }
});
