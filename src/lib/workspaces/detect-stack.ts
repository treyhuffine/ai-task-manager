/**
 * Best-effort detection of a project's setup + start commands from the files
 * in its checkout. Used only to *suggest* placeholders in the Worktree-scripts
 * UI — never to run anything. First confident match wins; if nothing matches,
 * both come back empty and the UI falls back to a neutral default.
 *
 * Precedence (most popular / most specific first), per ecosystem.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface StackSuggestion {
  /** Suggested setup command (install deps, etc.), or '' if unsure. */
  setup: string;
  /** Suggested start/dev command, or '' if unsure. */
  start: string;
}

const EMPTY: StackSuggestion = { setup: '', start: '' };

export function detectStack(cwd: string): StackSuggestion {
  if (!cwd || !existsSync(cwd)) return EMPTY;

  // ── Node ───────────────────────────────────────────────────────────────
  if (has(cwd, 'package.json')) {
    const pm = detectNodePm(cwd);
    const setup =
      pm === 'npm' && has(cwd, 'package-lock.json', 'npm-shrinkwrap.json') ? 'npm ci' : `${pm} install`;
    return { setup, start: detectNodeStart(cwd, pm) };
  }

  // ── Python ─────────────────────────────────────────────────────────────
  if (has(cwd, 'uv.lock') || pyprojectHas(cwd, '[tool.uv]')) return { setup: 'uv sync', start: 'uv run' };
  if (has(cwd, 'poetry.lock') || pyprojectHas(cwd, '[tool.poetry]'))
    return { setup: 'poetry install', start: 'poetry run' };
  if (has(cwd, 'Pipfile')) return { setup: 'pipenv install', start: 'pipenv run' };
  if (has(cwd, 'requirements.txt'))
    return { setup: 'pip install -r requirements.txt', start: has(cwd, 'manage.py') ? 'python manage.py runserver' : '' };
  if (has(cwd, 'pyproject.toml')) return { setup: 'pip install -e .', start: '' };

  // ── Rust / Go ──────────────────────────────────────────────────────────
  if (has(cwd, 'Cargo.toml')) return { setup: 'cargo fetch', start: 'cargo run' };
  if (has(cwd, 'go.mod')) return { setup: 'go mod download', start: 'go run .' };

  // ── Ruby / PHP / Elixir ────────────────────────────────────────────────
  if (has(cwd, 'Gemfile'))
    return { setup: 'bundle install', start: has(cwd, 'config.ru') || has(cwd, 'bin/rails') ? 'bundle exec rails s' : '' };
  if (has(cwd, 'composer.json'))
    return { setup: 'composer install', start: has(cwd, 'artisan') ? 'php artisan serve' : '' };
  if (has(cwd, 'mix.exs')) return { setup: 'mix deps.get', start: '' };

  // ── JVM ────────────────────────────────────────────────────────────────
  if (has(cwd, 'pom.xml')) {
    const mvn = has(cwd, 'mvnw') ? './mvnw' : 'mvn';
    return { setup: `${mvn} install`, start: `${mvn} spring-boot:run` };
  }
  if (has(cwd, 'build.gradle', 'build.gradle.kts')) {
    const gw = has(cwd, 'gradlew') ? './gradlew' : 'gradle';
    return { setup: `${gw} build`, start: `${gw} bootRun` };
  }

  // ── .NET / Dart / Deno ─────────────────────────────────────────────────
  if (hasExt(cwd, ['.csproj', '.sln', '.fsproj'])) return { setup: 'dotnet restore', start: 'dotnet run' };
  if (has(cwd, 'pubspec.yaml')) return { setup: 'flutter pub get', start: 'flutter run' };
  if (has(cwd, 'deno.json', 'deno.jsonc', 'deno.lock')) return { setup: '', start: 'deno task dev' };

  return EMPTY;
}

// ── helpers ──────────────────────────────────────────────────────────────

function has(cwd: string, ...names: string[]): boolean {
  return names.some((n) => existsSync(path.join(cwd, n)));
}

function hasExt(cwd: string, exts: string[]): boolean {
  try {
    return readdirSync(cwd).some((f) => exts.some((e) => f.endsWith(e)));
  } catch {
    return false;
  }
}

function pyprojectHas(cwd: string, marker: string): boolean {
  try {
    return readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8').includes(marker);
  } catch {
    return false;
  }
}

type NodePm = 'npm' | 'pnpm' | 'yarn' | 'bun';

function detectNodePm(cwd: string): NodePm {
  // `packageManager` (corepack) is authoritative when present.
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { packageManager?: unknown };
    const pm = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
    if (pm.startsWith('pnpm')) return 'pnpm';
    if (pm.startsWith('yarn')) return 'yarn';
    if (pm.startsWith('bun')) return 'bun';
    if (pm.startsWith('npm')) return 'npm';
  } catch {
    /* fall through to lockfile detection */
  }
  // Lockfiles, in popularity order: npm → pnpm → yarn → bun.
  if (has(cwd, 'package-lock.json', 'npm-shrinkwrap.json')) return 'npm';
  if (has(cwd, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(cwd, 'yarn.lock')) return 'yarn';
  if (has(cwd, 'bun.lockb', 'bun.lock')) return 'bun';
  return 'npm'; // default when only package.json is present
}

function detectNodeStart(cwd: string, pm: NodePm): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const name = ['dev', 'start', 'serve'].find((s) => typeof scripts[s] === 'string');
    // `<pm> run <script>` works for every Node package manager.
    return name ? `${pm} run ${name}` : '';
  } catch {
    return '';
  }
}
