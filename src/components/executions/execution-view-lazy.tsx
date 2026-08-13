'use client';

/**
 * DISABLED — `ExecutionView` is imported directly again. Kept as a record of
 * the experiment and what it would take to redo it.
 *
 * ## What this did
 *
 * `ExecutionView` pulls in xterm, CodeMirror, and the diff/merge machinery,
 * roughly 1.5MB, and both layouts render it conditionally:
 *
 *     {isExecutionView ? <ExecutionView … /> : <PanelLayout />}
 *
 * A static import gives the bundler no way to see that condition, so all of it
 * landed in the first-load chunk of every page. Routing the import through
 * `dynamic()` created a split point and moved it into its own chunk.
 *
 * The one effect that WAS confirmed: it collapsed a duplicated 1,707,753-byte
 * chunk that desktop and mobile had each been carrying their own copy of.
 *
 * Whether it removed the module from the initial load was never actually
 * established. Two measurement attempts both failed, in ways worth recording
 * because each looked convincing:
 *
 *   1. Grepping `.next/static/chunks` for "xterm" — inconclusive by
 *      construction. A lazily-fetched chunk contains the library too, so a hit
 *      cannot distinguish "eager" from "split".
 *   2. Reading `rootMainFiles` out of `.next/server/app/page/build-manifest.json`
 *      — vacuous. That key holds the Next runtime bootstrap, and the `pages`
 *      key on that manifest is EMPTY for App Router. It reported "no xterm" for
 *      the split build *and* for the static-import build, i.e. it was never
 *      measuring app code at all.
 *
 * The check that actually works reads the client reference manifest and
 * resolves the chunk URLs onto disk (strip the leading `/_next`):
 *
 *     const j = JSON.parse(
 *       fs.readFileSync('.next/server/app/page_client-reference-manifest.js', 'utf8')
 *         .match(/=\s*(\{[\s\S]*\})\s*;?\s*$/)[1]);
 *     const chunks = new Set(
 *       Object.values(j.clientModules).flatMap((v) => v.chunks ?? []));
 *     // then stat/read '.next' + chunk.replace(/^\/_next/, '')
 *
 * Baseline it produces for the current (static-import) build: 29 client chunks
 * for `/`, 6.01MB total, with xterm in a 1,709,428-byte chunk. Any future
 * attempt at this should move those numbers, and should be judged against them
 * rather than against a metric that cannot fail.
 *
 * ## Why it was turned off anyway
 *
 * The app is local-first. Over localhost, transfer is nearly free, and the
 * part that isn't free — parsing and evaluating 1.5MB of JavaScript — costs
 * the same whether it arrives at page load or on click. So the split did not
 * remove work, it relocated it.
 *
 * It relocated it to a worse moment. Page load is startup, which people
 * tolerate; opening an execution is an interaction, which has a much tighter
 * latency budget. Trading a slightly slower boot for a visible wait every time
 * you first click into work made the app *feel* slower, even though the
 * first-load number improved. The metric got better and the experience got
 * worse, so the metric lost.
 *
 * The remote-access argument for splitting is weaker than it looks, too: a
 * user coming through the tunnel still pays for the chunk when they open an
 * execution, over that same slow link. The cost moves rather than disappears
 * there as well.
 *
 * ## If this is revisited
 *
 * Don't just re-enable it — pair it with an idle prefetch, so the chunk is off
 * the boot path *and* already warm by the time anyone clicks:
 *
 *     useEffect(() => {
 *       const id = requestIdleCallback(() => { void import('./execution-view'); });
 *       return () => cancelIdleCallback(id);
 *     }, []);
 *
 * That keeps the win without the interaction cost, which is the only version
 * of this worth having for a local-first app.
 *
 * **And convert every call site.** There are three: `dashboard.tsx`,
 * `mobile/mobile-layout.tsx`, and `app/dev/execution-chat/page.tsx`. Leaving
 * even one on a static import re-anchors the module into a shared chunk and
 * the split silently does nothing — it still looks correct in review, and the
 * measurement above is the only way to catch it.
 */

// import dynamic from 'next/dynamic';
// import { ExecutionSkeleton } from './execution-skeleton';
//
// export const ExecutionView = dynamic(
//   () => import('./execution-view').then((m) => m.ExecutionView),
//   {
//     ssr: false,
//     loading: () => <ExecutionSkeleton horizontal={{}} vertical={{}} />,
//   },
// );

export {};
