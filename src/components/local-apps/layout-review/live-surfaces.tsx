'use client';

import { useState } from 'react';
import { BookOpen, MessageCircle } from 'lucide-react';
import { HarnessChat, HarnessChatSession } from '@/components/chat/harness-chat';
import { appMainChatIntro } from '@/components/chat/main-chat-intro';
import { DeckContainer } from '@/components/deck/deck-container';
import { MainChatHistoryMenu } from '@/components/chat/main-chat-history-menu';
import { useSkillChat } from '@/components/skills/use-skill-chat';
import { ConnectedAppPage } from '@/components/mcp-apps/page';
import { Button } from '@/components/ui/button';
import { AppPage } from '../app-page';
import { useReview } from './context';
import { Empty } from './shared';
import type { ReviewItem } from './catalog';
import s from './review.module.css';

export function LiveChat() {
  return <section className={s.chatSurface} aria-label="Ri chat"><div className={s.paneHeading}><MessageCircle size={13} />Ri chat<span className="flex-1" /><MainChatHistoryMenu scope={null} /></div><HarnessChat autoFocusComposer={false} intro={appMainChatIntro()} /></section>;
}
export function Today() {
  return <div className={s.deck} aria-label="Your daily deck"><DeckContainer /></div>;
}
export function SkillTry({ item }: { item: ReviewItem }) {
  const review = useReview();
  return <div className={s.frame}><div className={s.header}><BookOpen size={16} /><div className={s.headerCopy}><h1>Try {item.name}</h1><p>A real chat with this skill available.</p></div><Button size="xs" variant="outline" onClick={() => review.setTrySkill(null)}>Back to Apps</Button></div>{item.target.kind === 'skill' && <SkillTryChat skillRef={item.target.ref} />}</div>;
}
function SkillTryChat({ skillRef }: { skillRef: string }) {
  const chat = useSkillChat(skillRef, 'try');
  if (chat.error) return <Empty>{chat.error.message}<Button size="xs" onClick={() => void chat.refetch()}>Retry</Button></Empty>;
  return chat.sessionId ? <HarnessChatSession sessionId={chat.sessionId} autoFocusComposer={false} /> : <p role="status" className={s.notice}>Opening skill chat…</p>;
}

/** Use the existing app hosts and their permission boundaries, never a recreated app UI. */
export function LiveApp({ item }: { item: ReviewItem }) {
  const review = useReview();
  const [location, setLocation] = useState({ path: '/', query: {} as Record<string, string> });
  const navigate = (route: string) => {
    if (!route) { review.patch({ app: undefined }); return; }
    const target = item.target;
    const url = new URL(route, 'https://app.invalid/');
    if (target.kind === 'app' && (url.pathname === `/${target.slug}` || url.pathname.startsWith(`/${target.slug}/`))) {
      setLocation({ path: url.pathname.slice(target.slug.length + 1) || '/', query: Object.fromEntries(url.searchParams) });
    } else review.navigate(route);
  };
  if (item.connectedAppId) return <div className={s.livePane}><ConnectedAppPage serverId={item.connectedAppId} navigate={navigate} /></div>;
  const target = item.target;
  if (target.kind === 'app' && !review.localEnabled) return <Empty>Local apps are disabled for this Home. Your connections and skills are still available.</Empty>;
  const instance = target.kind === 'app' ? review.data?.instances.find(instance => instance.id === target.id) : undefined;
  if (!instance || !review.data) return <Empty>Choose an installed app to open it here.</Empty>;
  return <div className={s.livePane}><AppPage instance={instance} data={review.data} path={location.path} query={location.query} navigate={navigate} /></div>;
}
