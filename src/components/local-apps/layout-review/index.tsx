'use client';

import { useEffect, useId } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppsLayoutReview, layoutFromQuery, type AppsReviewProps } from '@/hooks/use-apps-layout-review';
import { AppLibrary } from '../app-library';
import { AppSettingsDialog } from '../app-settings-dialog';
import { LibraryChat } from '../library-chat';
import { libraryRoute } from '../library-model';
import { AppsReviewContext } from './context';
import { LAYOUT_OPTIONS, isLayoutChoice, type LayoutChoice, type LayoutId } from './options';
import { readReviewPreferences, updateReviewPreferences, useReviewPreferences } from './preferences';
import { REVIEW_LAYOUTS } from './registry';
import { LibraryPage } from './shared';
import { WithInspector } from './details';
import { SkillTry } from './live-surfaces';
import s from './review.module.css';

export function AppsLayoutReview(props: AppsReviewProps) {
  const chooserId = useId();
  const { query, navigate } = props;
  const preferences = useReviewPreferences();
  const choice = layoutFromQuery(props.query, preferences.layout);
  const option = LAYOUT_OPTIONS.find(option => option.id === choice);
  const position = LAYOUT_OPTIONS.findIndex(option => option.id === choice);
  const serializedQuery = new URLSearchParams(query).toString();
  useEffect(() => {
    const current = Object.fromEntries(new URLSearchParams(serializedQuery));
    if (isLayoutChoice(current.layout)) updateReviewPreferences(previous => previous.layout === current.layout ? previous : { ...previous, layout: current.layout as LayoutChoice });
    // Put a restored browser preference into this history entry before the
    // next selection. Back must recover the old layout, not today's preference.
    // Pairing consumes its fragment after mount. Do not replace that URL first.
    else if (!window.location.hash && !isLayoutChoice(new URLSearchParams(window.location.search).get('layout'))) navigate(libraryRoute(current, { layout: readReviewPreferences().layout }), { replace: true });
  }, [serializedQuery, navigate]);
  const choose = (layout: LayoutChoice) => {
    // A pairing fragment can defer normalization until this first interaction.
    if (!isLayoutChoice(query.layout)) navigate(libraryRoute(query, { layout: choice }), { replace: true });
    updateReviewPreferences(previous => ({ ...previous, layout }));
    props.navigate(libraryRoute(props.query, { layout, browse: undefined, item: undefined, panel: undefined, app: undefined, provider: undefined, mcp: undefined, collection: undefined, all: undefined }));
  };
  return <div className={s.review} data-apps-layout={choice}>
    <div className={s.chooser} aria-label="Apps layout review"><label htmlFor={chooserId} className={s.chooserLabel}>Apps layout</label><Button variant="ghost" size="icon-xs" aria-label="Previous Apps layout" onClick={() => choose(LAYOUT_OPTIONS[(position - 1 + LAYOUT_OPTIONS.length) % LAYOUT_OPTIONS.length].id)}><ChevronLeft size={14} /></Button>
      <select id={chooserId} value={choice} onChange={event => { if (isLayoutChoice(event.target.value)) choose(event.target.value); }}>{LAYOUT_OPTIONS.map((option, index) => <option value={option.id} key={option.id}>{index + 1}. {option.name}</option>)}<option value="original">Original Apps screen</option></select>
      <Button variant="ghost" size="icon-xs" aria-label="Next Apps layout" onClick={() => choose(LAYOUT_OPTIONS[(position + 1) % LAYOUT_OPTIONS.length].id)}><ChevronRight size={14} /></Button><span className={s.counter}>{position >= 0 ? `${position + 1} / ${LAYOUT_OPTIONS.length}` : 'Original'}</span><p className={s.chooserDescription}>{option?.description ?? 'The current Apps library, for comparison.'}</p>
    </div>
    {choice === 'original' || props.query.provider || props.query.mcp ? <AppLibrary {...props} /> : <ReviewScreen key={choice} {...props} layout={choice} />}
  </div>;
}
function ReviewScreen(props: AppsReviewProps & { layout: LayoutId }) {
  const review = useAppsLayoutReview(props, props.layout);
  const Layout = REVIEW_LAYOUTS[props.layout];
  return <AppsReviewContext.Provider value={review}>
    {review.failures.map(failure => <div className={s.error} role="alert" key={failure.name}>{failure.name} could not load. {failure.error?.message}<Button className="ml-2" size="xs" variant="outline" onClick={failure.retry}>Retry</Button></div>)}
    {review.loading && <p className={`${s.notice} flex items-center gap-2`} role="status"><Loader2 size={12} className="animate-spin" />Loading additions…</p>}
    {review.trySkill ? <SkillTry item={review.trySkill} /> : review.inLibrary ? <WithInspector><div className={s.frame}><LibraryPage /></div></WithInspector> : <Layout />}
    <LibraryChat item={review.chatItem} onClose={() => review.setChatItem(null)} onOpenChat={['home', 'chat'].includes(props.layout) ? () => {} : undefined} />
    {review.settingsInstance && review.data && <AppSettingsDialog instance={review.settingsInstance} data={review.data} open onOpenChange={open => { if (!open) review.closeSettings(); }} onRemoved={() => { review.closeSettings(); review.patch({ item: undefined, app: undefined }); }} />}
  </AppsReviewContext.Provider>;
}
