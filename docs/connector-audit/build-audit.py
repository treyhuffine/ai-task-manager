"""Join the dated directory snapshot, code inventory and editorial research.
No network, live accounts or upstream tools are accessed. Run from any directory.
"""
import collections
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
load = lambda name: json.loads((ROOT / name).read_text())
facts = load('directory-facts.json')
manifest = load('capture-manifest.json')
local = load('local-buckets.json')
current = load('current-connectors.json')
new = load('new-connector-evidence.json')
migration_data = load('migration-evidence.json')
migrations = migration_data if isinstance(migration_data, list) else migration_data['providers']
providers = {p['id']:p for p in current['providers']}
supplemental = [m for m in migrations if m['provider_id'] not in providers]
migrations = [m for m in migrations if m['provider_id'] in providers]
assert len(migrations)==len(providers)==29

# Exclusive editorial buckets for work planning. Original multi-label tags remain intact.
overrides = {}
def bucket(names, label):
 for name in names.split(): overrides[name] = label
bucket('todoist linear atlassian asana clickup trello monday ticktick wrike smartsheet meistertask fibery productive-io zoho-projects craft-io productised process-street astravue rally-mcp basecamp height teamwork', 'Tasks/projects')
bucket('google-drive notion box dropbox readwise raindrop craft mem roam-research goodnotes superhuman-docs guru glean confluence pdf-viewer pdf-net llamaParse llamaparse docusign docuseal files-com egnyte netdocuments imanage unstructured-transform xtiles xTiles', 'Notes/documents/knowledge')
bucket('gmail google-calendar microsoft-365 slack granola fireflies fathom otter-ai read-ai tldv tactiq fellow-ai circleback krisp grain calendly zoom-for-claude fastmail superhuman-mail fyxer reclaim-ai webex-meetings ringcentral-chat livestorM livestream livestreams resend mailgun whatsapp telegram discord', 'Communication/calendar')
bucket('context7 microsoft-learn mdn stack-overflow supabase sentry vercel cloudflare netlify datadog postman hugging-face replit railway aws-mcp render google-compute-engine neon expo circleci v0 clerk workos gitlab sourcegraph mintlify jam incident-io pagerduty honeycomb coralogix planetscale quicknode sprites vuetify-mcp', 'Developer tools/operations')
bucket('zapier make n8n workato tines ifttt tray-ai celigo mulesoft natoma pipedream codewords', 'Automation/platform')
bucket('canva figma miro lucid gamma adobe-creativity excalidraw-app-demo tldraw whimsical eraser mermaid-chart', 'Design/media')
bucket('airtable exa tavily firecrawl bigquery snowflake databricks metabase hex sigma dbt clickhouse posthog mixpanel amplitude', 'Data/analytics')
bucket('hubspot salesforce-headless-360 intercom zendesk pylon attio pipedrive-mcp zoho-crm freshservice front', 'Sales/marketing/support')
bucket('stripe plaid quickbooks paypal xero freshbooks zoho-books ramp ramp-data mercury brex', 'Finance/accounting')
bucket('booking expedia glovo instacart kiwi-com lastminute-com otto-travel resy stubhub tripadvisor turkish-airlines uber uber-eats viator wyndham-hotels cargoai fever-event-discovery cash-app taskrabbit thumbtack', 'Commerce/travel/local')
bucket('coursera oreilly udemy-business planning-center', 'Education/nonprofit')
bucket('drata malwarebytes mcafee norton sprinto-mcp-plugins ketryx', 'Legal/security/compliance')
bucket('adobe-workfront bonsai planday', 'Tasks/projects')
bucket('constant-contact intuit-mailchimp gainsight-cs gainsight-staircase-ai lusha nooks seismic similarweb sybill tiktok-for-business clarify dovetail harmonic letsbot listen-labs lorikeet risotto surveymonkey unthread', 'Sales/marketing/support')
bucket('pandadoc signeasy grtwo-docs lumin lz-virtual-mail twinmind-app', 'Notes/documents/knowledge')
bucket('slidesgpt audible idiolect lilt magic-patterns melon play-sheet-music spotify vani', 'Design/media')
bucket('ashby brighthire dice indeed isolved lattice manatal metaview remote-com shapes snagajob teamtailor workable ziprecruiter', 'People/hiring')
bucket('adobe-experience-manager aws-marketplace godaddy wix wordpress-com', 'Developer tools/operations')
bucket('appfolio-realm-x entendre freee links-connect metal razorpay tropic', 'Finance/accounting')
bucket('cognito-forms flourish-studio govtribe zite', 'Data/analytics')
bucket('plaud spinach-ai vibe-ai', 'Communication/calendar')
bucket('playmcp within', 'Automation/platform')
category_buckets = [
 ('legal','Legal/security/compliance'), ('health-life-sciences','Health/science'),
 ('healthcare','Health/science'), ('consumer-health','Health/science'),
 ('financial-services','Finance/accounting'), ('travel','Commerce/travel/local'),
 ('commerce-shopping','Commerce/travel/local'), ('education','Education/nonprofit'),
 ('nonprofit','Education/nonprofit'), ('sales-and-marketing','Sales/marketing/support'),
 ('creative','Design/media'), ('media-entertainment','Design/media'),
 ('communication','Communication/calendar'), ('developer-tools','Developer tools/operations'),
 ('data-analytics','Data/analytics'), ('productivity','Work productivity/general'),
 ('other','Other/specialist'),
]

def classify(row):
 if row['slug'] in local: return local[row['slug']]['bucket'], 'Editorial inference from listing metadata (no official category)'
 if row['slug'] in overrides: return overrides[row['slug']], 'Editorial product grouping'
 for cat, label in category_buckets:
  if cat in row['directory_categories']: return label, 'Editorial mapping of official category: '+cat
 return 'Other/specialist', 'Unclassified metadata fallback'

def delivery(row):
 if row['directory_type']=='local': return 'Local MCP extension', 'Requires local runtime / package review'
 if not row['server_url']: return 'Remote MCP, endpoint not listed', 'Discover vendor or tenant-specific endpoint'
 if (urlparse(row['server_url']).hostname or '').endswith('.mcp.claude.com'): return 'Anthropic-hosted remote MCP', 'Portability not established by listing'
 return 'External remote MCP URL published', 'Auth and client eligibility unverified'

priority_map = {
 'todoist':'P0','linear':'P1','notion':'P1','resend':'P1','asana':'P2','readwise':'P1',
 'jira':'P2','confluence':'P2','raindrop':'P2','airtable':'P2','hubspot':'P2',
 'gitlab':'P2','slack':'P2','google':'P2','microsoft':'P2','calendly':'P1','zoom':'P2',
 'dropbox':'P2','box':'P2','salesforce':'P2','zendesk':'P2','stripe':'P3',
 'plaid':'P3','quickbooks':'P3','twitter':'P3','mailgun':'P3','telegram':'P3',
 'whatsapp':'P3','discord':'P3',
}
recommendations = {
 'conditional_migration':'Migrate after auth, access and parity prerequisites',
 'prioritize_migration_validation':'Prioritize migration validation',
 'retain_native_adapter':'Keep native adapter',
 'validate_auth_then_migrate':'Validate auth, then migrate',
 'retain_hosted_mcp':'Hosted MCP implemented, validate live connection',
 'retain_native_adapter_add_optional_developer_mcp':'Keep native bank data, optional developer MCP separately',
 'retain_native_until_verified':'Keep native pending vendor verification',
 'retain_native_until_onboarded':'Keep native until partner onboarding',
 'retain_native_or_add_local_mcp_support':'Keep native, local MCP is a separate option',
}
for m in migrations: m['recommendation'] = recommendations.get(m['recommendation'],m['recommendation'])
for m in supplemental:
 new.append(dict(slug=m['directory_slugs'][0],name='PayPal',priority='P3',bucket='Finance/accounting',
  auth=m['auth_mode'],client_access=m['client_access'],rationale='Supplemental payment-platform candidate. Prioritize only with a concrete user workflow.',
  blocker='Public-client registration and required transaction permissions need validation.',next_step=m['next_step'],source_urls=m['source_urls'],
  recommended_endpoint=' | '.join(m['endpoint']),effort='M',change='Investigate supplemental payment connector',evidence_level='Vendor documentation reviewed; not live-tested'))
for n in new:
 if n['change']=='Add hosted MCP': n['change']='Validate and add hosted MCP'
by_slug = collections.defaultdict(list)
for m in migrations:
 for slug in m.get('directory_slugs',[]): by_slug[slug].append(m)
new_by_slug = {x['slug']: x for x in new}

rows=[]
for raw in facts:
 r = dict(raw)
 r['bucket'],r['bucket_source']=classify(r)
 r['external_mcp'],r['blocker']=delivery(r)
 r.update(priority='P3', recommendation='Demand-led evaluation', product_fit='Specialist / demand-led',
          auth='Not verified', validation='Directory metadata only; no authenticated testing',
          evidence_level='Directory metadata only',current_support='Not in built-in catalog',
          current_provider_ids=[],rationale='Evaluate when user demand matches this product category.',
          next_step='Review publisher documentation, ownership, client eligibility, costs and tool coverage before adding.',
          vendor_evidence_url='',vendor_evidence_urls=[])
 if r['directory_type']=='local':
  r.update(priority='P4',recommendation='Local-runtime backlog',next_step='Review package provenance, OS/runtime requirements and overlap with existing local capabilities. Requires a local MCP lifecycle before catalog addition.')
 if r['external_mcp']=='Anthropic-hosted remote MCP':
  r.update(recommendation='Find independent upstream alternative', next_step='Verify an independently accessible upstream MCP or build a native API integration. Do not reuse a Claude-specific endpoint without eligibility evidence.')
 ms=by_slug.get(r['slug'],[])
 if ms:
  r.update(priority=min(priority_map[m['provider_id']] for m in ms),current_provider_ids=[m['provider_id'] for m in ms],
           current_support='; '.join(providers[m['provider_id']]['displayName']+': '+('hosted MCP implemented' if m['provider_id']=='todoist' else 'native tools') for m in ms),
           product_fit='Existing product coverage',evidence_level='Code and vendor documentation reviewed',
           recommendation=' / '.join(m['recommendation'] for m in ms),auth=' / '.join(m['auth_mode'] for m in ms),
           blocker=' / '.join(m['client_access'] for m in ms),validation='Documentation reviewed; live consent and parity not tested',
           rationale='Preserve existing app behavior while reducing native wrapper maintenance.',
           next_step=' / '.join(m['next_step'] for m in ms))
  sources=list(dict.fromkeys(u for m in ms for u in m['source_urls']))
  r.update(vendor_evidence_urls=sources,vendor_evidence_url=sources[0] if sources else '',
           recommended_endpoints=list(dict.fromkeys(u for m in ms for u in m['endpoint'])))
 if r['slug'] in new_by_slug:
  n=new_by_slug[r['slug']]
  r.update(priority=n['priority'],bucket=n['bucket'],bucket_source='Editorial product grouping',
           recommendation=n['change'],product_fit='High' if n['priority']=='P1' else 'Adjacent / cohort-specific',
           auth=n['auth'],blocker=n['blocker'],validation=n['client_access']+'; not live-tested',
           evidence_level=n['evidence_level'],rationale=n['rationale'],next_step=n['next_step'],
           vendor_evidence_url=n['source_urls'][0],vendor_evidence_urls=n['source_urls'],
           recommended_endpoint=n['recommended_endpoint'] or r['server_url'])
 rows.append(r)

# Directory-only candidates remain research tasks, not claims of implementation readiness.
research = {
 'ticktick': ('P2','Tasks/projects','Personal task coverage adjacent to Todoist.','Verify official endpoint/client access and assignment, dates, recurring tasks and completion.'),
 'reclaim-ai': ('P2','Communication/calendar','Scheduling could close the loop between tasks and available time.','Verify plans and scheduling controls; compare against our calendar/deck model.'),
 'craft': ('P2','Notes/documents/knowledge','Bring personal documents and structured notes into agent context.','Verify OAuth/custom-client support and document write scope.'),
 'mem': ('P2','Notes/documents/knowledge','A relevant knowledge source for a notes-centric product.','Verify search, fetch, writes and account availability.'),
 'roam-research': ('P2','Notes/documents/knowledge','Graph notes can enrich task context for existing Roam users.','Verify workspace endpoint, auth and block/page write semantics.'),
 'fastmail': ('P2','Communication/calendar','Add a non-Google, non-Microsoft mailbox option.','Verify OAuth/client registration and mail versus calendar tool coverage.'),
 'fathom': ('P2','Communication/calendar','Additional meeting-to-task input.','Compare transcript/summary availability and onboarding with Granola.'),
 'otter-ai': ('P2','Communication/calendar','Additional meeting-to-task input.','Confirm custom-client eligibility, plans and transcript permissions.'),
 'read-ai': ('P2','Communication/calendar','Meeting and work context for task creation.','Confirm generic MCP access and meeting retrieval coverage.'),
 'wrike': ('P2','Tasks/projects','Team project management coverage.','Validate assignment, status, folder/project movement and OAuth.'),
 'smartsheet': ('P2','Tasks/projects','Project tracking for larger teams.','Resolve tenant endpoint and verify row/project permission semantics.'),
 'fibery': ('P2','Tasks/projects','Connect product plans and knowledge to work.','Verify tenant setup, entity types and safe write policies.'),
 'microsoft-learn': ('P2','Developer tools/operations','Official technical knowledge for execution agents.','Verify no-auth support and overlap with Context7 before adding.'),
 'read-and-write-apple-notes': ('P4','Notes/documents/knowledge','Local notes are a good fit for a local-first app.','Review AppleScript/package permissions, macOS support and local MCP lifecycle.'),
 'things-applescript': ('P4','Tasks/projects','Local personal task coverage.','Review third-party package provenance, macOS runtime and task import contract.'),
 'fantastical': ('P4','Communication/calendar','Local calendar context and scheduling.','Verify OS/app dependencies and contract with existing calendar/deck behavior.'),
}
for r in rows:
 if r['slug'] in research:
  pri,bkt,why,step=research[r['slug']]
  r.update(priority=pri,bucket=bkt,bucket_source='Editorial product grouping',product_fit='Promising; eligibility unverified',recommendation='Investigate' if pri=='P2' else 'Investigate local integration',rationale=why,next_step=step)

backlog=[]
def task(key,priority,item,change,bkt,rationale,effort,next_step,evidence_url,**extra):
 backlog.append(dict(id=key,priority=priority,item=item,change=change,bucket=bkt,rationale=rationale,effort=effort,next_step=next_step,evidence_url=evidence_url,**{'status':'Not started',**extra}))
platform=[
 ('F01','P0','Native OAuth migration identity','Fix migration path','Existing OAuth authConfigId is incompatible with the ingested bearer strategy. Clearing it blindly would break saved scope pins.','M','Separate MCP transport credentials from account/client identity. Verify pinned scopes and rollback for an existing OAuth connection.'),
 ('F02','P0','Task/calendar contract adapters','Preserve product contracts','Agent tool discovery does not preserve deterministic task picker or calendar/deck behavior.','M','Typed adapters and parity checks for output fields, pagination, recurrence, time zones and source links.'),
 ('F03','P0','Stable action names and approvals','Preserve policy contracts','Renamed, bulk and newly introduced tools can invalidate saved policies and learned action names.','M','Alias or migrate old IDs; preserve stricter overrides and test sends, bulk writes, retry/partial failures.'),
 ('F04','P1','Registered-client OAuth and auth profiles','Extend catalog setup','Many vendors require our own registered OAuth app. Built-in hosted setup currently assumes public OAuth discovery.','M-L','Declare auth profiles and securely configure client ID/secret without embedding confidential secrets in public distributed clients.'),
 ('F05','P1','Named bearer / no-auth connectors','Extend catalog setup','Generic custom MCP has these modes, but named built-in hosted onboarding requires OAuth.','S-M','Add trusted per-provider modes, encrypted keys where needed and matching setup UI.'),
 ('F06','P1','Multiple accounts and multiple toolkits','Extend runtime routing','Google has five toolkits, Microsoft two. Connections must retain account and scope identity.','L','Dispatch through ctx.connection; discover user/tenant identity and preserve all existing account pins.'),
 ('F07','P2','Tenant/region endpoint configuration','Extend trusted endpoint policy','n8n, Intercom and enterprise SaaS cannot all use one fixed URL.','M','Validate provider-owned hosts or explicitly approved self-hosted URLs; preserve tenant identity and annotation trust.'),
 ('F08','P2','Remote tool-change monitoring','Operate shared connector platform','Upstream tool schemas can change independently of our releases.','M','Record capability snapshots, flag changes and provide health/reconnect diagnostics and per-tool controls.'),
 ('F09','P4','Local MCP packages / stdio','Add local runtime lifecycle','132 Claude entries are local extensions, outside our hosted Streamable HTTP ingestion.','L','Review install/runtime metadata, secret environment, process supervision and platform support before adding local packages.'),
]
for key,pri,name,change,why,effort,step in platform: task(key,pri,name,change,'Automation/platform',why,effort,step,'local-analysis.md',lane='Platform')
for m in migrations:
 p=providers[m['provider_id']]
 matched=[r for r in rows if m['provider_id'] in r['current_provider_ids']]
 bkt='Notes/documents/knowledge' if p['id']=='confluence' else matched[0]['bucket'] if matched else {'twitter':'Sales/marketing/support','mailgun':'Communication/calendar','telegram':'Communication/calendar','whatsapp':'Communication/calendar','discord':'Communication/calendar','gitlab':'Developer tools/operations','zendesk':'Sales/marketing/support','raindrop':'Notes/documents/knowledge'}.get(p['id'],'Work productivity/general')
 task('M-'+p['id'],priority_map[p['id']],p['displayName'],m['recommendation'],bkt,
      ('Preserve five compatibility aliases and the typed task-picker contract. ' if p['id']=='todoist' else 'Preserve '+str(p['staticNativeActionCount'])+' native actions. ')+(' '.join(m['parity_gaps']) if isinstance(m['parity_gaps'],list) else m['parity_gaps']),
      'M-L' if p['id'] in ['google','microsoft','twitter','salesforce'] else 'S-M plus prerequisites',m['next_step'],m['source_urls'][0] if m['source_urls'] else 'local-analysis.md',lane='Existing connector',provider_id=p['id'],directory_slugs=m.get('directory_slugs',[]),evidence_urls=m['source_urls'],status='Implemented; live validation pending' if p['id']=='todoist' else 'Not started')
for n in new:
 task('N-'+n['slug'],n['priority'],n['name'],n['change'],n['bucket'],n['rationale'],n['effort'],n['next_step']+' '+n['blocker'],n['source_urls'][0],lane='New connector',directory_slugs=[] if n['slug']=='github-supplemental' else [n['slug']],evidence_urls=n['source_urls'])
for r in rows:
 if r['slug'] in research:
  task('R-'+r['slug'],r['priority'],r['name'],r['recommendation'],r['bucket'],r['rationale'],'Research first',r['next_step'],r['listing_url'],lane='Discovery',directory_slugs=[r['slug']])
backlog.sort(key=lambda t:(t['priority'], {'Platform':0,'Existing connector':1,'New connector':2,'Discovery':3}[t['lane']]))
for i,t in enumerate(backlog,1): t['order']=i
rows.sort(key=lambda r:(r['priority'],r['bucket'],r['name'].casefold(),r['slug']))
summary={**manifest,'current_catalog':current['counts'],'external_mcp_counts':dict(collections.Counter(r['external_mcp'] for r in rows)),
 'bucket_counts':dict(sorted(collections.Counter(r['bucket'] for r in rows).items())),
 'priority_counts':dict(sorted(collections.Counter(r['priority'] for r in rows).items())),
 'backlog_count':len(backlog),'existing_providers_reviewed':len(migrations),'new_candidates_with_vendor_review':len(new),'supplemental_payment_candidates':len(supplemental),
 'priority_definitions':{'P0':'Finish validation and remove migration blockers','P1':'First delivery wave, after its prerequisites','P2':'Next wave, partner access or targeted research','P3':'Demand-led, retain native or specialist long tail','P4':'Local-runtime track; separate platform project'},
 'effort_definition':'Relative engineering size, not calendar estimates. S: catalog/setup plus validation; M: auth or typed adapter; L: shared runtime work. Provider approval time excluded.',
 'limitations':['All 861 listings inventoried and bucketed. Vendor feasibility reviewed for all 29 existing providers and 21 new candidates (including supplemental GitHub and PayPal), not every long-tail listing.', 'No live OAuth consent, account access, tools/list or action execution tested.', 'Published external URL does not prove first-party ownership, custom-client access, availability, parity or zero cost.', 'GitHub is a supplemental recommendation outside the 861-listing snapshot.', 'Original categories are multi-label. Exclusive editorial buckets and priorities are judgments for this product, not Claude rankings.', 'Local entries may contact remote services, but need a local package/runtime rather than just a hosted URL.', 'No catalog or production code was changed by this research audit.'],
}
assert len(rows)==len({r['slug'] for r in rows})==861
assert sum(summary['external_mcp_counts'].values())==861
assert sum(summary['bucket_counts'].values())==861
assert len({m['provider_id'] for m in migrations})==29
assert all(r['bucket'] and r['next_step'] and r['listing_url'] for r in rows)
assert all(n['slug']=='github-supplemental' or n['slug'] in {r['slug'] for r in rows} for n in new)
assert len({t['id'] for t in backlog})==len(backlog)
(ROOT/'audit.json').write_text(json.dumps(dict(summary=summary,backlog=backlog,rows=rows),indent=2,ensure_ascii=False)+'\n')
print(json.dumps(summary,indent=2))
