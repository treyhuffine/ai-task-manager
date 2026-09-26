/**
 * An imported chat mirrors a transcript some other process owns, until the
 * user takes it over ("Continue here", `takeOverImportedSession`). It has no
 * provider session to resume, so a send would start a fresh agent with none
 * of the context the chat shows. Every sender refuses one: the composer, the
 * messages route, the orchestrator's send_session_message, dispatch itself,
 * and the health re-fire.
 *
 * Pure and dependency-free: imported by client components.
 */

export function isImportMirror(session: { surfaceKind: string | null; externalSessionId: string | null }): boolean {
  return session.surfaceKind === 'imported_agent' && !session.externalSessionId;
}

export const IMPORT_MIRROR_REFUSAL =
  'This chat mirrors a session imported from a terminal, so it can only be read here. ' +
  'Continue here takes it over first, where that is offered, or continue it in the terminal it came from.';
