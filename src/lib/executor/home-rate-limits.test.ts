import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { globalSessionChannel, subscribe } from '@/lib/realtime/bus';
import { getHarnessRateLimits } from '@/lib/harness/rate-limits';
import * as q from '@/lib/db/queries';

let home: TestHome | undefined;
let harness: FakeHarness | undefined;
const resetLimits = () => { delete (globalThis as Record<symbol, unknown>)[Symbol.for('ri.process.harness.rate-limits')]; };
afterEach(async () => {
  const executor = await import('./adapter');
  await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
  executor._resetExecutorState();
  harness?.restore();
  resetLimits();
  await home?.cleanup();
});

it('stores local account telemetry and refreshes the page through the home sink without transcript rows',async()=>{
  home=await createTestHome();
  resetLimits();
  harness=installFakeHarness('claude');
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  const observedAt=new Date().toISOString();
  harness.onTurn(async turn=>{
    await turn.emit({type:'rate_limits',update:{mode:'replace',snapshot:{provider:'claude',observedAt,buckets:[{id:'five_hour',owner:{kind:'account'},applicability:{kind:'all_models'},observedAt,usedPercent:84}]}}});
    await turn.say('Finished.');
  });
  let notifications=0;
  const unsubscribe=subscribe(globalSessionChannel,message=>{if(message.kind==='rate_limits_updated')notifications++;});
  try {
    const session=q.createChatSession({harness:'claude',type:'content'});
    await (await import('./adapter')).dispatch(session.id,'Report the result.');
    expect(getHarnessRateLimits()).toMatchObject([{harness:'claude',buckets:[{id:'five_hour',usedPercent:84}]}]);
    expect(notifications).toBe(1);
    expect(fs.existsSync(path.join(home.configDir,'harness-rate-limits.json'))).toBe(true);
    expect(q.listChatEvents(session.id).filter(event=>event.source==='agent').map(event=>event.content)).toEqual(['Finished.']);
  } finally {unsubscribe();}
});
