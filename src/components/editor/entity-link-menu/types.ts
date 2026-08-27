export interface EntityLinkItem {
  kind: 'task' | 'note';
  id: string;
  title: string;
  status?: string;
}
