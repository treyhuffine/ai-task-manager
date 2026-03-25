export type Theme = 'dark' | 'light';
export type WorkMode = 'light' | 'deep' | null;
export type ActiveView = 'command' | string; // 'command' or an agent id

export type PanelTab = 'deck' | 'chat' | 'tasks' | 'stream' | 'notes';
export type MorePanelTab = 'people' | 'decisions' | 'calendar' | 'integrations' | 'settings';
export type AnyPanelTab = PanelTab | MorePanelTab;
export type PanelId = 'a' | 'b';

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
