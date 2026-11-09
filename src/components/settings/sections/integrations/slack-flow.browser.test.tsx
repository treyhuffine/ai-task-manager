/** Real Plugins controller, UI and toasts. Synthetic account/OAuth boundaries, never a live Slack account. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const enabled = process.env.RI_SLACK_ACCOUNT_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {Toaster} from 'sonner';
    import {IntegrationsSection} from './src/components/settings/sections/integrations-section';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <main className="@container mx-auto max-w-2xl p-4"><IntegrationsSection navigation={{providerId:'slack',onBack:()=>{}}}/></main><Toaster />
    </QueryClientProvider>);
  `, [{name:'slack-workflow-boundaries',setup(build) {
    build.onResolve({filter:/lib\/trpc\/client$/}, () => ({path:'slack-client',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'}, () => ({loader:'ts',contents:`
      window.calls=[];window.opened=[];const gates={};const pause=name=>new Promise(resolve=>{gates[name]=resolve});window.release=name=>gates[name]?.();
      window.riDesktop={openExternal:async url=>{window.opened.push(url)}};
      const params=new URLSearchParams(location.search);let initial=true;let mcpEnabled=false;
      const blocked='Error POSTing to endpoint: '+JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'App is not enabled for Slack MCP server access. Please enable it here: https://api.slack.com/apps/A0123/app-assistant'}});
      let configs=params.has('apps')?[
        {id:'app-a',providerId:'slack',label:'Personal Slack',status:'active',isDefault:true},
        {id:'app-b',providerId:'slack',label:'Slack Dynamism',status:'active',isDefault:false}
      ]:[];
      let accounts=[];let connections=[];
      const ready=()=>{accounts=accounts.map(account=>({...account,requiresAuth:false,status:'ok',error:undefined,toolCount:6,lastAuthorizationId:'consent-1'}));};
      window.enableMcp=()=>{mcpEnabled=true;};
      window.completeOAuth=(failed,unfinished=false)=>{
        mcpEnabled=!failed;
        accounts=accounts.map(account=>({...account,connectionId:unfinished?undefined:'connection',requiresAuth:false,status:failed?'error':'ok',error:failed?blocked:undefined,toolCount:failed?0:6,lastAuthorizationId:failed?undefined:'consent-1'}));
        connections=unfinished?[]:[{id:'connection',providerId:'slack',accountId:'slack-user',label:'Dynamism Slack',scopes:[],status:'active'}];
      };
      const query=(key,fn)=>({queryOptions:()=>({queryKey:[key],queryFn:async()=>fn()})});
      export const trpc={integrationSources:{overview:query('sources',()=>({sources:[]})),accounts:query('managed-accounts',()=>[])},connectedApps:{network:query('network',()=>null)}};
      export const trpcClient={integrations:{
        statusGet:{query:async()=>{if(initial){initial=false;await pause('load');}return{redirectUri:'https://ri.example/callback',providers:[{id:'slack',displayName:'Slack',method:'mcp',configured:configs.length>0,mcp:{authKind:'oauth',oauthRegistration:'registered',requiresAuth:!accounts.length||accounts.some(a=>a.requiresAuth),redirectUri:'https://ri.example/api/integrations/mcp-oauth/builtin_slack',accounts}}]};}},
        connectionsGet:{query:async()=>({connections})},toolkitsGet:{query:async()=>({toolkits:[]})},writePolicyGet:{query:async()=>({toolkits:[]})},
        authConfigsGet:{query:async()=>({configs})},
        authConfigsPost:{mutate:async({body})=>{window.calls.push({operation:'save',label:body.label});await pause('save');if(window.failSave)throw Error('The app could not be saved. Try again.');const config={id:'app-new',providerId:'slack',label:body.label,status:'active',isDefault:configs.length===0};configs=[...configs,config];return{config};}},
        authConfigsDelete:{mutate:async()=>({})},authConfigsDefaultPost:{mutate:async()=>({})},
        connectPost:{mutate:async({body})=>{window.calls.push({operation:'connect',...body});await pause('connect');if(body.serverId&&mcpEnabled){window.completeOAuth(false);return{requiresAuth:false,serverId:body.serverId};}accounts=[{serverId:'server',label:body.label,authConfigId:body.authConfigId,requiresAuth:true,status:'error'}];return{authUrl:'https://slack.example/authorize',requiresAuth:true,serverId:'server',authorizationId:'consent-1'};}},
        testPost:{mutate:async({body})=>{window.calls.push({operation:'test',id:body.id});await pause('test');if(!mcpEnabled)return{ok:false,status:'error',error:blocked};ready();return{ok:true,status:'ok'};}}
      }};
    `}));
  }}], {css:true});
}, 60_000);
afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled)('saves an app, focuses the selected sign-in, and shows progress and success through verification', async () => {
  const page = await fixture.browser.newPage({viewport:{width:1000,height:1000}});
  page.setDefaultTimeout(7000);
  const errors: string[]=[];page.on('pageerror', error=>errors.push(error.message));
  try {
    await page.goto(fixture.url);
    await page.getByText('Loading your accounts and connection status…',{exact:true}).waitFor();
    await page.evaluate("window.release('load')");
    await page.getByLabel('App label in Ri',{exact:true}).fill('Slack Dynamism');
    await page.getByLabel('Client ID',{exact:true}).fill('fixture-client');
    await page.getByLabel('Client secret',{exact:true}).fill('fixture-secret');
    const manifest=new URL((await page.getByRole('link',{name:'Create Slack app',exact:true}).getAttribute('href'))!);
    expect(JSON.parse(manifest.searchParams.get('manifest_json')!).settings.is_mcp_enabled).toBe(true);
    await page.getByRole('button',{name:'Save app and continue',exact:true}).click();
    await page.locator('[data-sonner-toast]').filter({hasText:'Saving Slack app…'}).waitFor();
    expect(await page.getByRole('button',{name:'Saving app…',exact:true}).isDisabled()).toBe(true);
    await page.evaluate("window.release('save')");
    await page.getByLabel('Slack app',{exact:true}).waitFor();
    expect(await page.getByLabel('Slack app',{exact:true}).inputValue()).toBe('app-new');
    await page.getByText('App saved. Next, connect your Slack account below.',{exact:true}).waitFor();
    expect(await page.evaluate('document.activeElement.id')).toBe('slack-account-sign-in');
    expect(await page.getByRole('button',{name:'OAuth apps',exact:true}).count()).toBe(0);
    expect(await page.getByText('Not connected',{exact:true}).count()).toBe(1);
    await page.locator('[data-sonner-toast]').filter({hasText:'Slack app saved. Connect your account next.'}).waitFor();
    await page.getByLabel('Account label',{exact:true}).fill('Dynamism Slack');
    await page.getByRole('button',{name:'Connect Slack',exact:true}).click();
    await page.locator('[data-sonner-toast]').filter({hasText:'Preparing Slack sign-in…'}).waitFor();
    await page.evaluate("window.release('connect')");
    await page.getByText('Waiting for Dynamism Slack sign-in',{exact:true}).waitFor();
    expect(await page.evaluate('window.opened')).toEqual(['https://slack.example/authorize']);
    await page.evaluate('window.completeOAuth(false); window.dispatchEvent(new Event("focus"));');
    await page.getByText('Connected · 6 tools',{exact:true}).waitFor();
    expect(await page.getByText('App saved. Next, connect your Slack account below.',{exact:true}).count()).toBe(0);
    await page.locator('[data-sonner-toast]').filter({hasText:'Connected Dynamism Slack'}).waitFor();
    await page.getByRole('button',{name:'Test connection',exact:true}).click();
    await page.getByText('Checking Slack access…',{exact:true}).waitFor();
    await page.locator('[data-sonner-toast]').filter({hasText:'Checking connection and loading tools…'}).waitFor();
    await page.evaluate("window.release('test')");
    await page.getByText('Connected. Slack tools are ready.',{exact:true}).waitFor();
    await page.locator('[data-sonner-toast]').filter({hasText:'Connection ready'}).waitFor();
    expect(await page.evaluate('window.calls.find(call=>call.operation==="connect").authConfigId')).toBe('app-new');
    await page.screenshot({path:'.work/slack-flow-ready-desktop.png',fullPage:true});
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps multiple apps visible and recovers a blocked Slack app without repeating consent', async () => {
  const page=await fixture.browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(fixture.url+'?apps');await page.evaluate("window.release('load')");
    const apps=page.getByRole('region',{name:'Slack apps',exact:true});
    await apps.getByText('Personal Slack',{exact:true}).waitFor();
    await apps.getByText('Slack Dynamism',{exact:true}).waitFor();
    await page.getByLabel('Slack app',{exact:true}).selectOption('app-b');
    await page.getByLabel('Account label',{exact:true}).fill('Dynamism Slack');
    await page.getByRole('button',{name:'Connect Slack',exact:true}).click();await page.evaluate("window.release('connect')");
    await page.getByText('Waiting for Dynamism Slack sign-in',{exact:true}).waitFor();
    await page.evaluate('window.completeOAuth(true); window.dispatchEvent(new Event("focus"));');
    await page.getByText('Waiting for Dynamism Slack sign-in',{exact:true}).waitFor({state:'detached'});
    const recovery=page.getByRole('link',{name:'Enable Slack access',exact:true});
    await recovery.first().waitFor();
    expect(await recovery.count()).toBe(1);
    expect(await recovery.first().getAttribute('href')).toBe('https://api.slack.com/apps/A0123/app-assistant');
    expect(await page.getByText('Enable access in Slack · 0 tools',{exact:true}).count()).toBe(1);
    expect(await page.getByRole('button',{name:'Test connection',exact:true}).isEnabled()).toBe(true);
    expect(await page.getByRole('button',{name:'Remove app',exact:true}).last().isDisabled()).toBe(true);
    expect(await page.evaluate('window.calls.find(call=>call.operation==="connect").authConfigId')).toBe('app-b');
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.screenshot({path:'.work/slack-flow-blocked-mobile.png',fullPage:true});
    await page.evaluate('window.enableMcp()');
    await page.getByRole('button',{name:'Test connection',exact:true}).click();
    await page.getByText('Checking Slack access…',{exact:true}).waitFor();await page.evaluate("window.release('test')");
    await page.getByText('Connected. Slack tools are ready.',{exact:true}).waitFor();
    expect(await page.getByRole('link',{name:'Enable Slack access',exact:true}).count()).toBe(0);
    expect(await page.evaluate('window.calls.filter(call=>call.operation==="connect").length')).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('continues an unfinished setup with its pinned app after enabling Slack access', async () => {
  const page=await fixture.browser.newPage({viewport:{width:1000,height:900}});
  page.setDefaultTimeout(7000);
  try {
    await page.goto(fixture.url+'?apps');await page.evaluate("window.release('load')");
    await page.getByLabel('Slack app',{exact:true}).selectOption('app-b');
    await page.getByLabel('Account label',{exact:true}).fill('Dynamism Slack');
    await page.getByRole('button',{name:'Connect Slack',exact:true}).click();await page.evaluate("window.release('connect')");
    await page.getByText('Waiting for Dynamism Slack sign-in',{exact:true}).waitFor();
    await page.evaluate('window.completeOAuth(true,true); window.dispatchEvent(new Event("focus"));');
    await page.getByRole('button',{name:'Continue setup',exact:true}).waitFor();
    expect(await page.getByRole('button',{name:'Test connection',exact:true}).count()).toBe(0);
    await page.evaluate('window.enableMcp()');
    await page.getByRole('button',{name:'Continue setup',exact:true}).click();await page.evaluate("window.release('connect')");
    await page.getByText('Connected · 6 tools',{exact:true}).waitFor();
    expect(await page.getByRole('link',{name:'Enable Slack access',exact:true}).count()).toBe(0);
    expect(await page.evaluate('window.calls.filter(call=>call.operation==="connect").at(-1)')).toMatchObject({serverId:'server',authConfigId:'app-b',label:'Dynamism Slack'});
    expect(await page.evaluate('window.opened.length')).toBe(1);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps entered app credentials on save failure and replaces the progress toast with the error', async () => {
  const page=await fixture.browser.newPage({viewport:{width:1000,height:900}});
  try {
    await page.goto(fixture.url);await page.evaluate("window.release('load')");
    await page.getByLabel('App label in Ri',{exact:true}).fill('Slack Dynamism');
    await page.getByLabel('Client ID',{exact:true}).fill('fixture-client');await page.getByLabel('Client secret',{exact:true}).fill('fixture-secret');
    await page.evaluate('window.failSave=true');
    await page.getByRole('button',{name:'Save app and continue',exact:true}).click();
    await page.locator('[data-sonner-toast]').filter({hasText:'Saving Slack app…'}).waitFor();await page.evaluate("window.release('save')");
    await page.locator('[data-sonner-toast]').filter({hasText:'The app could not be saved. Try again.'}).waitFor();
    expect(await page.getByLabel('Client secret',{exact:true}).inputValue()).toBe('fixture-secret');
    expect(await page.getByRole('button',{name:'Save app and continue',exact:true}).isEnabled()).toBe(true);
    expect(await page.getByText('App saved',{exact:true}).count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
