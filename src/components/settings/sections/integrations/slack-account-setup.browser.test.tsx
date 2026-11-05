/** The real Slack account setup and account cards, with synthetic save/OAuth boundaries. No live Slack app or credentials. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
import { SLACK_ACCOUNT_USER_SCOPES } from '@/lib/integrations/slack-account-setup';

const enabled = process.env.RI_SLACK_ACCOUNT_BROWSER_TEST === '1';
const callback = 'https://ri.example/api/integrations/mcp-oauth/builtin_slack';
let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ProviderDetail} from './src/components/settings/sections/integrations/provider-detail';
    window.calls = [];
    const noop = () => {};
    const empty = {label:'',clientId:'',clientSecret:''};
    function Fixture() {
      const [configured,setConfigured] = useState(false), [connected,setConnected] = useState(false);
      const [form,setForm] = useState(empty), [copied,setCopied] = useState(false), [advanced,setAdvanced] = useState(false), [results,setResults] = useState({});
      const [configs,setConfigs] = useState([]);
      const provider = {id:'slack',displayName:'Slack',method:'mcp',configured,mcp:{requiresAuth:!connected,authKind:'oauth',oauthRegistration:'registered',redirectUri:'${callback}',
        accounts:connected?[{serverId:'slack-account',connectionId:'connection',label:'Work',requiresAuth:false,status:'ok',authConfigId:'app'}]:[]}};
      return <ProviderDetail provider={provider} connections={connected?[{id:'connection',providerId:'slack',accountId:'user',label:'Work',scopes:[],status:'active'}]:[]}
        toolkits={[]} writePolicy={{}} busy={false} testing={null} testResults={results} creds={{}} selectedServices={[]}
        advancedOpen={advanced} redirectUri="https://wrong.example/native-callback" copied={copied} byoConfigs={configs} byoForm={form}
        onBack={noop} onCredChange={noop} onToggleService={noop} onConnectDirect={noop} onDisconnect={noop} onSetApproval={noop}
        onConnectOAuth={(id,intent)=>{window.calls.push({operation:'authorize',id,intent});setConnected(true);}}
        onTest={id=>{window.calls.push({operation:'test',id});setResults({[id]:{ok:true,status:'ok'}});}}
        onToggleAdvanced={()=>setAdvanced(!advanced)} onCopyRedirect={()=>{navigator.clipboard.writeText('${callback}');setCopied(true);}}
        onByoField={(field,value)=>setForm(previous=>({...previous,[field]:value}))}
        onByoAdd={()=>{window.calls.push({operation:'save',form});setConfigs([{id:'app',providerId:'slack',label:form.label,isDefault:true,status:'active'}]);setForm(empty);setConfigured(true);}}
        onByoSetDefault={noop} onByoDelete={noop} />;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <main className="@container mx-auto max-w-2xl bg-background p-4 text-foreground"><Fixture /></main>
    </QueryClientProvider>);
  `, [], { css: true });
}, 60_000);

afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled).each([{width:1000,height:1000}, {width:390,height:844}])('guides app creation, reuse, saving, sign-in and testing at $width px', async viewport => {
  const page = await fixture.browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript("Object.defineProperty(navigator, 'clipboard', {value:{writeText:async value=>{window.copiedText=value;}}});");
    // Connected app network discovery is unrelated to account setup. No remote screens exist in this fixture.
    await page.route('**/api/trpc/connectedApps.network**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({result:{data:null}}) }));
    await page.goto(fixture.url);
    await page.getByRole('heading', { name: '1. Create or open your Slack app' }).waitFor();
    const create = page.getByRole('link', { name: 'Create Slack app', exact: true });
    const url = new URL((await create.getAttribute('href'))!);
    expect(url.origin + url.pathname).toBe('https://api.slack.com/apps');
    expect(url.searchParams.get('new_app')).toBe('1');
    const manifest = JSON.parse(url.searchParams.get('manifest_json')!);
    expect(manifest.oauth_config).toEqual({redirect_urls:[callback],scopes:{user:[...SLACK_ACCOUNT_USER_SCOPES]}});
    expect(await create.getAttribute('target')).toBe('_blank');
    expect(await page.getByRole('link', { name: 'Slack reference docs', exact: true }).getAttribute('href')).toBe('https://docs.slack.dev/ai/slack-mcp-server/');
    expect(await page.getByRole('link', { name: 'Open existing Slack apps', exact: true }).getAttribute('href')).toBe('https://api.slack.com/apps');
    expect(await page.getByRole('button', { name: 'Add app', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel('Account label', { exact: true }).count()).toBe(0);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.screenshot({ path: `.work/slack-account-setup-${viewport.width}.png`, fullPage: true });

    await page.getByText('Use an app I already created', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy redirect URI', exact: true }).click();
    expect(await page.evaluate('window.copiedText')).toBe(callback);
    await page.getByRole('button', { name: 'Copy user scopes', exact: true }).click();
    await page.getByText('User scopes copied', { exact: true }).waitFor();
    expect(JSON.parse(await page.evaluate('window.copiedText'))).toEqual([...SLACK_ACCOUNT_USER_SCOPES]);
    expect(await page.getByText('Keep your existing user scopes', { exact: false }).isVisible()).toBe(true);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.getByText('Use an app I already created', { exact: true }).click();

    await page.getByLabel('App label in Ri', { exact: true }).fill('My Slack app');
    await page.getByLabel('Client ID', { exact: true }).fill('fixture-client-id');
    expect(await page.getByRole('button', { name: 'Add app', exact: true }).isDisabled()).toBe(true);
    await page.getByLabel('Client secret', { exact: true }).fill('fixture-client-secret');
    expect(await page.getByLabel('Client secret', { exact: true }).getAttribute('type')).toBe('password');
    await page.getByRole('button', { name: 'Add app', exact: true }).click();
    await page.getByRole('heading', { name: '3. Sign in to Slack' }).waitFor();
    expect(await page.getByText('Your Slack app is saved in Ri.', { exact: false }).isVisible()).toBe(true);
    expect(await page.getByRole('link', { name: 'Create Slack app', exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Client secret', { exact: true }).count()).toBe(0);
    const connect = page.getByRole('button', { name: 'Connect Slack', exact: true });
    expect(await connect.isDisabled()).toBe(true);
    await page.getByLabel('Account label', { exact: true }).fill('Work');
    await page.screenshot({ path: `.work/slack-account-sign-in-${viewport.width}.png`, fullPage: true });
    await connect.click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await page.getByText('Healthy', { exact: true }).waitFor();
    expect(await page.evaluate('window.calls')).toEqual([
      {operation:'save',form:{label:'My Slack app',clientId:'fixture-client-id',clientSecret:'fixture-client-secret'}},
      {operation:'authorize',intent:{addAccount:true,setupId:expect.any(String),label:'Work',fields:{}}},
      {operation:'test',id:'connection'},
    ]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
