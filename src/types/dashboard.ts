export type Theme = 'dark' | 'light';
export type WorkMode = 'light' | 'deep' | null;
export type ActiveView = 'command' | string; // 'command' or an agent id

export type PanelTab = 'deck' | 'chat' | 'tasks' | 'stream' | 'notes';
export type MorePanelTab = 'areas' | 'people' | 'decisions' | 'calendar';
export type AnyPanelTab = PanelTab | MorePanelTab;
export type PanelId = 'a' | 'b';

/** Mobile bottom tab bar navigation */
export type MobileTab = 'chat' | 'agents' | 'create' | 'deck' | 'more';

export interface Agent {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'paused';
  task: string | null;
  color: string;
  bg: string;
  progress: number;
  icon: string;
  lastUpdate: string | null;
}

export interface Task {
  id: number;
  text: string;
  project: string;
  due: string | null;
  status: 'ready' | 'waiting' | 'todo' | 'done';
  color: string;
}

export interface StreamEvent {
  text: string;
  time: string;
  color: string;
}

// ─── Deck & Check-in Types ────────────────────────────────────

export type CheckInStatus = 'needs_check_in' | 'checked_in' | 'needs_refresh';
export type CheckInBeat = 'intake' | 'triage' | 'deck';

export interface ContextChip {
  id: string;
  label: string;
  selected: boolean;
}

/** AI recommendation for an unsorted stream item during triage */
export type TriageAction = 'promoteTask' | 'promoteNote' | 'appendNote' | 'boomerang' | 'dismiss';
export type PlacementZone = 'top' | 'mid' | 'low' | 'backlog';

export interface TriageRecommendation {
  action: TriageAction;
  summary: string;          // e.g. "Task, mid-priority" or "Append to 'Onboarding UX' note"
  area?: string;
  energy?: 'deep' | 'light';
  effort?: string;
  placement?: PlacementZone; // Where in the working set (for promoteTask)
  rationale?: string;
}

export interface TriageItem {
  id: string;
  rawText: string;
  createdAt: string;
  recommendation: TriageRecommendation;
  resolved: boolean;        // user accepted/dismissed
}

/** A subtask within a deep work item */
export interface SubtaskItem {
  id: string;
  title: string;
  effort?: string;
  completed: boolean;
}

/** A single item in the deck's priority stack */
export interface DeckItem {
  id: string;
  title: string;
  parentTitle?: string;       // Parent task / project name
  areaId?: string;            // Area UUID for filtering
  areaName?: string;
  rationale: string;          // Why this task, why this position
  energy?: 'deep' | 'light'; // Metadata, not structural
  effort?: string;            // XS/S/M/L/XL
  estimatedMinutes?: number;
  hardDeadline?: string;      // ISO date
  taskId: string;
  subtasks?: SubtaskItem[];
  continuityContext?: string; // "Last session: got OAuth working"
  manuallyAdded?: boolean;    // True when user added via quick-add
  slotStart?: string;         // Time-of-day label, e.g. "9:00 AM" (calendar slotting)
  slotEnd?: string;           // e.g. "10:30 AM"
  slotReason?: string;        // Why this slot
}

/** An item the AI surfaced on radar */
export interface RadarItem {
  id: string;
  title: string;
  areaName?: string;
  reason: string;             // Why it's on radar ("Not touched in 2 weeks")
  taskId?: string;            // If it maps to an existing task
}

/** A recurring task due today */
export interface RoutineItem {
  id: string;
  title: string;
  completedCount: number;     // e.g. 3
  targetCount: number;        // e.g. 4
  period: string;             // e.g. "this week"
  streak?: number;
  taskId: string;
}

/** A task the AI considered but didn't include in the deck */
export interface AlternativeItem {
  id: string;
  title: string;
  parentTitle?: string;
  areaId?: string;            // Area UUID for filtering
  areaName?: string;
  energy?: 'deep' | 'light';
  effort?: string;
  reason: string;             // Why it wasn't included
  taskId: string;
}

// ─── Legacy deck types (used by plan-review / plan-deep-work / plan-light-tasks) ──

/** A deep-work item in the legacy split-deck format */
export interface DeepWorkItem {
  id: string;
  projectTitle: string;
  taskTitle: string;
  areaName?: string;
  continuityContext: string;
  rationale: string;
  energy: 'deep' | 'light';
  effort?: string;
  estimatedMinutes?: number;
  hardDeadline?: string;
  taskId: string;
  sortPosition?: number;
  subtasks?: SubtaskItem[];
}

/** A light task in the legacy split-deck format */
export interface LightTaskItem {
  id: string;
  title: string;
  areaName?: string;
  energy: 'deep' | 'light';
  effort?: string;
  estimatedMinutes?: number;
  hardDeadline?: string;
  isNew?: boolean;
  taskId: string;
  sortPosition?: number;
}

/** Deck metadata in the legacy format */
export interface DeckMeta {
  workingSetSize: number;
}

/**
 * A resolved entry from a deck version's change log — what happened to a task
 * when the deck was (re)dealt. Drives the "what changed" brief and the bumped
 * lane. `deferred`/`dropped` items show in the bumped lane (restorable);
 * `carried`/`added` summarize in the brief.
 */
export interface DeckChangeView {
  kind: 'carried' | 'deferred' | 'dropped' | 'added' | 'reordered' | 'bumped';
  taskId: string;
  title: string;
  areaName?: string;
  reason: string;
  /** How the change-router surfaced it: absent/digest = brief, interrupt = banner. */
  channel?: 'absorb' | 'digest' | 'interrupt';
  /** Where the change came from — 'calendar' changes are mid-day adaptations. */
  source?: 'reconcile' | 'calendar' | 'user';
}

/** The full deck output from the AI */
export interface DeckPlan {
  deckId?: string;              // Persisted deck ID (for PATCH updates)
  forDate?: string;             // Local day this deck is for (YYYY-MM-DD)
  framing?: string;             // One-line day framing. Absent if nothing notable.
  items: DeckItem[];            // Ranked priority stack — THE deck
  alternatives: AlternativeItem[]; // Tasks AI considered but ranked lower
  changes?: DeckChangeView[];   // What changed when this version was dealt
  radarItems?: RadarItem[];     // Radar items to surface in "more options"
  generatedAt: string;          // ISO timestamp

  // Legacy split-deck properties (used by plan-review variants)
  deepWork?: DeepWorkItem[];
  lightTasks?: LightTaskItem[];
  meta?: DeckMeta;
  summary?: string;
  routines?: RoutineItem[];
  worthNoting?: string;
}
