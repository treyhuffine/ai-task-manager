#!/usr/bin/env python3
"""Immutable-HEAD review evidence, disposable Homes only. No deploy or Docker."""
import concurrent.futures
import json
import os
import pathlib
import re
import subprocess
import sys
import time

repo = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/ri-unified-review10-final').resolve()
if out.is_relative_to(repo):
    raise SystemExit('Evidence must live outside the checkout.')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo, text=True).strip()

def clean():
    return not git('status', '--porcelain=v1', '--untracked-files=all') and all(
        subprocess.run(['git', *args, '--quiet'], cwd=repo).returncode == 0
        for args in [('diff',), ('diff', '--cached')])

if not clean():
    raise SystemExit('Commit every staged, unstaged and untracked source file first.')
agentex_path = (repo / 'node_modules/@agentex/agent').resolve()
if '@agentex+agent@0.0.48_patch_hash=' not in str(agentex_path):
    raise SystemExit('Restore the locked patched agentex dependency before verification.')
def dependencies_unchanged():
    return (repo / 'node_modules/@agentex/agent').resolve() == agentex_path

source = git('rev-parse', 'HEAD')
if out.exists():
    raise SystemExit('Choose a new output directory. Existing evidence is never overwritten.')
out.mkdir(parents=True)
(out / 'screenshots').mkdir()
pnpm = ['pnpm', '--config.verifyDepsBeforeRun=false', '--config.strictDepBuilds=false']
comparison = '9528aabd'
changed = sorted(p for p in git('diff', '--name-only', comparison, '--', 'src', 'desktop', 'scripts', 'instrumentation.ts', 'tsup.config.ts').splitlines()
                 if p.endswith(('.ts', '.tsx', '.js', '.mjs', '.cjs')) and (repo / p).is_file())
browser = [
    'src/components/board/board.browser.test.ts',
    'src/components/chat-ui/model-menu/model-menu.browser.test.ts',
    'src/components/chat-ui/messages/markdown-link.browser.test.ts',
    'src/components/dashboard/rate-limits-pill.browser.test.ts',
    'src/components/team/team-shell.browser.test.ts', 'src/components/team/team-search.browser.test.ts',
    'src/components/team/team-navigation.browser.test.ts', 'src/components/dashboard/areas-chrome.browser.test.ts',
    'src/components/tasks/task-controls.browser.test.ts', 'src/components/executions/preview/worker-preview.browser.test.ts',
    'src/components/team/team-settings.browser.test.ts', 'src/components/team/team-ai-settings.browser.test.ts',
    'src/components/team/team-chat.browser.test.ts', 'src/components/team/team-chat-destination.browser.test.ts', 'src/components/team/team-chat-navigation.browser.test.ts', 'src/components/team/team-detail.browser.test.ts',
    'src/components/team/shared-body-editor.browser.test.ts', 'src/components/settings/sections/team-area-defaults.browser.test.ts',
    'src/components/spaces/team-label.browser.test.ts', 'src/components/local-apps/apps-rail-list.browser.test.ts',
    'src/components/settings/agent-skill-access.browser.test.ts', 'src/lib/spaces/forward.test.ts']
tasks = {
    'build': ['build'], 'desktop-build': ['desktop:build'],
    'desktop-app-build': ['exec', 'node', 'desktop/launch.mjs', '--build-only'], 'schema': ['db:generate'],
    'schema-check': ['exec', 'drizzle-kit', 'check'],
    'types': ['ts'],
    'full-vitest': ['exec', 'vitest', 'run', '--maxWorkers=4', '--hookTimeout=120000'],
    'lint': ['exec', 'eslint', '--format', 'json', *changed],
    'desktop': ['exec', 'vitest', 'run', '--config', 'desktop/vitest.config.ts', '--maxWorkers=2'],
    'browser': ['exec', 'vitest', 'run', *browser, '--maxWorkers=1', '--hookTimeout=120000'],
    'journey-migration': ['exec', 'vitest', 'run', 'src/lib/team/ai/http-restart.test.ts',
        'src/lib/team/ai/native-turn.test.ts', 'src/lib/spaces/area-defaults-migration.test.ts',
        'src/lib/team/legacy-order.test.ts', 'src/service/startup-migrations.test.ts',
        'src/lib/spaces/mixed-version.test.ts', 'src/lib/team/ai/transcript-recovery.test.ts',
        'src/lib/home/execution-recovery.integration.test.ts', 'src/lib/team/startup-recovery.test.ts', 'src/components/home/team-boundary.integration.test.tsx',
        'src/lib/sessions/team-selection-authority.test.ts', 'src/lib/sessions/decision-recovery.test.ts', 'src/lib/team/ai/settings-save.test.ts',
        '--maxWorkers=1', '--hookTimeout=120000'],
    'gallery': ['exec', 'tsx', 'scripts/chat-ui-gallery-browser-smoke.ts', '--skip-build'],
    'team-smoke-production': ['exec', 'tsx', 'desktop/team-smoke.ts', '--production'],
    'team-smoke-personal-production': ['exec', 'tsx', 'desktop/team-smoke.ts', '--personal', '--production'],
}
results = {}
manifest = {'sourceCommit': source, 'branch': git('branch', '--show-current'),
            'comparisonBase': git('rev-parse', comparison), 'startedClean': True,
            'agentexDependency': str(agentex_path),
            'cleanCheck': 'git status --porcelain=v1 --untracked-files=all, git diff --quiet, git diff --cached --quiet',
            'results': results, 'browser': {'executable': os.environ.get('RI_REVIEW_CHROMIUM'),
            'transport': 'Playwright Chromium transport', 'scope': 'real components, synthetic data adapters'},
            'limits': ['fake harness provider, no real account', 'source Electron plus production-build Team desktop smoke, no signed release or physical input',
                       'compiled service controller with readiness HTTP fixture', 'no microphone hardware qualification',
                       'macOS host: Linux kernel subreaper probes skipped; Linux birth and ambiguity fixtures run']}
for ref in ['fix/team-mcp-clarity', comparison, 'acae188a']:
    if subprocess.run(['git', 'merge-base', '--is-ancestor', ref, source], cwd=repo).returncode:
        raise SystemExit('Missing required ancestor: ' + ref)

# Main history stays byte for byte intact. The owner explicitly retired
# disposable branch history and requested one fresh CLI-generated delta.
old_files = git('ls-tree', '-r', '--name-only', comparison, '--', 'drizzle').splitlines()
for file in old_files:
    if file == 'drizzle/meta/_journal.json':
        continue
    if git('rev-parse', comparison + ':' + file) != git('rev-parse', source + ':' + file):
        raise SystemExit('Rewritten main migration artifact: ' + file)
old_journal = json.loads(subprocess.check_output(['git', 'show', comparison + ':drizzle/meta/_journal.json'], cwd=repo, text=True))
new_journal = json.loads((repo / 'drizzle/meta/_journal.json').read_text())
if new_journal['entries'][:-1] != old_journal['entries'] or new_journal['entries'][-1]['tag'] != '0024_breezy_rawhide_kid':
    raise SystemExit('Expected main history plus exactly one generated migration.')
if (repo / 'drizzle/lineages').exists():
    raise SystemExit('Retired migration lineage remains.')
manifest['migrationProvenance'] = 'Main 0000-0023 SQL/snapshots and journal entries unchanged; one CLI-generated 0024_breezy_rawhide_kid. Independent CLI regeneration produced identical SQL.'
if not os.environ.get('RI_REVIEW_MAIN_REPO'):
    raise SystemExit('Set RI_REVIEW_MAIN_REPO to a detached current-main checkout for the real version-skew test.')
baseline_modules = pathlib.Path(os.environ['RI_REVIEW_MAIN_REPO']) / 'node_modules'
if baseline_modules.is_symlink() or baseline_modules.resolve() == (repo / 'node_modules').resolve():
    raise SystemExit('The main baseline must have its own dependency links.')
manifest['versionSkewBaseline'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=os.environ['RI_REVIEW_MAIN_REPO'], text=True).strip()

def save():
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

def run(name):
    index = list(tasks).index(name)
    env = {**os.environ, 'RI_VERIFICATION_COMMIT': source, 'NEXT_TELEMETRY_DISABLED': '1'}
    env.update(npm_config_verifyDepsBeforeRun='false', npm_config_strictDepBuilds='false')
    if name == 'browser':
        if not env.get('RI_REVIEW_CHROMIUM'):
            raise RuntimeError('Set RI_REVIEW_CHROMIUM to the explicit browser executable.')
        env.update(RI_SPACES_BROWSER_TEST='1', RI_MODEL_MENU_BROWSER_TEST='1', RI_CHAT_LINK_BROWSER_TEST='1', RI_USAGE_BROWSER_TEST='1', RI_ARTIFACT_SCREENSHOTS=str(out / 'screenshots'))
    if name == 'gallery':
        env['RI_BROWSER_EXECUTABLE'] = os.environ['RI_REVIEW_CHROMIUM']
    if name == 'desktop-app-build':
        env['RI_DESKTOP_ROOT'] = str(out / ('home-' + name))
    if name == 'desktop':
        env.update(RI_TEAM_NAV_ELECTRON='1', RI_VERIFICATION_OUTPUT=str(out / 'electron-navigation.json'))
    if name == 'journey-migration':
        env['RI_SERVICE_BOOT_TEST'] = '1'
        env['RI_REVIEW_MAIN_REPO'] = os.environ['RI_REVIEW_MAIN_REPO']
    # iso deliberately removes inherited RI_* settings. Apply test opt-ins
    # inside that boundary, after its Home/path isolation is established.
    options = {key: value for key, value in env.items() if key in {
        'RI_USAGE_BROWSER_TEST', 'RI_BROWSER_EXECUTABLE', 'RI_CHAT_LINK_BROWSER_TEST', 'RI_VERIFICATION_COMMIT', 'RI_SPACES_BROWSER_TEST', 'RI_MODEL_MENU_BROWSER_TEST', 'RI_ARTIFACT_SCREENSHOTS',
        'RI_DESKTOP_ROOT', 'RI_REVIEW_MAIN_REPO', 'RI_REVIEW_CHROMIUM', 'RI_TEAM_NAV_ELECTRON', 'RI_VERIFICATION_OUTPUT', 'RI_SERVICE_BOOT_TEST',
        'NEXT_TELEMETRY_DISABLED', 'npm_config_verifyDepsBeforeRun', 'npm_config_strictDepBuilds'}}
    command = pnpm + ['iso', str(out / ('home-' + name)), '--port', str(43101 + index), '--', 'env'] + [key + '=' + value for key, value in options.items()] + pnpm + tasks[name]
    log = out / (name + '.log')
    started = time.time()
    with log.open('w') as stream:
        stream.write('sourceCommit: ' + source + '\ncommand: ' + json.dumps(command) + '\n')
        stream.flush()
        result = subprocess.run(command, cwd=repo, env=env, stdout=stream, stderr=subprocess.STDOUT)
    body = log.read_text()
    summary = '\n'.join(re.findall(r'^\s*(?:Test Files|Tests|Duration).+$', body, re.M))
    item = {'sourceCommit': source, 'command': command, 'exitCode': result.returncode,
            'elapsedSeconds': round(time.time() - started, 2), 'log': str(log), 'summary': summary}
    if name == 'lint':
        rows = json.loads(next(line for line in body.splitlines() if line.startswith('[{"filePath"')))
        item.update(files=len(rows), errors=sum(row['errorCount'] for row in rows), warnings=sum(row['warningCount'] for row in rows))
    print(name, result.returncode, summary, flush=True)
    return name, item

# Builds change generated SDK assets used by tests. Finish them before testing.
for name in ['build', 'desktop-build', 'desktop-app-build', 'schema', 'schema-check']:
    key, value = run(name)
    results[key] = value
    save()
    if value['exitCode'] or not clean() or not dependencies_unchanged() or git('rev-parse', 'HEAD') != source:
        manifest.update(sourceUnchanged=clean() and git('rev-parse', 'HEAD') == source, allPassed=False)
        save()
        raise SystemExit('Build/schema gate failed or source changed. Inspect ' + str(out))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    pending = [pool.submit(run, name) for name in tasks if name not in results and name not in {'desktop', 'browser', 'gallery', 'full-vitest', 'team-smoke-production', 'team-smoke-personal-production'}]
    for future in concurrent.futures.as_completed(pending):
        name, item = future.result()
        results[name] = item
        save()
# Real browser and Electron tests create and activate windows. Keep every
# window gate separate, including the broad suite's browser focus tests.
for task in ['desktop', 'browser', 'team-smoke-production', 'team-smoke-personal-production', 'gallery', 'full-vitest']:
    name, item = run(task)
    results[name] = item
    save()
manifest['sourceUnchanged'] = clean() and git('rev-parse', 'HEAD') == source
manifest['dependenciesUnchanged'] = dependencies_unchanged()
manifest['allPassed'] = manifest['sourceUnchanged'] and manifest['dependenciesUnchanged'] and all(item['exitCode'] == 0 for item in results.values())
save()
print('MANIFEST', out / 'manifest.json', 'allPassed', manifest['allPassed'], flush=True)
sys.exit(0 if manifest['allPassed'] else 1)
