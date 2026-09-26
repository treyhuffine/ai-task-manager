/**
 * The home's history requests, answered from this computer's own native
 * files (docs/homes-build.md, P2.9). `list_history` gives what a person
 * needs to choose a session and nothing of its content. `read_history`
 * gives one window of a session the home names, which it asks for only
 * once a person has chosen it.
 *
 * A read is of the session's transcript as it was listed: a plain file, in
 * the real folder it was discovered in (`FileCandidate.realDir`). Listing
 * never descends into links, and a read refuses one, so replacing a listed
 * transcript, or a folder above it, with a link doesn't send the home a file
 * nobody chose (P2.7 to P2.9 review fixes).
 */

import {
  discoverCandidatesInternal,
  listedSession,
  readHistoryWindow,
  type HistoryListing,
  type HistoryPrefix,
  type HistoryWindow,
  type InternalCandidate,
} from '@/lib/import/history-source';

export interface ReadHistoryRequest {
  key: string;
  fromOffset: number;
  expect: HistoryPrefix | null;
  maxBytes: number;
}

/** The largest window the home may ask for, whatever it asks. */
const MAX_WINDOW_BYTES = 8 * 1024 * 1024;
/** How long a listing stands in for reads, so windows of one import don't rescan every harness. */
const LISTING_FRESH_MS = 60_000;

let listing: { at: number; byKey: Map<string, InternalCandidate> } | null = null;

async function discover(): Promise<{ byKey: Map<string, InternalCandidate>; available: HistoryListing['available'] }> {
  const { candidates, available } = await discoverCandidatesInternal();
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  listing = { at: Date.now(), byKey };
  return { byKey, available };
}

export async function listHistory(): Promise<HistoryListing> {
  const { byKey, available } = await discover();
  return { sessions: [...byKey.values()].map(listedSession), available };
}

export async function readHistory(request: ReadHistoryRequest): Promise<HistoryWindow> {
  let candidate = listing && Date.now() - listing.at < LISTING_FRESH_MS ? listing.byKey.get(request.key) : undefined;
  if (!candidate) candidate = (await discover()).byKey.get(request.key);
  if (!candidate) throw new Error('That session is no longer on this computer.');
  if (candidate.kind !== 'file') {
    throw new Error("This harness serves its history from a running process, which can't be read from here yet.");
  }
  return readHistoryWindow(candidate, {
    fromOffset: Math.max(0, Math.floor(request.fromOffset)),
    expect: request.expect,
    maxBytes: Math.min(Math.max(64 * 1024, request.maxBytes), MAX_WINDOW_BYTES),
  });
}

/** Test seam. */
export function _resetHistoryListing(): void {
  listing = null;
}
