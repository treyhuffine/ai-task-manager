/** Client-safe two-axis snapshot for one chat session. */
export interface SessionRuntimeStatus {
  running: boolean;
  backgroundTasks: boolean;
  /** Exact live task ids from the server's in-memory runtime index. */
  backgroundTaskIds: string[];
}

/** Whether any provider work still owns this session's data surface. */
export function hasRuntimeActivity(status: SessionRuntimeStatus | undefined): boolean {
  return status?.running === true || status?.backgroundTasks === true;
}

/** Replace root-turn state without losing detached background work. */
export function withRunningStatus(
  previous: SessionRuntimeStatus | undefined,
  running: boolean,
): SessionRuntimeStatus {
  return {
    running,
    backgroundTasks: previous?.backgroundTasks ?? false,
    backgroundTaskIds: previous?.backgroundTaskIds ?? [],
  };
}

/** Replace background-task state without losing the root-turn state. */
export function withBackgroundTaskStatus(
  previous: SessionRuntimeStatus | undefined,
  backgroundTasks: boolean,
  backgroundTaskIds: string[],
): SessionRuntimeStatus {
  return {
    running: previous?.running ?? false,
    backgroundTasks,
    backgroundTaskIds: backgroundTasks ? backgroundTaskIds : [],
  };
}
