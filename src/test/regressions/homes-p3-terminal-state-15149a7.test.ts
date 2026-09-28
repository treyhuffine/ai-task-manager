/** A byte offset alone does not say whether a screen received the terminal's lifecycle state. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageStream } from '@/lib/realtime/page-stream';

class Source extends EventTarget {
  constructor(readonly url:string){super();}
  close(){}
  frame(event:string,data:unknown,id?:string){
    const e=new Event('terminal') as Event & {data:string};
    e.data=JSON.stringify({k:'/sessions/chat:term',e:event,d:data,i:id});this.dispatchEvent(e);
  }
}
let stream:PageStream;
let sources:Source[];
beforeEach(()=>{
  vi.useFakeTimers();sources=[];
  stream=new PageStream({open:(url)=>{const s=new Source(url);sources.push(s);return s as unknown as EventSource;}});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});

it('recovers exit when a screen briefly leaves without missing any output bytes',()=>{
  const position={after:null as number|null};
  let exited=false;
  const draw=(event:string)=>{if(event==='exit')exited=true;};
  const leave=stream.subscribeTerminal('/sessions/chat','term',position,draw);
  vi.advanceTimersByTime(20);
  sources[0]!.frame('ready',{resumed:false});
  sources[0]!.frame('data','old','3');
  leave();
  sources[0]!.frame('exit',{code:0});
  stream.subscribeTerminal('/sessions/chat','term',position,draw);
  vi.advanceTimersByTime(20);
  // A new feed would replay the terminal's ended state, even with no new bytes.
  if(sources.length>1){sources.at(-1)!.frame('ready',{resumed:true});sources.at(-1)!.frame('exit',{code:0});}
  expect(exited,'the screen joined a feed that had already ended, and never received its exit').toBe(true);
});

it('restores input if ready arrives while a temporarily hidden screen is unsubscribed',()=>{
  const position={after:null as number|null};
  let connected=false;
  const draw=(event:string)=>{if(event==='ready')connected=true;if(event==='unavailable')connected=false;};
  const leave=stream.subscribeTerminal('/sessions/chat','term',position,draw);
  vi.advanceTimersByTime(20);
  sources[0]!.frame('ready',{resumed:false});sources[0]!.frame('data','old','3');
  sources[0]!.frame('unavailable',{message:'Review worker disconnected'});
  leave();
  // The worker's relay recovers while the screen is between subscriptions.
  sources[0]!.frame('ready',{resumed:true});
  stream.subscribeTerminal('/sessions/chat','term',position,draw);
  vi.advanceTimersByTime(20);
  if(sources.length>1)sources.at(-1)!.frame('ready',{resumed:true});
  expect(connected,'same output offset bypassed the ready event that reenables input').toBe(true);
});
