/**
 * A schedule's builder chat, the content chat beside the schedule editor in
 * the Schedules window: its surface kind, and the ref of the one that sets up
 * a new schedule. Client-safe constants, shared by the window, the
 * document-chat operation and `create_trigger` (which moves the new-schedule
 * chat onto the schedule it creates). The brief is ./builder-brief.ts.
 */

/** `chat_sessions.surface_kind` of a schedule's builder chat. Its ref is the schedule's id. */
export const SCHEDULE_CHAT_SURFACE = 'trigger';

/** The ref of the builder chat for a schedule that doesn't exist yet. */
export const NEW_SCHEDULE_REF = 'new';
