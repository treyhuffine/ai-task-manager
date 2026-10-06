"""Generate the dated Markdown worklist from audit.json; no external mutations."""
import json
from pathlib import Path
p=Path(__file__).resolve().parent; a=json.loads((p/'audit.json').read_text()); s=a['summary']
parts=['# Connector implementation backlog\n', 'Generated from [audit.json](audit.json). Snapshot: September 28, 2026. These are research and implementation recommendations, not completed integrations. Checkboxes are intentionally open except no implementation work is inferred from this audit. Todoist code is already present and still needs live validation.\n', 'Relative effort: S is catalog/setup and verification, M includes auth or a typed adapter, L changes shared runtime behavior. Vendor review time is additional. P4 is a separate local-runtime track, not a claim of low product value.\n']
last=None
for t in a['backlog']:
 if last!=t['priority']:
  last=t['priority'];parts.append('\n## '+last+': '+s['priority_definitions'][last]+'\n')
 parts.append(f"- [ ] **{t['id']} · {t['item']}** ({t['lane']}, {t['effort']}). {t['change']}.\n  - Why: {t['rationale']}\n  - Next / acceptance: {t['next_step']}\n  - [Evidence]({t['evidence_url']}). Status: {t['status']}.\n")
parts.append('\n## Default route for the remaining directory\n\nEvery one of the 861 inventory rows includes a bucket, delivery type, priority, current-support match, evidence level and next step. The long tail is demand-led. Promote a row when a user workflow justifies it, then complete the eligibility and parity gates in [README.md](README.md). A published URL alone is not a ready-to-ship connector.\n')
(p/'BACKLOG.md').write_text('\n'.join(parts))
print('Backlog items',len(a['backlog']))
