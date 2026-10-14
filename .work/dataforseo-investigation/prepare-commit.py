from pathlib import Path
import difflib
import subprocess

root = Path('/Users/agent/ai-task-manager')
review = root / '.work/dataforseo-commit-review'
files = [
    'docs/integrations-current.md',
    'docs/integrations-recovery.md',
    'packages/integrations/src/__tests__/mcp-cached-discovery.test.ts',
    'packages/integrations/src/__tests__/mcp-client.test.ts',
    'packages/integrations/src/mcp/client.ts',
    'packages/integrations/src/mcp/index.ts',
    'packages/integrations/src/mcp/ingest.ts',
    'src/lib/integrations/hosted-mcp.ts',
    'src/lib/integrations/hosted-multiaccount-runtime.test.ts',
    'src/lib/integrations/mcp-client-lifetime.ts',
    'src/lib/integrations/mcp-client-lifetime.test.ts',
    'src/lib/integrations/mcp-servers.ts',
    'src/lib/integrations/mcp-servers.test.ts',
    'src/lib/integrations/runtime.ts',
]

def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)

patches = []
for filename in files:
    result = subprocess.run(['git', 'show', f'HEAD:{filename}'], cwd=root, capture_output=True, text=True)
    base = result.stdout if result.returncode == 0 else ''
    desired = (root / filename).read_text()
    if filename == 'packages/integrations/src/mcp/client.ts':
        start = desired.index('/** Only typed SDK rejection')
        end = desired.index('/**\n * Start OAuth explicitly', start)
        helper = desired[start:end]
        desired = replace_once(base, '/**\n * Start OAuth explicitly', helper + '/**\n * Start OAuth explicitly')
    elif filename == 'docs/integrations-current.md':
        paragraph = 'Runtime refresh lets already-started requests finish. Temporary discovery failures retain verified tool definitions and retry on access after fifteen seconds, keeping unavailable services distinct from rejected credentials. Paid calls are never replayed automatically. The [recovery guide](integrations-recovery.md) describes the behavior and retained health diagnostics.\n\n'
        desired = replace_once(base, 'Todoist and Jira have typed consumers', paragraph + 'Todoist and Jira have typed consumers')
    elif filename == 'src/lib/integrations/runtime.ts':
        desired = replace_once(desired, 'requiresAuth: boolean; local?: boolean; authKind?', 'requiresAuth: boolean; authKind?')
        desired = replace_once(desired, '          ...(definition.localCommand ? { local: true } : {}),\n', '')
        old = '''      if (hosted?.localCommand) {
        // The executable comes only from our catalog. A custom URL can never launch a process.
        client = await withTimeout(
          connectMcpClient({ command: hosted.localCommand, name: entry.slug, onToolsChanged }),
          MCP_TIMEOUT_MS, `connect MCP "${entry.slug}"`, lateClient => lateClient.close(),
        );
      } else if (entry.auth.kind === 'oauth') {'''
        desired = replace_once(desired, old, "      if (entry.auth.kind === 'oauth') {")
        old = '''      const local = getHostedMcpProvider(entry.providerId ?? '')?.localCommand;
      await recordFailure(entry, local && (error as NodeJS.ErrnoException)?.code === 'ENOENT'
        ? new Error('1Password MCP was not found. Install 1Password Desktop on the computer running Ri and enable its local MCP server in Settings > Labs and Settings > Developer. Then reconnect.')
        : error, candidate.discoveryStarted ? 'discover' : 'connect');'''
        desired = replace_once(desired, old, "      await recordFailure(entry, error, candidate.discoveryStarted ? 'discover' : 'connect');")
    target = review / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(desired)
    patches.extend(difflib.unified_diff(base.splitlines(keepends=True), desired.splitlines(keepends=True),
        fromfile=f'a/{filename}' if result.returncode == 0 else '/dev/null', tofile=f'b/{filename}'))

(root / '.work/dataforseo-investigation/commit.patch').write_text(''.join(patches))
print(f'Prepared {len(files)} files for isolated validation and commit.')

# External dependencies are shared read-only. Workspace packages resolve to this
# detached checkout, so tests cannot silently exercise another session's changes.
modules = review / 'node_modules'
modules.mkdir(exist_ok=True)
for entry in (root / 'node_modules').iterdir():
    if entry.name in ('@integrations', '@ri'):
        scope = modules / entry.name
        scope.mkdir(exist_ok=True)
        for package in entry.iterdir():
            if entry.name == '@integrations' and package.name == 'engine':
                target = review / 'packages/integrations'
            elif entry.name == '@ri' and package.name == 'app-kit':
                target = review / 'packages/app-kit'
            else:
                target = package.resolve()
            (scope / package.name).symlink_to(target, target_is_directory=True)
    else:
        (modules / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
for package in ('integrations', 'app-kit'):
    (review / 'packages' / package / 'node_modules').symlink_to(root / 'packages' / package / 'node_modules', target_is_directory=True)
