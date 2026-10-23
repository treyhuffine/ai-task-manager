'use client';

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import type { HomeContext } from '@/lib/home/context';
import { documentBindingMatches, readDocumentBinding, type DocumentBinding } from '@/lib/home/document-binding';
import { DOCUMENT_AUTHOR_CHANGED } from '@/lib/home/document-binding';
import { apiErrorCode } from '@/lib/api/client';
import { HomeErrorBoundary } from './home-error-boundary';

const Context = createContext<HomeContext | null>(null);

/** Document boundaries keep caches and drafts local to the authenticated Home. */
export function HomeBoundary({ children, expected }: { children?: ReactNode; expected?: DocumentBinding }) {
  const context = useQuery({ ...trpc.homeContext.queryOptions(), staleTime: 30_000, retry: false });
  const [bound, setBound] = useState<DocumentBinding | null>(() => readDocumentBinding() ?? expected ?? null);
  const [ready, setReady] = useState(() => typeof window === 'undefined' || !!readDocumentBinding());
  const homeId = context.data?.home.kind === 'team' ? context.data.home.id : null;
  const viewerId = homeId ? context.data!.viewer.id : null;
  useLayoutEffect(() => {
    if (!homeId || !viewerId) return;
    const declared = document.documentElement.dataset.riAuthority;
    if (declared && !['team', 'space'].includes(declared)) return;
    const identity = { homeId, viewerId };
    if (!documentBindingMatches(bound, identity) || !documentBindingMatches(expected ?? null, identity)) return;
    if (!documentBindingMatches(readDocumentBinding(), identity)) return;
    if (document.documentElement.dataset.riAuthority !== 'space') document.documentElement.dataset.riAuthority = 'team';
    document.documentElement.dataset.riHome = homeId;
    document.documentElement.dataset.riViewer = viewerId;
    document.documentElement.dataset.riBoundHome ??= homeId;
    document.documentElement.dataset.riBoundViewer ??= viewerId;
    if (ready) return;
    let active = true;
    // Establish HTTP/socket and draft identity before mounting any editor.
    queueMicrotask(() => { if (active) { setBound(identity); setReady(true); } });
    return () => { active = false; };
  }, [homeId, viewerId, bound, ready, expected]);
  if (apiErrorCode(context.error) === DOCUMENT_AUTHOR_CHANGED) return <HomeSignInChanged />;
  if (context.error && !context.data) return <div role="alert" className="p-6 text-sm">This Home could not be opened. <button className="underline" onClick={() => void context.refetch()}>Retry</button></div>;
  if (!context.data) return <div role="status" className="p-6 text-sm text-muted-foreground">Opening Home…</div>;
  const declared = typeof document === 'undefined' ? null : document.documentElement.dataset.riAuthority;
  if (declared && (context.data.home.kind === 'team' ? !['team', 'space'].includes(declared) : ['team', 'space'].includes(declared))) return <HomeSignInChanged />;
  if (homeId && viewerId && (!documentBindingMatches(bound ?? readDocumentBinding(), { homeId, viewerId }) || !documentBindingMatches(expected ?? null, { homeId, viewerId }))) return <HomeSignInChanged />;
  if (homeId && !ready) return <div role="status" className="p-6 text-sm text-muted-foreground">Opening Home…</div>;
  return <Context.Provider value={context.data}>{context.error && <div role="status" className="px-3 py-1 text-xs text-muted-foreground">Home updates are temporarily unavailable. <button className="underline" onClick={() => void context.refetch()}>Retry</button></div>}<HomeErrorBoundary key={`${context.data.home.id}:${context.data.viewer.id}`}>{children}</HomeErrorBoundary></Context.Provider>;
}

function HomeSignInChanged() {
  return <div role="alert" className="p-6 text-sm">This sign-in changed. Your drafts are kept for their original author. <button className="underline" onClick={() => window.location.reload()}>Reload Home</button></div>;
}

export function useHomeContext() {
  const value = useContext(Context);
  if (!value) throw new Error('A shared surface requires its authenticated Home context.');
  return value;
}

export function useOptionalHomeContext() {
  return useContext(Context);
}

/** Personal browser keys retain compatibility. Team keys always include the live author. */
export function useHomeStorageScope() {
  const value = useOptionalHomeContext();
  const documentScope = readDocumentBinding();
  const homeId = value ? value.home.kind === 'team' ? value.home.id : null : documentScope?.homeId;
  const viewerId = value ? value.home.kind === 'team' ? value.viewer.id : null : documentScope?.viewerId;
  return useMemo(() => homeId && viewerId ? { homeId, viewerId } : null, [homeId, viewerId]);
}

/** Chat drafts always identify both Home and author, including personal Homes. */
export function useHomeDocumentScope() {
  const value = useOptionalHomeContext();
  const binding = readDocumentBinding();
  const homeId = value?.home.id ?? binding?.homeId;
  const viewerId = value?.viewer.id ?? binding?.viewerId;
  return useMemo(() => homeId && viewerId ? { homeId, viewerId } : null, [homeId, viewerId]);
}
