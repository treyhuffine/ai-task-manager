'use client';

import type { McpCapabilityChanges, McpCapabilityField } from '@/lib/integrations/mcp-capabilities';
import { Button } from '@/components/ui/button';

const FIELD_LABELS: Record<McpCapabilityField, string> = {
  title: 'title', description: 'description', inputSchema: 'inputs', outputSchema: 'outputs', annotations: 'permissions and behavior',
  _meta: 'interactive views and visibility',
};
export function CapabilityReview({ changes, busy, onReview }: { changes?: McpCapabilityChanges; busy: boolean; onReview?: (revision: string) => void }) {
  if (!changes) return null;
  return <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
    <p className="font-medium">Tools changed since your last review</p>
    <ul className="space-y-1 text-muted-foreground">
      {changes.added.map(name => <li key={`added-${name}`}>Added <code>{name}</code></li>)}
      {changes.removed.map(name => <li key={`removed-${name}`}>Removed <code>{name}</code></li>)}
      {changes.changed.map(tool => <li key={`changed-${tool.name}`}>Changed <code>{tool.name}</code>: {tool.fields.map(field => FIELD_LABELS[field]).join(', ')}</li>)}
    </ul>
    <p className="text-muted-foreground">Review tool access and approval settings below. Marking these changes reviewed does not change permissions.</p>
    {onReview && <Button size="xs" variant="outline" disabled={busy} onClick={() => onReview(changes.revision)}>Mark reviewed</Button>}
  </section>;
}
