#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/constants/app.ts
var APP_NAME, APP_SHORT_ID, PAIRING_TOKEN_FRAGMENT_KEY;
var init_app = __esm({
  "src/constants/app.ts"() {
    "use strict";
    APP_NAME = "Flow";
    APP_SHORT_ID = "flow";
    PAIRING_TOKEN_FRAGMENT_KEY = "token";
  }
});

// src/lib/config/claude-md-template.ts
function renderBaseBrief() {
  return `# Orchestrator session

You are operating ${APP_NAME}, a productivity system combining tasks, notes,
and a curated daily deck. This directory is the app's data root: config, the
SQLite database, the markdown mirror, and attachments live here.

## How to operate

Interact through the orchestrator surface, never by editing files here
directly. Direct edits bypass embeddings, the markdown mirror, and attachment
derivation. The UI and search rely on those invariants. Corrupting them is
silent and only surfaces later.

- **MCP tools** (preferred when wired): one tool per action (tasks, notes,
  areas, deck, search, user state, workspaces, triggers, runs).
- **CLI fallback**: \`${APP_SHORT_ID} agent <action> [params]\`. Output is JSON.

The \`orchestrator\` skill has the full conventions (status values, energy,
effort, task-vs-note, title style, error envelope). Load it before acting if
you haven't already.

## This is an orchestrator session, not a dev session

Reasoning about what ${APP_NAME} can do \u2192 use the orchestrator skill. If a
capability you need isn't exposed, say so. Don't invent a workaround by
reaching into the filesystem.

Debugging or extending ${APP_NAME} itself \u2192 start a new session in the
source repo. That's a different role with different conventions.`;
}
function renderAppRootClaudeMd() {
  const body = renderBaseBrief().trim();
  return `<!-- ${FLOW_MANAGED_TAG}:managed:start -->
${body}
<!-- ${FLOW_MANAGED_TAG}:managed:end -->
`;
}
var FLOW_MANAGED_TAG;
var init_claude_md_template = __esm({
  "src/lib/config/claude-md-template.ts"() {
    "use strict";
    init_app();
    FLOW_MANAGED_TAG = APP_SHORT_ID;
  }
});

// src/lib/config/memory-template.ts
function renderBrainMemoryMd() {
  return `# ${APP_NAME} brain memory

Long-running scratchpad for the agent. Add facts you want available in
every future session: user role + working style, recurring projects,
naming conventions, "do not touch" lists, anything you'd otherwise
have to re-state at the top of each conversation.

## Decisions

When you make a decision of substance during a run, write a note via
\`create_note\` with a title that starts with \`Decision: \`, for example
\`Decision: switch transcript storage to JSON Lines\`. The body should
capture:

- **Context**: what surfaced the decision
- **Options**: what was considered
- **Decision**: what was chosen, and why
- **Consequences**: what changes downstream

Decisions stay queryable in the notes list (filter chip:
\`Decisions\`). Six months later, "Why did we decide X?" maps to one
search, not an archeology project.
`;
}
var init_memory_template = __esm({
  "src/lib/config/memory-template.ts"() {
    "use strict";
    init_app();
  }
});

// src/lib/config/personalization-templates.ts
function renderUserMdStub() {
  return `# About me

This file is yours. ${APP_NAME} reads it but never edits it. Tell your
assistant who you are so it doesn't have to re-learn you each session:

- Your name and how you like to be addressed
- What you do / the projects that matter right now
- Working style: deep-work hours, energy patterns, how you like tasks framed
- How to work with you: terse vs. detailed, when to push back, what's off-limits

Delete this guidance and write in your own words. Leave it empty for none.
`;
}
function renderSoulMdStub() {
  return `# Your assistant's voice

This file is yours. ${APP_NAME} reads it but never edits it. Shape how your
assistant shows up:

- What it's called (give it a name, if you like)
- Tone and voice: warm, terse, dry, formal\u2026
- Judgment: when to be careful and ask, when to just act
- Anything it should never do

Delete this guidance and write in your own words. Leave it empty for the default.
`;
}
var USER_MD_FILENAME, SOUL_MD_FILENAME;
var init_personalization_templates = __esm({
  "src/lib/config/personalization-templates.ts"() {
    "use strict";
    init_app();
    USER_MD_FILENAME = "USER.md";
    SOUL_MD_FILENAME = "SOUL.md";
  }
});

// src/lib/config/paths.ts
import fs from "fs";
import os from "os";
import path from "path";
function homeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}
function getAppRoot() {
  const override = process.env[APP_ROOT_ENV];
  if (override) return override;
  return path.join(homeDir(), APP_SHORT_ID);
}
function getDevAppRoot() {
  return path.join(homeDir(), `${APP_SHORT_ID}-dev`);
}
function getBrainDir() {
  return getAppRoot();
}
function getDbPath() {
  const override = process.env[DB_PATH_ENV];
  if (override) return override;
  return path.join(getAppRoot(), "data.db");
}
function getAttachmentsDir() {
  return path.join(getAppRoot(), "attachments");
}
function getConfigDir() {
  const override = process.env[CONFIG_DIR_ENV];
  if (override) return override;
  return path.join(getAppRoot(), ".config");
}
function ensureConfigDir() {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 448 });
  return dir;
}
function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}
function getWorkDir() {
  const override = process.env[WORK_DIR_ENV];
  if (override) return override;
  return path.join(getAppRoot(), ".work");
}
function getClonesDir() {
  return path.join(getWorkDir(), "clones");
}
function ensureClonesDir() {
  const dir = getClonesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 448 });
  return dir;
}
function getTmpDir() {
  return path.join(getWorkDir(), "tmp");
}
function ensureAppRoot() {
  const dir = getAppRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  } else {
    try {
      fs.chmodSync(dir, 448);
    } catch {
    }
  }
  const claudeMdPath = path.join(dir, "CLAUDE.md");
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, renderAppRootClaudeMd(), { mode: 384 });
  }
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_BODY, { mode: 420 });
  }
  return dir;
}
function ensureBrainDir() {
  const dir = ensureAppRoot();
  const seed = (filename, render2) => {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, render2(), { mode: 384 });
  };
  seed("MEMORY.md", renderBrainMemoryMd);
  seed(USER_MD_FILENAME, renderUserMdStub);
  seed(SOUL_MD_FILENAME, renderSoulMdStub);
  return dir;
}
var ENV_PREFIX, APP_ROOT_ENV, BRAIN_PATH_ENV, DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV, GITIGNORE_BODY;
var init_paths = __esm({
  "src/lib/config/paths.ts"() {
    "use strict";
    init_app();
    init_claude_md_template();
    init_memory_template();
    init_personalization_templates();
    ENV_PREFIX = APP_SHORT_ID.toUpperCase();
    APP_ROOT_ENV = `${ENV_PREFIX}_ROOT`;
    BRAIN_PATH_ENV = `${ENV_PREFIX}_BRAIN_PATH`;
    DB_PATH_ENV = `${ENV_PREFIX}_DB_PATH`;
    CONFIG_DIR_ENV = `${ENV_PREFIX}_CONFIG_DIR`;
    WORK_DIR_ENV = `${ENV_PREFIX}_WORK_DIR`;
    GITIGNORE_BODY = `# ${APP_SHORT_ID}: machine-local plumbing, never sync
.config/
.work/
# Legacy worktree/clone locations (pre-2026-06-16 installs put these at the
# home root. New ones live in .work/). They're DB-referenced by absolute
# path + may hold uncommitted work, so the migration leaves them in place,
# just keep them out of sync here.
worktrees/
clones/
# SQLite runtime sidecars (data.db itself is tracked while it's canonical)
*.db-wal
*.db-shm
# Local dated snapshots (each bundles a full binary data.db dump \u2192 would
# bloat history). The remote backup is the durable copy. These are local.
snapshots/
`;
  }
});

// src/lib/auth/config-file.ts
import fs2 from "fs";
function getAuthConfigPath() {
  return getConfigPath();
}
function readAuthConfig() {
  const p = getAuthConfigPath();
  if (!fs2.existsSync(p)) return null;
  try {
    const raw = fs2.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      localToken: parsed.localToken ?? null,
      tunnelUrl: parsed.tunnelUrl ?? null,
      onboardedAt: parsed.onboardedAt ?? null,
      voiceEnabled: parsed.voiceEnabled ?? null,
      globalSkillEnabled: parsed.globalSkillEnabled ?? null,
      lastPort: parsed.lastPort ?? null,
      staticUrl: parsed.staticUrl ?? null
    };
  } catch (err) {
    console.error("[auth] failed to read config.json:", err);
    return null;
  }
}
function writeAuthConfig(config) {
  ensureConfigDir();
  const existing = readAuthConfig();
  const pick2 = (key) => (key in config ? config[key] : existing?.[key]) ?? null;
  const next = {
    version: 1,
    localToken: pick2("localToken"),
    tunnelUrl: pick2("tunnelUrl"),
    onboardedAt: pick2("onboardedAt"),
    voiceEnabled: pick2("voiceEnabled"),
    globalSkillEnabled: pick2("globalSkillEnabled"),
    lastPort: pick2("lastPort"),
    staticUrl: pick2("staticUrl")
  };
  const p = getAuthConfigPath();
  fs2.writeFileSync(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
  try {
    fs2.chmodSync(p, 384);
  } catch {
  }
  return next;
}
var init_config_file = __esm({
  "src/lib/auth/config-file.ts"() {
    "use strict";
    init_paths();
  }
});

// src/lib/auth/tokens.ts
import { createHash } from "crypto";
import { customAlphabet } from "nanoid";
function getTokenEnv() {
  return process.env.AUTH_TOKEN_ENV === "test" ? "test" : "live";
}
function generateToken(env = getTokenEnv()) {
  const random = randomToken();
  const plaintext = `${APP_SHORT_ID}_${env}_${random}`;
  return {
    plaintext,
    prefix: random.slice(0, 6),
    suffix: random.slice(-4),
    hash: hashToken(plaintext),
    env
  };
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
var TOKEN_ALPHABET, TOKEN_LENGTH, randomToken;
var init_tokens = __esm({
  "src/lib/auth/tokens.ts"() {
    "use strict";
    init_app();
    TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    TOKEN_LENGTH = 40;
    randomToken = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);
  }
});

// src/lib/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  agents: () => agents,
  apiKeys: () => apiKeys,
  areas: () => areas,
  chatEvents: () => chatEvents,
  chatRefs: () => chatRefs,
  chatSessions: () => chatSessions,
  decks: () => decks,
  entityVersions: () => entityVersions,
  executions: () => executions,
  notes: () => notes,
  notificationChannels: () => notificationChannels,
  notificationDeliveries: () => notificationDeliveries,
  previewTargets: () => previewTargets,
  runs: () => runs,
  stream: () => stream,
  taskCompletions: () => taskCompletions,
  tasks: () => tasks,
  triggers: () => triggers,
  userState: () => userState,
  webPushSubscriptions: () => webPushSubscriptions,
  workspaces: () => workspaces
});
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
var timestamps, userState, areas, stream, tasks, taskCompletions, decks, apiKeys, workspaces, agents, executions, previewTargets, chatSessions, chatEvents, entityVersions, notes, chatRefs, triggers, runs, notificationChannels, webPushSubscriptions, notificationDeliveries;
var init_schema = __esm({
  "src/lib/db/schema.ts"() {
    "use strict";
    timestamps = {
      createdAt: text().notNull().default(sql`(datetime('now'))`),
      updatedAt: text().notNull().default(sql`(datetime('now'))`).$onUpdate(() => sql`(datetime('now'))`)
    };
    userState = sqliteTable("user_state", {
      id: integer().primaryKey(),
      ...timestamps,
      name: text(),
      activeAreaId: text().references(() => areas.id),
      activeParentTaskId: text(),
      activeEnergy: text({ enum: ["deep", "light"] }),
      availableMinutes: integer(),
      // Working-hours window (local HH:MM) the deck sizes/slots tasks within.
      // Defaults to a 9–6 day until the user sets it or a calendar refines it.
      workdayStart: text().notNull().default("09:00"),
      workdayEnd: text().notNull().default("18:00"),
      // IANA timezone (e.g. 'America/New_York'). Null → fall back to the
      // browser's detected zone in the UI; paired with the workday window so the
      // deck plans the day in the user's actual local time.
      timezone: text(),
      description: text().notNull().default(""),
      voiceAutoSend: integer({ mode: "boolean" }).notNull().default(true),
      voiceModel: text().notNull().default("local/parakeet-tdt-0.6b-v3"),
      // Last explicit provider-bound harness + model + effort tuple. The columns
      // remain nullable for pre-onboarding and legacy databases, but chat creation
      // resolves them to concrete values before anything reaches a runner.
      defaultAgentHarness: text({ enum: ["claude", "codex"] }),
      defaultAgentModel: text(),
      defaultAgentEffort: text({ enum: ["low", "medium", "high", "xhigh", "max", "ultra"] }),
      // Which brain powers the dashboard orchestrator chat:
      //   legacy         — hand-rolled streamText agent (src/lib/ai/chat-tools.ts)
      //   harness_skills — harness session (cwd = data root), actions via CLI/skills
      //   harness_mcp    — harness session with the orchestrator MCP attached
      // Harness sessions read this at spawn; switching modes starts a new chat.
      // See docs/orchestrator-harness.md.
      orchestratorMode: text({ enum: ["legacy", "harness_skills", "harness_mcp"] }).notNull().default("legacy"),
      // Monthly spend ceiling in USD for scheduled + manual runs combined.
      // Null means no budget enforced. When `currentMonthSpend()` crosses
      // thresholds, dispatch behavior changes: <75% no-op, 75–99% warn in
      // TopHud, ≥100% scheduled runs auto-pause (`triggers.disabledReason =
      // 'budget_exceeded'`) and manual sends require an explicit confirm.
      // See docs/async-agents-v1.md §4.7.
      monthlyBudgetUsd: real(),
      onboardedAt: text()
    });
    areas = sqliteTable("areas", {
      id: text().primaryKey(),
      ...timestamps,
      name: text().notNull(),
      description: text(),
      emoji: text(),
      attachments: text({ mode: "json" }).$type().default([]),
      notes: text(),
      userContext: text(),
      status: text({ enum: ["active", "inactive", "archived"] }).notNull().default("active"),
      sortOrder: integer().notNull().default(0)
    });
    stream = sqliteTable(
      "stream",
      {
        id: text().primaryKey(),
        ...timestamps,
        rawText: text().notNull(),
        /** Which in-app surface/flow produced the item. Decoupled from media type. */
        source: text({ enum: ["capture", "chat", "webhook"] }).notNull().default("capture"),
        /** Original media format. Voice/image items were transcribed/OCR'd into `raw_text`. */
        media: text({ enum: ["text", "voice", "image"] }).notNull().default("text"),
        /** How the item entered the system. `internal` = user action in the app. */
        origin: text({ enum: ["internal", "webhook", "api"] }).notNull().default("internal"),
        /** External system that sent it (e.g. `pocket`). Null when origin='internal'. */
        externalSource: text(),
        /** Upstream id for dedupe on at-least-once deliveries. Null when origin='internal'. */
        externalId: text(),
        /** Full inbound payload for audit/replay. Null when origin='internal'. */
        externalPayload: text(),
        status: text({ enum: ["pending", "promoted", "dismissed"] }).notNull().default("pending"),
        dismissedBy: text(),
        promotedToType: text(),
        promotedToId: text(),
        promotedAt: text(),
        promotionPass: text(),
        /** Files attached to this stream item (e.g. raw audio when transcription
         *  failed or no STT provider was available). Derived on write from any
         *  references present in `raw_text`. */
        attachments: text({ mode: "json" }).$type().default([])
      },
      (table) => [index("stream_external_id_idx").on(table.externalSource, table.externalId)]
    );
    tasks = sqliteTable(
      "tasks",
      {
        id: text().primaryKey(),
        ...timestamps,
        parentId: text().references(() => tasks.id),
        areaId: text().references(() => areas.id),
        // Canonical workspace this task pertains to. Distinct from `area_id`:
        // areas are user-facing buckets ("Health"), workspaces are codebases
        // on disk. Auto-populated when a task is created from inside an
        // execution session (defaults from `chat_sessions.workspace_id`).
        workspaceId: text().references(() => workspaces.id, { onDelete: "set null" }),
        rawInput: text().notNull(),
        streamItemId: text().references(() => stream.id),
        title: text().notNull(),
        description: text(),
        body: text(),
        userContext: text(),
        aiContext: text(),
        outcome: text(),
        heartbeatDays: integer(),
        lastProgressAt: text(),
        energy: text({ enum: ["deep", "light"] }),
        effort: text({ enum: ["trivial", "small", "medium", "large", "epic"] }),
        estimatedMinutes: integer(),
        contextTags: text({ mode: "json" }).$type().default([]),
        hardDeadline: text(),
        reminderAt: text(),
        resurfaceAfter: text(),
        attachments: text({ mode: "json" }).$type().default([]),
        foldedHeadings: text({ mode: "json" }).$type().default([]),
        status: text({ enum: ["active", "done", "archived"] }).notNull().default("active"),
        sortKey: text(),
        blockedOn: text(),
        blockedSince: text(),
        recurrence: text(),
        nextRecurrenceAt: text(),
        targetFrequency: integer(),
        timesDeferred: integer().notNull().default(0),
        lastSurfacedAt: text(),
        completedAt: text(),
        lastViewedAt: text()
      },
      (table) => [
        index("idx_tasks_status").on(table.status),
        index("idx_tasks_area_id").on(table.areaId),
        index("idx_tasks_workspace_id").on(table.workspaceId),
        index("idx_tasks_parent_id").on(table.parentId),
        index("idx_tasks_sort_key").on(table.sortKey),
        index("idx_tasks_status_sort").on(table.status, table.sortKey)
      ]
    );
    taskCompletions = sqliteTable(
      "task_completions",
      {
        id: text().primaryKey(),
        ...timestamps,
        taskId: text().notNull().references(() => tasks.id),
        completedAt: text().notNull().default(sql`(datetime('now'))`),
        note: text()
      },
      (table) => [index("idx_task_completions_task_id").on(table.taskId)]
    );
    decks = sqliteTable(
      "decks",
      {
        id: text().primaryKey(),
        ...timestamps,
        context: text(),
        contextTags: text({ mode: "json" }).$type().default([]),
        framing: text(),
        items: text({ mode: "json" }).$type().notNull().default([]),
        alternatives: text({ mode: "json" }).$type().notNull().default([]),
        searchContext: text(),
        model: text(),
        // ─── Proactive deck: day boundary, version lineage, change log ───
        // `forDate` is the local day this deck is *for* (YYYY-MM-DD), distinct
        // from createdAt (when it was generated — could be the prior night).
        // Defines "today's deck."
        forDate: text(),
        // Version chain: exactly one row per (forDate) has supersededAt = NULL —
        // that's the active deck for that day. A regen or mid-day reshape stamps
        // the prior active row's supersededAt and inserts a new active row, so
        // every earlier version survives for one-tap revert.
        supersededAt: text(),
        replacesDeckId: text(),
        // What produced this version. `manual` is the honest default for legacy
        // rows (all pre-proactive decks were user-triggered).
        origin: text({ enum: ["morning", "first_open", "midday", "manual"] }).notNull().default("manual"),
        // The deltas that produced this version — drives the "what changed" brief
        // and the bumped lane without diffing. See `DeckChange`.
        changes: text({ mode: "json" }).$type().notNull().default([]),
        // The calendar busy-blocks this deck was sized/slotted against. Lets the
        // mid-day reconcile (Phase 3) diff live calendar vs. what the deck assumed
        // and adapt only to genuine external changes. Empty until a calendar
        // connector registers a provider.
        calendarSnapshot: text({ mode: "json" }).$type().notNull().default([])
      },
      (table) => [
        // Hot path: "the active deck for day X" (forDate = ? AND supersededAt IS NULL).
        index("idx_decks_for_date_active").on(table.forDate, table.supersededAt)
      ]
    );
    apiKeys = sqliteTable(
      "api_keys",
      {
        id: text().primaryKey(),
        ...timestamps,
        name: text().notNull(),
        description: text(),
        deviceType: text({
          enum: ["host", "computer", "phone", "tablet", "service", "other"]
        }).notNull().default("other"),
        prefix: text().notNull(),
        suffix: text().notNull(),
        hash: text().notNull().unique(),
        env: text({ enum: ["live", "test"] }).notNull().default("live"),
        expiresAt: text(),
        lastUsedAt: text(),
        lastUsedIp: text(),
        lastUsedUserAgent: text(),
        revokedAt: text(),
        revokedReason: text()
      },
      (table) => [
        index("idx_api_keys_hash").on(table.hash),
        index("idx_api_keys_prefix").on(table.prefix),
        index("idx_api_keys_revoked").on(table.revokedAt)
      ]
    );
    workspaces = sqliteTable(
      "workspaces",
      {
        id: text().primaryKey(),
        ...timestamps,
        name: text().notNull(),
        slug: text().notNull().unique(),
        emoji: text(),
        attachments: text({ mode: "json" }).$type().default([]),
        cwd: text().notNull(),
        isGit: integer({ mode: "boolean" }).notNull().default(false),
        baseBranch: text(),
        remoteName: text().default("origin"),
        worktreeRoot: text(),
        // Globs to copy from `cwd` into each new session's worktree at creation
        // time. Picomatch dialect, dot-aware. `.env*` is the default so secrets
        // travel with the worktree without symlinking back to source. The committed
        // beamd project config (`beamd.yaml`) is tracked, so git already puts it in
        // the worktree; add the gitignored local override (`beamd.local.yaml`) to
        // this list if you want that to travel too.
        filesToCopy: text({ mode: "json" }).$type().notNull().default([".env*"]),
        // Connector allowlist for this workspace's executions (service-grain, optional account pin).
        // Empty = no connectors for executions. See docs/connectors-workspace-scoping-spec.md.
        connectorScopes: text({ mode: "json" }).$type().notNull().default([]),
        // Worktree lifecycle scripts (all optional). Flow runs each as `sh -lc` in
        // the execution's worktree, with $FLOW_SOURCE_CHECKOUT_PATH /
        // $FLOW_WORKTREE_PATH / $FLOW_BRANCH_NAME exported. Flow stays
        // strategy-agnostic — the project decides what these do (install deps, copy
        // caches, run migrations, codegen, …).
        //   setupCommand    — runs once after the worktree is created (post file-copy).
        //   teardownCommand — runs on archive, before the worktree is removed.
        setupCommand: text(),
        teardownCommand: text(),
        // The dev command that *starts* the worktree's server for previews. Flow runs
        // it in the worktree, auto-assigns a stable port (injected as `PORT`), and
        // confirms it's listening. How a preview is *reached* (localhost vs a remote
        // provider) is a global setting, not a per-workspace mode — see
        // `preview_targets` + docs/preview-system-spec.md. (Renamed from
        // `previewCommand`; matches `preview_targets.startCommand`.)
        startCommand: text(),
        areaId: text().references(() => areas.id, { onDelete: "set null" }),
        position: integer().notNull().default(0),
        collapsed: integer({ mode: "boolean" }).notNull().default(false),
        // When true, the Live-session explainer modal is skipped for this workspace
        // and the Zap action starts a Live execution directly. Per-workspace because
        // the risk it warns about (no isolation, commits land on the checked-out
        // branch) is a property of the specific repo, not a global preference. Users
        // opt in via the modal's "Don't ask again" checkbox and can re-arm it from
        // workspace settings.
        skipLiveConfirm: integer({ mode: "boolean" }).notNull().default(false),
        status: text({ enum: ["active", "archived"] }).notNull().default("active"),
        archivedAt: text()
      },
      (table) => [
        index("idx_workspaces_status_position").on(table.status, table.position),
        index("idx_workspaces_area_id").on(table.areaId)
      ]
    );
    agents = sqliteTable(
      "agents",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        kind: text({ enum: ["orchestrator", "executor"] }).notNull(),
        name: text().notNull(),
        role: text(),
        harness: text().notNull(),
        config: text({ mode: "json" }).$type().notNull().default({}),
        status: text({ enum: ["active", "archived"] }).notNull().default("active"),
        archivedAt: text()
      },
      (table) => [index("idx_agents_kind").on(table.kind), index("idx_agents_status").on(table.status)]
    );
    executions = sqliteTable(
      "executions",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        // What this execution is anchored to. Required — executions are
        // workspace work artifacts. CASCADE: workspace deletion takes its
        // executions with it. The transitive cascade to chats is broken at
        // `chat_sessions.execution_id` (SET NULL) so transcripts survive the
        // workspace deletion as orphaned-but-readable history.
        workspaceId: text().notNull().references(() => workspaces.id, { onDelete: "cascade" }),
        // Optional label. Most executions don't need one; recurring trigger
        // executions might be labeled "morning-triage" etc. for the UI.
        label: text(),
        // Durable git state — lifted from chat_sessions. All nullable because
        // executions exist before worktree provisioning completes (and non-git
        // workspaces never get these set — the agent runs from `workspace.cwd`).
        worktreePath: text(),
        branchName: text(),
        baseSha: text(),
        // Explicit PR link override — lifted from chat_sessions. See the column
        // comment on the (now-legacy) chat_sessions.pr_number for semantics.
        prNumber: integer(),
        // Worktree provisioning state — lifted from chat_sessions. `setup_error`
        // holds the last failure (null once the worktree exists); `setup_started_at`
        // anchors the "creating worktree… Ns" counter to the current attempt.
        setupError: text(),
        setupStartedAt: text(),
        // Setup *script* state (the workspace's `setupCommand`). Runs in the
        // BACKGROUND once the worktree is ready, so chat is available immediately —
        // distinct from the (faster) worktree provisioning above. `setupScriptStatus`
        // drives the "Running setup script…" indicator; `setupScriptError` holds the
        // last failure's output tail. Null status = no script / not started.
        setupScriptStatus: text({ enum: ["running", "done", "failed"] }),
        setupScriptError: text(),
        // "Take over locally" lifecycle — lifted from chat_sessions. In takeover
        // iff `takeover_started_at IS NOT NULL`; all six clear together on
        // resume/cancel. The token authenticates the local CLI without the bearer
        // token and expires after one hour.
        //
        // `takeoverChatSessionId` records the chat that initiated the takeover
        // so the resume handoff lands in the exact chat the user started in —
        // a workspace execution can have multiple sibling chats (scheduled
        // fires accumulate them) and "most-recently-active" can pick the
        // wrong one once that happens. ON DELETE SET NULL keeps the
        // execution-side state valid if the initiating chat is ever hard-
        // deleted. Legacy executions with NULL fall back to the old "most-
        // recent active chat" heuristic in `findChatSessionByTakeoverToken`.
        takeoverStartedAt: text(),
        takeoverBaseSha: text(),
        takeoverBranch: text(),
        takeoverToken: text(),
        takeoverTokenExpiresAt: text(),
        takeoverChatSessionId: text().references(() => chatSessions.id, {
          onDelete: "set null"
        }),
        // Manually-pasted preview URLs (BYO tunnel — ngrok/cloudflared/whatever).
        // The user runs their own tunnel and pastes the URL; Flow stores it and
        // the ManualProvider serves it for the preview. A small list so a
        // multi-service worktree can carry one URL per service (`service: null`
        // is the default/only service). See docs/preview-system-spec.md §6 and
        // the `PreviewUrl` shape below.
        previewUrls: text({ mode: "json" }).$type().notNull().default([]),
        status: text({ enum: ["active", "archived"] }).notNull().default("active"),
        archivedAt: text()
      },
      (table) => [
        index("idx_executions_workspace_status").on(table.workspaceId, table.status),
        uniqueIndex("uniq_executions_takeover_token").on(table.takeoverToken).where(sql`${table.takeoverToken} IS NOT NULL`)
      ]
    );
    previewTargets = sqliteTable(
      "preview_targets",
      {
        id: text().primaryKey(),
        ...timestamps,
        // The worktree this preview is for. CASCADE: deleting the execution
        // (e.g. via workspace deletion) drops its preview targets.
        executionId: text().notNull().references(() => executions.id, { onDelete: "cascade" }),
        // Named service within a multi-service worktree. Null = the default/only
        // app. The (executionId, service) pair is unique — enforced by two
        // partial indexes because SQLite treats NULLs as distinct in a plain
        // unique index (so UNIQUE(executionId, service) would allow duplicate
        // default rows).
        service: text(),
        previewName: text().notNull(),
        port: integer(),
        pinned: integer({ mode: "boolean" }).notNull().default(false),
        lastViewedAt: text()
      },
      (table) => [
        index("idx_preview_targets_execution").on(table.executionId),
        uniqueIndex("uniq_preview_targets_exec_default").on(table.executionId).where(sql`${table.service} IS NULL`),
        uniqueIndex("uniq_preview_targets_exec_service").on(table.executionId, table.service).where(sql`${table.service} IS NOT NULL`)
      ]
    );
    chatSessions = sqliteTable(
      "chat_sessions",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        agentId: text().notNull().references(() => agents.id),
        type: text({ enum: ["orchestration", "content", "execution"] }).notNull(),
        surfaceKind: text(),
        surfaceRef: text(),
        status: text({ enum: ["active", "archived"] }).notNull().default("active"),
        label: text(),
        // Free-form scratch space scoped to this session. Markdown text the
        // user jots into during work — observations, error logs, half-formed
        // todos — without polluting global tasks/notes. Hydrated into the
        // agent's turn context when the user `@scratchpad`-mentions it in a
        // message (renders as a `[[scratchpad]]` marker in `chat_events.content`).
        scratchPad: text(),
        // Execution-specific fields.
        workspaceId: text().references(() => workspaces.id, { onDelete: "set null" }),
        // The durable work artifact this chat belongs to. NULL for orchestration
        // and content chats. NOT NULL for active execution chats (see the
        // invariant in docs/executions-spec.md §2.2). ON DELETE SET NULL: if an
        // execution is ever hard-deleted (workspace deletion cascade), the chat
        // survives as an orphaned-but-readable transcript.
        executionId: text().references(() => executions.id, { onDelete: "set null" }),
        // Provenance: the run that created this chat. NULL for chats the user
        // opened directly without a run kicking them off (manual chat send from
        // the composer, scratch sessions, etc.). Subsequent runs against this
        // chat are tracked via `runs.chatSessionId` — this field is set once at
        // chat creation and never mutated. ON DELETE SET NULL preserves the
        // chat if the originating run is ever deleted. See
        // docs/async-agents-v1.md §4.3.
        createdByRunId: text().references(() => runs.id, { onDelete: "set null" }),
        // Review derivation (timestamp-only, no state column).
        //
        // `last_viewed_at` is the read receipt — bumped on user interaction
        // with the chat (textarea focus, send, explicit Mark read). Opening
        // the session no longer marks read on its own; the user has to engage
        // for the chat to leave the Unread bucket.
        //
        // `unread_marker_at` is the "Mark as unread" override. When set above
        // `last_viewed_at` it forces the session into Unread even when no new
        // agent outcome has landed. Cleared on the next Mark read / interaction.
        lastOutcomeEventAt: text(),
        lastViewedAt: text(),
        unreadMarkerAt: text(),
        // CLI-backed tracking; null for in-app sessions.
        externalSessionId: text(),
        externalTranscriptPath: text(),
        externalSyncOffset: integer(),
        externalSyncLastEventId: text(),
        // How tool permission requests are handled for this session. `bypass` is
        // the default — no flag passed to Claude, callback auto-allows everything.
        // `default | accept_edits | plan` map to Claude's --permission-mode flag
        // (default | acceptEdits | plan); the callback then surfaces prompts via
        // the pending-input UI. AskUserQuestion always surfaces regardless of mode.
        permissionMode: text({
          enum: ["bypass", "default", "accept_edits", "plan"]
        }).notNull().default("bypass"),
        // Explicit per-session model + effort. These stay nullable in the schema
        // for legacy rows, while creation and dispatch normalize them before the
        // provider boundary. Agentex maps the concrete values onto each provider's
        // native session protocol. Changing either recycles the cached session.
        //
        // Effort enum values are literal provider tokens, not display strings.
        model: text(),
        effort: text({ enum: ["low", "medium", "high", "xhigh", "max", "ultra"] }),
        // When entering plan mode we stash the prior permission_mode here so
        // ExitPlanMode can revert. Mirrors Claude Code's `prePlanMode` on
        // ToolPermissionContext. Cleared when a non-plan mode is set directly.
        prePlanMode: text({
          enum: ["bypass", "default", "accept_edits", "plan"]
        }),
        startedAt: text().notNull().default(sql`(datetime('now'))`),
        archivedAt: text()
      },
      (table) => [
        uniqueIndex("chat_sessions_external_session_id_uq").on(table.externalSessionId).where(sql`${table.externalSessionId} IS NOT NULL`),
        index("idx_chat_sessions_workspace_status").on(
          table.workspaceId,
          table.status,
          table.lastOutcomeEventAt
        ),
        index("idx_chat_sessions_agent_status").on(table.agentId, table.status),
        index("idx_chat_sessions_type_status").on(table.type, table.status),
        // Primary-chat lookup + per-execution rollups: "most-recently-active
        // non-archived chat for execution E" (docs/executions-spec.md §4).
        index("idx_chat_sessions_execution_status_activity").on(
          table.executionId,
          table.status,
          table.lastOutcomeEventAt
        )
      ]
    );
    chatEvents = sqliteTable(
      "chat_events",
      {
        id: text().primaryKey(),
        ...timestamps,
        sessionId: text().notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
        role: text().notNull(),
        source: text().notNull(),
        content: text(),
        toolName: text(),
        toolInput: text({ mode: "json" }),
        toolIsError: integer({ mode: "boolean" }),
        toolExitCode: integer(),
        raw: text({ mode: "json" }),
        externalEventId: text(),
        externalMessageId: text(),
        externalTurnId: text(),
        externalToolCallId: text(),
        externalParentToolCallId: text(),
        sourcePartIndex: integer().notNull().default(0),
        // Files dropped/pasted/uploaded with this message. Same shape as
        // entity attachments (tasks/notes/areas) — references files in
        // <brain>/attachments/<file_name>. Marker tokens in `content`
        // (`[[file:<file_name>]]`) point at entries here so the chip's
        // position in the message is preserved on render.
        attachments: text({ mode: "json" }).$type().default([])
      },
      (table) => [
        // Idempotent upsert key for CLI-backed events. Claude (JSONL uuid) and
        // Codex v2 (globally-unique item.id) both supply distinct external_event_id
        // values per row, so turn_id isn't needed for uniqueness here.
        uniqueIndex("chat_events_external_uq").on(table.sessionId, table.externalEventId, table.sourcePartIndex).where(sql`${table.externalEventId} IS NOT NULL`),
        index("idx_chat_events_session_created").on(table.sessionId, table.createdAt),
        index("idx_chat_events_tool_call_id").on(table.externalToolCallId)
      ]
    );
    entityVersions = sqliteTable(
      "entity_versions",
      {
        id: text().primaryKey(),
        ...timestamps,
        entityType: text({ enum: ["task", "note"] }).notNull(),
        entityId: text().notNull(),
        // Full point-in-time snapshot of the entity's user-meaningful, mutable
        // fields as of this version — enough to render a diff against the
        // adjacent version and to restore the entity on revert. Task-only fields
        // are absent for notes. See `EntityVersionSnapshot`.
        snapshot: text({ mode: "json" }).$type().notNull(),
        // Who authored the change that produced this snapshot.
        //   human  — a person edited via the UI / trusted local CLI
        //   ai     — an agent edited (document chat / orchestrator via MCP)
        //   system — a revert or other automated process
        source: text({ enum: ["human", "ai", "system"] }).notNull().default("human"),
        // The chat session whose turn produced this version, when known (the
        // in-document `type='content'` session). Lets the transcript link a
        // tool-call event to its diff. SET NULL if the session is later deleted —
        // the version (and its undo) outlive the conversation.
        actorSessionId: text().references(() => chatSessions.id, {
          onDelete: "set null"
        }),
        // Short human label for the change ("Rewrote the body", "Reverted to an
        // earlier version"). Optional — the diff is the source of truth.
        summary: text(),
        // Provenance for `source='system'` reverts: the version whose snapshot
        // this row restored. Not load-bearing.
        revertedFromVersionId: text()
      },
      (table) => [
        // Hot path: "history for entity E, newest first".
        index("idx_entity_versions_entity").on(table.entityType, table.entityId, table.createdAt),
        index("idx_entity_versions_actor_session").on(table.actorSessionId)
      ]
    );
    notes = sqliteTable(
      "notes",
      {
        id: text().primaryKey(),
        ...timestamps,
        areaId: text().references(() => areas.id),
        taskId: text().references(() => tasks.id),
        // Canonical workspace this note pertains to. Same role as
        // `tasks.workspace_id` — distinct from `area_id` and auto-populated
        // when the note is created from inside an execution session.
        workspaceId: text().references(() => workspaces.id, { onDelete: "set null" }),
        title: text(),
        body: text().notNull(),
        url: text(),
        attachments: text({ mode: "json" }).$type().default([]),
        foldedHeadings: text({ mode: "json" }).$type().default([]),
        status: text({ enum: ["active", "archived"] }).notNull().default("active"),
        contextTags: text({ mode: "json" }).$type().default([]),
        lastViewedAt: text()
      },
      (table) => [
        index("idx_notes_area_id").on(table.areaId),
        index("idx_notes_task_id").on(table.taskId),
        index("idx_notes_workspace_id").on(table.workspaceId),
        index("idx_notes_status").on(table.status)
      ]
    );
    chatRefs = sqliteTable(
      "chat_refs",
      {
        id: text().primaryKey(),
        ...timestamps,
        sessionId: text().notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
        eventId: text().references(() => chatEvents.id, { onDelete: "cascade" }),
        // 'scratchpad' is a session-local reference. By convention `entity_id`
        // stores the owning `session_id` so reverse-lookup semantics stay
        // consistent with the other types.
        entityType: text({ enum: ["task", "note", "area", "file", "scratchpad"] }).notNull(),
        entityId: text().notNull(),
        position: integer().notNull().default(0),
        hydrate: integer({ mode: "boolean" }).notNull().default(true),
        createdBy: text({ enum: ["user", "agent"] }).notNull().default("user")
      },
      (table) => [
        // Forward: list session pins (event_id IS NULL) or mentions for an event.
        index("idx_chat_refs_session_event").on(table.sessionId, table.eventId),
        // Reverse: where is this entity referenced?
        index("idx_chat_refs_entity").on(table.entityType, table.entityId),
        // One pin per (session, entity). Per-message mentions can repeat freely.
        uniqueIndex("chat_refs_session_pin_uq").on(table.sessionId, table.entityType, table.entityId).where(sql`${table.eventId} IS NULL`)
      ]
    );
    triggers = sqliteTable(
      "triggers",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        name: text().notNull(),
        description: text(),
        enabled: integer({ mode: "boolean" }).notNull().default(true),
        // What runs and where. `agentId` is required at the row level; the form
        // defaults it from the workspace's bound executor or the orchestrator
        // agent depending on targetKind.
        agentId: text().notNull().references(() => agents.id),
        workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
        targetKind: text({ enum: ["workspace", "orchestrator"] }).notNull(),
        // The thing to do when fired.
        prompt: text().notNull(),
        // V2 — stored but NOT honored at runtime today. The executor adapter
        // currently passes ALL discovered skills via `skillDirs` (see
        // resolveSkillDirsForSession in src/lib/executor/skills.ts), so the
        // agent's auto-loader already has full inventory and `skillHints`
        // would be redundant. The column lives so the create surface can
        // accept it without a migration once we add runtime use (e.g.
        // filtering skillDirs to only the listed names, or surfacing the
        // intent in the agent's prompt envelope).
        skillHints: text({ mode: "json" }).$type(),
        // Trigger kind. Exactly one of cron_expression / interval_seconds /
        // run_at / (webhook_public_id + webhook_secret_hash) is populated for
        // the matching kind. Validated in the orchestrator action layer (see
        // task #19 / src/lib/scheduler/cron.ts validateCronExpression).
        // 'manual' = no automatic firing; only the "Run now" button + the
        // `run_trigger` action invoke it. nextRunAt stays null forever for
        // manual rows so the tick query never picks them up. Lets a user
        // save a "scheduled task" without committing to a cadence — they
        // can fire it ad-hoc, or convert to a real trigger later by
        // editing the kind.
        kind: text({ enum: ["manual", "at", "every", "cron", "webhook"] }).notNull(),
        cronExpression: text(),
        intervalSeconds: integer(),
        runAt: text(),
        timezone: text().default("UTC"),
        // Optional "only fire during business hours" window. `HH:MM` strings
        // interpreted in `timezone`. Tick skips dispatch when current time in
        // tz is outside the window. Heartbeat (V2) will lean on this heavily.
        activeHoursStart: text(),
        activeHoursEnd: text(),
        // When a previous run for THIS trigger is still active.
        // skip_if_running        — record this fire as 'skipped', reason 'trigger_busy'
        // coalesce_if_active     — (default) append prompt to the active run's chat
        // allow_concurrent       — spawn a new run alongside the existing one
        // Distinct from the execution-level mutex (cross-trigger, same
        // execution); see docs/executions-spec.md §5.
        concurrencyPolicy: text({
          enum: ["skip_if_running", "coalesce_if_active", "allow_concurrent"]
        }).notNull().default("coalesce_if_active"),
        // V2 — stored but NOT honored at runtime today. The runner currently
        // fires a missed slot at most once on the next tick regardless of
        // policy (behaves like `skip_missed`). The column ships so the
        // create surface can accept it without a migration once the runner
        // grows a catch-up loop. See src/lib/scheduler/runner.ts.
        //
        // skip_missed (default)  — drop missed slots, set nextRunAt to next future fire
        // run_all (V2)           — fire once per missed window, capped at maxCatchUpRuns
        catchUpPolicy: text({
          enum: ["skip_missed", "run_all"]
        }).notNull().default("skip_missed"),
        maxCatchUpRuns: integer().notNull().default(3),
        // Trigger → execution ownership. The FK lives on the trigger (not on
        // executions) so many triggers can point at one execution — morning-
        // triage + evening-summary writing into the same workspace artifact
        // falls out without a unique-constraint workaround. ON DELETE SET
        // NULL: archiving/deleting the execution doesn't break the trigger;
        // next fire creates a fresh execution. See docs/executions-spec.md
        // §2.3. NULL for one-off (`kind='at'`) and orchestrator triggers.
        owningExecutionId: text().references(() => executions.id, { onDelete: "set null" }),
        // Webhook intake (kind='webhook' only). publicId is the path segment
        // at /api/webhooks/triggers/<publicId>; secretHash is bcrypt'd HMAC key.
        // Verified via HMAC-SHA256 over the raw request body.
        webhookPublicId: text(),
        webhookSecretHash: text(),
        // Per-run overrides applied to the dispatched session. Null = inherit
        // the harness default.
        model: text(),
        effort: text({ enum: ["low", "medium", "high", "xhigh", "max", "ultra"] }),
        // Optional hard cap on wall-clock runtime per fire. NULL = no
        // timeout (the default for new triggers); positive int = seconds.
        // The honest signal for "is this run stuck" lives in the observe-
        // run primitive (`src/lib/runs/observe.ts`) — wall-clock timeouts
        // are a blunt safety net for the rare case where the user
        // explicitly wants to cap a misbehaving trigger. Existing rows
        // with the legacy 900s default keep their behavior until edited.
        timeoutSeconds: integer(),
        // Scheduler bookkeeping. nextRunAt is advanced atomically by the tick
        // BEFORE dispatch — that's the at-most-once guarantee. lastRunStatus
        // captures the most recent outcome for fast list rendering without
        // joining runs.
        nextRunAt: text(),
        lastFiredAt: text(),
        lastRunId: text(),
        lastRunStatus: text({
          enum: ["completed", "failed", "skipped"]
        }),
        // Bumped on failed run, reset to 0 on completed. >= 3 surfaces a
        // banner; no auto-pause (silent failure is worse than surfaced
        // failure). See task #25.
        consecutiveFailures: integer().notNull().default(0),
        // Why the trigger is disabled. Populated only when `enabled=false`
        // and the source was automatic (budget guard, manual pause leaves
        // null). Used by the trigger detail view to render context.
        disabledReason: text(),
        // Notifier digest binding (docs/connectors-email-and-notifier-spec.md §2.9):
        // notification_channel ids that this trigger's result is delivered to when an
        // orchestrator-target run completes (`trigger.run_completed`, binding routing).
        deliverResultTo: text({ mode: "json" }).$type().notNull().default([])
      },
      (table) => [
        // Name uniqueness — two PARTIAL unique indexes (not one composite).
        // SQLite treats NULLs in unique indexes as distinct, so a plain
        // UNIQUE(workspaceId, name) would silently allow duplicate
        // brain-level (workspaceId IS NULL) names.
        uniqueIndex("uniq_triggers_brain_name").on(table.name).where(sql`${table.workspaceId} IS NULL`),
        uniqueIndex("uniq_triggers_workspace_name").on(table.workspaceId, table.name).where(sql`${table.workspaceId} IS NOT NULL`),
        // Hot path for the tick: enabled triggers due to fire.
        index("idx_triggers_enabled_next_run").on(table.enabled, table.nextRunAt),
        // Webhook intake lookup by public id.
        uniqueIndex("uniq_triggers_webhook_public_id").on(table.webhookPublicId).where(sql`${table.webhookPublicId} IS NOT NULL`),
        index("idx_triggers_workspace_status").on(table.workspaceId, table.enabled)
      ]
    );
    runs = sqliteTable(
      "runs",
      {
        id: text().primaryKey(),
        ...timestamps,
        // Which trigger fired this (null for manual chat sends).
        triggerId: text().references(() => triggers.id, { onDelete: "set null" }),
        // Denormalized FKs for cheap rollups. workspaceId is null for
        // orchestrator-target runs; executionId follows the chat's executionId
        // (null for orchestration/content chats).
        workspaceId: text().references(() => workspaces.id, { onDelete: "set null" }),
        executionId: text().references(() => executions.id, { onDelete: "set null" }),
        // The chat where the transcript lives.
        chatSessionId: text().references(() => chatSessions.id, { onDelete: "set null" }),
        // The agent that ran. Carried for grouping/spend-by-agent without a
        // join through chatSessions.
        agentId: text().notNull().references(() => agents.id),
        // What kicked this off. 'manual' = user chat send, the rest are
        // scheduler-driven.
        triggerKind: text({
          enum: ["manual", "cron", "every", "at", "webhook"]
        }).notNull(),
        // Verbatim payload for webhook triggers (so the prompt can reference
        // it via context), kept as JSON for any future structured triggers.
        triggerPayload: text({ mode: "json" }).$type(),
        // For scheduler-driven runs, the wall-clock time the slot fired (the
        // tick's idea of "now"). Null for manual + webhook.
        scheduledFor: text(),
        // Simple status enum — no awaiting_input/blocked vocabulary in V1
        // (multi-state action protocol is V2+). statusReason captures
        // structured codes for skip/fail flavors.
        status: text({
          enum: ["queued", "running", "completed", "failed", "skipped"]
        }).notNull().default("queued"),
        statusReason: text(),
        // Lifecycle timestamps. queuedAt is always set; startedAt fires when
        // the run transitions queued → running; completedAt + durationMs
        // populate together at terminal.
        queuedAt: text().notNull().default(sql`(datetime('now'))`),
        startedAt: text(),
        completedAt: text(),
        durationMs: integer(),
        // Usage rollup from @agentex/agent's `result` event. costUsd prefers
        // the SDK's reported value when present (Anthropic) and falls back to
        // the in-repo pricing table (src/lib/pricing/models.ts) for providers
        // that don't supply one.
        model: text(),
        inputTokens: integer().default(0),
        outputTokens: integer().default(0),
        cachedInputTokens: integer().default(0),
        cacheCreationInputTokens: integer().default(0),
        costUsd: real().default(0),
        // Auto-extracted from the last assistant message at terminal (task
        // #15). NULL when the run failed before any assistant turn.
        summary: text(),
        // Inferred from successful mutating action calls during the run (task
        // #14). `[{kind:'task', id:'...'}, {kind:'note', id:'...'}, ...]`.
        // Deduped by (kind, id).
        artifactRefs: text({ mode: "json" }).$type(),
        // Failure metadata. errorCode for stable program-readable categories
        // (process_restart, timeout, agent_error, ...), errorMessage for the
        // human-readable detail.
        errorCode: text(),
        errorMessage: text()
      },
      (table) => [
        // Per-trigger history.
        index("idx_runs_trigger_status").on(table.triggerId, table.status),
        // "what's currently running" + "today's spend" lookups.
        index("idx_runs_status_started").on(table.status, table.startedAt),
        // Filter pills on the runs view.
        index("idx_runs_trigger_kind_started").on(table.triggerKind, table.startedAt),
        // Execution-level run mutex check — at most one workspace run per
        // execution may be `status='running'` at any time. The mutex is the
        // reason this index exists; it's the hot path. See
        // docs/executions-spec.md §5.
        index("idx_runs_execution_status").on(table.executionId, table.status)
      ]
    );
    notificationChannels = sqliteTable(
      "notification_channels",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        kind: text({ enum: ["connector", "web_push", "in_app"] }).notNull(),
        // Optional human name for the channel ("My phone", "Team room"). UI falls back to a derived label.
        label: text(),
        // kind 'connector' — WHICH connector (telegram/slack/…). The actionId
        // (telegram.send_message) lives in the adapter registry, NOT this row.
        providerId: text(),
        // kind 'connector' — the engine connection id. NO Drizzle FK: the connection
        // lives in the engine's store (.config/connectors), not this DB; the
        // disconnect cascade is app-level (deleteChannelsForConnection).
        connectionId: text(),
        // Structured target per kind: Telegram {chatId}, Slack {channel}, web_push {} (fans to subs).
        config: text({ mode: "json" }).$type().notNull().default({}),
        // The per-channel matrix toggle list — which event types route here.
        events: text({ mode: "json" }).$type().notNull().default([]),
        enabled: integer({ mode: "boolean" }).notNull().default(true)
      },
      (table) => [
        index("idx_notification_channels_user_enabled").on(table.userId, table.enabled),
        index("idx_notification_channels_connection").on(table.connectionId)
        // disconnect cascade
      ]
    );
    webPushSubscriptions = sqliteTable(
      "web_push_subscriptions",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        endpoint: text().notNull().unique(),
        // one row per browser endpoint
        p256dh: text().notNull(),
        auth: text().notNull()
      },
      (table) => [index("idx_web_push_subscriptions_user").on(table.userId)]
    );
    notificationDeliveries = sqliteTable(
      "notification_deliveries",
      {
        id: text().primaryKey(),
        ...timestamps,
        userId: text().notNull().default("local"),
        eventType: text().notNull(),
        dedupeKey: text().notNull(),
        // from the event; idempotency across re-fires
        channelId: text().notNull().references(() => notificationChannels.id, { onDelete: "cascade" }),
        // No 'sending' in v1: inline single-process → no lease needed. Add it + lease
        // columns with a future background worker (spec §2.16).
        status: text({ enum: ["pending", "sent", "failed", "skipped"] }).notNull().default("pending"),
        attempts: integer().notNull().default(0),
        event: text({ mode: "json" }).$type().notNull(),
        // for re-render / retry / history
        rendered: text({ mode: "json" }).$type(),
        providerMessageId: text(),
        // e.g. Telegram message_id
        lastError: text(),
        nextAttemptAt: text(),
        // set by a FUTURE retry worker (not v1)
        sentAt: text()
      },
      (table) => [
        uniqueIndex("uniq_notification_deliveries_dedupe_channel").on(table.dedupeKey, table.channelId),
        // idempotency
        index("idx_notification_deliveries_user_status").on(table.userId, table.status),
        index("idx_notification_deliveries_next_attempt").on(table.status, table.nextAttemptAt)
        // future worker
      ]
    );
  }
});

// src/lib/db/index.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";
import fs3 from "fs";
import path2 from "path";
function getDefaultDbPath() {
  return getDbPath();
}
function resetDb() {
  if (rawInstance) {
    rawInstance.close();
    rawInstance = null;
    dbInstance = null;
    currentPath = null;
  }
}
function getDb(dbPath) {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  if (dbInstance && currentPath === resolvedPath) {
    if (!fs3.existsSync(resolvedPath)) {
      rawInstance?.close();
      rawInstance = null;
      dbInstance = null;
      currentPath = null;
    } else {
      return dbInstance;
    }
  }
  if (process.env[DB_PATH_ENV]) {
    const dir = path2.dirname(resolvedPath);
    if (!fs3.existsSync(dir)) {
      fs3.mkdirSync(dir, { recursive: true });
    }
  } else {
    ensureBrainDir();
  }
  const sqlite = new Database(resolvedPath);
  sqliteVec.load(sqlite);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  rawInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema: schema_exports, casing: "snake_case" });
  const migrationsFolder = path2.resolve(process.cwd(), "drizzle");
  migrate(dbInstance, { migrationsFolder });
  sqlite.exec(EXTRA_SQL);
  currentPath = resolvedPath;
  return dbInstance;
}
function getRawDb(dbPath) {
  getDb(dbPath);
  return rawInstance;
}
var dbInstance, rawInstance, currentPath, EXTRA_SQL;
var init_db = __esm({
  "src/lib/db/index.ts"() {
    "use strict";
    init_paths();
    init_schema();
    dbInstance = null;
    rawInstance = null;
    currentPath = null;
    EXTRA_SQL = `
-- FTS for tasks
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description, body, raw_input, content='tasks', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;

-- FTS for notes
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;

-- FTS for stream
CREATE VIRTUAL TABLE IF NOT EXISTS stream_fts USING fts5(raw_text, content='stream', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS stream_ai AFTER INSERT ON stream BEGIN
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_ad AFTER DELETE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_au AFTER UPDATE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;

-- Embeddings metadata
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id);

-- Embeddings vector index (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(embedding float[1536]);

-- Seed singleton user_state row
INSERT OR IGNORE INTO user_state (id) VALUES (1);
`;
  }
});

// src/lib/embeddings/embed.ts
import { createHash as createHash2 } from "crypto";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
function computeContentHash(text2) {
  return createHash2("sha256").update(text2).digest("hex");
}
function buildEmbeddingText(entityType, entity) {
  const labeled = (pairs) => pairs.filter((p) => Boolean(p[1])).map(([label, value]) => `${label}: ${value}`).join("\n");
  switch (entityType) {
    case "task": {
      const t = entity;
      return labeled([
        ["Title", t.title],
        ["Description", t.description],
        ["Outcome", t.outcome],
        ["Body", t.body],
        ["Context", t.userContext]
      ]);
    }
    case "note": {
      const n = entity;
      return labeled([
        ["Title", n.title],
        ["Body", n.body]
      ]);
    }
    case "stream": {
      const s = entity;
      return s.rawText;
    }
  }
}
function truncate(text2) {
  return text2.length <= MAX_CHARS ? text2 : text2.slice(0, MAX_CHARS);
}
async function generateEmbedding(text2) {
  const result = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: truncate(text2)
  });
  return result.embedding;
}
async function upsertEmbedding(entityType, entityId, textContent) {
  if (!textContent.trim()) return;
  if (!process.env.OPENAI_API_KEY) return;
  const db = getRawDb();
  const hash = computeContentHash(textContent);
  const existing = db.prepare("SELECT id, content_hash FROM embeddings WHERE entity_type = ? AND entity_id = ?").get(entityType, entityId);
  if (existing && existing.content_hash === hash) {
    return;
  }
  const vector = await generateEmbedding(textContent);
  const embedding = new Float32Array(vector);
  if (existing) {
    db.prepare(
      "UPDATE embeddings SET content_hash = ?, text_content = ?, created_at = datetime('now') WHERE id = ?"
    ).run(hash, textContent, existing.id);
    db.prepare("DELETE FROM embeddings_vec WHERE rowid = ?").run(BigInt(existing.id));
    db.prepare("INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)").run(
      BigInt(existing.id),
      embedding
    );
  } else {
    const info = db.prepare(
      "INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content) VALUES (?, ?, ?, ?)"
    ).run(entityType, entityId, hash, textContent);
    db.prepare("INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)").run(
      BigInt(info.lastInsertRowid),
      embedding
    );
  }
}
var MAX_CHARS;
var init_embed = __esm({
  "src/lib/embeddings/embed.ts"() {
    "use strict";
    init_db();
    MAX_CHARS = 28e3;
  }
});

// src/lib/case/keys.ts
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function camelizeKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => camelizeKeys(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[snakeToCamel(k)] = camelizeKeys(v);
    }
    return out;
  }
  return value;
}
function snakeizeKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => snakeizeKeys(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[camelToSnake(k)] = snakeizeKeys(v);
    }
    return out;
  }
  return value;
}
var init_keys = __esm({
  "src/lib/case/keys.ts"() {
    "use strict";
  }
});

// src/lib/db/hydrate.ts
function hydrateRow(row2) {
  if (!row2) return void 0;
  const { attachments, ...rest } = row2;
  return {
    ...rest,
    attachments: attachments ? camelizeKeys(attachments) : null
  };
}
function dehydrateAttachments(attachments) {
  if (attachments === null) return null;
  if (attachments === void 0) return void 0;
  return snakeizeKeys(attachments);
}
function withoutAttachments(input) {
  const copy = { ...input };
  delete copy.attachments;
  return copy;
}
var init_hydrate = __esm({
  "src/lib/db/hydrate.ts"() {
    "use strict";
    init_keys();
  }
});

// src/lib/export/mirror/config.ts
import path3 from "path";
function isMirrorEnabled() {
  return process.env[MIRROR_DISABLED_ENV] !== "1";
}
function isAttachmentGcEnabled() {
  return process.env[ATTACHMENT_GC_ENABLED_ENV] === "1";
}
function typeDir(type) {
  return path3.join(getBrainDir(), `${type}s`);
}
function tmpDir(type) {
  return path3.join(typeDir(type), ".tmp");
}
function archiveDir(type) {
  return path3.join(getBrainDir(), ".archive", `${type}s`);
}
var ENV_PREFIX2, MIRROR_DISABLED_ENV, ATTACHMENT_GC_ENABLED_ENV, ENTITY_TYPES;
var init_config = __esm({
  "src/lib/export/mirror/config.ts"() {
    "use strict";
    init_paths();
    init_app();
    ENV_PREFIX2 = APP_SHORT_ID.toUpperCase();
    MIRROR_DISABLED_ENV = `${ENV_PREFIX2}_MIRROR_DISABLED`;
    ATTACHMENT_GC_ENABLED_ENV = `${ENV_PREFIX2}_ATTACHMENT_GC`;
    ENTITY_TYPES = ["task", "note", "area", "stream"];
  }
});

// src/lib/attachments/derive.ts
function extractReferencedFileNames(body) {
  if (!body) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const match of body.matchAll(ATTACHMENT_REF_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
function deriveAttachments(input) {
  const priorByName = /* @__PURE__ */ new Map();
  for (const a of input.prior ?? []) priorByName.set(a.fileName, a);
  const uploadsByName = /* @__PURE__ */ new Map();
  for (const a of input.newUploads ?? []) uploadsByName.set(a.fileName, a);
  const referenced = extractReferencedFileNames(input.body);
  const out = [];
  for (const name of referenced) {
    const prior = priorByName.get(name);
    if (prior) {
      out.push(prior);
      continue;
    }
    const upload = uploadsByName.get(name);
    if (upload) {
      out.push(upload);
      continue;
    }
    out.push({
      fileName: name,
      originalName: name,
      mimeType: "application/octet-stream",
      size: 0,
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return out;
}
function rewriteAttachmentsForMirror(body) {
  if (!body) return "";
  return body.replace(/\/api\/attachments\//g, "../attachments/");
}
var ATTACHMENT_REF_RE;
var init_derive = __esm({
  "src/lib/attachments/derive.ts"() {
    "use strict";
    ATTACHMENT_REF_RE = /\/api\/attachments\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g;
  }
});

// src/lib/export/markdown.ts
import slugifyLib from "@sindresorhus/slugify";
function slugify(s) {
  return slugifyLib(s, { lowercase: true, decamelize: false }).slice(0, 80);
}
var init_markdown = __esm({
  "src/lib/export/markdown.ts"() {
    "use strict";
    init_derive();
  }
});

// src/lib/export/mirror/render.ts
function mirrorFilename(nameOrTitle, id) {
  const base4 = slugify(nameOrTitle ?? "").slice(0, SLUG_MAX);
  return base4 ? `${base4}--${id}.md` : `${id}.md`;
}
function mirrorLinkPath(type, nameOrTitle, id) {
  const filename = mirrorFilename(nameOrTitle, id);
  const stem = filename.slice(0, -3);
  return `${type}s/${stem}`;
}
function parseMirrorFilename(filename) {
  if (!filename.endsWith(".md")) return null;
  const stem = filename.slice(0, -3);
  const lastSep = stem.lastIndexOf("--");
  if (lastSep === -1) {
    return { slug: null, id: stem };
  }
  return { slug: stem.slice(0, lastSep), id: stem.slice(lastSep + 2) };
}
function wikiLink(resolver, type, id) {
  if (!id || !resolver) return null;
  const target = resolver.linkFor(type, id);
  return target ? `[[${target}]]` : null;
}
function yamlValue(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "[" + v.map((x) => yamlValue(x)).join(", ") + "]";
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).filter(([, val]) => val !== void 0).map(([key, val]) => `${key}: ${yamlValue(val)}`);
    return "{" + entries.join(", ") + "}";
  }
  const s = String(v);
  if (/[\r\n]/.test(s) || /^\s|\s$|[:#\-&*!?|>'"%@`,\[\]{}]|^(true|false|null|yes|no|\d)/i.test(s) || s === "") {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
  }
  return s;
}
function attachmentsForFrontmatter(attachments) {
  if (!attachments || attachments.length === 0) return null;
  return attachments.map(({ uploadedAt, ...rest }) => rest);
}
function buildFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === void 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}
function renderTask(task, opts = {}) {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: "task",
    title: task.title,
    status: task.status,
    area: wikiLink(opts.links, "area", task.areaId),
    areaId: task.areaId,
    areaName: opts.areaName ?? null,
    parent: wikiLink(opts.links, "task", task.parentId),
    parentId: task.parentId,
    parentTitle: opts.parentTitle ?? null,
    energy: task.energy,
    effort: task.effort,
    estimatedMinutes: task.estimatedMinutes,
    heartbeatDays: task.heartbeatDays,
    hardDeadline: task.hardDeadline,
    resurfaceAfter: task.resurfaceAfter,
    reminderAt: task.reminderAt,
    recurrence: task.recurrence,
    nextRecurrenceAt: task.nextRecurrenceAt,
    targetFrequency: task.targetFrequency,
    contextTags: task.contextTags,
    attachments: attachmentsForFrontmatter(task.attachments),
    blockedOn: task.blockedOn,
    blockedSince: task.blockedSince,
    outcome: task.outcome,
    timesDeferred: task.timesDeferred || null,
    lastProgressAt: task.lastProgressAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    managedBy: APP_SHORT_ID
  });
  const description = rewriteAttachmentsForMirror(task.description ?? "").trim();
  const body = rewriteAttachmentsForMirror(task.body ?? "").trim();
  const userContext = (task.userContext ?? "").trim();
  const parts = [frontmatter, "", HEADER_COMMENTS, "", `# ${task.title}`];
  if (description) parts.push("", description);
  if (body) parts.push("", body);
  if (userContext) parts.push("", "## Context", "", userContext);
  return {
    filename: mirrorFilename(task.title, task.id),
    content: parts.join("\n") + "\n"
  };
}
function renderNote(note, opts = {}) {
  const sources = opts.sources ?? [];
  const sourceIds = sources.map((s) => s.id);
  const sourceLinks = opts.links ? sources.map((s) => opts.links.linkFor("stream", s.id)).filter((x) => x !== null).map((p) => `[[${p}]]`) : [];
  const frontmatter = buildFrontmatter({
    id: note.id,
    type: "note",
    title: note.title,
    status: note.status,
    area: wikiLink(opts.links, "area", note.areaId),
    areaId: note.areaId,
    areaName: opts.areaName ?? null,
    task: wikiLink(opts.links, "task", note.taskId),
    taskId: note.taskId,
    taskTitle: opts.taskTitle ?? null,
    url: note.url,
    contextTags: note.contextTags,
    attachments: attachmentsForFrontmatter(note.attachments),
    sources: sourceLinks.length > 0 ? sourceLinks : null,
    sourceIds: sourceIds.length > 0 ? sourceIds : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    managedBy: APP_SHORT_ID
  });
  const parts = [frontmatter, "", HEADER_COMMENTS];
  if (note.title) parts.push("", `# ${note.title}`);
  const body = rewriteAttachmentsForMirror(note.body ?? "").trim();
  if (body) parts.push("", body);
  if (sources.length > 0) {
    parts.push("", "## Sources", "");
    for (const s of sources) {
      const heading = streamSourceHeading(s, opts.links);
      parts.push(`### ${heading}`);
      const rawText = rewriteAttachmentsForMirror(s.rawText ?? "");
      const quoted = rawText.split("\n").map((line) => `> ${line}`).join("\n");
      parts.push("", quoted, "");
    }
  }
  return {
    filename: mirrorFilename(note.title, note.id),
    content: parts.join("\n").replace(/\n+$/, "") + "\n"
  };
}
function streamSourceHeading(s, links) {
  const date = (s.createdAt ?? "").slice(0, 19).replace("T", " ");
  const source = s.source ?? "capture";
  const label = `${source}: ${date}`.trim();
  const target = links?.linkFor("stream", s.id);
  return target ? `[[${target}|${label}]]` : label;
}
function renderArea(area, _opts = {}) {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: "area",
    name: area.name,
    status: area.status,
    emoji: area.emoji,
    sortOrder: area.sortOrder,
    description: area.description,
    attachments: attachmentsForFrontmatter(area.attachments),
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    managedBy: APP_SHORT_ID
  });
  const parts = [
    frontmatter,
    "",
    HEADER_COMMENTS,
    "",
    `# ${area.emoji ? area.emoji + " " : ""}${area.name}`
  ];
  if (area.description) parts.push("", area.description);
  if (area.notes) parts.push("", "## Notes", "", area.notes);
  if (area.userContext) parts.push("", "## Context", "", area.userContext);
  return {
    filename: mirrorFilename(area.name, area.id),
    content: parts.join("\n") + "\n"
  };
}
function renderStream(s, opts = {}) {
  const promotedLink = s.promotedToType && s.promotedToId ? wikiLink(opts.links, s.promotedToType, s.promotedToId) : null;
  const frontmatter = buildFrontmatter({
    id: s.id,
    type: "stream",
    source: s.source,
    status: s.status,
    promotedTo: promotedLink,
    promotedToType: s.promotedToType,
    promotedToId: s.promotedToId,
    promotedToTitle: opts.promotedToTitle ?? null,
    promotedAt: s.promotedAt,
    dismissedBy: s.dismissedBy,
    attachments: attachmentsForFrontmatter(s.attachments),
    createdAt: s.createdAt,
    managedBy: APP_SHORT_ID
  });
  const parts = [frontmatter, "", HEADER_COMMENTS, "", rewriteAttachmentsForMirror(s.rawText ?? "").trim()];
  const firstLine = (s.rawText ?? "").split("\n")[0]?.trim() ?? "";
  const slug = firstLine.length > 0 ? firstLine.slice(0, 40) : "";
  return {
    filename: mirrorFilename(slug, s.id),
    content: parts.join("\n").replace(/\n+$/, "") + "\n"
  };
}
var SLUG_MAX, HEADER_COMMENTS;
var init_render = __esm({
  "src/lib/export/mirror/render.ts"() {
    "use strict";
    init_app();
    init_markdown();
    init_derive();
    SLUG_MAX = 60;
    HEADER_COMMENTS = [
      `<!-- Managed by ${APP_SHORT_ID}. Edits here are overwritten on next sync. -->`,
      `<!-- To modify: use the app, an MCP tool, or write SQL directly. -->`
    ].join("\n");
  }
});

// src/lib/export/mirror/fs.ts
import fs4 from "fs";
import fsp from "fs/promises";
import path4 from "path";
function ensureDirs() {
  ensureBrainDir();
  for (const t of ENTITY_TYPES) {
    fs4.mkdirSync(typeDir(t), { recursive: true });
    fs4.mkdirSync(tmpDir(t), { recursive: true });
    fs4.mkdirSync(archiveDir(t), { recursive: true });
  }
}
async function findByIdInType(type, id) {
  const dir = typeDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const matches = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path4.join(dir, name));
  }
  return matches;
}
async function findByIdInArchive(type, id) {
  const dir = archiveDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const matches = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path4.join(dir, name));
  }
  return matches;
}
async function writeEntityFile(type, id, finalFilename, content) {
  const dir = typeDir(type);
  const tmp = path4.join(tmpDir(type), `${id}.tmp`);
  const finalPath = path4.join(dir, finalFilename);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(tmpDir(type), { recursive: true });
  await fsp.writeFile(tmp, content, "utf8");
  const existing = await findByIdInType(type, id);
  for (const p of existing) {
    if (p === finalPath) continue;
    await fsp.rm(p).catch(() => void 0);
  }
  const archived = await findByIdInArchive(type, id);
  for (const p of archived) {
    await fsp.rm(p).catch(() => void 0);
  }
  await fsp.rename(tmp, finalPath);
  return finalPath;
}
async function archiveEntityFile(type, id, filename, content) {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  const dest = path4.join(archiveDir(type), filename);
  for (const p of await findByIdInArchive(type, id)) {
    if (p === dest) continue;
    await fsp.rm(p).catch(() => void 0);
  }
  await fsp.mkdir(archiveDir(type), { recursive: true });
  await fsp.writeFile(dest, content, "utf8");
}
async function deleteEntityFile(type, id) {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  for (const p of await findByIdInArchive(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
}
async function listIdsInType(type) {
  const dir = typeDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const ids = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed) ids.push(parsed.id);
  }
  return ids;
}
async function readUpdatedAt(filePath) {
  try {
    const head = await fsp.readFile(filePath, "utf8");
    const slice = head.slice(0, 2048);
    const match = slice.match(/^updatedAt:\s*("?)([^"\n]+)\1/m);
    if (!match) return null;
    return match[2].trim();
  } catch {
    return null;
  }
}
var init_fs = __esm({
  "src/lib/export/mirror/fs.ts"() {
    "use strict";
    init_config();
    init_paths();
    init_render();
  }
});

// src/lib/export/mirror/sync.ts
import { and, eq } from "drizzle-orm";
function syncEntity(type, id) {
  if (!isMirrorEnabled()) return Promise.resolve();
  const ctx = new MutationContext();
  ctx.add(type, id);
  return syncBatch(ctx);
}
async function syncBatch(ctx) {
  if (!isMirrorEnabled()) return;
  if (ctx.size === 0) return;
  try {
    const expanded = expandCascades(ctx);
    await Promise.all(
      expanded.entries().map(async ([type, id]) => {
        try {
          await syncOne(type, id);
        } catch (err) {
          console.warn(`[mirror] sync failed: ${type}:${id}`, err);
        }
      })
    );
  } catch (err) {
    console.warn("[mirror] syncBatch failed", err);
  }
}
function expandCascades(ctx) {
  const out = new MutationContext();
  for (const [type, id] of ctx.entries()) {
    out.add(type, id);
  }
  const db = getDb();
  for (const [type, id] of ctx.entries()) {
    if (type === "stream") {
      const row2 = db.select().from(stream).where(eq(stream.id, id)).get();
      if (row2?.promotedToType === "note" && row2.promotedToId) {
        out.add("note", row2.promotedToId);
      }
      continue;
    }
    if (type === "area") {
      const refTasks = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.areaId, id)).all();
      out.addMany("task", refTasks.map((r) => r.id));
      const refNotes = db.select({ id: notes.id }).from(notes).where(eq(notes.areaId, id)).all();
      out.addMany("note", refNotes.map((r) => r.id));
      continue;
    }
    if (type === "task") {
      const childTasks = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, id)).all();
      out.addMany("task", childTasks.map((r) => r.id));
      const refNotes = db.select({ id: notes.id }).from(notes).where(eq(notes.taskId, id)).all();
      out.addMany("note", refNotes.map((r) => r.id));
      const refStreams = db.select({ id: stream.id }).from(stream).where(and(eq(stream.promotedToId, id), eq(stream.promotedToType, "task"))).all();
      out.addMany("stream", refStreams.map((r) => r.id));
      continue;
    }
    if (type === "note") {
      const refStreams = db.select({ id: stream.id }).from(stream).where(and(eq(stream.promotedToId, id), eq(stream.promotedToType, "note"))).all();
      out.addMany("stream", refStreams.map((r) => r.id));
      continue;
    }
  }
  return out;
}
async function syncOne(type, id) {
  const db = getDb();
  if (type === "task") {
    const row2 = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
    if (!row2) {
      await deleteEntityFile("task", id);
      return;
    }
    await writeTask(row2);
    return;
  }
  if (type === "note") {
    const row2 = hydrateRow(db.select().from(notes).where(eq(notes.id, id)).get());
    if (!row2) {
      await deleteEntityFile("note", id);
      return;
    }
    await writeNote(row2);
    return;
  }
  if (type === "area") {
    const row2 = hydrateRow(db.select().from(areas).where(eq(areas.id, id)).get());
    if (!row2) {
      await deleteEntityFile("area", id);
      return;
    }
    await writeArea(row2);
    return;
  }
  if (type === "stream") {
    const row2 = hydrateRow(db.select().from(stream).where(eq(stream.id, id)).get());
    if (!row2) {
      await deleteEntityFile("stream", id);
      return;
    }
    await writeStream(row2);
    return;
  }
}
function createLinkResolver() {
  const db = getDb();
  return {
    linkFor(type, id) {
      if (type === "task") {
        const row2 = db.select().from(tasks).where(eq(tasks.id, id)).get();
        return row2 ? mirrorLinkPath("task", row2.title, row2.id) : null;
      }
      if (type === "note") {
        const row2 = db.select().from(notes).where(eq(notes.id, id)).get();
        return row2 ? mirrorLinkPath("note", row2.title, row2.id) : null;
      }
      if (type === "area") {
        const row2 = db.select().from(areas).where(eq(areas.id, id)).get();
        return row2 ? mirrorLinkPath("area", row2.name, row2.id) : null;
      }
      if (type === "stream") {
        const row2 = db.select().from(stream).where(eq(stream.id, id)).get();
        if (!row2) return null;
        const firstLine = (row2.rawText ?? "").split("\n")[0]?.trim().slice(0, 40) ?? "";
        return mirrorLinkPath("stream", firstLine, row2.id);
      }
      return null;
    }
  };
}
async function writeTask(task) {
  const db = getDb();
  const area = task.areaId ? db.select().from(areas).where(eq(areas.id, task.areaId)).get() : void 0;
  const parent = task.parentId ? db.select().from(tasks).where(eq(tasks.id, task.parentId)).get() : void 0;
  const { filename, content } = renderTask(task, {
    areaName: area?.name ?? null,
    parentTitle: parent?.title ?? null,
    links: createLinkResolver()
  });
  if (task.status === "archived") {
    await archiveEntityFile("task", task.id, filename, content);
  } else {
    await writeEntityFile("task", task.id, filename, content);
  }
}
async function writeNote(note) {
  const db = getDb();
  const area = note.areaId ? db.select().from(areas).where(eq(areas.id, note.areaId)).get() : void 0;
  const task = note.taskId ? db.select().from(tasks).where(eq(tasks.id, note.taskId)).get() : void 0;
  const sources = db.select().from(stream).where(
    and(
      eq(stream.promotedToId, note.id),
      eq(stream.promotedToType, "note"),
      eq(stream.status, "promoted")
    )
  ).all().map((r) => hydrateRow(r));
  const { filename, content } = renderNote(note, {
    areaName: area?.name ?? null,
    taskTitle: task?.title ?? null,
    sources,
    links: createLinkResolver()
  });
  if (note.status === "archived") {
    await archiveEntityFile("note", note.id, filename, content);
  } else {
    await writeEntityFile("note", note.id, filename, content);
  }
}
async function writeArea(area) {
  const { filename, content } = renderArea(area);
  if (area.status === "archived") {
    await archiveEntityFile("area", area.id, filename, content);
  } else {
    await writeEntityFile("area", area.id, filename, content);
  }
}
async function writeStream(s) {
  const db = getDb();
  let promotedToTitle = null;
  if (s.promotedToId && s.promotedToType) {
    if (s.promotedToType === "note") {
      const n = db.select().from(notes).where(eq(notes.id, s.promotedToId)).get();
      promotedToTitle = n?.title ?? null;
    } else if (s.promotedToType === "task") {
      const t = db.select().from(tasks).where(eq(tasks.id, s.promotedToId)).get();
      promotedToTitle = t?.title ?? null;
    }
  }
  const { filename, content } = renderStream(s, {
    promotedToTitle,
    links: createLinkResolver()
  });
  if (s.status === "dismissed") {
    await archiveEntityFile("stream", s.id, filename, content);
  } else {
    await writeEntityFile("stream", s.id, filename, content);
  }
}
var MutationContext;
var init_sync = __esm({
  "src/lib/export/mirror/sync.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_hydrate();
    init_config();
    init_fs();
    init_render();
    MutationContext = class {
      constructor() {
        this.refs = /* @__PURE__ */ new Set();
      }
      add(type, id) {
        this.refs.add(`${type}:${id}`);
      }
      addMany(type, ids) {
        for (const id of ids) this.refs.add(`${type}:${id}`);
      }
      entries() {
        return Array.from(this.refs).map((ref) => {
          const sep = ref.indexOf(":");
          return [ref.slice(0, sep), ref.slice(sep + 1)];
        });
      }
      get size() {
        return this.refs.size;
      }
    };
  }
});

// src/lib/export/mirror/readme.ts
import fs5 from "fs/promises";
import path5 from "path";
function readmeContent() {
  return `# ${APP_NAME} Brain

Your ${APP_NAME} data lives in this folder. \`data.db\` is the source of
truth. The markdown files alongside it are a live, always-current mirror
written by the app.

## Live mirror (derived, don't hand-edit)

- \`tasks/\`: one file per task
- \`notes/\`: one file per note
- \`areas/\`: one file per area
- \`stream/\`: one file per captured stream item
- \`attachments/\`: uploaded files (images, PDFs, voice memos) referenced by
  the entities above. Markdown bodies link here via \`../attachments/\u2026\`
- \`.archive/\`: archived or merged-away entities. Orphan attachments also
  move to \`.archive/attachments/\` when no entity references them anymore

These files update automatically as you use the app. **Edits here are
overwritten on the next sync.** To make changes, use:

- the ${APP_NAME} app
- the MCP tools exposed by ${APP_NAME}
- direct SQL against the database

## Source of truth

- \`data.db\`: the SQLite database. Everything else in this folder is
  derived from it.

## Why mirror at all?

Your data lives on your disk as plain markdown alongside the database. You can:

- grep it, back it up, commit it to git (gitignore \`data.db*\` and
  \`attachments/\` to keep the repo to portable text)
- open it in Obsidian, VS Code, or any editor
- feed the folder to any LLM for context
- keep reading it even if ${APP_NAME} itself goes away

Portability and observability without giving up the engineering properties of a
real database.

## Filename format

\`{slug}--{uuid}.md\`: the slug is cosmetic, the UUID is the stable identity.
A double-hyphen separator distinguishes slug hyphens from hyphens inside the
UUID. The ID is always the part after the last \`--\`.

## Configuration

- \`${APP_ROOT_ENV}\`: point the data home (this folder) somewhere else
- \`${MIRROR_DISABLED_ENV}=1\`: turn the markdown mirror off (db only)
- \`${ATTACHMENT_GC_ENABLED_ENV}=1\`: opt in to attachment garbage collection
  (off by default, orphan files are hidden UUID-named blobs that cost nothing
  to leave on disk, and a wrong sweep would visibly break references)

## Force a sync

Run \`${APP_SHORT_ID} export\` to force a full sync (useful after a crash or
if you suspect drift).
`;
}
async function ensureReadme() {
  const target = path5.join(getBrainDir(), README_FILENAME);
  try {
    await fs5.access(target);
  } catch {
    await fs5.mkdir(getBrainDir(), { recursive: true });
    await fs5.writeFile(target, readmeContent(), "utf8");
  }
}
var README_FILENAME;
var init_readme = __esm({
  "src/lib/export/mirror/readme.ts"() {
    "use strict";
    init_app();
    init_paths();
    init_config();
    README_FILENAME = "README.md";
  }
});

// src/lib/export/mirror/attachments-gc.ts
import fs6 from "fs";
import fsp2 from "fs/promises";
import path6 from "path";
function archiveAttachmentsDir() {
  return path6.join(getBrainDir(), ".archive", "attachments");
}
function ensureAttachmentsDirsExist() {
  fs6.mkdirSync(getAttachmentsDir(), { recursive: true });
  fs6.mkdirSync(archiveAttachmentsDir(), { recursive: true });
}
function collectReferencedFileNames() {
  const db = getDb();
  const out = /* @__PURE__ */ new Set();
  const push = (rows) => {
    for (const r of rows) {
      for (const a of r.attachments ?? []) out.add(a.fileName);
    }
  };
  push(db.select({ attachments: tasks.attachments }).from(tasks).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: notes.attachments }).from(notes).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: areas.attachments }).from(areas).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: stream.attachments }).from(stream).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: workspaces.attachments }).from(workspaces).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: chatEvents.attachments }).from(chatEvents).all().map((r) => hydrateRow(r)));
  return out;
}
async function sweepAttachments() {
  const start = Date.now();
  ensureAttachmentsDirsExist();
  const referenced = collectReferencedFileNames();
  const liveDir = getAttachmentsDir();
  const archiveDir2 = archiveAttachmentsDir();
  let liveEntries;
  try {
    liveEntries = await fsp2.readdir(liveDir);
  } catch {
    return {
      referenced: referenced.size,
      onDisk: 0,
      archived: 0,
      restored: 0,
      gcEnabled: isAttachmentGcEnabled(),
      elapsedMs: Date.now() - start
    };
  }
  const live = new Set(liveEntries.filter((n) => !n.startsWith(".")));
  let restored = 0;
  for (const name of referenced) {
    if (live.has(name)) continue;
    const src = path6.join(archiveDir2, name);
    const dest = path6.join(liveDir, name);
    try {
      await fsp2.rename(src, dest);
      live.add(name);
      restored++;
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") continue;
      console.warn(`[mirror] reference heal failed: ${name}`, err);
    }
  }
  const gcEnabled = isAttachmentGcEnabled();
  let archived = 0;
  if (gcEnabled) {
    for (const name of live) {
      if (referenced.has(name)) continue;
      const src = path6.join(liveDir, name);
      const dest = path6.join(archiveDir2, name);
      try {
        await fsp2.rename(src, dest);
        archived++;
      } catch (err) {
        if (err.code === "EXDEV") {
          await fsp2.copyFile(src, dest);
          await fsp2.unlink(src);
          archived++;
          continue;
        }
        console.warn(`[mirror] orphan attachment archive failed: ${name}`, err);
      }
    }
  }
  return {
    referenced: referenced.size,
    onDisk: live.size,
    archived,
    restored,
    gcEnabled,
    elapsedMs: Date.now() - start
  };
}
var init_attachments_gc = __esm({
  "src/lib/export/mirror/attachments-gc.ts"() {
    "use strict";
    init_db();
    init_hydrate();
    init_schema();
    init_paths();
    init_config();
  }
});

// src/lib/export/mirror/reconcile.ts
async function reconcileAll() {
  if (!isMirrorEnabled()) {
    return {
      synced: 0,
      skipped: 0,
      orphaned: 0,
      attachments: { referenced: 0, onDisk: 0, archived: 0, restored: 0, gcEnabled: false, elapsedMs: 0 },
      elapsedMs: 0
    };
  }
  const start = Date.now();
  ensureDirs();
  await ensureReadme();
  const db = getDb();
  let synced = 0;
  let skipped = 0;
  const dbTasks = db.select().from(tasks).all().map((r) => hydrateRow(r));
  const dbTaskIds = /* @__PURE__ */ new Set();
  for (const t of dbTasks) {
    dbTaskIds.add(t.id);
    const current = await findByIdInType("task", t.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= t.updatedAt) {
        skipped++;
        continue;
      }
    }
    await writeTask(t);
    synced++;
  }
  const dbNotes = db.select().from(notes).all().map((r) => hydrateRow(r));
  const dbNoteIds = /* @__PURE__ */ new Set();
  for (const n of dbNotes) {
    dbNoteIds.add(n.id);
    const current = await findByIdInType("note", n.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= n.updatedAt) {
        skipped++;
        continue;
      }
    }
    await writeNote(n);
    synced++;
  }
  const dbAreas = db.select().from(areas).all().map((r) => hydrateRow(r));
  const dbAreaIds = /* @__PURE__ */ new Set();
  for (const a of dbAreas) {
    dbAreaIds.add(a.id);
    const current = await findByIdInType("area", a.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= a.updatedAt) {
        skipped++;
        continue;
      }
    }
    await writeArea(a);
    synced++;
  }
  const dbStreams = db.select().from(stream).all().map((r) => hydrateRow(r));
  const dbStreamIds = /* @__PURE__ */ new Set();
  for (const s of dbStreams) {
    dbStreamIds.add(s.id);
    await writeStream(s);
    synced++;
  }
  let orphaned = 0;
  const checks2 = [
    ["task", dbTaskIds],
    ["note", dbNoteIds],
    ["area", dbAreaIds],
    ["stream", dbStreamIds]
  ];
  for (const [type, knownIds] of checks2) {
    const fileIds = await listIdsInType(type);
    for (const id of fileIds) {
      if (!knownIds.has(id)) {
        orphaned++;
        console.warn(`[mirror] orphaned file (no DB row): ${type}:${id}`);
      }
    }
  }
  const attachments = await sweepAttachments();
  const elapsedMs = Date.now() - start;
  return { synced, skipped, orphaned, attachments, elapsedMs };
}
var init_reconcile = __esm({
  "src/lib/export/mirror/reconcile.ts"() {
    "use strict";
    init_db();
    init_hydrate();
    init_schema();
    init_fs();
    init_sync();
    init_config();
    init_readme();
    init_attachments_gc();
  }
});

// src/lib/export/mirror/timer.ts
var INTERVAL_MS;
var init_timer = __esm({
  "src/lib/export/mirror/timer.ts"() {
    "use strict";
    init_reconcile();
    init_config();
    INTERVAL_MS = 15 * 60 * 1e3;
  }
});

// src/lib/export/mirror/init.ts
var init_init = __esm({
  "src/lib/export/mirror/init.ts"() {
    "use strict";
    init_fs();
    init_readme();
    init_reconcile();
    init_timer();
    init_config();
    init_paths();
  }
});

// src/lib/export/mirror/index.ts
var init_mirror = __esm({
  "src/lib/export/mirror/index.ts"() {
    "use strict";
    init_sync();
    init_reconcile();
    init_init();
    init_timer();
    init_config();
    init_paths();
  }
});

// src/lib/entity-refs/parse-markers.ts
var init_parse_markers = __esm({
  "src/lib/entity-refs/parse-markers.ts"() {
    "use strict";
  }
});

// src/constants/chat.ts
var CHAT_PAGE_SIZE;
var init_chat = __esm({
  "src/constants/chat.ts"() {
    "use strict";
    CHAT_PAGE_SIZE = 1e3;
  }
});

// src/db/types.ts
var OUTCOME_SOURCES;
var init_types = __esm({
  "src/db/types.ts"() {
    "use strict";
    OUTCOME_SOURCES = /* @__PURE__ */ new Set(["agent", "result"]);
  }
});

// src/lib/realtime/bus.ts
function publish(channel, message) {
  const listeners = state.channels.get(channel);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (err) {
      console.error(`[realtime-bus] listener threw on channel ${channel}:`, err);
    }
  }
}
function sessionChannel(sessionId) {
  return `session:${sessionId}`;
}
function publishChatEvent(event) {
  publish(sessionChannel(event.sessionId), { kind: "chat_event", event });
}
function publishRuntime(sessionId, running) {
  publish(sessionChannel(sessionId), { kind: "runtime", running });
}
function publishPendingInput(sessionId, pending2) {
  publish(sessionChannel(sessionId), { kind: "pending_input", pending: pending2 });
}
var STATE_KEY, globalRef, state;
var init_bus = __esm({
  "src/lib/realtime/bus.ts"() {
    "use strict";
    STATE_KEY = /* @__PURE__ */ Symbol.for("@flow/realtime-bus-state");
    globalRef = globalThis;
    if (!globalRef[STATE_KEY]) {
      globalRef[STATE_KEY] = { channels: /* @__PURE__ */ new Map() };
    }
    state = globalRef[STATE_KEY];
  }
});

// src/lib/agent-options.ts
function effortOptionsForModel(harness, model) {
  if (harness === "claude_code") {
    return EFFORT_OPTIONS.filter((option) => option.id !== "ultra");
  }
  if (harness !== "codex") return [];
  const supported = new Set(
    model?.supportedEfforts?.length ? model.supportedEfforts : ["low", "medium", "high", "xhigh"]
  );
  return EFFORT_OPTIONS.filter((option) => supported.has(option.id));
}
function providerIdForHarness(harness) {
  return harness === "codex" ? "codex" : "claude";
}
function modelBelongsToProvider(providerId, modelId, models = modelsForProvider(providerId)) {
  if (models.some((model) => model.id === modelId)) return true;
  if (providerId === "claude") {
    return modelId.startsWith("claude-") || ["opus", "sonnet", "haiku", "fable"].includes(modelId);
  }
  return /^(?:gpt-|o\d(?:-|$)|codex(?:-|$))/i.test(modelId);
}
function explicitModelForProvider(providerId, preferred, models = modelsForProvider(providerId)) {
  const catalog = models.length > 0 ? models : modelsForProvider(providerId);
  const modelId = preferred?.trim();
  if (modelId && modelBelongsToProvider(providerId, modelId, catalog)) {
    return catalog.find((model) => model.id === modelId) ?? { id: modelId, label: modelId };
  }
  return catalog[0] ?? {
    id: defaultModelFor(providerId),
    label: defaultModelFor(providerId)
  };
}
function explicitEffortForModel(harness, model, preferred) {
  const options = effortOptionsForModel(harness, model);
  const supported = new Set(options.map((option) => option.id));
  if (harness === "codex" && preferred && !model.supportedEfforts?.length) {
    return preferred;
  }
  if (preferred && supported.has(preferred)) return preferred;
  if (model.defaultEffort && supported.has(model.defaultEffort)) return model.defaultEffort;
  if (supported.has(DEFAULT_AGENT_EFFORT)) return DEFAULT_AGENT_EFFORT;
  return options[0]?.id ?? DEFAULT_AGENT_EFFORT;
}
function explicitAgentSelection(providerId, preferred = {}, models = modelsForProvider(providerId)) {
  const harness = providerHarnessKey(providerId);
  const model = explicitModelForProvider(providerId, preferred.model, models);
  return {
    providerId,
    harness,
    model: model.id,
    effort: explicitEffortForModel(harness, model, preferred.effort)
  };
}
function providerHarnessKey(id) {
  return id === "codex" ? "codex" : "claude_code";
}
function modelsForProvider(id) {
  return MODEL_OPTIONS[providerHarnessKey(id)] ?? [];
}
function defaultModelFor(id) {
  return modelsForProvider(id)[0]?.id ?? "";
}
var MODEL_OPTIONS, EFFORT_OPTIONS, DEFAULT_AGENT_EFFORT;
var init_agent_options = __esm({
  "src/lib/agent-options.ts"() {
    "use strict";
    MODEL_OPTIONS = {
      claude_code: [
        { id: "opus", label: "Opus", hint: "latest \xB7 top quality" },
        { id: "sonnet", label: "Sonnet", hint: "latest \xB7 balanced" },
        { id: "haiku", label: "Haiku", hint: "latest \xB7 fast + cheap" },
        { id: "fable", label: "Fable", hint: "latest" }
      ],
      codex: [
        { id: "gpt-5.5", label: "5.5", hint: "Frontier model for complex coding, research, and real-world work" },
        { id: "gpt-5.6-sol", label: "5.6 Sol", hint: "Latest frontier agentic coding model" },
        { id: "gpt-5.6-terra", label: "5.6 Terra", hint: "Balanced agentic coding model for everyday work" },
        { id: "gpt-5.6-luna", label: "5.6 Luna", hint: "Fast and affordable agentic coding model" },
        { id: "gpt-5.4", label: "5.4", hint: "Strong model for everyday coding" },
        { id: "gpt-5.4-mini", label: "5.4 Mini", hint: "Small, fast, and cost-efficient model for simpler coding tasks" },
        { id: "gpt-5.3-codex-spark", label: "5.3 Codex Spark", hint: "Ultra-fast coding model" }
      ]
    };
    EFFORT_OPTIONS = [
      { id: "low", label: "Low", shortLabel: "low", hint: "Minimal thinking, fastest" },
      { id: "medium", label: "Medium", shortLabel: "med", hint: "Balanced default" },
      { id: "high", label: "High", shortLabel: "high", hint: "More thinking budget" },
      { id: "xhigh", label: "Extra high", shortLabel: "xhigh", hint: "Heavy thinking budget" },
      { id: "max", label: "Max", shortLabel: "max", hint: "Maximum thinking budget" },
      {
        id: "ultra",
        label: "Ultra",
        shortLabel: "ultra",
        hint: "Maximum reasoning with automatic task delegation"
      }
    ];
    DEFAULT_AGENT_EFFORT = "medium";
  }
});

// src/lib/db/queries.ts
import { eq as eq2, and as and2, or, desc, asc, sql as sql2, gt, lt, inArray, isNull, isNotNull, gte, lte, getTableColumns } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import slugify2 from "@sindresorhus/slugify";
function listTasks(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length === 1) {
      conditions.push(eq2(tasks.status, statuses[0]));
    } else {
      conditions.push(inArray(tasks.status, statuses));
    }
  }
  if (filter.areaId) conditions.push(eq2(tasks.areaId, filter.areaId));
  if (filter.workspaceId) conditions.push(eq2(tasks.workspaceId, filter.workspaceId));
  if (filter.parentId) conditions.push(eq2(tasks.parentId, filter.parentId));
  if (filter.energy) conditions.push(eq2(tasks.energy, filter.energy));
  if (filter.q) conditions.push(sql2`${tasks.title} LIKE ${"%" + filter.q + "%"}`);
  const limit = filter.limit ?? 1e4;
  const offset = filter.offset ?? 0;
  const orderClauses = (() => {
    switch (filter.orderBy) {
      case "lastViewedAt":
        return [sql2`${tasks.lastViewedAt} DESC NULLS LAST`, desc(tasks.createdAt)];
      case "hardDeadline":
        return [sql2`${tasks.hardDeadline} ASC NULLS LAST`, desc(tasks.createdAt)];
      case "createdAt":
        return [desc(tasks.createdAt)];
      case "updatedAt":
        return [desc(tasks.updatedAt)];
      default:
        return [sql2`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt)];
    }
  })();
  const rows = db.select({
    ...getTableColumns(tasks),
    subtaskCount: sql2`(SELECT COUNT(*) FROM tasks t2 WHERE t2.parent_id = ${sql2.raw('"tasks"."id"')})`.as("subtaskCount"),
    subtaskPreview: sql2`(SELECT GROUP_CONCAT(t3.title, '|||') FROM (SELECT title FROM tasks t3 WHERE t3.parent_id = ${sql2.raw('"tasks"."id"')} LIMIT 4) t3)`.as("subtaskPreview")
  }).from(tasks).where(conditions.length > 0 ? and2(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
  return rows.map((r) => hydrateRow(r));
}
function getTask(id) {
  const db = getDb();
  return hydrateRow(db.select().from(tasks).where(eq2(tasks.id, id)).get());
}
function taskAttachmentText(description, body) {
  return `${description ?? ""}
${body ?? ""}`;
}
function createTask(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attachments = deriveAttachments({
    body: taskAttachmentText(input.description, input.body),
    prior: [],
    newUploads: input.attachments ?? []
  });
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.insert(tasks).values({
    ...rest,
    rawInput: input.rawInput ?? input.title,
    id: uuidv7(),
    status: input.status ?? "active",
    contextTags: input.contextTags ?? [],
    attachments: dehydrateAttachments(attachments) ?? [],
    timesDeferred: 0,
    createdAt: now,
    updatedAt: now
  }).returning().get());
  void upsertEmbedding("task", row2.id, buildEmbeddingText("task", row2));
  void syncEntity("task", row2.id);
  return row2;
}
function updateTask(id, input, meta) {
  const db = getDb();
  const existing = hydrateRow(db.select().from(tasks).where(eq2(tasks.id, id)).get());
  if (!existing) return null;
  const bodyChanged = Object.prototype.hasOwnProperty.call(input, "body");
  const descriptionChanged = Object.prototype.hasOwnProperty.call(input, "description");
  const attachmentsHint = input.attachments;
  const attachments = bodyChanged || descriptionChanged || attachmentsHint !== void 0 ? deriveAttachments({
    body: taskAttachmentText(
      descriptionChanged ? input.description : existing.description,
      bodyChanged ? input.body : existing.body
    ),
    prior: existing.attachments ?? [],
    newUploads: attachmentsHint ?? []
  }) : void 0;
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.update(tasks).set({
    ...rest,
    ...attachments !== void 0 ? { attachments: dehydrateAttachments(attachments) ?? [] } : {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq2(tasks.id, id)).returning().get());
  void upsertEmbedding("task", row2.id, buildEmbeddingText("task", row2));
  void syncEntity("task", row2.id);
  captureEntityVersion("task", row2.id, taskSnapshot(existing), taskSnapshot(row2), meta, existing.updatedAt);
  return row2;
}
function completeTask(id, note) {
  const db = getDb();
  const task = hydrateRow(db.select().from(tasks).where(eq2(tasks.id, id)).get());
  if (!task) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (task.recurrence) {
    db.insert(taskCompletions).values({
      id: uuidv7(),
      taskId: id,
      completedAt: now,
      note: note ?? null
    }).run();
    const nextDate = computeNextRecurrence(task.recurrence, now);
    const updated = hydrateRow(db.update(tasks).set({ nextRecurrenceAt: nextDate, lastProgressAt: now, updatedAt: now }).where(eq2(tasks.id, id)).returning().get());
    void syncEntity("task", updated.id);
    return { task: updated, recurring: true, nextRecurrenceAt: nextDate };
  } else {
    const updated = hydrateRow(db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(eq2(tasks.id, id)).returning().get());
    db.insert(taskCompletions).values({
      id: uuidv7(),
      taskId: id,
      completedAt: now,
      note: note ?? null
    }).run();
    void syncEntity("task", updated.id);
    return { task: updated, recurring: false };
  }
}
function computeNextRecurrence(recurrence, fromDate) {
  const date = new Date(fromDate);
  const lower = recurrence.toLowerCase();
  if (lower.includes("daily") || lower === "1d") {
    date.setDate(date.getDate() + 1);
  } else if (lower.includes("weekly") || lower === "1w") {
    date.setDate(date.getDate() + 7);
  } else if (lower.includes("monthly") || lower === "1m") {
    date.setMonth(date.getMonth() + 1);
  } else if (lower.includes("yearly") || lower === "1y") {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    const match = lower.match(/^(\d+)d$/);
    if (match) {
      date.setDate(date.getDate() + parseInt(match[1], 10));
    } else {
      date.setDate(date.getDate() + 7);
    }
  }
  return date.toISOString();
}
function listNotes(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.areaId) conditions.push(eq2(notes.areaId, filter.areaId));
  if (filter.workspaceId) conditions.push(eq2(notes.workspaceId, filter.workspaceId));
  if (filter.taskId) conditions.push(eq2(notes.taskId, filter.taskId));
  if (filter.status) conditions.push(eq2(notes.status, filter.status));
  if (filter.decisionsOnly) {
    conditions.push(sql2`LOWER(${notes.title}) LIKE 'decision: %'`);
  }
  const limit = filter.limit ?? 1e4;
  const offset = filter.offset ?? 0;
  const orderClauses = (() => {
    switch (filter.orderBy) {
      case "createdAt":
        return [desc(notes.createdAt)];
      case "updatedAt":
        return [desc(notes.updatedAt)];
      default:
        return [sql2`${notes.lastViewedAt} DESC NULLS LAST`, desc(notes.createdAt)];
    }
  })();
  const rows = db.select().from(notes).where(conditions.length > 0 ? and2(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
  return rows.map((r) => hydrateRow(r));
}
function getNote(id) {
  const db = getDb();
  return hydrateRow(db.select().from(notes).where(eq2(notes.id, id)).get());
}
function createNote(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attachments = deriveAttachments({
    body: input.body ?? "",
    prior: [],
    newUploads: input.attachments ?? []
  });
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.insert(notes).values({
    ...rest,
    id: uuidv7(),
    status: input.status ?? "active",
    contextTags: input.contextTags ?? [],
    attachments: dehydrateAttachments(attachments) ?? [],
    createdAt: now,
    updatedAt: now
  }).returning().get());
  void upsertEmbedding("note", row2.id, buildEmbeddingText("note", row2));
  void syncEntity("note", row2.id);
  return row2;
}
function updateNote(id, input, meta) {
  const db = getDb();
  const existing = hydrateRow(db.select().from(notes).where(eq2(notes.id, id)).get());
  if (!existing) return null;
  const bodyChanged = Object.prototype.hasOwnProperty.call(input, "body");
  const attachmentsHint = input.attachments;
  const attachments = bodyChanged || attachmentsHint !== void 0 ? deriveAttachments({
    body: bodyChanged ? input.body ?? "" : existing.body,
    prior: existing.attachments ?? [],
    newUploads: attachmentsHint ?? []
  }) : void 0;
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.update(notes).set({
    ...rest,
    ...attachments !== void 0 ? { attachments: dehydrateAttachments(attachments) ?? [] } : {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq2(notes.id, id)).returning().get());
  void upsertEmbedding("note", row2.id, buildEmbeddingText("note", row2));
  void syncEntity("note", row2.id);
  captureEntityVersion("note", row2.id, noteSnapshot(existing), noteSnapshot(row2), meta, existing.updatedAt);
  return row2;
}
function taskSnapshot(t) {
  return {
    title: t.title ?? null,
    body: t.body ?? "",
    description: t.description ?? null,
    status: t.status,
    energy: t.energy ?? null,
    effort: t.effort ?? null,
    hardDeadline: t.hardDeadline ?? null,
    resurfaceAfter: t.resurfaceAfter ?? null,
    recurrence: t.recurrence ?? null,
    blockedOn: t.blockedOn ?? null,
    outcome: t.outcome ?? null,
    userContext: t.userContext ?? null
  };
}
function noteSnapshot(n) {
  return {
    title: n.title ?? null,
    body: n.body,
    url: n.url ?? null,
    status: n.status
  };
}
function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function captureEntityVersion(entityType, entityId, before, after, meta, baselineCreatedAt) {
  if (snapshotsEqual(before, after)) return;
  try {
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = db.select({ c: sql2`count(*)` }).from(entityVersions).where(and2(eq2(entityVersions.entityType, entityType), eq2(entityVersions.entityId, entityId))).get();
    if ((existing?.c ?? 0) === 0) {
      db.insert(entityVersions).values({
        id: uuidv7(),
        entityType,
        entityId,
        snapshot: before,
        source: "human",
        createdAt: baselineCreatedAt
      }).run();
    }
    db.insert(entityVersions).values({
      id: uuidv7(),
      entityType,
      entityId,
      snapshot: after,
      source: meta?.source ?? "human",
      actorSessionId: meta?.actorSessionId ?? null,
      summary: meta?.summary ?? null,
      revertedFromVersionId: meta?.revertedFromVersionId ?? null,
      createdAt: now
    }).run();
  } catch (err) {
    console.error(`[queries] failed to capture version for ${entityType} ${entityId}:`, err);
  }
}
function listStream(filter = {}) {
  const db = getDb();
  const rows = db.select().from(stream).where(filter.status ? eq2(stream.status, filter.status) : void 0).orderBy(desc(stream.createdAt)).limit(filter.limit ?? 100).offset(filter.offset ?? 0).all();
  return rows.map((r) => hydrateRow(r));
}
function getStream(id) {
  const db = getDb();
  return hydrateRow(db.select().from(stream).where(eq2(stream.id, id)).get());
}
function createStream(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attachments = deriveAttachments({
    body: input.rawText ?? "",
    prior: [],
    newUploads: input.attachments ?? []
  });
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.insert(stream).values({
    ...rest,
    id: uuidv7(),
    source: input.source ?? "capture",
    status: input.status ?? "pending",
    attachments: dehydrateAttachments(attachments) ?? [],
    createdAt: input.createdAt ?? now
  }).returning().get());
  void upsertEmbedding("stream", row2.id, buildEmbeddingText("stream", row2));
  void syncEntity("stream", row2.id);
  return row2;
}
function updateStream(id, input) {
  const db = getDb();
  const existing = hydrateRow(db.select().from(stream).where(eq2(stream.id, id)).get());
  if (!existing) return null;
  const bodyChanged = Object.prototype.hasOwnProperty.call(input, "rawText");
  const attachmentsHint = input.attachments;
  const attachments = bodyChanged || attachmentsHint !== void 0 ? deriveAttachments({
    body: bodyChanged ? input.rawText ?? "" : existing.rawText,
    prior: existing.attachments ?? [],
    newUploads: attachmentsHint ?? []
  }) : void 0;
  const rest = withoutAttachments(input);
  const row2 = hydrateRow(db.update(stream).set({
    ...rest,
    ...attachments !== void 0 ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}
  }).where(eq2(stream.id, id)).returning().get());
  void upsertEmbedding("stream", row2.id, buildEmbeddingText("stream", row2));
  void syncEntity("stream", row2.id);
  return row2;
}
function dismissStream(id, dismissedBy = "user") {
  return updateStream(id, { status: "dismissed", dismissedBy });
}
function listAreas(filter = {}) {
  const db = getDb();
  const status = filter.status ?? "active";
  const rows = db.select().from(areas).where(status !== "all" ? eq2(areas.status, status) : void 0).orderBy(asc(areas.sortOrder)).all();
  return rows.map((r) => hydrateRow(r));
}
function getArea(id) {
  const db = getDb();
  return hydrateRow(db.select().from(areas).where(eq2(areas.id, id)).get());
}
function createArea(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { attachments: inputAttachments, ...rest } = input;
  const row2 = hydrateRow(db.insert(areas).values({
    ...rest,
    id: uuidv7(),
    status: input.status ?? "active",
    attachments: dehydrateAttachments(inputAttachments) ?? [],
    createdAt: now,
    updatedAt: now
  }).returning().get());
  void syncEntity("area", row2.id);
  return row2;
}
function updateArea(id, input) {
  const db = getDb();
  const existing = hydrateRow(db.select().from(areas).where(eq2(areas.id, id)).get());
  if (!existing) return null;
  const { attachments: inputAttachments, ...rest } = input;
  const row2 = hydrateRow(db.update(areas).set({
    ...rest,
    ...inputAttachments !== void 0 ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq2(areas.id, id)).returning().get());
  if (row2) void syncEntity("area", row2.id);
  return row2;
}
function getLatestDeck() {
  const db = getDb();
  return db.select().from(decks).orderBy(desc(decks.createdAt)).limit(1).all()[0] ?? null;
}
function getDeck(id) {
  const db = getDb();
  return db.select().from(decks).where(eq2(decks.id, id)).get();
}
function updateDeck(id, input) {
  const db = getDb();
  const deck = db.update(decks).set({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq2(decks.id, id)).returning().get();
  return deck ?? null;
}
function getActiveDeckForDate(date) {
  const db = getDb();
  return db.select().from(decks).where(and2(eq2(decks.forDate, date), isNull(decks.supersededAt))).orderBy(desc(decks.createdAt)).limit(1).all()[0] ?? null;
}
function getDeckVersions(date) {
  const db = getDb();
  return db.select().from(decks).where(eq2(decks.forDate, date)).orderBy(asc(decks.createdAt)).all();
}
function supersedeAndInsertDeck(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return db.transaction((tx) => {
    const prior = tx.select().from(decks).where(and2(eq2(decks.forDate, input.forDate), isNull(decks.supersededAt))).orderBy(desc(decks.createdAt)).all();
    for (const p of prior) {
      tx.update(decks).set({ supersededAt: now, updatedAt: now }).where(eq2(decks.id, p.id)).run();
    }
    return tx.insert(decks).values({
      ...input,
      id: uuidv7(),
      replacesDeckId: prior[0]?.id ?? null,
      supersededAt: null
    }).returning().get();
  });
}
function getUserState() {
  const db = getDb();
  return db.select().from(userState).where(eq2(userState.id, 1)).get();
}
function getWorkdayBounds() {
  const us = getUserState();
  return {
    workdayStart: us?.workdayStart ?? "09:00",
    workdayEnd: us?.workdayEnd ?? "18:00"
  };
}
function updateUserState(input) {
  const db = getDb();
  return db.update(userState).set({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq2(userState.id, 1)).returning().get();
}
function createApiKey(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const token = generateToken(input.env ?? "live");
  const key = db.insert(apiKeys).values({
    ...input,
    id: uuidv7(),
    prefix: token.prefix,
    suffix: token.suffix,
    hash: token.hash,
    env: token.env,
    deviceType: input.deviceType ?? "other",
    createdAt: now,
    updatedAt: now
  }).returning().get();
  return { key, token };
}
function findApiKeyByHash(hash) {
  const db = getDb();
  return db.select().from(apiKeys).where(eq2(apiKeys.hash, hash)).get();
}
function deriveUniqueWorkspaceSlug(name) {
  const db = getDb();
  const base4 = slugify2(name) || "workspace";
  let candidate = base4;
  let suffix = 2;
  while (db.select({ id: workspaces.id }).from(workspaces).where(eq2(workspaces.slug, candidate)).get()) {
    candidate = `${base4}-${suffix++}`;
  }
  return candidate;
}
function listWorkspaces(filter = {}) {
  const db = getDb();
  const status = filter.status ?? "active";
  const rows = db.select({
    ...getTableColumns(workspaces),
    sessionCount: sql2`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql2.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as("sessionCount"),
    needsReviewCandidateCount: sql2`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql2.raw('"workspaces"."id"')}
          AND cs.status = 'active'
          AND cs.last_outcome_event_at IS NOT NULL
          AND cs.last_outcome_event_at > COALESCE(cs.last_viewed_at, '1970-01-01')
      )`.as("needsReviewCandidateCount"),
    activeSessionCount: sql2`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql2.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as("activeSessionCount")
  }).from(workspaces).where(eq2(workspaces.status, status)).orderBy(asc(workspaces.position), asc(workspaces.createdAt)).all();
  return rows.map((r) => hydrateRow(r));
}
function getWorkspace(id) {
  const db = getDb();
  return hydrateRow(db.select().from(workspaces).where(eq2(workspaces.id, id)).get());
}
function createWorkspace(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const slug = input.slug ?? deriveUniqueWorkspaceSlug(input.name);
  const maxPosition = db.select({ max: sql2`MAX(${workspaces.position})` }).from(workspaces).get();
  const position = input.position ?? (maxPosition?.max ?? -1) + 1;
  const { attachments: inputAttachments, ...rest } = input;
  const row2 = hydrateRow(db.insert(workspaces).values({
    ...rest,
    id: uuidv7(),
    slug,
    position,
    status: input.status ?? "active",
    ...inputAttachments !== void 0 ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {},
    createdAt: now,
    updatedAt: now
  }).returning().get());
  return row2;
}
function archiveWorkspace(id) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const db = getDb();
  const row2 = hydrateRow(db.update(workspaces).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq2(workspaces.id, id)).returning().get());
  return row2 ?? null;
}
function getAgent(id) {
  const db = getDb();
  return db.select().from(agents).where(eq2(agents.id, id)).get();
}
function createAgent(input) {
  const db = getDb();
  const row2 = db.insert(agents).values({
    ...input,
    id: uuidv7(),
    status: input.status ?? "active"
  }).returning().get();
  return row2;
}
function getOrCreateDefaultExecutor(harness) {
  const db = getDb();
  const existing = db.select().from(agents).where(and2(eq2(agents.kind, "executor"), eq2(agents.harness, harness), eq2(agents.status, "active"))).orderBy(asc(agents.createdAt)).limit(1).get();
  if (existing) return existing;
  return createAgent({
    kind: "executor",
    harness,
    name: harness === "claude_code" ? "Claude Code" : harness,
    config: {}
  });
}
function getOrCreateDefaultOrchestrator(harness = "claude_code") {
  const db = getDb();
  const existing = db.select().from(agents).where(and2(eq2(agents.kind, "orchestrator"), eq2(agents.status, "active"), eq2(agents.harness, harness))).orderBy(asc(agents.createdAt)).limit(1).get();
  if (existing) return existing;
  return createAgent({
    kind: "orchestrator",
    harness,
    name: "Orchestrator",
    config: {}
  });
}
function getExecution(id) {
  const db = getDb();
  return db.select().from(executions).where(eq2(executions.id, id)).get();
}
function updateExecution(id, input) {
  const db = getDb();
  const row2 = db.update(executions).set({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq2(executions.id, id)).returning().get();
  return row2 ?? null;
}
function markExecutionSetupComplete(executionId, params) {
  return updateExecution(executionId, {
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    baseSha: params.baseSha,
    setupError: null
  });
}
function recordExecutionSetupError(executionId, error) {
  return updateExecution(executionId, { setupError: error });
}
function setExecutionSetupScript(executionId, status, error) {
  return updateExecution(executionId, {
    setupScriptStatus: status,
    ...error !== void 0 ? { setupScriptError: error } : {}
  });
}
function resetExecutionForReprovision(executionId) {
  return updateExecution(executionId, {
    worktreePath: null,
    branchName: null,
    baseSha: null,
    setupStartedAt: (/* @__PURE__ */ new Date()).toISOString(),
    setupError: null
  });
}
function flattenSessionExecution(row2) {
  const e = row2.execution && row2.execution.id != null ? row2.execution : null;
  return {
    ...row2,
    execution: e,
    worktreePath: e?.worktreePath ?? null,
    branchName: e?.branchName ?? null,
    baseSha: e?.baseSha ?? null,
    prNumber: e?.prNumber ?? null,
    setupError: e?.setupError ?? null,
    setupStartedAt: e?.setupStartedAt ?? null,
    setupScriptStatus: e?.setupScriptStatus ?? null,
    setupScriptError: e?.setupScriptError ?? null,
    takeoverStartedAt: e?.takeoverStartedAt ?? null,
    takeoverBaseSha: e?.takeoverBaseSha ?? null,
    takeoverBranch: e?.takeoverBranch ?? null,
    takeoverToken: e?.takeoverToken ?? null,
    takeoverTokenExpiresAt: e?.takeoverTokenExpiresAt ?? null
  };
}
function getChatSessionWithExecution(id) {
  const db = getDb();
  const row2 = db.select({
    ...getTableColumns(chatSessions),
    execution: getTableColumns(executions)
  }).from(chatSessions).leftJoin(executions, eq2(chatSessions.executionId, executions.id)).where(eq2(chatSessions.id, id)).get();
  if (!row2) return null;
  return flattenSessionExecution(row2);
}
function listChatSessions(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.workspaceId) conditions.push(eq2(chatSessions.workspaceId, filter.workspaceId));
  if (filter.executionId) conditions.push(eq2(chatSessions.executionId, filter.executionId));
  if (filter.status) conditions.push(eq2(chatSessions.status, filter.status));
  if (filter.type) conditions.push(eq2(chatSessions.type, filter.type));
  const rows = db.select({
    ...getTableColumns(chatSessions),
    execution: getTableColumns(executions)
  }).from(chatSessions).leftJoin(executions, eq2(chatSessions.executionId, executions.id)).where(conditions.length > 0 ? and2(...conditions) : void 0).orderBy(sql2`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`).all();
  return rows.map((r) => flattenSessionExecution(r));
}
function getChatSession(id) {
  const db = getDb();
  return db.select().from(chatSessions).where(eq2(chatSessions.id, id)).get();
}
function updateChatSession(id, input) {
  const db = getDb();
  const row2 = db.update(chatSessions).set(input).where(eq2(chatSessions.id, id)).returning().get();
  return row2 ?? null;
}
function createExecutionWithChat(params) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const agent = db.select().from(agents).where(eq2(agents.id, params.agentId)).get();
  const selection = explicitAgentSelection(
    providerIdForHarness(agent?.harness),
    { model: params.model, effort: params.effort }
  );
  return db.transaction((tx) => {
    const executionId = uuidv7();
    const execution = tx.insert(executions).values({
      id: executionId,
      workspaceId: params.workspaceId,
      label: params.label,
      worktreePath: params.worktreePath ?? null,
      branchName: params.branchName ?? null,
      baseSha: params.baseSha ?? null,
      prNumber: params.prNumber ?? null,
      setupStartedAt: params.setupStartedAt ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now
    }).returning().get();
    const session = tx.insert(chatSessions).values({
      id: params.chatSessionId ?? uuidv7(),
      agentId: params.agentId,
      type: "execution",
      workspaceId: params.workspaceId,
      executionId,
      label: params.label,
      status: "active",
      // ISO (UTC) to match the execution's timestamps and to sort
      // consistently against ISO outcome/unread timestamps (the SQLite
      // `datetime('now')` default would store the space-format instead).
      startedAt: now,
      model: selection.model,
      effort: selection.effort
    }).returning().get();
    return { execution, session };
  });
}
function bumpSessionOutcome(id, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const db = getDb();
  db.update(chatSessions).set({ lastOutcomeEventAt: at }).where(eq2(chatSessions.id, id)).run();
}
function listRailSessions() {
  const db = getDb();
  const rows = db.select({
    ...getTableColumns(chatSessions),
    execution: getTableColumns(executions),
    workspaceName: workspaces.name,
    workspaceEmoji: workspaces.emoji,
    workspaceAttachments: workspaces.attachments,
    workspaceAreaId: workspaces.areaId,
    workspaceIsGit: workspaces.isGit
  }).from(executions).innerJoin(
    workspaces,
    and2(eq2(workspaces.id, executions.workspaceId), eq2(workspaces.status, "active"))
  ).innerJoin(
    chatSessions,
    sql2`${chatSessions.id} = (
        SELECT cs2.id FROM chat_sessions cs2
        WHERE cs2.execution_id = ${executions.id} AND cs2.status = 'active'
        ORDER BY COALESCE(cs2.last_outcome_event_at, cs2.started_at) DESC
        LIMIT 1
      )`
  ).where(eq2(executions.status, "active")).orderBy(sql2`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`).all();
  return rows.map((r) => hydrateRailRow(r));
}
function hydrateRailRow(row2) {
  const { workspaceAttachments, ...rest } = row2;
  const flat = flattenSessionExecution(rest);
  return {
    ...flat,
    workspaceAttachments: workspaceAttachments ? camelizeKeys(workspaceAttachments) : null
  };
}
function insertChatEvent(input) {
  const db = getDb();
  const id = input.id ?? uuidv7();
  const { attachments: inputAttachments, ...rest } = input;
  const rows = db.insert(chatEvents).values({
    ...rest,
    id,
    ...inputAttachments !== void 0 ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}
  }).onConflictDoNothing().returning().all();
  if (rows.length === 0) return null;
  const row2 = hydrateRow(rows[0]);
  if (OUTCOME_SOURCES.has(input.source)) {
    bumpSessionOutcome(input.sessionId, input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString());
  }
  publishChatEvent(row2);
  return row2;
}
function listChatEvents(sessionId, opts = {}) {
  const db = getDb();
  const limit = opts.limit ?? CHAT_PAGE_SIZE;
  if (opts.before) {
    const anchor = db.select({ createdAt: chatEvents.createdAt, id: chatEvents.id }).from(chatEvents).where(eq2(chatEvents.id, opts.before)).limit(1).get();
    if (!anchor) return [];
    const older = db.select().from(chatEvents).where(
      and2(
        eq2(chatEvents.sessionId, sessionId),
        or(
          lt(chatEvents.createdAt, anchor.createdAt),
          and2(eq2(chatEvents.createdAt, anchor.createdAt), lt(chatEvents.id, anchor.id))
        )
      )
    ).orderBy(desc(chatEvents.createdAt), desc(chatEvents.id)).limit(limit).all();
    return older.reverse().map((r) => hydrateRow(r));
  }
  const offset = opts.offset ?? 0;
  const tail = db.select().from(chatEvents).where(eq2(chatEvents.sessionId, sessionId)).orderBy(desc(chatEvents.createdAt), desc(chatEvents.id)).limit(limit).offset(offset).all();
  return tail.reverse().map((r) => hydrateRow(r));
}
function listRecentChatEvents(sessionId, limit = 30) {
  const db = getDb();
  const rows = db.select().from(chatEvents).where(eq2(chatEvents.sessionId, sessionId)).orderBy(desc(chatEvents.createdAt), desc(chatEvents.id)).limit(limit).all();
  return rows.map((r) => hydrateRow(r));
}
function listTriggers(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.enabled != null) conditions.push(eq2(triggers.enabled, filter.enabled));
  if (filter.kind) conditions.push(eq2(triggers.kind, filter.kind));
  if (filter.targetKind) conditions.push(eq2(triggers.targetKind, filter.targetKind));
  if (filter.workspaceId === null) conditions.push(isNull(triggers.workspaceId));
  else if (filter.workspaceId) conditions.push(eq2(triggers.workspaceId, filter.workspaceId));
  let query = db.select().from(triggers).$dynamic();
  if (conditions.length > 0) query = query.where(and2(...conditions));
  query = query.orderBy(desc(triggers.createdAt));
  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.offset(filter.offset);
  return query.all();
}
function getTrigger(id) {
  const db = getDb();
  return db.select().from(triggers).where(eq2(triggers.id, id)).get();
}
function findTriggerByName(name, workspaceId) {
  const db = getDb();
  const scopeFilter = workspaceId == null ? isNull(triggers.workspaceId) : eq2(triggers.workspaceId, workspaceId);
  return db.select().from(triggers).where(and2(eq2(triggers.name, name), scopeFilter)).get();
}
function createTrigger(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return db.insert(triggers).values({
    ...input,
    id: input.id ?? uuidv7(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  }).returning().get();
}
function updateTrigger(id, input) {
  const db = getDb();
  const row2 = db.update(triggers).set({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq2(triggers.id, id)).returning().get();
  return row2 ?? null;
}
function deleteTrigger(id) {
  const db = getDb();
  const result = db.delete(triggers).where(eq2(triggers.id, id)).run();
  return result.changes > 0;
}
function setTriggerLastRun(id, runId, status) {
  const current = getTrigger(id);
  if (!current) return null;
  const nextFailures = status === "failed" ? current.consecutiveFailures + 1 : 0;
  return updateTrigger(id, {
    lastRunId: runId,
    lastRunStatus: status,
    consecutiveFailures: nextFailures
  });
}
function resetTriggerFailures(id) {
  return updateTrigger(id, { consecutiveFailures: 0 });
}
function listTriggersWithLastRun(filter = {}) {
  const list2 = listTriggers(filter);
  if (list2.length === 0) return [];
  const db = getDb();
  const ids = list2.map((s) => s.lastRunId).filter((id) => !!id);
  const lastRuns = ids.length ? db.select().from(runs).where(inArray(runs.id, ids)).all() : [];
  const byId = new Map(lastRuns.map((r) => [r.id, r]));
  return list2.map((s) => ({
    ...s,
    lastRun: s.lastRunId ? byId.get(s.lastRunId) ?? null : null
  }));
}
function listRuns(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.status) {
    const arr = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(arr.length === 1 ? eq2(runs.status, arr[0]) : inArray(runs.status, arr));
  }
  if (filter.trigger) {
    const arr = Array.isArray(filter.trigger) ? filter.trigger : [filter.trigger];
    conditions.push(
      arr.length === 1 ? eq2(runs.triggerKind, arr[0]) : inArray(runs.triggerKind, arr)
    );
  }
  if (filter.triggerId) conditions.push(eq2(runs.triggerId, filter.triggerId));
  if (filter.agentId) conditions.push(eq2(runs.agentId, filter.agentId));
  if (filter.executionId) conditions.push(eq2(runs.executionId, filter.executionId));
  if (filter.workspaceId) conditions.push(eq2(runs.workspaceId, filter.workspaceId));
  if (filter.since) conditions.push(gte(runs.startedAt, filter.since));
  let query = db.select().from(runs).$dynamic();
  if (conditions.length > 0) query = query.where(and2(...conditions));
  query = query.orderBy(desc(runs.createdAt));
  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.offset(filter.offset);
  return query.all();
}
function getRun(id) {
  const db = getDb();
  return db.select().from(runs).where(eq2(runs.id, id)).get();
}
function createRun(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return db.insert(runs).values({
    ...input,
    id: input.id ?? uuidv7(),
    queuedAt: input.queuedAt ?? now,
    createdAt: input.createdAt ?? now
  }).returning().get();
}
function updateRun(id, input) {
  const db = getDb();
  const row2 = db.update(runs).set(input).where(eq2(runs.id, id)).returning().get();
  return row2 ?? null;
}
function markRunStarted(id, startedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  return updateRun(id, { status: "running", startedAt });
}
function markRunCompleted(id, patch = {}) {
  const current = getRun(id);
  if (!current) return null;
  if (current.status !== "queued" && current.status !== "running") return current;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  const durationMs = current.startedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(current.startedAt).getTime()) : null;
  return updateRun(id, {
    ...patch,
    status: "completed",
    completedAt,
    durationMs
  });
}
function markRunFailed(id, patch = { errorCode: "agent_error", errorMessage: "unknown" }) {
  const current = getRun(id);
  if (!current) return null;
  if (current.status !== "queued" && current.status !== "running") return current;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  const durationMs = current.startedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(current.startedAt).getTime()) : null;
  return updateRun(id, {
    status: "failed",
    completedAt,
    durationMs,
    errorCode: patch.errorCode,
    errorMessage: patch.errorMessage.slice(0, 2e3),
    statusReason: patch.statusReason ?? null
  });
}
function findActiveRunForExecution(executionId) {
  const db = getDb();
  return db.select().from(runs).where(and2(eq2(runs.executionId, executionId), eq2(runs.status, "running"))).get();
}
function findActiveRunForTrigger(triggerId) {
  const db = getDb();
  return db.select().from(runs).where(and2(eq2(runs.triggerId, triggerId), eq2(runs.status, "running"))).get();
}
function sumRunCostSince(sinceIso) {
  const db = getDb();
  const row2 = db.select({ total: sql2`COALESCE(SUM(${runs.costUsd}), 0)` }).from(runs).where(gte(runs.startedAt, sinceIso)).get();
  return row2?.total ?? 0;
}
function listNotificationChannels(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.userId) conditions.push(eq2(notificationChannels.userId, filter.userId));
  if (filter.enabled != null) conditions.push(eq2(notificationChannels.enabled, filter.enabled));
  if (filter.connectionId) conditions.push(eq2(notificationChannels.connectionId, filter.connectionId));
  let query = db.select().from(notificationChannels).$dynamic();
  if (conditions.length > 0) query = query.where(and2(...conditions));
  return query.orderBy(desc(notificationChannels.createdAt)).all();
}
function getNotificationChannel(id) {
  return getDb().select().from(notificationChannels).where(eq2(notificationChannels.id, id)).get();
}
function listWebPushSubscriptions(userId) {
  return getDb().select().from(webPushSubscriptions).where(eq2(webPushSubscriptions.userId, userId)).all();
}
function deleteWebPushSubscriptionByEndpoint(endpoint) {
  const result = getDb().delete(webPushSubscriptions).where(eq2(webPushSubscriptions.endpoint, endpoint)).run();
  return result.changes > 0;
}
function upsertDelivery(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = db.insert(notificationDeliveries).values({ ...input, id: input.id ?? uuidv7(), createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now }).onConflictDoNothing({ target: [notificationDeliveries.dedupeKey, notificationDeliveries.channelId] }).run();
  return result.changes > 0;
}
function listProcessableDeliveries(dedupeKey, channelIds) {
  if (channelIds.length === 0) return [];
  return getDb().select().from(notificationDeliveries).where(
    and2(
      eq2(notificationDeliveries.dedupeKey, dedupeKey),
      inArray(notificationDeliveries.channelId, channelIds),
      inArray(notificationDeliveries.status, ["pending", "failed"])
    )
  ).all();
}
function markDeliverySent(id, patch) {
  getDb().update(notificationDeliveries).set({
    status: "sent",
    sentAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    attempts: sql2`${notificationDeliveries.attempts} + 1`,
    ...patch.providerMessageId !== void 0 ? { providerMessageId: patch.providerMessageId } : {},
    ...patch.rendered !== void 0 ? { rendered: patch.rendered } : {}
  }).where(eq2(notificationDeliveries.id, id)).run();
}
function markDeliveryFailed(id, lastError) {
  getDb().update(notificationDeliveries).set({
    status: "failed",
    lastError: lastError.slice(0, 2e3),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    attempts: sql2`${notificationDeliveries.attempts} + 1`
  }).where(eq2(notificationDeliveries.id, id)).run();
}
var init_queries = __esm({
  "src/lib/db/queries.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_embed();
    init_mirror();
    init_parse_markers();
    init_chat();
    init_types();
    init_tokens();
    init_derive();
    init_bus();
    init_hydrate();
    init_keys();
    init_agent_options();
  }
});

// src/lib/auth/port.ts
function getRunningPort(fallback = DEFAULT_PORT) {
  const env = process.env.PORT;
  if (env && Number.isFinite(Number(env))) return Number(env);
  const saved = readAuthConfig()?.lastPort;
  if (saved && Number.isFinite(saved)) return saved;
  return fallback;
}
function setRunningPort(port) {
  writeAuthConfig({ lastPort: port });
}
var DEFAULT_PORT, DEV_PORT;
var init_port = __esm({
  "src/lib/auth/port.ts"() {
    "use strict";
    init_config_file();
    DEFAULT_PORT = 4224;
    DEV_PORT = 42241;
  }
});

// src/lib/auth/bootstrap.ts
import os2 from "os";
function getStaticUrl() {
  return readAuthConfig()?.staticUrl ?? null;
}
function setStaticUrl(url) {
  writeAuthConfig({ staticUrl: url });
}
function getLocalBaseUrl() {
  return getStaticUrl() ?? `http://localhost:${getRunningPort()}`;
}
function getLanIp() {
  const nets = os2.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net2 of nets[name] ?? []) {
      if (net2.family === "IPv4" && !net2.internal) return net2.address;
    }
  }
  return null;
}
function getLanBaseUrl() {
  const ip = getLanIp();
  return ip ? `http://${ip}:${getRunningPort()}` : null;
}
function buildPairingUrl(token, baseUrl = getLocalBaseUrl()) {
  return `${baseUrl}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${token}`;
}
function getRemoteBaseUrl() {
  return readAuthConfig()?.tunnelUrl ?? null;
}
function setRemoteBaseUrl(raw) {
  const normalized = normalizeBaseUrl(raw);
  writeAuthConfig({ tunnelUrl: normalized });
  return normalized;
}
function clearRemoteBaseUrl() {
  writeAuthConfig({ tunnelUrl: null });
}
function normalizeBaseUrl(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL cannot be empty");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  return `${parsed.protocol}//${parsed.host}`;
}
function ensureLocalToken() {
  const existing = readAuthConfig();
  if (existing?.localToken) {
    const row2 = findApiKeyByHash(hashToken(existing.localToken));
    if (row2 && !row2.revokedAt) {
      return {
        plaintext: existing.localToken,
        pairingUrl: buildPairingUrl(existing.localToken),
        created: false
      };
    }
  }
  const { token } = createApiKey({
    name: `${os2.hostname()} (host)`,
    deviceType: "host",
    description: "Auto-generated local host token"
  });
  writeAuthConfig({ localToken: token.plaintext });
  return {
    plaintext: token.plaintext,
    pairingUrl: buildPairingUrl(token.plaintext),
    created: true
  };
}
var init_bootstrap = __esm({
  "src/lib/auth/bootstrap.ts"() {
    "use strict";
    init_app();
    init_config_file();
    init_tokens();
    init_queries();
    init_port();
  }
});

// src/lib/agent-skills/shipped.ts
import fs7 from "fs";
import path7 from "path";
import { fileURLToPath } from "url";
async function loadAgentex() {
  return import("@agentex/agent");
}
function findPackageRoot(startDir) {
  let dir = startDir;
  while (dir !== path7.parse(dir).root) {
    if (fs7.existsSync(path7.join(dir, "package.json"))) return dir;
    dir = path7.dirname(dir);
  }
  throw new Error(`Could not find package.json walking up from ${startDir}`);
}
function shippedSkillDirs() {
  return SHIPPED_SKILL_NAMES.map((name) => path7.join(SKILLS_ROOT, name));
}
function getGlobalSkillPreference() {
  return readAuthConfig()?.globalSkillEnabled ?? null;
}
async function installAppRootSkills() {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), {
    location: "workspace",
    cwd: getAppRoot()
  });
}
async function installGlobalSkills() {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), { location: "global" });
}
async function removeAppRootSkills() {
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), {
    location: "workspace",
    cwd: getAppRoot()
  });
}
async function removeGlobalSkills() {
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), { location: "global" });
}
async function configureGlobalSkill(enabled) {
  if (enabled) {
    const install = await installGlobalSkills();
    writeAuthConfig({ globalSkillEnabled: true });
    return { enabled: true, install };
  }
  const remove2 = await removeGlobalSkills();
  writeAuthConfig({ globalSkillEnabled: false });
  return { enabled: false, remove: remove2 };
}
async function removeOwnedProjectSkillLinks(cwd) {
  if (path7.resolve(cwd) === path7.resolve(getAppRoot())) {
    return { entries: [], removed: 0 };
  }
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), { location: "workspace", cwd });
}
var MODULE_DIR, SKILLS_ROOT, SHIPPED_SKILL_NAMES;
var init_shipped = __esm({
  "src/lib/agent-skills/shipped.ts"() {
    "use strict";
    init_paths();
    init_config_file();
    MODULE_DIR = path7.dirname(fileURLToPath(import.meta.url));
    SKILLS_ROOT = path7.join(findPackageRoot(MODULE_DIR), "skills");
    SHIPPED_SKILL_NAMES = ["orchestrator"];
  }
});

// src/lib/utils/sanitize-child-env.ts
function sanitizeChildEnv(extra) {
  const out = { ...process.env };
  for (const k of Object.keys(out)) {
    if (STATIC_DROP.has(k)) {
      out[k] = void 0;
      continue;
    }
    for (const prefix of DROP_PREFIXES) {
      if (k.startsWith(prefix)) {
        out[k] = void 0;
        break;
      }
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      out[k] = v;
    }
  }
  return out;
}
var STATIC_DROP, DROP_PREFIXES;
var init_sanitize_child_env = __esm({
  "src/lib/utils/sanitize-child-env.ts"() {
    "use strict";
    STATIC_DROP = /* @__PURE__ */ new Set([
      // Flow's own run mode must not cross into the user's app processes. If Flow
      // runs as a production server (NODE_ENV=production), a child `yarn install`
      // would SKIP devDependencies (breaking dev servers that need them, e.g. a
      // next.config that requires a dev-only module), and `next dev` would warn /
      // misbehave on a non-standard value. Dropped → each tool defaults its own
      // (`next dev`→development, `next build`→production, installs→full).
      "NODE_ENV",
      // Network / binding — would force the child onto Flow's port.
      "PORT",
      "HOST",
      // Next.js internal worker plumbing — leaks Flow's identity into a
      // child Next dev server.
      "TURBOPACK",
      "NEXT_RUNTIME",
      "NEXT_PRIVATE_WORKER",
      "NEXT_PRIVATE_TRACE_ID",
      "NEXT_DEPLOYMENT_ID",
      "__NEXT_PRIVATE_ORIGIN",
      "__NEXT_PROCESSED_ENV",
      // Portless inheritance — if Flow itself was started under
      // `portless run`, these point at Flow's allocation, not the child's.
      "PORTLESS_URL",
      "PORTLESS_TAILSCALE_URL",
      "PORTLESS_APP_PORT",
      "NODE_EXTRA_CA_CERTS"
    ]);
    DROP_PREFIXES = ["__NEXT_", "NEXT_PRIVATE_", "FLOW_"];
  }
});

// src/lib/workspaces/index.ts
import { execFile } from "child_process";
import { existsSync } from "fs";
import path12 from "path";
import { promisify } from "util";
import slugify3 from "@sindresorhus/slugify";
function tailLines(text2, n = 20) {
  const lines = text2.replace(/\s+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}
async function runWorktreeScript(opts) {
  const env = sanitizeChildEnv({
    FLOW_SOURCE_CHECKOUT_PATH: opts.sourceCheckoutPath,
    FLOW_WORKTREE_PATH: opts.worktreePath,
    ...opts.branch ? { FLOW_BRANCH_NAME: opts.branch } : {}
  });
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-lc", opts.command], {
      cwd: opts.worktreePath,
      env,
      timeout: opts.timeoutMs ?? 15 * 6e4,
      maxBuffer: 8 * 1024 * 1024
    });
    return { ok: true, exitCode: 0, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err;
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message || "script failed";
    return { ok: false, exitCode: typeof e.code === "number" ? e.code : null, output };
  }
}
async function loadLib() {
  if (cached) return cached;
  cached = await import("@agentex/workspace");
  return cached;
}
function defaultWorktreeRoot(slug) {
  return path12.join(getWorkDir(), "worktrees", slug);
}
async function detectIsGit(absolutePath) {
  try {
    const lib = await loadLib();
    const kind = await lib.workspace.detectKind(absolutePath);
    return kind === "git";
  } catch {
    return false;
  }
}
async function detectBaseBranch(absolutePath, remote = "origin") {
  try {
    const lib = await loadLib();
    return await lib.workspace.detectDefaultBranch(absolutePath, remote);
  } catch {
    return null;
  }
}
function deriveSessionLabelSlug(label, sessionId) {
  const slug = label ? slugify3(label) : "";
  if (slug) return slug;
  return `session-${sessionId.slice(0, 8)}`;
}
function worktreeIdSuffix(sessionId) {
  return sessionId.slice(24, 30);
}
function buildWorktreeLeaf(slug, sessionId) {
  return `${slug}-${worktreeIdSuffix(sessionId)}`;
}
async function fetchPrHead(args) {
  const { ws, prNumber } = args;
  if (!ws.isGit) throw new Error("fetchPrHead called on non-git workspace");
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`fetchPrHead: invalid prNumber ${prNumber}`);
  }
  const remote = ws.remoteName ?? "origin";
  const localRef = `refs/agentex/pr/${prNumber}`;
  const refspec = `+refs/pull/${prNumber}/head:${localRef}`;
  await execFileAsync("git", ["fetch", remote, refspec], { cwd: ws.cwd });
  const { stdout } = await execFileAsync("git", ["rev-parse", localRef], { cwd: ws.cwd });
  return { ref: localRef, sha: stdout.trim() };
}
async function refreshBaseFromRemote(args) {
  const { ws, baseBranch } = args;
  const remote = ws.remoteName ?? "origin";
  const remoteSlashed = `${remote}/`;
  const branchName = baseBranch.startsWith(remoteSlashed) ? baseBranch.slice(remoteSlashed.length) : baseBranch;
  const refspec = `+refs/heads/${branchName}:refs/remotes/${remote}/${branchName}`;
  try {
    await execFileAsync("git", ["fetch", remote, refspec], { cwd: ws.cwd });
    return { ref: `${remote}/${branchName}`, fetched: true, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ref: branchName,
      fetched: false,
      warning: `Could not fetch ${remote}/${branchName}; using local branch (may be behind): ${msg}`
    };
  }
}
async function createWorktreeForSession(args) {
  const { ws, sessionId, sessionLabel, baseBranchOverride } = args;
  if (!ws.isGit) {
    throw new Error("createWorktreeForSession called on non-git workspace");
  }
  const trimmedOverride = baseBranchOverride?.trim();
  const requestedBase = trimmedOverride || ws.baseBranch;
  if (!requestedBase) {
    throw new Error(`Workspace ${ws.slug} has no baseBranch`);
  }
  let baseBranch = requestedBase;
  if (!trimmedOverride) {
    const refreshed = await refreshBaseFromRemote({ ws, baseBranch: requestedBase });
    baseBranch = refreshed.ref;
    if (refreshed.warning) {
      console.warn(`[workspaces] ${refreshed.warning}`);
    }
  }
  const lib = await loadLib();
  const root = ws.worktreeRoot ?? defaultWorktreeRoot(ws.slug);
  const worktreeLeafBase = buildWorktreeLeaf(ws.slug, sessionId);
  const labelSlug = deriveSessionLabelSlug(sessionLabel, sessionId);
  const baseBranchName = `${ws.slug}/${labelSlug}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const branch = attempt === 1 ? baseBranchName : `${baseBranchName}-${attempt}`;
    const worktreeLeaf = attempt === 1 ? worktreeLeafBase : `${worktreeLeafBase}-${attempt}`;
    const worktreePath = path12.join(root, worktreeLeaf);
    if (existsSync(worktreePath)) continue;
    try {
      const handle = await lib.workspace.create({
        kind: "git",
        source: ws.cwd,
        baseBranch,
        path: worktreePath,
        branch
      });
      if (handle.kind !== "git") {
        throw new Error("Expected git workspace handle");
      }
      return {
        path: handle.path,
        branch: handle.git.branch,
        baseSha: handle.git.baseSha
      };
    } catch (err) {
      if (err instanceof lib.BranchExistsError) continue;
      throw err;
    }
  }
  throw new Error(`Could not allocate a unique branch from ${baseBranchName}`);
}
async function resumeWorktreeForSession(args) {
  const { ws, worktreePath, branch, sessionId } = args;
  if (!ws.isGit) return null;
  if (existsSync(worktreePath)) return null;
  if (!ws.baseBranch) return null;
  const lib = await loadLib();
  try {
    const handle = await lib.workspace.create({
      kind: "git",
      source: ws.cwd,
      baseBranch: ws.baseBranch,
      path: worktreePath,
      branch,
      reuseBranch: true
      // `applyFromSource` defaults true → the lib copies the workspace's
      // configured `fromSource` block automatically. We still drive the
      // app-specific `filesToCopy` (env files) explicitly below for parity
      // with `createWorktreeForSession`.
    });
    if (handle.kind !== "git") return null;
    return {
      path: handle.path,
      branch: handle.git.branch,
      baseSha: handle.git.baseSha
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resumeWorktreeForSession] workspace.create failed for session ${sessionId}:`, msg);
    return null;
  }
}
var execFileAsync, cached;
var init_workspaces = __esm({
  "src/lib/workspaces/index.ts"() {
    "use strict";
    init_paths();
    init_sanitize_child_env();
    execFileAsync = promisify(execFile);
    cached = null;
  }
});

// src/lib/executor/skills.ts
import fs12 from "fs";
import path13 from "path";
function readSkillDir(root, scope) {
  if (!fs12.existsSync(root)) return [];
  let entries;
  try {
    entries = fs12.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skills] failed to enumerate ${root}:`, err);
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = path13.join(root, entry.name);
    const skillFile = path13.join(sourceDir, SKILL_FILE);
    try {
      if (!fs12.existsSync(skillFile)) continue;
    } catch {
      continue;
    }
    out.push({ name: entry.name, sourceDir, scope });
  }
  return out;
}
function resolveSkillsForSession(workspaceCwd) {
  const global = readSkillDir(path13.join(getBrainDir(), "skills"), "global");
  const workspace = workspaceCwd ? readSkillDir(path13.join(workspaceCwd, ".flow", "skills"), "workspace") : [];
  const byName = /* @__PURE__ */ new Map();
  for (const skill of global) byName.set(skill.name, skill);
  for (const skill of workspace) byName.set(skill.name, skill);
  return Array.from(byName.values());
}
function resolveSkillDirsForSession(workspaceCwd) {
  return resolveSkillsForSession(workspaceCwd).map((s) => s.sourceDir);
}
function inventorySkills(workspaceCwd) {
  return resolveSkillsForSession(workspaceCwd).map((s) => ({
    name: s.name,
    scope: s.scope,
    sourceDir: s.sourceDir
  }));
}
var SKILL_FILE;
var init_skills = __esm({
  "src/lib/executor/skills.ts"() {
    "use strict";
    init_paths();
    SKILL_FILE = "SKILL.md";
  }
});

// src/lib/deck/calendar.ts
function setCalendarProvider(fn) {
  provider = fn;
}
function hasCalendarProvider() {
  return provider != null;
}
async function getCalendarEventsForDay(date) {
  if (!provider) return [];
  try {
    return await provider(date);
  } catch (err) {
    console.error("[calendar] provider failed, treating day as open", err);
    return [];
  }
}
function parseHhMm(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return Math.max(0, Math.min(1440, mins));
}
function minutesToLabel(min) {
  const h24 = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}
function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function blockBusyMinutes(block, date) {
  const dayStart = /* @__PURE__ */ new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return null;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const s = new Date(block.start);
  const e = new Date(block.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  if (e <= dayStart || s >= dayEnd) return null;
  const startMin = Math.round((Math.max(s.getTime(), dayStart.getTime()) - dayStart.getTime()) / 6e4);
  const endMin = Math.round((Math.min(e.getTime(), dayEnd.getTime()) - dayStart.getTime()) / 6e4);
  if (endMin <= startMin) return null;
  return [startMin, endMin];
}
function computeFreeGaps(blocks, opts) {
  const dayStart = parseHhMm(opts.workdayStart);
  const dayEnd = parseHhMm(opts.workdayEnd);
  if (dayEnd <= dayStart) return [];
  const busy = blocks.map((b) => blockBusyMinutes(b, opts.date)).filter((iv) => iv != null).map(([s, e]) => [Math.max(s, dayStart), Math.min(e, dayEnd)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of busy) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  const gaps = [];
  let cursor = dayStart;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push({ startMinute: cursor, endMinute: s, minutes: s - cursor });
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) gaps.push({ startMinute: cursor, endMinute: dayEnd, minutes: dayEnd - cursor });
  return gaps;
}
function availableMinutes(gaps) {
  return gaps.reduce((sum, g2) => sum + g2.minutes, 0);
}
function formatGap(gap) {
  return `${minutesToLabel(gap.startMinute)} to ${minutesToLabel(gap.endMinute)} (${formatMinutes(gap.minutes)})`;
}
var provider;
var init_calendar = __esm({
  "src/lib/deck/calendar.ts"() {
    "use strict";
    provider = null;
  }
});

// packages/connectors/src/auth/oauth2.ts
function basicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
function oauth2(config) {
  const fetchImpl = config.fetch ?? fetch;
  const usePkce = config.usePkce ?? false;
  const tokenAuthMethod = config.tokenAuthMethod ?? "client_secret_post";
  const refreshableStatuses = config.refreshableStatuses ?? [401];
  const revocationErrors = config.revocationErrors ?? ["invalid_grant"];
  const scopeSeparator = config.scopeSeparator ?? " ";
  async function tokenEndpoint(params, clientId, clientSecret) {
    const body = new URLSearchParams(params);
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    };
    if (tokenAuthMethod === "client_secret_basic" && clientSecret) {
      headers.Authorization = basicAuthHeader(clientId, clientSecret);
    } else if (tokenAuthMethod !== "none") {
      body.set("client_id", clientId);
      if (clientSecret) body.set("client_secret", clientSecret);
    } else {
      body.set("client_id", clientId);
    }
    const res = await fetchImpl(config.tokenUrl, { method: "POST", headers, body });
    let json = {};
    try {
      json = await res.json();
    } catch {
    }
    return { ok: res.ok, status: res.status, json };
  }
  function toTokenSet(json) {
    const mapped = config.mapTokenResponse?.(json);
    const accessToken = mapped?.accessToken ?? json.access_token;
    if (!accessToken) throw new Error("token endpoint returned no access_token");
    const scope = mapped?.scope ?? json.scope;
    return {
      accessToken,
      refreshToken: mapped?.refreshToken ?? json.refresh_token,
      expiresInMs: mapped?.expiresInMs ?? (typeof json.expires_in === "number" ? json.expires_in * 1e3 : void 0),
      ...scope !== void 0 ? { scope } : {},
      raw: json
    };
  }
  const oauth = {
    usePkce,
    refreshableStatuses,
    buildAuthorizationUrl(input) {
      const u = new URL(config.authorizationUrl);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", input.clientId);
      u.searchParams.set("redirect_uri", input.redirectUri);
      u.searchParams.set("scope", input.scopes.join(scopeSeparator));
      u.searchParams.set("state", input.state);
      if (usePkce && input.codeChallenge) {
        u.searchParams.set("code_challenge", input.codeChallenge);
        u.searchParams.set("code_challenge_method", "S256");
      }
      for (const [k, v] of Object.entries(config.authParams ?? {})) u.searchParams.set(k, v);
      return u.toString();
    },
    async exchangeCode(input) {
      const params = {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri
      };
      if (usePkce && input.codeVerifier) params.code_verifier = input.codeVerifier;
      const { ok: ok2, status, json } = await tokenEndpoint(params, input.clientId, input.clientSecret);
      if (!ok2) {
        throw new Error(`token exchange failed (${status}): ${json.error ?? "unknown_error"}`);
      }
      return toTokenSet(json);
    },
    async refresh(input) {
      let result;
      try {
        result = await tokenEndpoint(
          { grant_type: "refresh_token", refresh_token: input.refreshToken },
          input.clientId,
          input.clientSecret
        );
      } catch (cause) {
        throw new OAuthRefreshError("refresh request failed", { revoked: false, cause });
      }
      if (result.ok) return toTokenSet(result.json);
      const definitive = revocationErrors.includes(result.json.error ?? "");
      throw new OAuthRefreshError(`refresh failed (${result.status}): ${result.json.error ?? "unknown"}`, {
        revoked: definitive,
        status: result.status
      });
    },
    ...config.revokeUrl ? {
      async revoke(input) {
        const headers = {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        };
        const body = new URLSearchParams({ token: input.token });
        if (tokenAuthMethod === "client_secret_basic" && input.clientSecret) {
          headers.Authorization = basicAuthHeader(input.clientId, input.clientSecret);
        } else {
          body.set("client_id", input.clientId);
          if (input.clientSecret) body.set("client_secret", input.clientSecret);
        }
        await fetchImpl(config.revokeUrl, { method: "POST", headers, body });
      }
    } : {}
  };
  return {
    kind: "oauth2",
    oauth,
    applyAuth(creds, req) {
      if (creds.type !== "oauth2") throw new Error("oauth2 strategy received non-oauth2 credentials");
      req.headers.Authorization = `Bearer ${creds.accessToken}`;
    },
    tokenOf(creds) {
      if (creds.type !== "oauth2") throw new Error("oauth2 strategy received non-oauth2 credentials");
      return creds.accessToken;
    }
  };
}
var OAuthRefreshError;
var init_oauth2 = __esm({
  "packages/connectors/src/auth/oauth2.ts"() {
    "use strict";
    OAuthRefreshError = class extends Error {
      constructor(message, opts) {
        super(message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
        this.name = "OAuthRefreshError";
        this.revoked = opts.revoked;
        this.status = opts.status;
      }
    };
  }
});

// packages/connectors/src/core/ids.ts
import { randomBytes } from "crypto";
import { uuidv7 as uuidv72 } from "uuidv7";
function newId() {
  return uuidv72();
}
function newAttemptId() {
  return uuidv72();
}
function randomUrlToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
var init_ids = __esm({
  "packages/connectors/src/core/ids.ts"() {
    "use strict";
  }
});

// packages/connectors/src/auth/pkce.ts
import { createHash as createHash3 } from "crypto";
function generateCodeVerifier() {
  return randomUrlToken(32);
}
function codeChallengeS256(verifier) {
  return createHash3("sha256").update(verifier).digest("base64url");
}
var init_pkce = __esm({
  "packages/connectors/src/auth/pkce.ts"() {
    "use strict";
    init_ids();
  }
});

// packages/connectors/src/core/errors.ts
var ConnectorError, AuthConfigRequiredError, NeedsReauthError;
var init_errors = __esm({
  "packages/connectors/src/core/errors.ts"() {
    "use strict";
    ConnectorError = class extends Error {
      constructor(code, message, opts = {}) {
        super(message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
        this.name = "ConnectorError";
        this.code = code;
        this.indeterminate = opts.indeterminate ?? false;
        this.status = opts.status;
        this.retryAfter = opts.retryAfter;
      }
    };
    AuthConfigRequiredError = class extends Error {
      constructor(providerId, choices) {
        super(`provider "${providerId}" has more than one connection method; choose one`);
        this.name = "AuthConfigRequiredError";
        this.providerId = providerId;
        this.choices = choices;
      }
    };
    NeedsReauthError = class extends Error {
      constructor(connectionId, message = "connection needs re-authentication") {
        super(message);
        this.name = "NeedsReauthError";
        this.connectionId = connectionId;
      }
    };
  }
});

// packages/connectors/src/core/auth-config-validate.ts
function scopeHeld(provider2, granted, required) {
  if (granted.includes(required)) return true;
  return provider2.scopeSatisfies?.(granted, required) ?? false;
}
function assertAuthConfigValidForProvider(config, provider2, code = "internal_error") {
  if (config.scheme !== provider2.auth.kind) {
    throw new ConnectorError(
      code,
      `AuthConfig "${config.id}" scheme "${config.scheme}" does not match provider "${provider2.id}" strategy "${provider2.auth.kind}"`
    );
  }
  if (config.allowedScopes) {
    const must = /* @__PURE__ */ new Set([...provider2.identityScopes ?? [], ...config.defaultScopes ?? []]);
    const uncovered = [...must].filter((s) => !scopeHeld(provider2, config.allowedScopes, s));
    if (uncovered.length > 0) {
      throw new ConnectorError(
        code,
        `AuthConfig "${config.id}" identity/defaultScopes exceed its allowedScopes: ${uncovered.join(", ")}`
      );
    }
  }
}
var init_auth_config_validate = __esm({
  "packages/connectors/src/core/auth-config-validate.ts"() {
    "use strict";
    init_errors();
  }
});

// packages/connectors/src/core/digest.ts
import { createHash as createHash4 } from "crypto";
function canonical(value) {
  if (value === null) return null;
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  const t = typeof value;
  if (t === "object") {
    const obj2 = value;
    const out = {};
    for (const key of Object.keys(obj2).sort()) {
      if (obj2[key] === void 0) continue;
      out[key] = canonical(obj2[key]);
    }
    return out;
  }
  if (t === "number") return Number.isFinite(value) ? value : String(value);
  if (t === "bigint") return value.toString();
  if (t === "string" || t === "boolean") return value;
  return null;
}
function canonicalStringify(value) {
  return JSON.stringify(canonical(value));
}
function sha256(s) {
  return createHash4("sha256").update(s).digest("hex");
}
function inputDigest(value) {
  return sha256(canonicalStringify(value));
}
function fingerprint(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 8) return "?";
  const def = schema._def;
  if (!def) return "?";
  const tn = def.typeName ?? def.type ?? "?";
  try {
    if (tn === "ZodObject" || def.shape) {
      const rawShape = typeof def.shape === "function" ? def.shape() : def.shape;
      const shape = rawShape ?? {};
      const keys = Object.keys(shape).sort();
      return `obj{${keys.map((k) => `${k}:${fingerprint(shape[k], depth + 1)}`).join(",")}}`;
    }
    if (tn === "ZodArray") return `arr[${fingerprint(def.type ?? def.element, depth + 1)}]`;
    if (tn === "ZodOptional" || tn === "ZodNullable" || tn === "ZodDefault") {
      return `${tn}<${fingerprint(def.innerType, depth + 1)}>`;
    }
    if (tn === "ZodUnion") {
      const opts = def.options ?? [];
      return `union(${opts.map((o) => fingerprint(o, depth + 1)).join("|")})`;
    }
    if (tn === "ZodEnum") return `enum(${(def.values ?? []).join(",")})`;
  } catch {
  }
  return String(tn);
}
function schemaFingerprint(schema) {
  return fingerprint(schema);
}
function actionVersion(input) {
  return sha256(`${input.risk}:${input.mutating}:${schemaFingerprint(input.inputSchema)}`);
}
var init_digest = __esm({
  "packages/connectors/src/core/digest.ts"() {
    "use strict";
  }
});

// packages/connectors/src/core/defaults.ts
function defaultApprovalPolicy() {
  return {
    async check(input) {
      return input.mutating ? "ask" : "allow";
    }
  };
}
function connectionMetadata(c) {
  return {
    id: c.id,
    ownerId: c.ownerId,
    providerId: c.providerId,
    accountId: c.accountId,
    ...c.email !== void 0 ? { email: c.email } : {},
    ...c.label !== void 0 ? { label: c.label } : {},
    scopes: c.scopes
  };
}
function uniqueScopes(...lists) {
  const set = /* @__PURE__ */ new Set();
  for (const list2 of lists) for (const s of list2 ?? []) set.add(s);
  return [...set];
}
var systemClock, noopLogger;
var init_defaults = __esm({
  "packages/connectors/src/core/defaults.ts"() {
    "use strict";
    systemClock = { now: () => Date.now() };
    noopLogger = {
      debug() {
      },
      info() {
      },
      warn() {
      },
      error() {
      }
    };
  }
});

// packages/connectors/src/core/http.ts
function joinUrl(baseUrl, path24) {
  if (/^https?:\/\//i.test(path24)) return path24;
  if (!baseUrl) throw new ConnectorError("internal_error", `relative path "${path24}" with no provider baseUrl`);
  return `${baseUrl.replace(/\/+$/, "")}/${path24.replace(/^\/+/, "")}`;
}
function resolveUrl(baseUrl, path24, query) {
  const url = new URL(joinUrl(baseUrl, path24));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== void 0 && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
function appendQuery(url, extra) {
  const keys = Object.keys(extra);
  if (keys.length === 0) return url;
  const u = new URL(url);
  for (const k of keys) u.searchParams.set(k, extra[k]);
  return u.toString();
}
async function parseBody(res) {
  if (res.status === 204 || res.status === 205) return void 0;
  const ct = res.headers.get("content-type") ?? "";
  const text2 = await res.text();
  if (!text2) return void 0;
  if (ct.includes("application/json") || ct.includes("+json")) return JSON.parse(text2);
  return text2;
}
function retryAfterSeconds(res) {
  const h = res.headers.get("retry-after");
  if (!h) return void 0;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, Math.ceil((when - Date.now()) / 1e3));
  return void 0;
}
function createAuthedHttp(opts) {
  const fetchImpl = opts.fetch ?? fetch;
  const { strategy, redactor, connectionId } = opts;
  const retry = opts.retry ?? DEFAULT_RETRY_POLICY;
  const sleep2 = opts.sleep ?? ((ms, signal) => new Promise((resolve, reject) => {
    const abort2 = () => reject(signal?.reason ?? new ConnectorError("provider_unavailable", "request aborted"));
    if (signal?.aborted) return abort2();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      abort2();
    }, { once: true });
  }));
  function isTransient(e) {
    if (!(e instanceof ConnectorError)) return false;
    if (e.code === "provider_rate_limited") return true;
    if (e.code === "provider_unavailable") return !e.indeterminate;
    return false;
  }
  function retryDelayMs(attempt, e) {
    if (typeof e.retryAfter === "number") return Math.min(e.retryAfter * 1e3, retry.maxDelayMs);
    const base4 = Math.min(retry.initialDelayMs * retry.backoffMultiplier ** attempt, retry.maxDelayMs);
    const jitter = base4 * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(base4 + jitter));
  }
  async function send(req) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sendOnce(req);
      } catch (e) {
        if (attempt < retry.maxRetries && isTransient(e)) {
          const ra = e.retryAfter;
          if (typeof ra === "number" && ra * 1e3 > retry.maxDelayMs) throw e;
          await sleep2(retryDelayMs(attempt, e), req.signal);
          continue;
        }
        throw e;
      }
    }
  }
  async function sendOnce(req) {
    let creds = await opts.getCredentials();
    let refreshed = false;
    for (; ; ) {
      const headers = { Accept: "application/json", ...req.headers ?? {} };
      let bodyInit;
      if (req.rawBody !== void 0) {
        bodyInit = req.rawBody;
        if (req.contentType) headers["Content-Type"] = req.contentType;
      } else if (req.body !== void 0) {
        bodyInit = JSON.stringify(req.body);
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }
      const baseUrl = resolveUrl(opts.baseUrl, req.path, req.query);
      const extraQuery = {};
      const bodyOverlay = {};
      let rewrittenUrl;
      strategy.applyAuth(creds, {
        method: req.method,
        url: baseUrl,
        headers,
        ...bodyInit !== void 0 ? { body: bodyInit } : {},
        addQueryParam: (k, v) => {
          extraQuery[k] = v;
        },
        setBodyField: (k, v) => {
          bodyOverlay[k] = v;
        },
        setUrl: (u) => {
          rewrittenUrl = u;
        }
      });
      if (Object.keys(bodyOverlay).length > 0 && req.rawBody === void 0) {
        const base4 = typeof req.body === "object" && req.body !== null ? req.body : {};
        bodyInit = JSON.stringify({ ...base4, ...bodyOverlay });
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }
      const url = appendQuery(rewrittenUrl ?? baseUrl, extraQuery);
      try {
        redactor.register(strategy.tokenOf(creds), "token");
      } catch {
      }
      if (headers.Authorization) redactor.register(headers.Authorization, "authorization");
      let res;
      try {
        res = await fetchImpl(url, {
          method: req.method,
          headers,
          ...bodyInit !== void 0 ? { body: bodyInit } : {},
          ...req.signal ? { signal: req.signal } : {}
        });
      } catch (cause) {
        throw new ConnectorError("provider_unavailable", "provider request failed", {
          indeterminate: !!req.mutating,
          cause
        });
      }
      const refreshable = res.status === 401 || (strategy.oauth?.refreshableStatuses.includes(res.status) ?? false);
      if (refreshable && !refreshed && strategy.oauth) {
        refreshed = true;
        creds = await opts.getCredentials(true);
        continue;
      }
      if (res.ok) return await parseBody(res);
      if (res.status === 401) {
        throw new NeedsReauthError(connectionId, "provider rejected credentials after refresh");
      }
      const message = `provider error ${res.status} for ${req.method} ${req.path}`;
      if (res.status === 429) {
        throw new ConnectorError("provider_rate_limited", message, {
          status: 429,
          retryAfter: retryAfterSeconds(res)
        });
      }
      if (res.status >= 500) {
        throw new ConnectorError("provider_unavailable", message, {
          status: res.status,
          indeterminate: !!req.mutating
        });
      }
      throw new ConnectorError("provider_error", message, { status: res.status });
    }
  }
  const http = {
    request: send,
    get: (path24, o) => send({ method: "GET", path: path24, ...o }),
    post: (path24, body, o) => send({ method: "POST", path: path24, body, ...o }),
    put: (path24, body, o) => send({ method: "PUT", path: path24, body, ...o }),
    patch: (path24, body, o) => send({ method: "PATCH", path: path24, body, ...o }),
    delete: (path24, o) => send({ method: "DELETE", path: path24, ...o })
  };
  return http;
}
var DEFAULT_RETRY_POLICY;
var init_http = __esm({
  "packages/connectors/src/core/http.ts"() {
    "use strict";
    init_errors();
    DEFAULT_RETRY_POLICY = {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 3e4,
      backoffMultiplier: 2
    };
  }
});

// packages/connectors/src/core/redactor.ts
function scrubString(s, secrets) {
  let out = s;
  for (const [secret, replacement] of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(replacement);
  }
  return out;
}
function deepRedact(value, secrets, seen) {
  if (typeof value === "string") return scrubString(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, secrets, seen));
  if (value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[scrubString(k, secrets)] = deepRedact(v, secrets, seen);
  }
  return out;
}
function createRedactor() {
  const secrets = /* @__PURE__ */ new Map();
  return {
    register(value, label) {
      if (typeof value !== "string" || value.length < MIN_SECRET_LEN) return;
      secrets.set(value, label ? `[redacted:${label}]` : "[redacted]");
    },
    redact(value) {
      if (secrets.size === 0) return value;
      return deepRedact(value, secrets, /* @__PURE__ */ new WeakSet());
    }
  };
}
var MIN_SECRET_LEN;
var init_redactor = __esm({
  "packages/connectors/src/core/redactor.ts"() {
    "use strict";
    MIN_SECRET_LEN = 6;
  }
});

// packages/connectors/src/lock/in-process.ts
function inProcessLock() {
  const tails = /* @__PURE__ */ new Map();
  return {
    async withLock(key, fn) {
      const prev = tails.get(key) ?? Promise.resolve();
      let release;
      const current = new Promise((r) => release = r);
      tails.set(key, current);
      await prev.catch(() => void 0);
      try {
        return await fn();
      } finally {
        release();
        if (tails.get(key) === current) tails.delete(key);
      }
    }
  };
}
var init_in_process = __esm({
  "packages/connectors/src/lock/in-process.ts"() {
    "use strict";
  }
});

// packages/connectors/src/core/runtime.ts
function statusAllowsPurpose(status, purpose) {
  switch (purpose) {
    case "connect":
      return status === "active";
    case "reconnect":
    case "consent":
      return status === "active" || status === "disabled";
    case "refresh":
    case "revoke":
      return true;
  }
}
function scopeHeld2(provider2, granted, required) {
  if (granted.includes(required)) return true;
  return provider2.scopeSatisfies?.(granted, required) ?? false;
}
function scopeCovers(provider2, allowedScopes, requested) {
  if (!allowedScopes) return true;
  return requested.every((s) => scopeHeld2(provider2, allowedScopes, s));
}
function pickDefault(candidates) {
  for (const level of ["owner", "tenant", "global"]) {
    const atLevel = candidates.filter((c) => c.scope === level && c.isDefault);
    if (atLevel.length === 1) return atLevel[0];
    if (atLevel.length > 1) return "ambiguous";
  }
  return null;
}
function errorOutcome(code, message, indeterminate) {
  return { ok: false, reason: "error", code, message, ...indeterminate ? { indeterminate: true } : {} };
}
function createConnectorRuntime(opts) {
  const { registry, store, authRequests, secretBox } = opts;
  const authConfigs = opts.authConfigs ?? opts.oauthApps;
  if (!authConfigs) {
    throw new ConnectorError("internal_error", "createConnectorRuntime requires `authConfigs` (or the deprecated `oauthApps`)");
  }
  const approval = opts.approval ?? defaultApprovalPolicy();
  const redactor = opts.redactor ?? createRedactor();
  const clock = opts.clock ?? systemClock;
  const logger = opts.logger ?? noopLogger;
  const onActionRun = opts.onActionRun ?? (() => {
  });
  const fetchImpl = opts.fetch ?? fetch;
  const retry = opts.retry;
  const defaultOwnerId = opts.defaultOwnerId ?? DEFAULT_OWNER;
  const authTtlMs = opts.authRequestTtlMs ?? DEFAULT_AUTH_TTL_MS;
  const skewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const lock = opts.lock ?? inProcessLock();
  const validatedConfigIds = /* @__PURE__ */ new Set();
  function ensureConfigValid(config, provider2) {
    if (validatedConfigIds.has(config.id)) return;
    assertAuthConfigValidForProvider(config, provider2, "internal_error");
    validatedConfigIds.add(config.id);
  }
  function fail(code, message, indeterminate) {
    return errorOutcome(code, redactor.redact(message), indeterminate);
  }
  function registerSecrets(creds) {
    switch (creds.type) {
      case "oauth2":
        redactor.register(creds.accessToken, "access_token");
        if (creds.refreshToken) redactor.register(creds.refreshToken, "refresh_token");
        break;
      case "api_key":
        redactor.register(creds.apiKey, "api_key");
        break;
      case "bearer":
        redactor.register(creds.token, "bearer");
        break;
      case "basic":
        redactor.register(creds.password, "password");
        break;
      case "custom":
        for (const v of Object.values(creds.values)) redactor.register(v, "custom");
        break;
      case "oauth1":
        redactor.register(creds.consumerSecret, "oauth1_consumer_secret");
        if (creds.tokenSecret) redactor.register(creds.tokenSecret, "oauth1_token_secret");
        break;
      case "aws_sigv4":
        redactor.register(creds.secretAccessKey, "aws_secret");
        if (creds.sessionToken) redactor.register(creds.sessionToken, "aws_session");
        break;
      case "jwt":
        redactor.register(creds.key, "jwt_key");
        break;
    }
  }
  function requireProvider(id) {
    const p = registry.getProvider(id);
    if (!p) throw new ConnectorError("unknown_provider", `unknown provider "${id}"`);
    return p;
  }
  function isFresh(creds) {
    return creds.expiresAt == null || clock.now() < creds.expiresAt - skewMs;
  }
  async function resolveConnectConfig(provider2, ctx, sel) {
    const visible = await authConfigs.listForConnect(provider2.id, ctx);
    for (const c of visible) ensureConfigValid(c, provider2);
    const identity = provider2.identityScopes ?? [];
    const requestedWith = (explicit) => uniqueScopes(identity, explicit);
    if (sel.authConfigId != null) {
      const chosen = visible.find((c) => c.id === sel.authConfigId);
      if (!chosen) return { kind: "none" };
      if (!statusAllowsPurpose(chosen.status, "connect")) return { kind: "unavailable" };
      const requested = requestedWith(sel.explicitScopes ?? chosen.defaultScopes ?? []);
      if (!scopeCovers(provider2, chosen.allowedScopes, requested)) return { kind: "scope_not_allowed" };
      return { kind: "resolved", config: chosen, authConfigId: chosen.id };
    }
    const active = visible.filter((c) => statusAllowsPurpose(c.status, "connect"));
    let candidates = active;
    if (sel.explicitScopes != null) {
      const requested = requestedWith(sel.explicitScopes);
      candidates = active.filter((c) => scopeCovers(provider2, c.allowedScopes, requested));
    }
    if (candidates.length === 1) {
      const only = candidates[0];
      return { kind: "resolved", config: only, authConfigId: only.id };
    }
    if (candidates.length > 1) {
      const def = pickDefault(candidates);
      if (def === "ambiguous") return { kind: "ambiguous" };
      if (def) return { kind: "resolved", config: def, authConfigId: def.id };
      return {
        kind: "picker",
        choices: candidates.map((c) => ({ authConfigId: c.id, label: c.label ?? c.id }))
      };
    }
    if (sel.explicitScopes != null && active.length > 0) return { kind: "scope_not_allowed" };
    if (visible.length > 0) return { kind: "unavailable" };
    return { kind: "none" };
  }
  async function getValidCredentials(connectionId, force = false) {
    const stored = await store.get(connectionId);
    if (!stored) throw new ConnectorError("connection_not_found", `connection "${connectionId}" not found`);
    const creds = await secretBox.open(stored.sealed);
    registerSecrets(creds);
    if (creds.type !== "oauth2") return creds;
    if (!force && isFresh(creds)) return creds;
    const staleToken = creds.accessToken;
    return lock.withLock(connectionId, async () => {
      const s2 = await store.get(connectionId);
      if (!s2) throw new ConnectorError("connection_not_found", `connection "${connectionId}" not found`);
      const c2 = await secretBox.open(s2.sealed);
      registerSecrets(c2);
      if (c2.type !== "oauth2") return c2;
      if (c2.accessToken !== staleToken && isFresh(c2)) return c2;
      if (!force && isFresh(c2)) return c2;
      if (!c2.refreshToken) {
        await store.setStatus(connectionId, "needs_reauth", "no refresh token");
        throw new NeedsReauthError(connectionId);
      }
      const provider2 = requireProvider(s2.connection.providerId);
      const flow = provider2.auth.oauth;
      if (!flow) throw new ConnectorError("internal_error", `provider "${provider2.id}" has no oauth flow to refresh`);
      const resolved = await authConfigs.openConfigForConnection(provider2.id, s2.connection.authConfigId);
      if (!resolved) throw new ConnectorError("provider_not_configured", `no auth client configured for "${provider2.id}"`);
      ensureConfigValid(resolved.config, provider2);
      const clientId = resolved.config.oauth?.clientId;
      if (!clientId) throw new ConnectorError("provider_not_configured", `auth client for "${provider2.id}" has no client id`);
      if (resolved.clientSecret) redactor.register(resolved.clientSecret, "client_secret");
      let ts;
      try {
        ts = await flow.refresh({
          clientId,
          ...resolved.clientSecret !== void 0 ? { clientSecret: resolved.clientSecret } : {},
          refreshToken: c2.refreshToken
        });
      } catch (e) {
        if (e instanceof OAuthRefreshError && e.revoked) {
          await store.setStatus(connectionId, "needs_reauth", "refresh revoked");
          throw new NeedsReauthError(connectionId);
        }
        throw new ConnectorError("provider_unavailable", "token refresh failed", { cause: e });
      }
      const next = {
        type: "oauth2",
        accessToken: ts.accessToken,
        refreshToken: ts.refreshToken ?? c2.refreshToken,
        // ROTATE if present, else PRESERVE
        ...ts.expiresInMs != null ? { expiresAt: clock.now() + ts.expiresInMs } : {},
        ...ts.raw !== void 0 ? { raw: ts.raw } : {}
      };
      registerSecrets(next);
      const updated = { ...s2.connection, updatedAt: new Date(clock.now()).toISOString() };
      await store.save(updated, await secretBox.seal(next));
      return next;
    });
  }
  async function buildAuthorization(input) {
    const { provider: provider2, config } = input;
    const flow = provider2.auth.oauth;
    if (!flow) throw new ConnectorError("internal_error", `provider "${provider2.id}" is not an OAuth provider`);
    const clientId = config.oauth?.clientId;
    if (!clientId) throw new ConnectorError("provider_not_configured", `auth client for "${provider2.id}" has no client id`);
    const state5 = randomUrlToken(24);
    let codeChallenge;
    let sealedVerifier;
    if (flow.usePkce) {
      const verifier = generateCodeVerifier();
      redactor.register(verifier, "pkce_verifier");
      codeChallenge = codeChallengeS256(verifier);
      sealedVerifier = await secretBox.seal(verifier);
    }
    const req = {
      state: state5,
      ownerId: input.ownerId,
      providerId: provider2.id,
      scopes: input.scopes,
      redirectUri: input.redirectUri,
      intent: input.intent,
      ...input.existingConnectionId ? { existingConnectionId: input.existingConnectionId } : {},
      ...input.authConfigId !== void 0 ? { authConfigId: input.authConfigId } : {},
      ...input.label ? { label: input.label } : {},
      ...sealedVerifier ? { sealedVerifier } : {},
      expiresAt: clock.now() + authTtlMs,
      createdAt: clock.now()
    };
    await authRequests.put(req);
    const authorizationUrl = flow.buildAuthorizationUrl({
      clientId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      state: state5,
      ...codeChallenge ? { codeChallenge } : {}
    });
    return { authorizationUrl, requestId: state5 };
  }
  function resolveRedirect(config, override) {
    const uri = override ?? config.oauth?.redirectUri;
    if (!uri) {
      throw new ConnectorError(
        "provider_not_configured",
        `no redirectUri (pass one or configure the auth client for "${config.providerId}")`
      );
    }
    return uri;
  }
  async function beginAuth(providerId, options) {
    const provider2 = requireProvider(providerId);
    const ownerId = options.ownerId ?? defaultOwnerId;
    if (options.existingConnectionId) {
      const existing = await store.get(options.existingConnectionId);
      if (!existing || existing.connection.ownerId !== ownerId || existing.connection.providerId !== providerId) {
        throw new ConnectorError("connection_not_found", "connection to upgrade not found");
      }
      const config2 = await authConfigs.getConfigForConnection(providerId, existing.connection.authConfigId);
      if (!config2) throw new ConnectorError("provider_not_configured", `no auth client configured for "${providerId}"`);
      ensureConfigValid(config2, provider2);
      if (!statusAllowsPurpose(config2.status, "consent")) {
        throw new ConnectorError("auth_config_unavailable", `auth client "${config2.id}" cannot be used to add scopes (status ${config2.status})`);
      }
      const requested = uniqueScopes(provider2.identityScopes, options.scopes ?? existing.connection.scopes);
      if (!scopeCovers(provider2, config2.allowedScopes, requested)) {
        throw new ConnectorError("scope_not_allowed", `auth client "${config2.id}" cannot grant the requested scopes`);
      }
      return buildAuthorization({
        provider: provider2,
        config: config2,
        authConfigId: existing.connection.authConfigId,
        ownerId,
        scopes: requested,
        redirectUri: resolveRedirect(config2, options.redirectUri),
        intent: "add_scopes",
        existingConnectionId: options.existingConnectionId,
        ...options.label ? { label: options.label } : {}
      });
    }
    const ctx = {
      ...ownerId !== void 0 ? { ownerId } : {},
      ...options.tenantId !== void 0 ? { tenantId: options.tenantId } : {}
    };
    const resolution = await resolveConnectConfig(provider2, ctx, {
      ...options.authConfigId !== void 0 ? { authConfigId: options.authConfigId } : {},
      ...options.scopes !== void 0 ? { explicitScopes: options.scopes } : {}
    });
    switch (resolution.kind) {
      case "picker":
        throw new AuthConfigRequiredError(
          providerId,
          resolution.choices
        );
      case "ambiguous":
        throw new ConnectorError("auth_config_ambiguous_default", `provider "${providerId}" has more than one default auth client at the same visibility level`);
      case "unavailable":
        throw new ConnectorError("auth_config_unavailable", `the selected auth client for "${providerId}" cannot be used to connect`);
      case "scope_not_allowed":
        throw new ConnectorError("scope_not_allowed", `no auth client for "${providerId}" can grant the requested scopes`);
      case "none":
        throw new ConnectorError("provider_not_configured", `no auth client configured for "${providerId}"`);
      case "resolved":
        break;
    }
    const { config, authConfigId } = resolution;
    const base4 = options.scopes ?? config.defaultScopes ?? [];
    return buildAuthorization({
      provider: provider2,
      config,
      authConfigId,
      ownerId,
      scopes: uniqueScopes(provider2.identityScopes, base4),
      redirectUri: resolveRedirect(config, options.redirectUri),
      intent: "new_connection",
      ...options.label ? { label: options.label } : {}
    });
  }
  async function completeAuth(p) {
    const req = await authRequests.take(p.state);
    if (!req) throw new ConnectorError("invalid_input", "unknown or expired auth state");
    if (req.expiresAt < clock.now()) throw new ConnectorError("invalid_input", "auth request expired");
    const provider2 = requireProvider(req.providerId);
    const flow = provider2.auth.oauth;
    if (!flow) throw new ConnectorError("internal_error", `provider "${provider2.id}" has no oauth flow`);
    const resolved = await authConfigs.openConfigForConnection(provider2.id, req.authConfigId);
    if (!resolved || !resolved.config.oauth) {
      throw new ConnectorError("provider_not_configured", `no auth client configured for "${provider2.id}"`);
    }
    ensureConfigValid(resolved.config, provider2);
    if (resolved.clientSecret) redactor.register(resolved.clientSecret, "client_secret");
    const codeVerifier = req.sealedVerifier ? await secretBox.open(req.sealedVerifier) : void 0;
    if (codeVerifier) redactor.register(codeVerifier, "pkce_verifier");
    const ts = await flow.exchangeCode({
      clientId: resolved.config.oauth.clientId,
      ...resolved.clientSecret !== void 0 ? { clientSecret: resolved.clientSecret } : {},
      redirectUri: req.redirectUri,
      code: p.code,
      ...codeVerifier !== void 0 ? { codeVerifier } : {}
    });
    const creds = {
      type: "oauth2",
      accessToken: ts.accessToken,
      ...ts.refreshToken !== void 0 ? { refreshToken: ts.refreshToken } : {},
      ...ts.expiresInMs != null ? { expiresAt: clock.now() + ts.expiresInMs } : {},
      ...ts.raw !== void 0 ? { raw: ts.raw } : {}
    };
    registerSecrets(creds);
    const idCtx = {
      tokenResponse: ts.raw,
      params: p.params ?? {}
    };
    const derivedBaseUrl = provider2.resolveBaseUrl?.(idCtx);
    const baseUrl = derivedBaseUrl ?? resolved.config.baseUrl ?? provider2.baseUrl;
    const identifyHttp = createAuthedHttp({
      ...baseUrl !== void 0 ? { baseUrl } : {},
      strategy: provider2.auth,
      connectionId: "(pending)",
      getCredentials: async () => creds,
      redactor,
      fetch: fetchImpl,
      ...retry ? { retry } : {}
    });
    const identity = provider2.identify ? await provider2.identify(identifyHttp, idCtx) : { accountId: `${provider2.id}:default` };
    const connConfig = identity.config;
    const connBaseUrl = derivedBaseUrl ?? identity.baseUrl;
    const grantedScopes = grantedFrom(ts, req.scopes);
    const now = new Date(clock.now()).toISOString();
    if (req.intent === "add_scopes") {
      if (!req.existingConnectionId) throw new ConnectorError("internal_error", "add_scopes without existingConnectionId");
      const existing = await store.get(req.existingConnectionId);
      if (!existing || existing.connection.ownerId !== req.ownerId) {
        throw new ConnectorError("connection_not_found", "connection to upgrade not found");
      }
      if (identity.accountId !== existing.connection.accountId) {
        throw new ConnectorError(
          "consent_account_mismatch",
          "the authorized account does not match the connection being upgraded; connect it separately instead"
        );
      }
      if (req.authConfigId !== existing.connection.authConfigId) {
        throw new ConnectorError(
          "consent_account_mismatch",
          "the authorized connection method does not match the connection being upgraded"
        );
      }
      const updated = {
        ...existing.connection,
        scopes: uniqueScopes(existing.connection.scopes, grantedScopes),
        // Re-auth re-derives identity; refresh the non-secret per-connection context too (an
        // instance-bound provider's cloudId/instance_url could have moved). Parity with new_connection.
        ...connConfig !== void 0 ? { config: connConfig } : {},
        ...connBaseUrl !== void 0 ? { baseUrl: connBaseUrl } : {},
        status: "active",
        updatedAt: now
      };
      await store.save(updated, await secretBox.seal(creds));
      return updated;
    }
    const siblings = await store.list({ ownerId: req.ownerId, providerId: provider2.id });
    const match = siblings.find(
      (c) => c.accountId === identity.accountId && c.authConfigId === req.authConfigId
    );
    const connection = match ? {
      ...match,
      scopes: uniqueScopes(match.scopes, grantedScopes),
      ...identity.email !== void 0 ? { email: identity.email } : {},
      ...req.label ?? identity.label ? { label: req.label ?? identity.label } : {},
      ...req.authConfigId !== void 0 ? { authConfigId: req.authConfigId } : {},
      ...connConfig !== void 0 ? { config: connConfig } : {},
      ...connBaseUrl !== void 0 ? { baseUrl: connBaseUrl } : {},
      status: "active",
      updatedAt: now
    } : {
      id: newId(),
      ownerId: req.ownerId,
      providerId: provider2.id,
      accountId: identity.accountId,
      ...identity.email !== void 0 ? { email: identity.email } : {},
      ...req.label ?? identity.label ? { label: req.label ?? identity.label } : {},
      ...req.authConfigId !== void 0 ? { authConfigId: req.authConfigId } : {},
      ...connConfig !== void 0 ? { config: connConfig } : {},
      ...connBaseUrl !== void 0 ? { baseUrl: connBaseUrl } : {},
      scopes: grantedScopes,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    await store.save(connection, await secretBox.seal(creds));
    return connection;
  }
  async function connectDirect(providerId, opts2) {
    const provider2 = requireProvider(providerId);
    if (provider2.auth.kind !== opts2.credential.type) {
      throw new ConnectorError(
        "invalid_input",
        `credential type "${opts2.credential.type}" does not match provider "${providerId}" strategy "${provider2.auth.kind}"`
      );
    }
    const ownerId = opts2.ownerId ?? defaultOwnerId;
    const creds = opts2.credential;
    registerSecrets(creds);
    const config = opts2.authConfigId !== void 0 ? await authConfigs.getConfigForConnection(providerId, opts2.authConfigId) : null;
    if (opts2.authConfigId !== void 0 && !config) {
      throw new ConnectorError("invalid_input", `auth config "${opts2.authConfigId}" not found for provider "${providerId}"`);
    }
    if (config) ensureConfigValid(config, provider2);
    const baseUrl = config?.baseUrl ?? provider2.baseUrl;
    let identity;
    if (provider2.identify) {
      const http = createAuthedHttp({
        ...baseUrl !== void 0 ? { baseUrl } : {},
        strategy: provider2.auth,
        connectionId: "(pending)",
        getCredentials: async () => creds,
        redactor,
        fetch: fetchImpl,
        ...retry ? { retry } : {}
      });
      identity = await provider2.identify(http, {});
    } else {
      identity = {
        accountId: opts2.accountId ?? `${provider2.id}:default`,
        ...opts2.email !== void 0 ? { email: opts2.email } : {},
        ...opts2.label !== void 0 ? { label: opts2.label } : {}
      };
    }
    const connConfig = identity.config;
    const connBaseUrl = identity.baseUrl;
    const now = new Date(clock.now()).toISOString();
    const siblings = await store.list({ ownerId, providerId });
    const match = siblings.find((c) => c.accountId === identity.accountId && c.authConfigId === opts2.authConfigId);
    const label = opts2.label ?? identity.label;
    const email = opts2.email ?? identity.email;
    const connection = match ? {
      ...match,
      ...email !== void 0 ? { email } : {},
      ...label !== void 0 ? { label } : {},
      ...opts2.authConfigId !== void 0 ? { authConfigId: opts2.authConfigId } : {},
      ...connConfig !== void 0 ? { config: connConfig } : {},
      ...connBaseUrl !== void 0 ? { baseUrl: connBaseUrl } : {},
      status: "active",
      updatedAt: now
    } : {
      id: newId(),
      ownerId,
      providerId,
      accountId: identity.accountId,
      ...email !== void 0 ? { email } : {},
      ...label !== void 0 ? { label } : {},
      ...opts2.authConfigId !== void 0 ? { authConfigId: opts2.authConfigId } : {},
      ...connConfig !== void 0 ? { config: connConfig } : {},
      ...connBaseUrl !== void 0 ? { baseUrl: connBaseUrl } : {},
      scopes: [],
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    await store.save(connection, await secretBox.seal(creds));
    return connection;
  }
  async function accountChoices(providerId, conns) {
    return Promise.all(
      conns.map(async (c) => {
        const cfg = await authConfigs.getConfigForConnection(providerId, c.authConfigId);
        return {
          connectionId: c.id,
          ...c.email !== void 0 ? { email: c.email } : {},
          ...c.label !== void 0 ? { label: c.label } : {},
          ...cfg?.label ? { authConfigLabel: cfg.label } : {}
        };
      })
    );
  }
  async function resolveConnection(providerId, ownerId, connectionId, account) {
    if (connectionId) {
      const stored = await store.get(connectionId);
      if (!stored || stored.connection.ownerId !== ownerId || stored.connection.providerId !== providerId) {
        return { kind: "not_found" };
      }
      return { kind: "ok", connection: stored.connection };
    }
    const conns = await store.list({ ownerId, providerId });
    if (conns.length === 0) return { kind: "none" };
    if (conns.length === 1) return { kind: "ok", connection: conns[0] };
    if (account) {
      const labelled = await Promise.all(
        conns.map(async (c) => ({
          c,
          cfgLabel: (await authConfigs.getConfigForConnection(providerId, c.authConfigId))?.label
        }))
      );
      const matches = labelled.filter(({ c, cfgLabel }) => tokensFor(c, cfgLabel).includes(account));
      if (matches.length === 1) return { kind: "ok", connection: matches[0].c };
    }
    return { kind: "ambiguous", choices: await accountChoices(providerId, conns) };
  }
  async function listAccountChoices(providerId, opts2 = {}) {
    const ownerId = opts2.ownerId ?? defaultOwnerId;
    return accountChoices(providerId, await store.list({ ownerId, providerId }));
  }
  async function runAction2(actionId, input, options = {}) {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const caller = options.caller ?? { type: "app" };
    const resolved = registry.getAction(actionId);
    if (!resolved) return fail("unknown_action", `unknown action "${actionId}"`);
    const { action: action2, provider: provider2 } = resolved;
    const mutating = action2.mutating ?? false;
    const risk = action2.risk ?? (mutating ? "medium" : "low");
    const parsed = action2.input.safeParse(input);
    if (!parsed.success) {
      return fail("invalid_input", formatZodError(parsed.error));
    }
    const cleanInput = parsed.data;
    const attemptId = newAttemptId();
    const digest = inputDigest(cleanInput);
    const version = actionVersion({ inputSchema: action2.input, risk, mutating });
    const inputPreview = redactor.redact(cleanInput);
    const baseEvent = {
      attemptId,
      actionId,
      caller,
      mutating,
      risk
    };
    emit({ ...baseEvent, phase: "start", status: "ok", inputPreview });
    const finish = (status, extra = {}) => {
      emit({ ...baseEvent, phase: "finish", status, inputPreview, ...extra });
    };
    try {
      const resolution = await resolveConnection(provider2.id, ownerId, options.connectionId, options.account);
      if (resolution.kind === "not_found") {
        finish("error", { status: "error", errorCode: "connection_not_found" });
        return fail("connection_not_found", "connection not found");
      }
      if (resolution.kind === "none") {
        const ctx2 = {
          ...ownerId !== void 0 ? { ownerId } : {},
          ...options.tenantId !== void 0 ? { tenantId: options.tenantId } : {}
        };
        const cr = await resolveConnectConfig(provider2, ctx2, { explicitScopes: action2.scopes ?? [] });
        switch (cr.kind) {
          case "resolved": {
            const scopes = uniqueScopes(provider2.identityScopes, action2.scopes);
            const { authorizationUrl } = await buildAuthorization({
              provider: provider2,
              config: cr.config,
              authConfigId: cr.authConfigId,
              ownerId,
              scopes,
              redirectUri: resolveRedirect(cr.config),
              intent: "new_connection"
            });
            finish("auth_required");
            return { ok: false, reason: "auth_required", providerId: provider2.id, authorizationUrl };
          }
          case "picker":
            finish("auth_config_required");
            return { ok: false, reason: "auth_config_required", providerId: provider2.id, choices: cr.choices };
          case "ambiguous":
            finish("error", { status: "error", errorCode: "auth_config_ambiguous_default" });
            return fail("auth_config_ambiguous_default", `provider "${provider2.id}" has more than one default auth client at the same visibility level`);
          case "unavailable":
            finish("error", { status: "error", errorCode: "auth_config_unavailable" });
            return fail("auth_config_unavailable", `no usable auth client for "${provider2.id}"`);
          case "scope_not_allowed":
            finish("error", { status: "error", errorCode: "scope_not_allowed" });
            return fail("scope_not_allowed", `no auth client for "${provider2.id}" can grant the required scopes`);
          case "none":
            finish("error", { status: "error", errorCode: "provider_not_configured" });
            return fail("provider_not_configured", `no auth client configured for "${provider2.id}"`);
        }
        throw new ConnectorError("internal_error", "unreachable connect resolution");
      }
      if (resolution.kind === "ambiguous") {
        finish("needs_account", { connectionId: void 0 });
        return { ok: false, reason: "needs_account", providerId: provider2.id, choices: resolution.choices };
      }
      const connection = resolution.connection;
      const meta = connectionMetadata(connection);
      const connConfig = await authConfigs.getConfigForConnection(provider2.id, connection.authConfigId);
      if (connConfig) ensureConfigValid(connConfig, provider2);
      const baseUrl = connection.baseUrl ?? connConfig?.baseUrl ?? provider2.baseUrl;
      const required = action2.scopes ?? [];
      const missing = required.filter((s) => !scopeHeld2(provider2, connection.scopes, s));
      if (missing.length > 0) {
        const requestScopes = uniqueScopes(connection.scopes, missing);
        if (connConfig && !scopeCovers(provider2, connConfig.allowedScopes, requestScopes)) {
          finish("error", { connectionId: connection.id, status: "error", errorCode: "scope_not_allowed" });
          return fail("scope_not_allowed", `the connection's auth client cannot grant: ${missing.join(", ")}`);
        }
        if (!connConfig) {
          finish("error", { connectionId: connection.id, status: "error", errorCode: "provider_not_configured" });
          return fail("provider_not_configured", `no auth client configured for "${provider2.id}"`);
        }
        const { authorizationUrl } = await buildAuthorization({
          provider: provider2,
          config: connConfig,
          authConfigId: connection.authConfigId,
          ownerId,
          scopes: requestScopes,
          redirectUri: resolveRedirect(connConfig),
          intent: "add_scopes",
          existingConnectionId: connection.id
        });
        finish("needs_consent", { connectionId: connection.id });
        return {
          ok: false,
          reason: "needs_consent",
          providerId: provider2.id,
          connectionId: connection.id,
          missingScopes: missing,
          authorizationUrl
        };
      }
      const decision = await approval.check({
        actionId,
        actionVersion: version,
        risk,
        mutating,
        connection: meta,
        inputDigest: digest,
        inputPreview,
        caller
      });
      if (decision === "deny") {
        finish("denied", { connectionId: connection.id, status: "denied", errorCode: "denied" });
        return fail("denied", "action denied by policy");
      }
      if (decision === "ask") {
        finish("approval_required", { connectionId: connection.id });
        return { ok: false, reason: "approval_required", actionId, risk, preview: inputPreview };
      }
      const reauth = async () => {
        if (!connConfig) {
          finish("auth_required", { connectionId: connection.id });
          return fail("provider_not_configured", `no auth client configured for "${provider2.id}"`);
        }
        const { authorizationUrl } = await buildAuthorization({
          provider: provider2,
          config: connConfig,
          authConfigId: connection.authConfigId,
          ownerId,
          scopes: uniqueScopes(connection.scopes, provider2.identityScopes),
          redirectUri: resolveRedirect(connConfig),
          intent: "add_scopes",
          existingConnectionId: connection.id
        });
        finish("auth_required", { connectionId: connection.id });
        return { ok: false, reason: "auth_required", providerId: provider2.id, authorizationUrl };
      };
      try {
        await getValidCredentials(connection.id);
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        throw e;
      }
      const http = createAuthedHttp({
        ...baseUrl !== void 0 ? { baseUrl } : {},
        strategy: provider2.auth,
        connectionId: connection.id,
        getCredentials: (force) => getValidCredentials(connection.id, force),
        redactor,
        fetch: fetchImpl,
        ...retry ? { retry } : {}
      });
      const ctx = {
        connection: meta,
        http,
        getToken: async () => provider2.auth.tokenOf(await getValidCredentials(connection.id)),
        config: connection.config ?? {},
        clock,
        log: logger
      };
      let result;
      try {
        result = await action2.execute(ctx, cleanInput);
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        if (e instanceof ConnectorError) {
          const status = e.indeterminate ? "unknown" : "error";
          finish(status, { connectionId: connection.id, status, errorCode: e.code, error: redactor.redact(e.message) });
          return fail(e.code, e.message, e.indeterminate);
        }
        const message = e instanceof Error ? e.message : String(e);
        finish("error", { connectionId: connection.id, status: "error", errorCode: "internal_error", error: redactor.redact(message) });
        return fail("internal_error", message);
      }
      if (action2.output) {
        const out = action2.output.safeParse(result);
        if (!out.success) {
          finish("error", { connectionId: connection.id, status: "error", errorCode: "provider_error" });
          return fail("provider_error", "provider returned an unexpected shape");
        }
        result = out.data;
      }
      const safeResult = redactor.redact(result);
      finish("ok", { connectionId: connection.id, status: "ok", outputPreview: safeResult });
      return { ok: true, result: safeResult };
    } catch (e) {
      if (e instanceof ConnectorError) {
        const status = e.indeterminate ? "unknown" : "error";
        finish(status, { status, errorCode: e.code, error: redactor.redact(e.message) });
        return fail(e.code, e.message, e.indeterminate);
      }
      const message = e instanceof Error ? e.message : String(e);
      logger.error("runAction failed", { actionId, error: message });
      finish("error", { status: "error", errorCode: "internal_error", error: redactor.redact(message) });
      return fail("internal_error", message);
    }
  }
  function emit(event) {
    try {
      onActionRun(event);
    } catch (e) {
      logger.warn("onActionRun threw", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  async function disconnectConnection(id, options = {}) {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const revokeProvider = options.revokeProvider ?? true;
    const stored = await store.get(id);
    if (!stored) return;
    if (stored.connection.ownerId !== ownerId) {
      throw new ConnectorError("connection_not_found", `connection "${id}" not found`);
    }
    if (revokeProvider) {
      try {
        const provider2 = requireProvider(stored.connection.providerId);
        const flow = provider2.auth.oauth;
        if (provider2.revokeUrl && flow?.revoke) {
          const creds = await secretBox.open(stored.sealed);
          registerSecrets(creds);
          const resolvedConfig = await authConfigs.openConfigForConnection(provider2.id, stored.connection.authConfigId);
          const clientId = resolvedConfig?.config.oauth?.clientId;
          const token = creds.type === "oauth2" ? creds.refreshToken ?? creds.accessToken : void 0;
          if (token && clientId) {
            if (resolvedConfig?.clientSecret) redactor.register(resolvedConfig.clientSecret, "client_secret");
            await flow.revoke({
              clientId,
              ...resolvedConfig?.clientSecret !== void 0 ? { clientSecret: resolvedConfig.clientSecret } : {},
              token
            });
          }
        }
      } catch (e) {
        logger.warn("provider revoke failed (continuing with local delete)", {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    await store.delete(id);
  }
  async function testConnection(connectionId, options = {}) {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const checkedAt = new Date(clock.now()).toISOString();
    const stored = await store.get(connectionId);
    if (!stored || stored.connection.ownerId !== ownerId) {
      throw new ConnectorError("connection_not_found", `connection "${connectionId}" not found`);
    }
    const connection = stored.connection;
    const provider2 = requireProvider(connection.providerId);
    let creds;
    try {
      creds = await getValidCredentials(connectionId, true);
    } catch (e) {
      if (e instanceof NeedsReauthError) return { connectionId, ok: false, status: "needs_reauth", verified: true, checkedAt };
      const message = e instanceof Error ? e.message : String(e);
      return { connectionId, ok: false, status: "error", verified: false, error: redactor.redact(message), checkedAt };
    }
    const isOAuth = creds.type === "oauth2";
    const heal = async () => {
      if (connection.status !== "active") await store.setStatus(connectionId, "active");
    };
    const reauth = async () => {
      await store.setStatus(connectionId, "needs_reauth", "health probe: provider rejected credentials");
      return { connectionId, ok: false, status: "needs_reauth", verified: true, checkedAt };
    };
    if (provider2.healthCheck || provider2.identify) {
      const connConfig = await authConfigs.getConfigForConnection(provider2.id, connection.authConfigId);
      const baseUrl = connection.baseUrl ?? connConfig?.baseUrl ?? provider2.baseUrl;
      const http = createAuthedHttp({
        ...baseUrl !== void 0 ? { baseUrl } : {},
        strategy: provider2.auth,
        connectionId,
        getCredentials: (force) => getValidCredentials(connectionId, force),
        redactor,
        fetch: fetchImpl,
        ...retry ? { retry } : {}
      });
      try {
        if (provider2.healthCheck) await provider2.healthCheck(http, { config: connection.config ?? {} });
        else await provider2.identify(http, {});
        await heal();
        return { connectionId, ok: true, status: "active", verified: true, checkedAt };
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        if (provider2.healthCheck || !isOAuth) {
          const message = e instanceof Error ? e.message : String(e);
          return { connectionId, ok: false, status: "error", verified: false, error: redactor.redact(message), checkedAt };
        }
        await heal();
        return { connectionId, ok: true, status: "active", verified: false, checkedAt };
      }
    }
    await heal();
    return { connectionId, ok: true, status: "active", verified: isOAuth, checkedAt };
  }
  return {
    beginAuth,
    completeAuth,
    connectDirect,
    listConnections: (filter) => store.list(filter),
    listAccountChoices,
    runAction: runAction2,
    testConnection,
    disconnectConnection,
    getToolkits: () => registry.toolkits(),
    getProviders: () => registry.providers()
  };
}
function tokensFor(conn, cfgLabel) {
  const bases = [conn.email, conn.label].filter((s) => !!s);
  const tokens = [...bases];
  if (cfgLabel) for (const b of bases) tokens.push(`${b} (${cfgLabel})`);
  return tokens;
}
function grantedFrom(ts, requested) {
  const rawScope = ts.raw?.scope;
  const scope = ts.scope ?? rawScope;
  if (scope && typeof scope === "string") return scope.split(/[\s,]+/).filter(Boolean);
  return requested;
}
function formatZodError(err) {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
var DEFAULT_OWNER, DEFAULT_AUTH_TTL_MS, DEFAULT_REFRESH_SKEW_MS;
var init_runtime = __esm({
  "packages/connectors/src/core/runtime.ts"() {
    "use strict";
    init_oauth2();
    init_pkce();
    init_errors();
    init_auth_config_validate();
    init_digest();
    init_defaults();
    init_http();
    init_redactor();
    init_ids();
    init_in_process();
    DEFAULT_OWNER = "local";
    DEFAULT_AUTH_TTL_MS = 10 * 6e4;
    DEFAULT_REFRESH_SKEW_MS = 6e4;
  }
});

// packages/connectors/src/core/registry.ts
import { z } from "zod";
function isZodObject(schema) {
  if (schema instanceof z.ZodObject) return true;
  const def = schema?._def;
  return def?.typeName === "ZodObject" || def?.shape !== void 0;
}
function objectKeys(schema) {
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  const shape = schema?._def?.shape;
  const resolved = typeof shape === "function" ? shape() : shape;
  return resolved && typeof resolved === "object" ? Object.keys(resolved) : [];
}
function createRegistry() {
  const providers = /* @__PURE__ */ new Map();
  const toolkits = /* @__PURE__ */ new Map();
  const actions2 = /* @__PURE__ */ new Map();
  function addToolkit(toolkit) {
    const provider2 = providers.get(toolkit.providerId);
    if (!provider2) {
      throw new ConnectorError(
        "internal_error",
        `toolkit "${toolkit.id}" references unknown provider "${toolkit.providerId}" (register the provider first)`
      );
    }
    if (toolkits.has(toolkit.id)) {
      throw new ConnectorError("internal_error", `duplicate toolkit id "${toolkit.id}"`);
    }
    for (const action2 of toolkit.actions) {
      if (actions2.has(action2.id)) {
        throw new ConnectorError("internal_error", `duplicate action id "${action2.id}"`);
      }
      if (!isZodObject(action2.input)) {
        throw new ConnectorError(
          "internal_error",
          `action "${action2.id}" input must be a Zod object schema (the projection injects an \`account\` field)`
        );
      }
      if (objectKeys(action2.input).includes("account")) {
        throw new ConnectorError(
          "internal_error",
          `action "${action2.id}" input declares a reserved field "account" (the projection injects it; rename the field)`
        );
      }
    }
    toolkits.set(toolkit.id, toolkit);
    for (const action2 of toolkit.actions) actions2.set(action2.id, { action: action2, toolkit, provider: provider2 });
  }
  return {
    addProvider(provider2) {
      if (providers.has(provider2.id)) {
        throw new ConnectorError("internal_error", `duplicate provider id "${provider2.id}"`);
      }
      providers.set(provider2.id, provider2);
    },
    addToolkit,
    addBundle({ provider: provider2, toolkits: tks }) {
      if (providers.has(provider2.id)) {
        throw new ConnectorError("internal_error", `duplicate provider id "${provider2.id}"`);
      }
      providers.set(provider2.id, provider2);
      for (const t of tks) addToolkit(t);
    },
    getProvider: (id) => providers.get(id),
    getToolkit: (id) => toolkits.get(id),
    getAction: (id) => actions2.get(id),
    providers: () => [...providers.values()],
    toolkits: () => [...toolkits.values()]
  };
}
var init_registry = __esm({
  "packages/connectors/src/core/registry.ts"() {
    "use strict";
    init_errors();
  }
});

// packages/connectors/src/core/authoring.ts
function defineProvider(provider2) {
  return provider2;
}
function defineToolkit(toolkit) {
  if (toolkit.scopes) return toolkit;
  const scopes = [...new Set(toolkit.actions.flatMap((a) => a.scopes ?? []))];
  return { ...toolkit, scopes };
}
function action(spec) {
  return {
    id: spec.id,
    description: spec.description,
    input: spec.input,
    ...spec.output ? { output: spec.output } : {},
    ...spec.scopes ? { scopes: spec.scopes } : {},
    ...spec.mutating !== void 0 ? { mutating: spec.mutating } : {},
    ...spec.risk ? { risk: spec.risk } : {},
    ...spec.deprecated !== void 0 ? { deprecated: spec.deprecated } : {},
    ...spec.replacedBy ? { replacedBy: spec.replacedBy } : {},
    execute: spec.execute
  };
}
function httpAction(spec) {
  const mutating = spec.mutating ?? false;
  return {
    id: spec.id,
    description: spec.description,
    input: spec.input,
    ...spec.scopes ? { scopes: spec.scopes } : {},
    mutating,
    ...spec.risk ? { risk: spec.risk } : {},
    ...spec.deprecated !== void 0 ? { deprecated: spec.deprecated } : {},
    ...spec.replacedBy ? { replacedBy: spec.replacedBy } : {},
    async execute(ctx, input) {
      const req = spec.request(input, { config: ctx.config });
      const raw = await ctx.http.request({ ...req, mutating });
      return spec.output ? spec.output(raw) : raw;
    }
  };
}
var init_authoring = __esm({
  "packages/connectors/src/core/authoring.ts"() {
    "use strict";
  }
});

// packages/connectors/src/core/paginate.ts
async function collectPages(fetchPage, options = {}) {
  const maxItems = options.maxItems ?? 1e3;
  const maxPages = options.maxPages ?? 50;
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    out.push(...items);
    if (out.length >= maxItems) return out.slice(0, maxItems);
    if (nextCursor == null || nextCursor === "") break;
    cursor = nextCursor;
  }
  return out;
}
var init_paginate = __esm({
  "packages/connectors/src/core/paginate.ts"() {
    "use strict";
  }
});

// packages/connectors/src/auth-configs.ts
function visibilityKey(c) {
  switch (c.scope) {
    case "global":
      return "global";
    case "tenant":
      return `tenant:${c.tenantId}`;
    case "owner":
      return `owner:${c.ownerId}`;
  }
}
function visibleIn(c, ctx) {
  switch (c.scope) {
    case "global":
      return true;
    case "tenant":
      return ctx.tenantId != null && c.tenantId === ctx.tenantId;
    case "owner":
      return ctx.ownerId != null && c.ownerId === ctx.ownerId;
  }
}
function summarize(c) {
  return {
    id: c.id,
    providerId: c.providerId,
    scheme: c.scheme,
    ...c.label !== void 0 ? { label: c.label } : {},
    isDefault: c.isDefault ?? false,
    status: c.status
  };
}
function validateStaticConfigs(configs) {
  const ids = /* @__PURE__ */ new Set();
  const byProvider = /* @__PURE__ */ new Map();
  const defaultKeys = /* @__PURE__ */ new Set();
  for (const c of configs) {
    if (ids.has(c.id)) {
      throw new ConnectorError("internal_error", `duplicate AuthConfig id "${c.id}" (ids are globally unique)`);
    }
    ids.add(c.id);
    if (c.scope === "tenant" && c.tenantId == null) {
      throw new ConnectorError("internal_error", `AuthConfig "${c.id}" has scope 'tenant' but no tenantId`);
    }
    if (c.scope === "owner" && c.ownerId == null) {
      throw new ConnectorError("internal_error", `AuthConfig "${c.id}" has scope 'owner' but no ownerId`);
    }
    if (c.scheme === "oauth2" && !c.oauth) {
      throw new ConnectorError("internal_error", `AuthConfig "${c.id}" is scheme 'oauth2' but has no oauth client identity`);
    }
    const list2 = byProvider.get(c.providerId) ?? [];
    list2.push(c);
    byProvider.set(c.providerId, list2);
    if (c.isDefault) {
      const key = `${c.providerId}|${visibilityKey(c)}`;
      if (defaultKeys.has(key)) {
        throw new ConnectorError(
          "auth_config_ambiguous_default",
          `provider "${c.providerId}" has more than one default AuthConfig at the same visibility level`
        );
      }
      defaultKeys.add(key);
    }
  }
  for (const [providerId, list2] of byProvider) {
    if (list2.length > 1) {
      const unnamed = list2.find((c) => c.label == null || c.label === "");
      if (unnamed) {
        throw new ConnectorError(
          "internal_error",
          `provider "${providerId}" has >1 AuthConfig, so each needs a label; "${unnamed.id}" has none`
        );
      }
    }
  }
}
function storeAuthConfigRegistry(opts) {
  const bundledConfigs = [];
  const bundledSecrets = /* @__PURE__ */ new Map();
  for (const item of opts.bundled ?? []) {
    const { clientSecret, ...config } = item;
    bundledConfigs.push(config);
    if (clientSecret) bundledSecrets.set(config.id, clientSecret);
  }
  validateStaticConfigs(bundledConfigs);
  const bundledFor = (providerId) => bundledConfigs.filter((c) => c.providerId === providerId);
  const combinedFor = async (providerId) => [
    ...bundledFor(providerId),
    ...await opts.store.listForProvider(providerId)
  ];
  const legacyDefaultId = async (providerId) => {
    const list2 = await combinedFor(providerId);
    const marked = list2.find((c) => c.isDefault);
    if (marked) return marked.id;
    return list2.length === 1 ? list2[0].id : null;
  };
  const configById = async (providerId, id) => {
    const b = bundledFor(providerId).find((c) => c.id === id);
    if (b) return b;
    const s = await opts.store.get(id);
    return s && s.config.providerId === providerId ? s.config : null;
  };
  const open3 = async (providerId, id) => {
    const b = bundledFor(providerId).find((c) => c.id === id);
    if (b) {
      const sec = bundledSecrets.get(b.id);
      return { config: b, ...sec !== void 0 ? { clientSecret: sec } : {} };
    }
    const s = await opts.store.get(id);
    if (!s || s.config.providerId !== providerId) return null;
    const clientSecret = s.sealedSecret !== void 0 ? await opts.secretBox.open(s.sealedSecret) : void 0;
    return { config: s.config, ...clientSecret !== void 0 ? { clientSecret } : {} };
  };
  return {
    async listForConnect(providerId, ctx) {
      return (await combinedFor(providerId)).filter((c) => visibleIn(c, ctx));
    },
    async getConfigForConnection(providerId, authConfigId) {
      if (authConfigId == null) {
        const id = await legacyDefaultId(providerId);
        return id ? configById(providerId, id) : null;
      }
      return configById(providerId, authConfigId);
    },
    async openConfigForConnection(providerId, authConfigId) {
      const id = authConfigId == null ? await legacyDefaultId(providerId) : authConfigId;
      return id ? open3(providerId, id) : null;
    },
    async listForProvider(providerId, ctx) {
      return (await combinedFor(providerId)).filter((c) => visibleIn(c, ctx)).map(summarize);
    }
  };
}
var init_auth_configs = __esm({
  "packages/connectors/src/auth-configs.ts"() {
    "use strict";
    init_errors();
  }
});

// packages/connectors/src/core/auth-config-admin.ts
function summarize2(c) {
  return {
    id: c.id,
    providerId: c.providerId,
    scheme: c.scheme,
    ...c.label !== void 0 ? { label: c.label } : {},
    isDefault: c.isDefault ?? false,
    status: c.status
  };
}
function createAuthConfigAdmin(deps) {
  return {
    async addConfig(input) {
      const scope = input.scope ?? "owner";
      if (!input.label) throw new ConnectorError("invalid_input", "a BYO auth config requires a label");
      if (scope === "owner" && !input.ownerId) throw new ConnectorError("invalid_input", "scope 'owner' requires ownerId");
      if (scope === "tenant" && !input.tenantId) throw new ConnectorError("invalid_input", "scope 'tenant' requires tenantId");
      if (input.scheme === "oauth2" && !input.oauth) {
        throw new ConnectorError("invalid_input", "an oauth2 config requires oauth { clientId, redirectUri }");
      }
      const id = input.id ?? `${input.providerId}-${newId()}`;
      if (await deps.store.get(id)) throw new ConnectorError("conflict", `auth config "${id}" already exists`);
      const config = {
        id,
        providerId: input.providerId,
        scheme: input.scheme,
        label: input.label,
        scope,
        ...input.ownerId !== void 0 ? { ownerId: input.ownerId } : {},
        ...input.tenantId !== void 0 ? { tenantId: input.tenantId } : {},
        ...input.oauth !== void 0 ? { oauth: input.oauth } : {},
        ...input.defaultScopes !== void 0 ? { defaultScopes: input.defaultScopes } : {},
        ...input.allowedScopes !== void 0 ? { allowedScopes: input.allowedScopes } : {},
        ...input.baseUrl !== void 0 ? { baseUrl: input.baseUrl } : {},
        status: "active"
      };
      const provider2 = deps.getProvider?.(input.providerId);
      if (provider2) assertAuthConfigValidForProvider(config, provider2, "invalid_input");
      const sealed = input.clientSecret !== void 0 ? await deps.secretBox.seal(input.clientSecret) : void 0;
      await deps.store.create(config, sealed);
      return summarize2(config);
    },
    async removeConfig(id) {
      const entry = await deps.store.get(id);
      if (!entry) return;
      const refs = await deps.connections.list({ providerId: entry.config.providerId });
      if (refs.some((c) => c.authConfigId === id)) {
        throw new ConnectorError(
          "conflict",
          `cannot delete auth config "${id}" while connections use it \u2014 archive it, or disconnect those connections first`
        );
      }
      await deps.store.delete(id);
    },
    async setDefault(providerId, id) {
      const entry = await deps.store.get(id);
      if (!entry || entry.config.providerId !== providerId) {
        throw new ConnectorError("invalid_input", `no auth config "${id}" for provider "${providerId}"`);
      }
      const conns = await deps.connections.list({ providerId });
      if (conns.some((c) => c.authConfigId == null)) {
        throw new ConnectorError(
          "conflict",
          `cannot repoint the default for "${providerId}" while legacy (unstamped) connections exist \u2014 backfill them first (\xA75)`
        );
      }
      await deps.store.setDefault(providerId, id);
    },
    async setStatus(id, status) {
      await deps.store.setStatus(id, status);
    },
    async list(providerId) {
      return (await deps.store.listForProvider(providerId)).map(summarize2);
    }
  };
}
var init_auth_config_admin = __esm({
  "packages/connectors/src/core/auth-config-admin.ts"() {
    "use strict";
    init_ids();
    init_errors();
    init_auth_config_validate();
  }
});

// packages/connectors/src/lock/file.ts
import { mkdir, rm, stat } from "fs/promises";
import { join } from "path";
function fileLock(opts) {
  const staleMs = opts.staleMs ?? 3e4;
  const retryMs = opts.retryMs ?? 25;
  const timeoutMs = opts.timeoutMs ?? 15e3;
  const local = inProcessLock();
  const lockPath = (key) => join(opts.dir, `${encodeURIComponent(key)}.lock`);
  async function acquire(path24) {
    const start = Date.now();
    for (; ; ) {
      try {
        await mkdir(path24, { recursive: false });
        return;
      } catch (e) {
        if (e?.code !== "EEXIST") throw e;
        try {
          const s = await stat(path24);
          if (Date.now() - s.mtimeMs > staleMs) {
            await rm(path24, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - start > timeoutMs) throw new Error(`fileLock: timed out acquiring ${path24}`);
        await sleep(retryMs);
      }
    }
  }
  return {
    async withLock(key, fn) {
      return local.withLock(key, async () => {
        await mkdir(opts.dir, { recursive: true });
        const path24 = lockPath(key);
        await acquire(path24);
        try {
          return await fn();
        } finally {
          await rm(path24, { recursive: true, force: true }).catch(() => void 0);
        }
      });
    }
  };
}
var sleep;
var init_file = __esm({
  "packages/connectors/src/lock/file.ts"() {
    "use strict";
    init_in_process();
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  }
});

// packages/connectors/src/lock/index.ts
var init_lock = __esm({
  "packages/connectors/src/lock/index.ts"() {
    "use strict";
    init_file();
  }
});

// packages/connectors/src/index.ts
var init_src = __esm({
  "packages/connectors/src/index.ts"() {
    "use strict";
    init_runtime();
    init_registry();
    init_auth_configs();
    init_auth_config_admin();
    init_redactor();
    init_lock();
  }
});

// packages/connectors/src/crypto/aes-gcm.ts
import { createCipheriv, createDecipheriv, randomBytes as randomBytes2, createHash as createHash5 } from "crypto";
function normalizeKey(key) {
  if (typeof key === "string") return createHash5("sha256").update(key).digest();
  const buf = Buffer.from(key);
  return buf.length === 32 ? buf : createHash5("sha256").update(buf).digest();
}
function aesGcmSecretBox(opts) {
  const key = normalizeKey(opts.key);
  return {
    async seal(value) {
      const iv = randomBytes2(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const pt = Buffer.from(JSON.stringify(value ?? null), "utf8");
      const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
      const env = {
        v: 1,
        iv: iv.toString("base64"),
        ct: ct.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
      };
      return JSON.stringify(env);
    },
    async open(sealed) {
      const env = JSON.parse(sealed);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
      decipher.setAuthTag(Buffer.from(env.tag, "base64"));
      const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]);
      return JSON.parse(pt.toString("utf8"));
    }
  };
}
function generateSecretKey() {
  return randomBytes2(32).toString("base64");
}
var init_aes_gcm = __esm({
  "packages/connectors/src/crypto/aes-gcm.ts"() {
    "use strict";
  }
});

// packages/connectors/src/crypto/index.ts
var init_crypto = __esm({
  "packages/connectors/src/crypto/index.ts"() {
    "use strict";
    init_aes_gcm();
  }
});

// packages/connectors/src/store/file.ts
import { mkdir as mkdir2, readFile, rename, writeFile } from "fs/promises";
import { join as join2 } from "path";
import { randomBytes as randomBytes3 } from "crypto";
async function readJson(path24, fallback) {
  try {
    return JSON.parse(await readFile(path24, "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return fallback;
    throw e;
  }
}
async function writeJsonAtomic(dir, path24, value) {
  await mkdir2(dir, { recursive: true });
  const tmp = `${path24}.${randomBytes3(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 384 });
  await rename(tmp, path24);
}
function fileStore(opts) {
  const connectionsPath = join2(opts.dir, "connections.json");
  const authRequestsPath = join2(opts.dir, "auth-requests.json");
  const lock = opts.lock ?? inProcessLock();
  const readConnections = () => readJson(connectionsPath, []);
  const readAuthRequests = () => readJson(authRequestsPath, []);
  return {
    // ── ConnectionStore ──
    async list(filter) {
      const all = await readConnections();
      return all.map((e) => e.connection).filter(
        (c) => (!filter?.ownerId || c.ownerId === filter.ownerId) && (!filter?.providerId || c.providerId === filter.providerId)
      );
    },
    async get(id) {
      const all = await readConnections();
      return all.find((e) => e.connection.id === id) ?? null;
    },
    async save(connection, sealed) {
      await lock.withLock("connections", async () => {
        const all = await readConnections();
        const idx = all.findIndex((e) => e.connection.id === connection.id);
        const entry = { connection, sealed };
        if (idx >= 0) all[idx] = entry;
        else all.push(entry);
        await writeJsonAtomic(opts.dir, connectionsPath, all);
      });
    },
    async setStatus(id, status, _reason) {
      await lock.withLock("connections", async () => {
        const all = await readConnections();
        const entry = all.find((e) => e.connection.id === id);
        if (!entry) return;
        entry.connection.status = status;
        entry.connection.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await writeJsonAtomic(opts.dir, connectionsPath, all);
      });
    },
    async delete(id) {
      await lock.withLock("connections", async () => {
        const all = await readConnections();
        const next = all.filter((e) => e.connection.id !== id);
        await writeJsonAtomic(opts.dir, connectionsPath, next);
      });
    },
    // ── AuthRequestStore ──
    async put(req) {
      await lock.withLock("auth-requests", async () => {
        const all = await readAuthRequests();
        const next = all.filter((r) => r.state !== req.state);
        next.push(req);
        await writeJsonAtomic(opts.dir, authRequestsPath, next);
      });
    },
    async take(state5) {
      return lock.withLock("auth-requests", async () => {
        const all = await readAuthRequests();
        const req = all.find((r) => r.state === state5) ?? null;
        const next = all.filter((r) => r.state !== state5);
        await writeJsonAtomic(opts.dir, authRequestsPath, next);
        return req;
      });
    },
    async sweepExpired(now) {
      await lock.withLock("auth-requests", async () => {
        const all = await readAuthRequests();
        const next = all.filter((r) => r.expiresAt >= now);
        if (next.length !== all.length) await writeJsonAtomic(opts.dir, authRequestsPath, next);
      });
    }
  };
}
var init_file2 = __esm({
  "packages/connectors/src/store/file.ts"() {
    "use strict";
    init_in_process();
  }
});

// packages/connectors/src/store/auth-config.ts
import { chmod, mkdir as mkdir3, readFile as readFile2, rename as rename2, writeFile as writeFile2 } from "fs/promises";
import { join as join3 } from "path";
import { randomBytes as randomBytes4 } from "crypto";
function visibilityKey2(c) {
  switch (c.scope) {
    case "global":
      return "global";
    case "tenant":
      return `tenant:${c.tenantId}`;
    case "owner":
      return `owner:${c.ownerId}`;
  }
}
function applySetDefault(items, providerId, id) {
  const target = items.find((e) => e.config.id === id && e.config.providerId === providerId);
  if (!target) return items;
  const key = visibilityKey2(target.config);
  return items.map((e) => {
    if (e.config.providerId !== providerId || visibilityKey2(e.config) !== key) return e;
    return { ...e, config: { ...e.config, isDefault: e.config.id === id } };
  });
}
async function readJson2(path24, fallback) {
  try {
    return JSON.parse(await readFile2(path24, "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return fallback;
    throw e;
  }
}
async function writeJsonAtomic2(dir, path24, value) {
  await mkdir3(dir, { recursive: true, mode: 448 });
  await chmod(dir, 448).catch(() => {
  });
  const tmp = `${path24}.${randomBytes4(6).toString("hex")}.tmp`;
  await writeFile2(tmp, JSON.stringify(value, null, 2), { mode: 384 });
  await rename2(tmp, path24);
}
function authConfigFileStore(opts) {
  const path24 = join3(opts.dir, "auth-configs.json");
  const lock = opts.lock ?? inProcessLock();
  const read = () => readJson2(path24, []);
  const write = (items) => writeJsonAtomic2(opts.dir, path24, items);
  return {
    async create(config, sealedSecret) {
      await lock.withLock("auth-configs", async () => {
        const items = await read();
        const entry = { config, ...sealedSecret !== void 0 ? { sealedSecret } : {} };
        const idx = items.findIndex((e) => e.config.id === config.id);
        if (idx >= 0) items[idx] = entry;
        else items.push(entry);
        await write(items);
      });
    },
    async get(id) {
      return (await read()).find((e) => e.config.id === id) ?? null;
    },
    async listForProvider(providerId) {
      return (await read()).filter((e) => e.config.providerId === providerId).map((e) => e.config);
    },
    async setDefault(providerId, id) {
      await lock.withLock("auth-configs", async () => {
        await write(applySetDefault(await read(), providerId, id));
      });
    },
    async setStatus(id, status) {
      await lock.withLock("auth-configs", async () => {
        const items = (await read()).map((e) => e.config.id === id ? { ...e, config: { ...e.config, status } } : e);
        await write(items);
      });
    },
    async delete(id) {
      await lock.withLock("auth-configs", async () => {
        await write((await read()).filter((e) => e.config.id !== id));
      });
    }
  };
}
var init_auth_config = __esm({
  "packages/connectors/src/store/auth-config.ts"() {
    "use strict";
    init_in_process();
  }
});

// packages/connectors/src/store/index.ts
var init_store = __esm({
  "packages/connectors/src/store/index.ts"() {
    "use strict";
    init_file2();
    init_auth_config();
  }
});

// packages/connectors/src/providers/google/provider.ts
function google(options = {}) {
  return defineProvider({
    id: "google",
    displayName: "Google",
    baseUrl: "https://www.googleapis.com",
    identityScopes: ["openid", "email"],
    revokeUrl: GOOGLE_REVOKE_URL,
    scopeSatisfies: googleScopeSatisfies,
    auth: oauth2({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: GOOGLE_REVOKE_URL,
      usePkce: true,
      // `access_type=offline` + `prompt=consent` guarantee a refresh token (§14).
      authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/oauth2/v2/userinfo");
      const accountId = me.sub ?? me.id ?? me.email;
      if (!accountId) throw new Error("google identify: userinfo returned no stable id");
      return {
        accountId,
        ...me.email !== void 0 ? { email: me.email } : {},
        label: me.email ?? me.name ?? accountId
      };
    }
  });
}
function googleScopeSatisfies(granted, required) {
  if (granted.includes(required)) return true;
  return granted.some((g2) => SCOPE_IMPLIES[g2]?.includes(required) ?? false);
}
var GOOGLE_REVOKE_URL, GOOGLE_SCOPES, S, SCOPE_IMPLIES;
var init_provider = __esm({
  "packages/connectors/src/providers/google/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
    GOOGLE_SCOPES = {
      calendarFull: "https://www.googleapis.com/auth/calendar",
      calendarReadonly: "https://www.googleapis.com/auth/calendar.readonly",
      calendarEvents: "https://www.googleapis.com/auth/calendar.events",
      calendarEventsReadonly: "https://www.googleapis.com/auth/calendar.events.readonly",
      gmailFull: "https://mail.google.com/",
      gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
      gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
      gmailSend: "https://www.googleapis.com/auth/gmail.send",
      gmailModify: "https://www.googleapis.com/auth/gmail.modify",
      driveFull: "https://www.googleapis.com/auth/drive",
      driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
      driveFile: "https://www.googleapis.com/auth/drive.file",
      documents: "https://www.googleapis.com/auth/documents",
      documentsReadonly: "https://www.googleapis.com/auth/documents.readonly",
      spreadsheets: "https://www.googleapis.com/auth/spreadsheets",
      spreadsheetsReadonly: "https://www.googleapis.com/auth/spreadsheets.readonly",
      // Identity. The short aliases `email`/`profile` are what we REQUEST (identityScopes), but Google
      // grants back (and returns in the token's `scope`) the canonical userinfo URLs — so the two must
      // be treated as equivalent or every call re-prompts for `email`. `openid` is returned as-is.
      userinfoEmail: "https://www.googleapis.com/auth/userinfo.email",
      userinfoProfile: "https://www.googleapis.com/auth/userinfo.profile"
    };
    S = GOOGLE_SCOPES;
    SCOPE_IMPLIES = {
      [S.gmailFull]: [S.gmailReadonly, S.gmailCompose, S.gmailSend, S.gmailModify],
      [S.gmailModify]: [S.gmailReadonly, S.gmailCompose],
      [S.calendarFull]: [S.calendarReadonly, S.calendarEvents, S.calendarEventsReadonly],
      [S.calendarEvents]: [S.calendarEventsReadonly],
      [S.calendarReadonly]: [S.calendarEventsReadonly],
      // Google returns the canonical userinfo URL for the requested `email`/`profile` aliases.
      [S.userinfoEmail]: ["email"],
      [S.userinfoProfile]: ["profile"],
      [S.driveFull]: [S.driveReadonly, S.driveFile],
      [S.documents]: [S.documentsReadonly],
      [S.spreadsheets]: [S.spreadsheetsReadonly]
    };
  }
});

// packages/connectors/src/providers/google/calendar.ts
import { z as z2 } from "zod";
function eventSummary(e) {
  return {
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    status: e.status,
    htmlLink: e.htmlLink
  };
}
var CAL, googleCalendar;
var init_calendar2 = __esm({
  "packages/connectors/src/providers/google/calendar.ts"() {
    "use strict";
    init_authoring();
    init_provider();
    CAL = "/calendar/v3";
    googleCalendar = defineToolkit({
      id: "google_calendar",
      providerId: "google",
      displayName: "Google Calendar",
      // `scopes` (upfront-consent bundle) defaults to the union of the actions' scopes (§3).
      actions: [
        httpAction({
          id: "google_calendar.list_calendars",
          description: "List the calendars the user can access.",
          scopes: [GOOGLE_SCOPES.calendarReadonly],
          input: z2.object({}),
          request: () => ({ method: "GET", path: `${CAL}/users/me/calendarList` }),
          output: (raw) => {
            const r = raw;
            return { calendars: (r.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary })) };
          }
        }),
        httpAction({
          id: "google_calendar.list_events",
          description: "List upcoming or recently changed events on a calendar.",
          scopes: [GOOGLE_SCOPES.calendarEventsReadonly],
          input: z2.object({
            calendarId: z2.string().default("primary"),
            timeMin: z2.string().optional().describe("RFC3339 lower bound (e.g. 2026-06-18T00:00:00Z)"),
            timeMax: z2.string().optional(),
            maxResults: z2.number().int().positive().max(2500).default(25),
            query: z2.string().optional().describe("Free-text search over events")
          }),
          request: (i) => ({
            method: "GET",
            path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events`,
            query: {
              timeMin: i.timeMin,
              timeMax: i.timeMax,
              maxResults: i.maxResults,
              q: i.query,
              singleEvents: true,
              orderBy: "startTime"
            }
          }),
          output: (raw) => {
            const r = raw;
            return { events: (r.items ?? []).map(eventSummary) };
          }
        }),
        httpAction({
          id: "google_calendar.get_event",
          description: "Get a single calendar event by id.",
          scopes: [GOOGLE_SCOPES.calendarEventsReadonly],
          input: z2.object({ calendarId: z2.string().default("primary"), eventId: z2.string() }),
          request: (i) => ({
            method: "GET",
            path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`
          }),
          output: (raw) => eventSummary(raw)
        }),
        httpAction({
          id: "google_calendar.create_event",
          description: "Create an event on a calendar.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.calendarEvents],
          input: z2.object({
            calendarId: z2.string().default("primary"),
            summary: z2.string(),
            description: z2.string().optional(),
            location: z2.string().optional(),
            start: z2.string().describe("RFC3339 start, e.g. 2026-06-20T15:00:00-04:00"),
            end: z2.string().describe("RFC3339 end"),
            attendees: z2.array(z2.string().email()).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events`,
            body: {
              summary: i.summary,
              description: i.description,
              location: i.location,
              start: { dateTime: i.start },
              end: { dateTime: i.end },
              attendees: i.attendees?.map((email) => ({ email }))
            }
          }),
          output: (raw) => eventSummary(raw)
        }),
        httpAction({
          id: "google_calendar.update_event",
          description: "Update fields on an existing event.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.calendarEvents],
          input: z2.object({
            calendarId: z2.string().default("primary"),
            eventId: z2.string(),
            summary: z2.string().optional(),
            description: z2.string().optional(),
            location: z2.string().optional(),
            start: z2.string().optional(),
            end: z2.string().optional()
          }),
          request: (i) => ({
            method: "PATCH",
            path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`,
            body: {
              summary: i.summary,
              description: i.description,
              location: i.location,
              start: i.start ? { dateTime: i.start } : void 0,
              end: i.end ? { dateTime: i.end } : void 0
            }
          }),
          output: (raw) => eventSummary(raw)
        }),
        httpAction({
          id: "google_calendar.delete_event",
          description: "Delete an event from a calendar.",
          mutating: true,
          risk: "high",
          scopes: [GOOGLE_SCOPES.calendarEvents],
          input: z2.object({ calendarId: z2.string().default("primary"), eventId: z2.string() }),
          request: (i) => ({
            method: "DELETE",
            path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`
          }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/google/gmail.ts
import { z as z3 } from "zod";
function encodeHeaderWord(value) {
  return hasNonAscii(value) ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=` : value;
}
function encodeEmail(input) {
  for (const [name, value] of [
    ["To", input.to],
    ["Cc", input.cc],
    ["Bcc", input.bcc],
    ["Subject", input.subject]
  ]) {
    if (value && hasLineBreak(value)) throw new Error(`mail header "${name}" contains a line break`);
  }
  const headers = [
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : null,
    input.bcc ? `Bcc: ${input.bcc}` : null,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64"
  ].filter((h) => h !== null);
  const body = (Buffer.from(input.body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  const raw = `${headers.join("\r\n")}\r
\r
${body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}
function extractHeaders(p) {
  const out = {};
  for (const h of p?.headers ?? []) {
    if (h.name && h.value !== void 0 && WANTED_HEADERS.includes(h.name)) out[h.name] = h.value;
  }
  return Object.keys(out).length ? out : void 0;
}
function extractPlainText(p) {
  if (!p) return void 0;
  if ((p.mimeType ?? "").startsWith("text/plain") && p.body?.data) {
    try {
      return Buffer.from(p.body.data, "base64url").toString("utf8");
    } catch {
      return void 0;
    }
  }
  for (const part of p.parts ?? []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  return void 0;
}
var GMAIL, hasNonAscii, hasLineBreak, EMAIL_RE, isEmailList, recipientField, subjectField, WANTED_HEADERS, gmail;
var init_gmail = __esm({
  "packages/connectors/src/providers/google/gmail.ts"() {
    "use strict";
    init_authoring();
    init_provider();
    GMAIL = "/gmail/v1/users/me";
    hasNonAscii = (s) => /[^\x00-\x7F]/.test(s);
    hasLineBreak = (s) => /[\r\n]/.test(s);
    EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
    isEmailList = (s) => s.split(",").map((p) => p.trim()).filter(Boolean).length > 0 && s.split(",").map((p) => p.trim()).filter(Boolean).every((p) => EMAIL_RE.test(p));
    recipientField = z3.string().refine((s) => !hasLineBreak(s), "recipients must not contain line breaks").refine(isEmailList, "must be a valid email address or comma-separated list of addresses");
    subjectField = z3.string().refine((s) => !hasLineBreak(s), "subject must not contain line breaks");
    WANTED_HEADERS = ["From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID"];
    gmail = defineToolkit({
      id: "gmail",
      providerId: "google",
      displayName: "Gmail",
      // `scopes` (the upfront-consent bundle) defaults to the union of the actions' scopes
      // (§3). Declaring it by hand drifts — it previously omitted gmail.compose, so a
      // full-toolkit connect could never create a draft (P2-b). Let `defineToolkit` derive it.
      actions: [
        httpAction({
          id: "gmail.search_messages",
          description: 'Search messages with a Gmail query (e.g. "from:alice is:unread").',
          scopes: [GOOGLE_SCOPES.gmailReadonly],
          input: z3.object({
            query: z3.string().describe("Gmail search query"),
            maxResults: z3.number().int().positive().max(100).default(20)
          }),
          request: (i) => ({ method: "GET", path: `${GMAIL}/messages`, query: { q: i.query, maxResults: i.maxResults } }),
          output: (raw) => {
            const r = raw;
            return {
              messages: (r.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId })),
              estimate: r.resultSizeEstimate ?? 0
            };
          }
        }),
        httpAction({
          id: "gmail.get_message",
          description: "Get a message by id (metadata + snippet).",
          scopes: [GOOGLE_SCOPES.gmailReadonly],
          input: z3.object({
            messageId: z3.string(),
            format: z3.enum(["full", "metadata", "minimal"]).default("metadata")
          }),
          request: (i) => ({ method: "GET", path: `${GMAIL}/messages/${encodeURIComponent(i.messageId)}`, query: { format: i.format } }),
          // `format` is now honored: 'metadata'/'full' surface the parsed headers; 'full' also
          // includes the decoded plain-text body. 'minimal' returns no payload, so neither appears.
          output: (raw) => {
            const m = raw;
            const headers = extractHeaders(m.payload);
            const text2 = extractPlainText(m.payload);
            return {
              id: m.id,
              threadId: m.threadId,
              snippet: m.snippet,
              labelIds: m.labelIds ?? [],
              ...headers ? { headers } : {},
              ...text2 ? { text: text2 } : {}
            };
          }
        }),
        httpAction({
          id: "gmail.create_draft",
          description: "Create a draft email (does not send).",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.gmailCompose],
          input: z3.object({
            to: recipientField,
            subject: subjectField,
            body: z3.string(),
            cc: recipientField.optional()
          }),
          request: (i) => ({ method: "POST", path: `${GMAIL}/drafts`, body: { message: { raw: encodeEmail(i) } } }),
          output: (raw) => {
            const r = raw;
            return { draftId: r.id, messageId: r.message?.id };
          }
        }),
        httpAction({
          id: "gmail.send_email",
          description: "Send an email from the connected account.",
          mutating: true,
          risk: "high",
          scopes: [GOOGLE_SCOPES.gmailSend],
          input: z3.object({
            to: recipientField,
            subject: subjectField,
            body: z3.string(),
            cc: recipientField.optional(),
            bcc: recipientField.optional()
          }),
          request: (i) => ({ method: "POST", path: `${GMAIL}/messages/send`, body: { raw: encodeEmail(i) } }),
          output: (raw) => {
            const m = raw;
            return { id: m.id, threadId: m.threadId };
          }
        }),
        httpAction({
          id: "gmail.modify_labels",
          description: "Add and/or remove labels on a message.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.gmailModify],
          input: z3.object({
            messageId: z3.string(),
            addLabelIds: z3.array(z3.string()).default([]),
            removeLabelIds: z3.array(z3.string()).default([])
          }),
          request: (i) => ({
            method: "POST",
            path: `${GMAIL}/messages/${encodeURIComponent(i.messageId)}/modify`,
            body: { addLabelIds: i.addLabelIds, removeLabelIds: i.removeLabelIds }
          }),
          output: (raw) => {
            const m = raw;
            return { id: m.id, labelIds: m.labelIds ?? [] };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/google/drive.ts
import { z as z4 } from "zod";
function fileSummary(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    ...f.size !== void 0 ? { size: Number(f.size) } : {}
  };
}
var DRIVE, googleDrive;
var init_drive = __esm({
  "packages/connectors/src/providers/google/drive.ts"() {
    "use strict";
    init_authoring();
    init_provider();
    DRIVE = "/drive/v3";
    googleDrive = defineToolkit({
      id: "google_drive",
      providerId: "google",
      displayName: "Google Drive",
      actions: [
        httpAction({
          id: "google_drive.list_files",
          description: "List or search Drive files. Use `query` for a Drive query string (e.g. \"name contains 'report'\").",
          scopes: [GOOGLE_SCOPES.driveReadonly],
          input: z4.object({
            query: z4.string().optional().describe("Drive `q` query, e.g. \"mimeType='application/pdf'\""),
            pageSize: z4.number().int().positive().max(1e3).default(25),
            orderBy: z4.string().optional().describe('e.g. "modifiedTime desc"')
          }),
          request: (i) => ({
            method: "GET",
            path: `${DRIVE}/files`,
            query: {
              q: i.query,
              pageSize: i.pageSize,
              orderBy: i.orderBy,
              fields: "files(id,name,mimeType,modifiedTime,webViewLink,size),nextPageToken"
            }
          }),
          output: (raw) => {
            const r = raw;
            return { files: (r.files ?? []).map(fileSummary), nextPageToken: r.nextPageToken };
          }
        }),
        httpAction({
          id: "google_drive.get_file",
          description: "Get a Drive file\u2019s metadata by id.",
          scopes: [GOOGLE_SCOPES.driveReadonly],
          input: z4.object({ fileId: z4.string() }),
          request: (i) => ({
            method: "GET",
            path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}`,
            query: { fields: "id,name,mimeType,modifiedTime,webViewLink,size" }
          }),
          output: (raw) => fileSummary(raw)
        }),
        httpAction({
          id: "google_drive.export_file",
          description: "Export a Google Doc/Sheet/Slide as text (default text/plain) and return its content.",
          scopes: [GOOGLE_SCOPES.driveReadonly],
          input: z4.object({
            fileId: z4.string(),
            mimeType: z4.string().default("text/plain").describe("Export MIME type, e.g. text/plain, text/csv")
          }),
          request: (i) => ({
            method: "GET",
            path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}/export`,
            query: { mimeType: i.mimeType }
          }),
          output: (raw) => ({ content: typeof raw === "string" ? raw : JSON.stringify(raw) })
        }),
        httpAction({
          id: "google_drive.create_folder",
          description: "Create a folder in Drive (optionally inside a parent folder).",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.driveFile],
          input: z4.object({ name: z4.string(), parentId: z4.string().optional() }),
          request: (i) => ({
            method: "POST",
            path: `${DRIVE}/files`,
            body: {
              name: i.name,
              mimeType: "application/vnd.google-apps.folder",
              ...i.parentId ? { parents: [i.parentId] } : {}
            }
          }),
          output: (raw) => fileSummary(raw)
        }),
        httpAction({
          id: "google_drive.delete_file",
          description: "Permanently delete a Drive file by id.",
          mutating: true,
          risk: "high",
          scopes: [GOOGLE_SCOPES.driveFile],
          input: z4.object({ fileId: z4.string() }),
          request: (i) => ({ method: "DELETE", path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}` }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/google/docs.ts
import { z as z5 } from "zod";
function docText(doc) {
  const out = [];
  for (const el of doc.body?.content ?? []) {
    for (const e of el.paragraph?.elements ?? []) {
      if (e.textRun?.content) out.push(e.textRun.content);
    }
  }
  return out.join("");
}
var DOCS, googleDocs;
var init_docs = __esm({
  "packages/connectors/src/providers/google/docs.ts"() {
    "use strict";
    init_authoring();
    init_provider();
    DOCS = "https://docs.googleapis.com/v1/documents";
    googleDocs = defineToolkit({
      id: "google_docs",
      providerId: "google",
      displayName: "Google Docs",
      actions: [
        httpAction({
          id: "google_docs.get_document",
          description: "Get a Google Doc\u2019s title and plain-text content by document id.",
          scopes: [GOOGLE_SCOPES.documentsReadonly],
          input: z5.object({ documentId: z5.string() }),
          request: (i) => ({ method: "GET", path: `${DOCS}/${encodeURIComponent(i.documentId)}` }),
          output: (raw) => {
            const d = raw;
            return { documentId: d.documentId, title: d.title, text: docText(d) };
          }
        }),
        httpAction({
          id: "google_docs.create_document",
          description: "Create a new Google Doc with a title.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.documents],
          input: z5.object({ title: z5.string() }),
          request: (i) => ({ method: "POST", path: DOCS, body: { title: i.title } }),
          output: (raw) => {
            const d = raw;
            return { documentId: d.documentId, title: d.title };
          }
        }),
        httpAction({
          id: "google_docs.append_text",
          description: "Append text to the end of an existing Google Doc.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.documents],
          input: z5.object({ documentId: z5.string(), text: z5.string() }),
          request: (i) => ({
            method: "POST",
            path: `${DOCS}/${encodeURIComponent(i.documentId)}:batchUpdate`,
            body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: i.text } }] }
          }),
          output: () => ({ updated: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/google/sheets.ts
import { z as z6 } from "zod";
var SHEETS, googleSheets;
var init_sheets = __esm({
  "packages/connectors/src/providers/google/sheets.ts"() {
    "use strict";
    init_authoring();
    init_provider();
    SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
    googleSheets = defineToolkit({
      id: "google_sheets",
      providerId: "google",
      displayName: "Google Sheets",
      actions: [
        httpAction({
          id: "google_sheets.get_values",
          description: 'Read a range of cells from a spreadsheet (A1 notation, e.g. "Sheet1!A1:C10").',
          scopes: [GOOGLE_SCOPES.spreadsheetsReadonly],
          input: z6.object({ spreadsheetId: z6.string(), range: z6.string() }),
          request: (i) => ({
            method: "GET",
            path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}`
          }),
          output: (raw) => {
            const r = raw;
            return { range: r.range, values: r.values ?? [] };
          }
        }),
        httpAction({
          id: "google_sheets.append_values",
          description: "Append rows to a sheet range (values is an array of rows).",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.spreadsheets],
          input: z6.object({
            spreadsheetId: z6.string(),
            range: z6.string().describe('A1 range to append into, e.g. "Sheet1!A1"'),
            values: z6.array(z6.array(z6.union([z6.string(), z6.number(), z6.boolean()])))
          }),
          request: (i) => ({
            method: "POST",
            path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}:append`,
            query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
            body: { values: i.values }
          }),
          output: (raw) => {
            const r = raw;
            return { updatedRange: r.updates?.updatedRange, updatedRows: r.updates?.updatedRows };
          }
        }),
        httpAction({
          id: "google_sheets.update_values",
          description: "Overwrite a range of cells with the given values.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.spreadsheets],
          input: z6.object({
            spreadsheetId: z6.string(),
            range: z6.string(),
            values: z6.array(z6.array(z6.union([z6.string(), z6.number(), z6.boolean()])))
          }),
          request: (i) => ({
            method: "PUT",
            path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}`,
            query: { valueInputOption: "USER_ENTERED" },
            body: { values: i.values }
          }),
          output: (raw) => {
            const r = raw;
            return { updatedRange: r.updatedRange, updatedCells: r.updatedCells };
          }
        }),
        httpAction({
          id: "google_sheets.create_spreadsheet",
          description: "Create a new spreadsheet with a title.",
          mutating: true,
          risk: "medium",
          scopes: [GOOGLE_SCOPES.spreadsheets],
          input: z6.object({ title: z6.string() }),
          request: (i) => ({ method: "POST", path: SHEETS, body: { properties: { title: i.title } } }),
          output: (raw) => {
            const r = raw;
            return { spreadsheetId: r.spreadsheetId, spreadsheetUrl: r.spreadsheetUrl };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/google/index.ts
function registerGoogle(registry, options = {}) {
  registry.addBundle({
    provider: google(options),
    toolkits: [googleCalendar, gmail, googleDrive, googleDocs, googleSheets]
  });
}
var init_google = __esm({
  "packages/connectors/src/providers/google/index.ts"() {
    "use strict";
    init_provider();
    init_calendar2();
    init_gmail();
    init_drive();
    init_docs();
    init_sheets();
  }
});

// packages/connectors/src/providers/slack/provider.ts
function slack(options = {}) {
  return defineProvider({
    id: "slack",
    displayName: "Slack",
    baseUrl: "https://slack.com/api",
    identityScopes: [],
    revokeUrl: "https://slack.com/api/auth.revoke",
    auth: oauth2({
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      usePkce: false,
      scopeSeparator: ",",
      // Slack wants comma-separated scopes on the authorize URL
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/auth.test");
      if (me.ok === false || !me.user_id) throw new Error(`slack identify failed: ${me.error ?? "no user_id"}`);
      return {
        accountId: `${me.team_id ?? ""}:${me.user_id}`,
        label: `${me.team ?? "Slack"} (${me.user ?? me.user_id})`
      };
    }
  });
}
var init_provider2 = __esm({
  "packages/connectors/src/providers/slack/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
  }
});

// packages/connectors/src/providers/slack/messaging.ts
import { z as z7 } from "zod";
function ok(raw) {
  const r = raw ?? {};
  if (r.ok === false) throw new ConnectorError("provider_error", `slack: ${r.error ?? "unknown_error"}`);
  return r;
}
var slackMessaging;
var init_messaging = __esm({
  "packages/connectors/src/providers/slack/messaging.ts"() {
    "use strict";
    init_authoring();
    init_paginate();
    init_errors();
    slackMessaging = defineToolkit({
      id: "slack",
      providerId: "slack",
      displayName: "Slack",
      actions: [
        // Auto-paginated: the agent asks for up to `limit` channels and the action follows Slack's
        // `next_cursor` internally (collectPages, bounded) — no cursor bookkeeping leaks to the model.
        action({
          id: "slack.list_channels",
          description: "List channels (public + private) in the workspace.",
          scopes: ["channels:read"],
          input: z7.object({ limit: z7.number().int().positive().max(1e3).default(100) }),
          async execute(ctx, i) {
            const channels = await collectPages(
              async (cursor) => {
                const raw = await ctx.http.get("/conversations.list", {
                  query: { types: "public_channel,private_channel", limit: 200, cursor }
                });
                const r = ok(raw);
                return { items: r.channels ?? [], nextCursor: r.response_metadata?.next_cursor || void 0 };
              },
              { maxItems: i.limit }
            );
            return { channels: channels.map((c) => ({ id: c.id, name: c.name, is_private: !!c.is_private })) };
          }
        }),
        httpAction({
          id: "slack.post_message",
          description: "Post a message to a channel.",
          mutating: true,
          risk: "medium",
          scopes: ["chat:write"],
          input: z7.object({ channel: z7.string(), text: z7.string(), thread_ts: z7.string().optional() }),
          request: (i) => ({ method: "POST", path: "/chat.postMessage", body: { channel: i.channel, text: i.text, thread_ts: i.thread_ts } }),
          output: (raw) => {
            const r = ok(raw);
            return { ts: r.ts, channel: r.channel };
          }
        }),
        httpAction({
          id: "slack.search_messages",
          description: "Search messages across the workspace.",
          scopes: ["search:read"],
          input: z7.object({ query: z7.string(), count: z7.number().int().positive().max(100).default(20) }),
          request: (i) => ({ method: "GET", path: "/search.messages", query: { query: i.query, count: i.count } }),
          output: (raw) => {
            const r = ok(raw);
            return { matches: r.messages?.matches ?? [], total: r.messages?.total ?? 0 };
          }
        }),
        httpAction({
          id: "slack.get_thread",
          description: "Get the replies in a message thread.",
          scopes: ["channels:history"],
          input: z7.object({ channel: z7.string(), ts: z7.string() }),
          request: (i) => ({ method: "GET", path: "/conversations.replies", query: { channel: i.channel, ts: i.ts } }),
          output: (raw) => {
            const r = ok(raw);
            return { messages: r.messages ?? [] };
          }
        }),
        httpAction({
          id: "slack.list_users",
          description: "List members of the workspace.",
          scopes: ["users:read"],
          input: z7.object({ limit: z7.number().int().positive().max(1e3).default(100) }),
          request: (i) => ({ method: "GET", path: "/users.list", query: { limit: i.limit } }),
          output: (raw) => {
            const r = ok(raw);
            return { members: (r.members ?? []).map((m) => ({ id: m.id, name: m.name, real_name: m.real_name })) };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/slack/index.ts
function registerSlack(registry, options = {}) {
  registry.addBundle({ provider: slack(options), toolkits: [slackMessaging] });
}
var init_slack = __esm({
  "packages/connectors/src/providers/slack/index.ts"() {
    "use strict";
    init_provider2();
    init_messaging();
  }
});

// packages/connectors/src/providers/notion/provider.ts
function notion(options = {}) {
  return defineProvider({
    id: "notion",
    displayName: "Notion",
    baseUrl: "https://api.notion.com/v1",
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      usePkce: false,
      // Notion authenticates the token request with HTTP Basic (client_id:client_secret).
      tokenAuthMethod: "client_secret_basic",
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/users/me", { headers: { "Notion-Version": NOTION_VERSION } });
      const accountId = me.id ?? "notion";
      return { accountId, ...me.name ? { label: me.name } : {} };
    }
  });
}
var NOTION_VERSION;
var init_provider3 = __esm({
  "packages/connectors/src/providers/notion/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    NOTION_VERSION = "2022-06-28";
  }
});

// packages/connectors/src/providers/notion/toolkit.ts
import { z as z8 } from "zod";
function plain(rt) {
  return rt ? rt.map((t) => t.plain_text ?? "").join("") : void 0;
}
function titleOf(x) {
  if (x.title) return plain(x.title);
  for (const p of Object.values(x.properties ?? {})) {
    if (p?.type === "title" || p?.title) return plain(p.title);
  }
  return void 0;
}
var V, notionToolkit;
var init_toolkit = __esm({
  "packages/connectors/src/providers/notion/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_provider3();
    V = { "Notion-Version": NOTION_VERSION };
    notionToolkit = defineToolkit({
      id: "notion",
      providerId: "notion",
      displayName: "Notion",
      actions: [
        httpAction({
          id: "notion.search",
          description: "Search pages and databases the integration can access.",
          input: z8.object({ query: z8.string().optional(), filter: z8.record(z8.any()).optional() }),
          request: (i) => ({ method: "POST", path: "/search", headers: V, body: { query: i.query, filter: i.filter } }),
          output: (raw) => {
            const r = raw;
            return {
              results: (r.results ?? []).map((x) => ({ id: x.id, object: x.object, title: titleOf(x) }))
            };
          }
        }),
        httpAction({
          id: "notion.get_page",
          description: "Get a Notion page\u2019s properties by id.",
          input: z8.object({ pageId: z8.string() }),
          request: (i) => ({ method: "GET", path: `/pages/${encodeURIComponent(i.pageId)}`, headers: V })
        }),
        httpAction({
          id: "notion.create_page",
          description: "Create a Notion page under a parent page or database.",
          mutating: true,
          risk: "medium",
          input: z8.object({
            parent: z8.record(z8.any()).describe("e.g. { database_id } or { page_id }"),
            properties: z8.record(z8.any()),
            children: z8.array(z8.any()).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/pages",
            headers: V,
            body: { parent: i.parent, properties: i.properties, ...i.children ? { children: i.children } : {} }
          }),
          output: (raw) => {
            const p = raw;
            return { id: p.id, object: p.object };
          }
        }),
        httpAction({
          id: "notion.update_page",
          description: "Update a Notion page\u2019s properties.",
          mutating: true,
          risk: "medium",
          input: z8.object({ pageId: z8.string(), properties: z8.record(z8.any()) }),
          request: (i) => ({
            method: "PATCH",
            path: `/pages/${encodeURIComponent(i.pageId)}`,
            headers: V,
            body: { properties: i.properties }
          }),
          output: (raw) => ({ id: raw.id })
        }),
        httpAction({
          id: "notion.append_blocks",
          description: "Append block children to a page or block.",
          mutating: true,
          risk: "medium",
          input: z8.object({ blockId: z8.string(), children: z8.array(z8.any()) }),
          request: (i) => ({
            method: "PATCH",
            path: `/blocks/${encodeURIComponent(i.blockId)}/children`,
            headers: V,
            body: { children: i.children }
          }),
          output: () => ({ updated: true })
        }),
        httpAction({
          id: "notion.query_database",
          description: "Query a Notion database with an optional filter and sorts.",
          input: z8.object({
            databaseId: z8.string(),
            filter: z8.record(z8.any()).optional(),
            sorts: z8.array(z8.any()).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: `/databases/${encodeURIComponent(i.databaseId)}/query`,
            headers: V,
            body: { ...i.filter ? { filter: i.filter } : {}, ...i.sorts ? { sorts: i.sorts } : {} }
          }),
          output: (raw) => {
            const r = raw;
            return {
              results: (r.results ?? []).map((x) => ({ id: x.id, object: x.object, title: titleOf(x) })),
              nextCursor: r.next_cursor ?? void 0
            };
          }
        }),
        httpAction({
          id: "notion.get_database",
          description: "Get a Notion database\u2019s schema/metadata by id.",
          input: z8.object({ databaseId: z8.string() }),
          request: (i) => ({ method: "GET", path: `/databases/${encodeURIComponent(i.databaseId)}`, headers: V })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/notion/index.ts
function registerNotion(registry, options = {}) {
  registry.addBundle({ provider: notion(options), toolkits: [notionToolkit] });
}
var init_notion = __esm({
  "packages/connectors/src/providers/notion/index.ts"() {
    "use strict";
    init_provider3();
    init_toolkit();
  }
});

// packages/connectors/src/providers/microsoft/provider.ts
function microsoftScopeSatisfies(granted, required) {
  if (granted.includes(required)) return true;
  return granted.some((g2) => SCOPE_IMPLIES2[g2]?.includes(required) ?? false);
}
function microsoft(options = {}) {
  return defineProvider({
    id: "microsoft",
    displayName: "Microsoft 365",
    baseUrl: "https://graph.microsoft.com/v1.0",
    // `offline_access` is required for a refresh token; openid/email for identity.
    identityScopes: ["openid", "email", "offline_access", M.userRead],
    scopeSatisfies: microsoftScopeSatisfies,
    auth: oauth2({
      authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      usePkce: true,
      authParams: { prompt: "select_account" },
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/me");
      const email = me.mail ?? me.userPrincipalName;
      const accountId = me.id ?? email;
      if (!accountId) throw new Error("microsoft identify: /me returned no stable id");
      return {
        accountId,
        ...email !== void 0 ? { email } : {},
        label: me.displayName ?? email ?? accountId
      };
    }
  });
}
var MICROSOFT_SCOPES, M, SCOPE_IMPLIES2;
var init_provider4 = __esm({
  "packages/connectors/src/providers/microsoft/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    MICROSOFT_SCOPES = {
      userRead: "User.Read",
      mailRead: "Mail.Read",
      mailReadWrite: "Mail.ReadWrite",
      mailSend: "Mail.Send",
      calendarsRead: "Calendars.Read",
      calendarsReadWrite: "Calendars.ReadWrite"
    };
    M = MICROSOFT_SCOPES;
    SCOPE_IMPLIES2 = {
      [M.mailReadWrite]: [M.mailRead],
      [M.calendarsReadWrite]: [M.calendarsRead]
    };
  }
});

// packages/connectors/src/providers/microsoft/mail.ts
import { z as z9 } from "zod";
function messageSummary(m) {
  return {
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    preview: m.bodyPreview
  };
}
var outlookMail;
var init_mail = __esm({
  "packages/connectors/src/providers/microsoft/mail.ts"() {
    "use strict";
    init_authoring();
    init_provider4();
    outlookMail = defineToolkit({
      id: "outlook_mail",
      providerId: "microsoft",
      displayName: "Outlook Mail",
      actions: [
        httpAction({
          id: "outlook_mail.list_messages",
          description: "List or search Outlook messages (most recent first). Use `search` for free-text.",
          scopes: [MICROSOFT_SCOPES.mailRead],
          input: z9.object({
            top: z9.number().int().positive().max(100).default(25),
            search: z9.string().optional().describe("Free-text search over the mailbox")
          }),
          request: (i) => ({
            method: "GET",
            path: "/me/messages",
            query: {
              $top: i.top,
              $search: i.search ? `"${i.search}"` : void 0,
              $select: "id,subject,from,receivedDateTime,bodyPreview",
              $orderby: i.search ? void 0 : "receivedDateTime desc"
            }
          }),
          output: (raw) => {
            const r = raw;
            return { messages: (r.value ?? []).map(messageSummary) };
          }
        }),
        httpAction({
          id: "outlook_mail.get_message",
          description: "Get a single Outlook message (with its body) by id.",
          scopes: [MICROSOFT_SCOPES.mailRead],
          input: z9.object({ messageId: z9.string() }),
          request: (i) => ({ method: "GET", path: `/me/messages/${encodeURIComponent(i.messageId)}` }),
          output: (raw) => {
            const m = raw;
            return { ...messageSummary(m), body: m.body?.content };
          }
        }),
        httpAction({
          id: "outlook_mail.send_mail",
          description: "Send an email from the connected Outlook account.",
          mutating: true,
          risk: "high",
          scopes: [MICROSOFT_SCOPES.mailSend],
          input: z9.object({
            to: z9.array(z9.string().email()).min(1),
            subject: z9.string(),
            content: z9.string(),
            cc: z9.array(z9.string().email()).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/me/sendMail",
            body: {
              message: {
                subject: i.subject,
                body: { contentType: "Text", content: i.content },
                toRecipients: i.to.map((address) => ({ emailAddress: { address } })),
                ...i.cc ? { ccRecipients: i.cc.map((address) => ({ emailAddress: { address } })) } : {}
              },
              saveToSentItems: true
            }
          }),
          // sendMail returns 202 with no body.
          output: () => ({ sent: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/microsoft/calendar.ts
import { z as z10 } from "zod";
function eventSummary2(e) {
  return {
    id: e.id,
    subject: e.subject,
    start: e.start?.dateTime,
    end: e.end?.dateTime,
    location: e.location?.displayName,
    webLink: e.webLink
  };
}
var outlookCalendar;
var init_calendar3 = __esm({
  "packages/connectors/src/providers/microsoft/calendar.ts"() {
    "use strict";
    init_authoring();
    init_provider4();
    outlookCalendar = defineToolkit({
      id: "outlook_calendar",
      providerId: "microsoft",
      displayName: "Outlook Calendar",
      actions: [
        httpAction({
          id: "outlook_calendar.list_events",
          description: "List events on the connected Outlook calendar.",
          scopes: [MICROSOFT_SCOPES.calendarsRead],
          input: z10.object({ top: z10.number().int().positive().max(100).default(25) }),
          request: (i) => ({
            method: "GET",
            path: "/me/events",
            query: { $top: i.top, $select: "id,subject,start,end,location,webLink", $orderby: "start/dateTime" }
          }),
          output: (raw) => {
            const r = raw;
            return { events: (r.value ?? []).map(eventSummary2) };
          }
        }),
        httpAction({
          id: "outlook_calendar.create_event",
          description: "Create an event on the connected Outlook calendar (times in ISO 8601).",
          mutating: true,
          risk: "medium",
          scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
          input: z10.object({
            subject: z10.string(),
            start: z10.string().describe("ISO 8601 start, e.g. 2026-06-20T15:00:00"),
            end: z10.string().describe("ISO 8601 end"),
            timeZone: z10.string().default("UTC"),
            location: z10.string().optional(),
            body: z10.string().optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/me/events",
            body: {
              subject: i.subject,
              start: { dateTime: i.start, timeZone: i.timeZone },
              end: { dateTime: i.end, timeZone: i.timeZone },
              ...i.location ? { location: { displayName: i.location } } : {},
              ...i.body ? { body: { contentType: "Text", content: i.body } } : {}
            }
          }),
          output: (raw) => eventSummary2(raw)
        }),
        httpAction({
          id: "outlook_calendar.update_event",
          description: "Update fields on an existing Outlook event.",
          mutating: true,
          risk: "medium",
          scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
          input: z10.object({
            eventId: z10.string(),
            subject: z10.string().optional(),
            start: z10.string().optional(),
            end: z10.string().optional(),
            timeZone: z10.string().default("UTC"),
            location: z10.string().optional()
          }),
          request: (i) => ({
            method: "PATCH",
            path: `/me/events/${encodeURIComponent(i.eventId)}`,
            body: {
              subject: i.subject,
              ...i.start ? { start: { dateTime: i.start, timeZone: i.timeZone } } : {},
              ...i.end ? { end: { dateTime: i.end, timeZone: i.timeZone } } : {},
              ...i.location ? { location: { displayName: i.location } } : {}
            }
          }),
          output: (raw) => eventSummary2(raw)
        }),
        httpAction({
          id: "outlook_calendar.delete_event",
          description: "Delete an event from the connected Outlook calendar.",
          mutating: true,
          risk: "high",
          scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
          input: z10.object({ eventId: z10.string() }),
          request: (i) => ({ method: "DELETE", path: `/me/events/${encodeURIComponent(i.eventId)}` }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/microsoft/index.ts
function registerMicrosoft(registry, options = {}) {
  registry.addBundle({ provider: microsoft(options), toolkits: [outlookMail, outlookCalendar] });
}
var init_microsoft = __esm({
  "packages/connectors/src/providers/microsoft/index.ts"() {
    "use strict";
    init_provider4();
    init_mail();
    init_calendar3();
  }
});

// packages/connectors/src/providers/linear/provider.ts
function linear(options = {}) {
  return defineProvider({
    id: "linear",
    displayName: "Linear",
    baseUrl: "https://api.linear.app",
    identityScopes: [],
    revokeUrl: LINEAR_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: "https://linear.app/oauth/authorize",
      tokenUrl: "https://api.linear.app/oauth/token",
      usePkce: false,
      revokeUrl: LINEAR_REVOKE_URL,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const res = await http.post("/graphql", { query: "{ viewer { id name email } }" });
      if (res.errors?.length) throw new ConnectorError("provider_error", `linear: ${res.errors[0]?.message ?? "graphql error"}`);
      const v = res.data?.viewer;
      if (!v?.id) throw new Error("linear identify: viewer returned no id");
      return {
        accountId: v.id,
        ...v.email !== void 0 ? { email: v.email } : {},
        label: v.name ?? v.email ?? v.id
      };
    }
  });
}
var LINEAR_REVOKE_URL;
var init_provider5 = __esm({
  "packages/connectors/src/providers/linear/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    init_errors();
    LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
  }
});

// packages/connectors/src/providers/linear/toolkit.ts
import { z as z11 } from "zod";
function data(raw) {
  const r = raw;
  if (r.errors?.length) throw new ConnectorError("provider_error", `linear: ${r.errors[0]?.message ?? "graphql error"}`);
  return r.data ?? {};
}
var linearToolkit;
var init_toolkit2 = __esm({
  "packages/connectors/src/providers/linear/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_errors();
    linearToolkit = defineToolkit({
      id: "linear",
      providerId: "linear",
      displayName: "Linear",
      actions: [
        httpAction({
          id: "linear.list_issues",
          description: "List issues, most recent first. Optionally filter by a title substring.",
          scopes: ["read"],
          input: z11.object({
            first: z11.number().int().positive().max(50).default(25),
            query: z11.string().optional().describe("Title substring to filter on")
          }),
          request: (i) => ({
            method: "POST",
            path: "/graphql",
            body: {
              query: i.query ? "query($first:Int!,$q:String!){ issues(first:$first, filter:{ title:{ containsIgnoreCase:$q } }){ nodes { id identifier title state { name } assignee { name } } } }" : "query($first:Int!){ issues(first:$first){ nodes { id identifier title state { name } assignee { name } } } }",
              variables: i.query ? { first: i.first, q: i.query } : { first: i.first }
            }
          }),
          output: (raw) => {
            const issues = data(raw).issues;
            return { issues: issues?.nodes ?? [] };
          }
        }),
        httpAction({
          id: "linear.create_issue",
          description: "Create an issue on a team.",
          mutating: true,
          risk: "medium",
          scopes: ["issues:create"],
          input: z11.object({
            teamId: z11.string(),
            title: z11.string(),
            description: z11.string().optional(),
            priority: z11.number().int().min(0).max(4).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/graphql",
            body: {
              query: "mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue { id identifier url } } }",
              variables: {
                input: {
                  teamId: i.teamId,
                  title: i.title,
                  ...i.description !== void 0 ? { description: i.description } : {},
                  ...i.priority !== void 0 ? { priority: i.priority } : {}
                }
              }
            }
          }),
          output: (raw) => data(raw).issueCreate?.issue ?? null
        }),
        httpAction({
          id: "linear.update_issue",
          description: "Update fields on an existing issue.",
          mutating: true,
          risk: "medium",
          scopes: ["write"],
          input: z11.object({
            id: z11.string(),
            title: z11.string().optional(),
            description: z11.string().optional(),
            stateId: z11.string().optional(),
            priority: z11.number().int().min(0).max(4).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/graphql",
            body: {
              query: "mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id, input:$input){ success issue { id identifier } } }",
              variables: {
                id: i.id,
                input: {
                  ...i.title !== void 0 ? { title: i.title } : {},
                  ...i.description !== void 0 ? { description: i.description } : {},
                  ...i.stateId !== void 0 ? { stateId: i.stateId } : {},
                  ...i.priority !== void 0 ? { priority: i.priority } : {}
                }
              }
            }
          }),
          output: (raw) => data(raw).issueUpdate?.issue ?? null
        }),
        httpAction({
          id: "linear.add_comment",
          description: "Add a comment to an issue.",
          mutating: true,
          risk: "low",
          scopes: ["write"],
          input: z11.object({ issueId: z11.string(), body: z11.string() }),
          request: (i) => ({
            method: "POST",
            path: "/graphql",
            body: {
              query: "mutation($input:CommentCreateInput!){ commentCreate(input:$input){ success comment { id } } }",
              variables: { input: { issueId: i.issueId, body: i.body } }
            }
          }),
          output: (raw) => data(raw).commentCreate?.comment ?? null
        }),
        httpAction({
          id: "linear.list_teams",
          description: "List the teams the user can access.",
          scopes: ["read"],
          input: z11.object({}),
          request: () => ({ method: "POST", path: "/graphql", body: { query: "{ teams { nodes { id name key } } }" } }),
          output: (raw) => ({ teams: data(raw).teams?.nodes ?? [] })
        }),
        httpAction({
          id: "linear.list_projects",
          description: "List projects.",
          scopes: ["read"],
          input: z11.object({}),
          request: () => ({ method: "POST", path: "/graphql", body: { query: "{ projects { nodes { id name state } } }" } }),
          output: (raw) => ({ projects: data(raw).projects?.nodes ?? [] })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/linear/index.ts
function registerLinear(registry, options = {}) {
  registry.addBundle({ provider: linear(options), toolkits: [linearToolkit] });
}
var init_linear = __esm({
  "packages/connectors/src/providers/linear/index.ts"() {
    "use strict";
    init_provider5();
    init_toolkit2();
  }
});

// packages/connectors/src/providers/jira/provider.ts
function jira(options = {}) {
  return defineProvider({
    id: "jira",
    displayName: "Jira",
    // No baseUrl — the API base is per-site (built from a cloudId in each action).
    // `offline_access` guarantees a refresh token; `read:me` lets us read the account.
    identityScopes: ["offline_access", "read:me"],
    auth: oauth2({
      authorizationUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      usePkce: false,
      authParams: { audience: "api.atlassian.com", prompt: "consent" },
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const resources = await http.get(
        "https://api.atlassian.com/oauth/token/accessible-resources"
      );
      const first = resources?.[0];
      if (!first) throw new Error("jira identify: token has no accessible Atlassian sites");
      return { accountId: first.id, label: first.name ?? first.id, config: { cloudId: first.id } };
    }
  });
}
var init_provider6 = __esm({
  "packages/connectors/src/providers/jira/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
  }
});

// packages/connectors/src/providers/jira/toolkit.ts
import { z as z12 } from "zod";
function base(config) {
  return `https://api.atlassian.com/ex/jira/${encodeURIComponent(String(config.cloudId))}/rest/api/3`;
}
function adf(text2) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: text2 }] }] };
}
var SCOPE, jiraToolkit;
var init_toolkit3 = __esm({
  "packages/connectors/src/providers/jira/toolkit.ts"() {
    "use strict";
    init_authoring();
    SCOPE = { read: "read:jira-work", write: "write:jira-work" };
    jiraToolkit = defineToolkit({
      id: "jira",
      providerId: "jira",
      displayName: "Jira",
      actions: [
        httpAction({
          id: "jira.search_issues",
          description: "Search Jira issues with a JQL query.",
          scopes: [SCOPE.read],
          input: z12.object({
            jql: z12.string().describe(`JQL, e.g. "project = ABC AND status = 'To Do'"`),
            maxResults: z12.number().int().positive().max(100).default(25)
          }),
          request: (i, { config }) => ({
            method: "GET",
            path: `${base(config)}/search`,
            query: { jql: i.jql, maxResults: i.maxResults }
          }),
          output: (raw) => {
            const r = raw;
            return {
              total: r.total,
              issues: (r.issues ?? []).map((is) => ({
                id: is.id,
                key: is.key,
                summary: is.fields?.summary,
                status: is.fields?.status?.name
              }))
            };
          }
        }),
        httpAction({
          id: "jira.get_issue",
          description: "Get a single Jira issue by id or key.",
          scopes: [SCOPE.read],
          input: z12.object({ issueIdOrKey: z12.string() }),
          request: (i, { config }) => ({ method: "GET", path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}` }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, key: r.key, fields: r.fields };
          }
        }),
        httpAction({
          id: "jira.create_issue",
          description: "Create a Jira issue.",
          mutating: true,
          risk: "medium",
          scopes: [SCOPE.write],
          input: z12.object({
            projectKey: z12.string(),
            summary: z12.string(),
            description: z12.string().optional(),
            issueType: z12.string().default("Task")
          }),
          request: (i, { config }) => ({
            method: "POST",
            path: `${base(config)}/issue`,
            body: {
              fields: {
                project: { key: i.projectKey },
                summary: i.summary,
                issuetype: { name: i.issueType },
                ...i.description ? { description: adf(i.description) } : {}
              }
            }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, key: r.key };
          }
        }),
        httpAction({
          id: "jira.update_issue",
          description: "Update fields on a Jira issue (raw Jira `fields` object).",
          mutating: true,
          risk: "medium",
          scopes: [SCOPE.write],
          input: z12.object({ issueIdOrKey: z12.string(), fields: z12.record(z12.any()) }),
          request: (i, { config }) => ({
            method: "PUT",
            path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}`,
            body: { fields: i.fields }
          }),
          output: () => ({ updated: true })
        }),
        httpAction({
          id: "jira.add_comment",
          description: "Add a comment to a Jira issue.",
          mutating: true,
          risk: "low",
          scopes: [SCOPE.write],
          input: z12.object({ issueIdOrKey: z12.string(), body: z12.string() }),
          request: (i, { config }) => ({
            method: "POST",
            path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}/comment`,
            body: { body: adf(i.body) }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id };
          }
        }),
        httpAction({
          id: "jira.list_projects",
          description: "List Jira projects on the site.",
          scopes: [SCOPE.read],
          input: z12.object({}),
          request: (_i, { config }) => ({ method: "GET", path: `${base(config)}/project/search` }),
          output: (raw) => {
            const r = raw;
            return { projects: (r.values ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })) };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/jira/index.ts
function registerJira(registry, options = {}) {
  registry.addBundle({ provider: jira(options), toolkits: [jiraToolkit] });
}
var init_jira = __esm({
  "packages/connectors/src/providers/jira/index.ts"() {
    "use strict";
    init_provider6();
    init_toolkit3();
  }
});

// packages/connectors/src/providers/discord/provider.ts
function discord(options = {}) {
  return defineProvider({
    id: "discord",
    displayName: "Discord",
    baseUrl: "https://discord.com/api/v10",
    identityScopes: [DISCORD_SCOPES.identify],
    revokeUrl: DISCORD_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: "https://discord.com/api/oauth2/authorize",
      tokenUrl: "https://discord.com/api/oauth2/token",
      revokeUrl: DISCORD_REVOKE_URL,
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/users/@me");
      const accountId = me.id;
      if (!accountId) throw new Error("discord identify: /users/@me returned no id");
      return {
        accountId,
        ...me.email !== void 0 ? { email: me.email } : {},
        label: me.global_name ?? me.username ?? accountId
      };
    }
  });
}
var DISCORD_REVOKE_URL, DISCORD_SCOPES;
var init_provider7 = __esm({
  "packages/connectors/src/providers/discord/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    DISCORD_REVOKE_URL = "https://discord.com/api/oauth2/token/revoke";
    DISCORD_SCOPES = {
      identify: "identify",
      email: "email",
      guilds: "guilds",
      messagesRead: "messages.read"
    };
  }
});

// packages/connectors/src/providers/discord/toolkit.ts
import { z as z13 } from "zod";
var discordToolkit;
var init_toolkit4 = __esm({
  "packages/connectors/src/providers/discord/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_provider7();
    discordToolkit = defineToolkit({
      id: "discord",
      providerId: "discord",
      displayName: "Discord",
      actions: [
        httpAction({
          id: "discord.list_guilds",
          description: "List the Discord servers (guilds) the user belongs to.",
          scopes: [DISCORD_SCOPES.guilds],
          input: z13.object({}),
          request: () => ({ method: "GET", path: "/users/@me/guilds" }),
          output: (raw) => {
            const r = raw ?? [];
            return { guilds: r.map((g2) => ({ id: g2.id, name: g2.name })) };
          }
        }),
        httpAction({
          id: "discord.list_channels",
          description: "List channels in a guild.",
          input: z13.object({ guildId: z13.string() }),
          request: (i) => ({ method: "GET", path: `/guilds/${encodeURIComponent(i.guildId)}/channels` }),
          output: (raw) => {
            const r = raw ?? [];
            return { channels: r.map((c) => ({ id: c.id, name: c.name, type: c.type })) };
          }
        }),
        httpAction({
          id: "discord.get_messages",
          description: "Get recent messages from a channel.",
          scopes: [DISCORD_SCOPES.messagesRead],
          input: z13.object({ channelId: z13.string(), limit: z13.number().int().positive().max(100).default(25) }),
          request: (i) => ({
            method: "GET",
            path: `/channels/${encodeURIComponent(i.channelId)}/messages`,
            query: { limit: i.limit }
          }),
          output: (raw) => ({ messages: raw ?? [] })
        }),
        httpAction({
          id: "discord.post_message",
          description: "Post a message to a channel. Note: posting usually requires a bot token (Authorization: Bot <token>); this uses the OAuth user token \u2014 a bot-token variant is a future option.",
          mutating: true,
          risk: "medium",
          input: z13.object({ channelId: z13.string(), content: z13.string() }),
          request: (i) => ({
            method: "POST",
            path: `/channels/${encodeURIComponent(i.channelId)}/messages`,
            body: { content: i.content }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/discord/index.ts
function registerDiscord(registry, options = {}) {
  registry.addBundle({ provider: discord(options), toolkits: [discordToolkit] });
}
var init_discord = __esm({
  "packages/connectors/src/providers/discord/index.ts"() {
    "use strict";
    init_provider7();
    init_toolkit4();
  }
});

// packages/connectors/src/providers/calendly/index.ts
import { z as z14 } from "zod";
function calendly(options = {}) {
  return defineProvider({
    id: "calendly",
    displayName: "Calendly",
    baseUrl: "https://api.calendly.com",
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: "https://auth.calendly.com/oauth/authorize",
      tokenUrl: "https://auth.calendly.com/oauth/token",
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/users/me");
      const r = me.resource;
      if (!r?.uri) throw new Error("calendly identify: no user uri");
      return { accountId: r.uri, ...r.email !== void 0 ? { email: r.email } : {}, label: r.name ?? r.email ?? r.uri };
    }
  });
}
function registerCalendly(registry, options = {}) {
  registry.addBundle({ provider: calendly(options), toolkits: [calendlyToolkit] });
}
var calendlyToolkit;
var init_calendly = __esm({
  "packages/connectors/src/providers/calendly/index.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    calendlyToolkit = defineToolkit({
      id: "calendly",
      providerId: "calendly",
      displayName: "Calendly",
      actions: [
        httpAction({
          id: "calendly.get_current_user",
          description: "Get the current Calendly user (uri, name, email, scheduling URL).",
          input: z14.object({}),
          request: () => ({ method: "GET", path: "/users/me" }),
          output: (raw) => raw.resource ?? {}
        }),
        httpAction({
          id: "calendly.list_event_types",
          description: "List a user\u2019s event types. Pass the user URI (from get_current_user).",
          input: z14.object({ user: z14.string().describe("User URI"), count: z14.number().int().positive().max(100).default(25) }),
          request: (i) => ({ method: "GET", path: "/event_types", query: { user: i.user, count: i.count } }),
          output: (raw) => ({ collection: raw.collection ?? [] })
        }),
        httpAction({
          id: "calendly.list_scheduled_events",
          description: "List scheduled events for a user URI.",
          input: z14.object({
            user: z14.string().describe("User URI"),
            status: z14.enum(["active", "canceled"]).optional(),
            count: z14.number().int().positive().max(100).default(25)
          }),
          request: (i) => ({ method: "GET", path: "/scheduled_events", query: { user: i.user, status: i.status, count: i.count } }),
          output: (raw) => ({ collection: raw.collection ?? [] })
        }),
        httpAction({
          id: "calendly.get_event",
          description: "Get a scheduled event by uuid.",
          input: z14.object({ uuid: z14.string() }),
          request: (i) => ({ method: "GET", path: `/scheduled_events/${encodeURIComponent(i.uuid)}` }),
          output: (raw) => raw.resource ?? raw
        }),
        httpAction({
          id: "calendly.cancel_event",
          description: "Cancel a scheduled event by uuid.",
          mutating: true,
          risk: "high",
          input: z14.object({ uuid: z14.string(), reason: z14.string().optional() }),
          request: (i) => ({ method: "POST", path: `/scheduled_events/${encodeURIComponent(i.uuid)}/cancellation`, body: { reason: i.reason } }),
          output: (raw) => raw.resource ?? raw
        })
      ]
    });
  }
});

// packages/connectors/src/providers/raindrop/index.ts
import { z as z15 } from "zod";
function raindrop(options = {}) {
  return defineProvider({
    id: "raindrop",
    displayName: "Raindrop",
    baseUrl: "https://api.raindrop.io/rest/v1",
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: "https://raindrop.io/oauth/authorize",
      tokenUrl: "https://raindrop.io/oauth/access_token",
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/user");
      const u = me.user;
      if (!u?._id) throw new Error("raindrop identify: no user id");
      return { accountId: String(u._id), ...u.email !== void 0 ? { email: u.email } : {}, label: u.fullName ?? u.email ?? String(u._id) };
    }
  });
}
function registerRaindrop(registry, options = {}) {
  registry.addBundle({ provider: raindrop(options), toolkits: [raindropToolkit] });
}
var raindropToolkit;
var init_raindrop = __esm({
  "packages/connectors/src/providers/raindrop/index.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    raindropToolkit = defineToolkit({
      id: "raindrop",
      providerId: "raindrop",
      displayName: "Raindrop",
      actions: [
        httpAction({
          id: "raindrop.list_collections",
          description: "List the user\u2019s root collections.",
          input: z15.object({}),
          request: () => ({ method: "GET", path: "/collections" }),
          output: (raw) => ({ items: raw.items ?? [] })
        }),
        httpAction({
          id: "raindrop.list_raindrops",
          description: "List bookmarks in a collection (0 = all). Supports search + pagination.",
          input: z15.object({
            collectionId: z15.number().int().default(0),
            search: z15.string().optional(),
            page: z15.number().int().min(0).default(0),
            perpage: z15.number().int().positive().max(50).default(25)
          }),
          request: (i) => ({
            method: "GET",
            path: `/raindrops/${i.collectionId}`,
            query: { search: i.search, page: i.page, perpage: i.perpage }
          }),
          output: (raw) => {
            const r = raw;
            return { items: r.items ?? [], count: r.count ?? 0 };
          }
        }),
        httpAction({
          id: "raindrop.create_raindrop",
          description: "Create a bookmark (raindrop).",
          mutating: true,
          risk: "low",
          input: z15.object({ link: z15.string(), title: z15.string().optional(), collectionId: z15.number().int().optional(), tags: z15.array(z15.string()).optional() }),
          request: (i) => ({
            method: "POST",
            path: "/raindrop",
            body: { link: i.link, title: i.title, tags: i.tags, ...i.collectionId !== void 0 ? { collection: { $id: i.collectionId } } : {} }
          }),
          output: (raw) => raw.item ?? raw
        }),
        httpAction({
          id: "raindrop.update_raindrop",
          description: "Update a bookmark by id.",
          mutating: true,
          risk: "low",
          input: z15.object({ id: z15.number().int(), title: z15.string().optional(), tags: z15.array(z15.string()).optional(), important: z15.boolean().optional() }),
          request: (i) => ({ method: "PUT", path: `/raindrop/${i.id}`, body: { title: i.title, tags: i.tags, important: i.important } }),
          output: (raw) => raw.item ?? raw
        })
      ]
    });
  }
});

// packages/connectors/src/providers/zoom/index.ts
import { z as z16 } from "zod";
function zoom(options = {}) {
  return defineProvider({
    id: "zoom",
    displayName: "Zoom",
    baseUrl: "https://api.zoom.us/v2",
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: "https://zoom.us/oauth/authorize",
      tokenUrl: "https://zoom.us/oauth/token",
      tokenAuthMethod: "client_secret_basic",
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/users/me");
      if (!me.id) throw new Error("zoom identify: /users/me returned no id");
      return {
        accountId: me.id,
        ...me.email !== void 0 ? { email: me.email } : {},
        label: [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email || me.id
      };
    }
  });
}
function registerZoom(registry, options = {}) {
  registry.addBundle({ provider: zoom(options), toolkits: [zoomToolkit] });
}
var zoomToolkit;
var init_zoom = __esm({
  "packages/connectors/src/providers/zoom/index.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    zoomToolkit = defineToolkit({
      id: "zoom",
      providerId: "zoom",
      displayName: "Zoom",
      actions: [
        httpAction({
          id: "zoom.list_meetings",
          description: "List the current user\u2019s meetings.",
          input: z16.object({ type: z16.enum(["scheduled", "live", "upcoming"]).default("upcoming"), page_size: z16.number().int().positive().max(300).default(30) }),
          request: (i) => ({ method: "GET", path: "/users/me/meetings", query: { type: i.type, page_size: i.page_size } }),
          output: (raw) => {
            const r = raw;
            return { meetings: r.meetings ?? [], total: r.total_records ?? 0 };
          }
        }),
        httpAction({
          id: "zoom.create_meeting",
          description: "Schedule a meeting for the current user.",
          mutating: true,
          risk: "medium",
          input: z16.object({
            topic: z16.string(),
            start_time: z16.string().optional().describe("ISO 8601 start time"),
            duration: z16.number().int().positive().optional().describe("minutes"),
            timezone: z16.string().optional(),
            agenda: z16.string().optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/users/me/meetings",
            body: { topic: i.topic, type: 2, start_time: i.start_time, duration: i.duration, timezone: i.timezone, agenda: i.agenda }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, join_url: r.join_url, start_url: r.start_url };
          }
        }),
        httpAction({
          id: "zoom.get_meeting",
          description: "Get a meeting by id.",
          input: z16.object({ meetingId: z16.string() }),
          request: (i) => ({ method: "GET", path: `/meetings/${encodeURIComponent(i.meetingId)}` }),
          output: (raw) => raw
        }),
        httpAction({
          id: "zoom.update_meeting",
          description: "Update a meeting\u2019s fields.",
          mutating: true,
          risk: "medium",
          input: z16.object({ meetingId: z16.string(), topic: z16.string().optional(), start_time: z16.string().optional(), duration: z16.number().int().positive().optional(), agenda: z16.string().optional() }),
          request: (i) => ({
            method: "PATCH",
            path: `/meetings/${encodeURIComponent(i.meetingId)}`,
            body: { topic: i.topic, start_time: i.start_time, duration: i.duration, agenda: i.agenda }
          }),
          output: () => ({ updated: true })
        }),
        httpAction({
          id: "zoom.delete_meeting",
          description: "Delete a meeting by id.",
          mutating: true,
          risk: "high",
          input: z16.object({ meetingId: z16.string() }),
          request: (i) => ({ method: "DELETE", path: `/meetings/${encodeURIComponent(i.meetingId)}` }),
          output: () => ({ deleted: true })
        }),
        httpAction({
          id: "zoom.list_recordings",
          description: "List the current user\u2019s cloud recordings.",
          input: z16.object({ from: z16.string().optional().describe("YYYY-MM-DD"), to: z16.string().optional(), page_size: z16.number().int().positive().max(300).default(30) }),
          request: (i) => ({ method: "GET", path: "/users/me/recordings", query: { from: i.from, to: i.to, page_size: i.page_size } }),
          output: (raw) => ({ meetings: raw.meetings ?? [] })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/hubspot/index.ts
import { z as z17 } from "zod";
function hubspot(options = {}) {
  return defineProvider({
    id: "hubspot",
    displayName: "HubSpot",
    baseUrl: "https://api.hubapi.com",
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: "https://app.hubspot.com/oauth/authorize",
      tokenUrl: "https://api.hubapi.com/oauth/v1/token",
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const info = await http.get("/account-info/v3/details");
      if (!info.portalId) throw new Error("hubspot identify: no portalId");
      return { accountId: String(info.portalId), label: `HubSpot portal ${info.portalId}` };
    }
  });
}
function obj(name, path24 = `/crm/v3/objects/${name}`) {
  return path24;
}
function listAction(object) {
  return httpAction({
    id: `hubspot.list_${object}`,
    description: `List ${object}.`,
    input: z17.object({ limit: z17.number().int().positive().max(100).default(20), after: z17.string().optional() }),
    request: (i) => ({ method: "GET", path: obj(object), query: { limit: i.limit, after: i.after } }),
    output: (raw) => {
      const r = raw;
      return { results: r.results ?? [], next: r.paging?.next?.after };
    }
  });
}
function registerHubspot(registry, options = {}) {
  registry.addBundle({ provider: hubspot(options), toolkits: [hubspotToolkit] });
}
var hubspotToolkit;
var init_hubspot = __esm({
  "packages/connectors/src/providers/hubspot/index.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    hubspotToolkit = defineToolkit({
      id: "hubspot",
      providerId: "hubspot",
      displayName: "HubSpot",
      actions: [
        listAction("contacts"),
        listAction("companies"),
        listAction("deals"),
        httpAction({
          id: "hubspot.get_contact",
          description: "Get a contact by id.",
          input: z17.object({ contactId: z17.string(), properties: z17.array(z17.string()).optional() }),
          request: (i) => ({ method: "GET", path: `/crm/v3/objects/contacts/${encodeURIComponent(i.contactId)}`, query: { properties: i.properties?.join(",") } }),
          output: (raw) => raw
        }),
        httpAction({
          id: "hubspot.create_contact",
          description: "Create a contact from a properties map (e.g. { email, firstname, lastname }).",
          mutating: true,
          risk: "medium",
          input: z17.object({ properties: z17.record(z17.unknown()) }),
          request: (i) => ({ method: "POST", path: "/crm/v3/objects/contacts", body: { properties: i.properties } }),
          output: (raw) => raw
        }),
        httpAction({
          id: "hubspot.update_contact",
          description: "Update a contact\u2019s properties.",
          mutating: true,
          risk: "medium",
          input: z17.object({ contactId: z17.string(), properties: z17.record(z17.unknown()) }),
          request: (i) => ({ method: "PATCH", path: `/crm/v3/objects/contacts/${encodeURIComponent(i.contactId)}`, body: { properties: i.properties } }),
          output: (raw) => raw
        }),
        httpAction({
          id: "hubspot.search_contacts",
          description: "Search contacts with a query string and/or filter groups.",
          input: z17.object({ query: z17.string().optional(), filterGroups: z17.array(z17.any()).optional(), limit: z17.number().int().positive().max(100).default(20) }),
          request: (i) => ({ method: "POST", path: "/crm/v3/objects/contacts/search", body: { query: i.query, filterGroups: i.filterGroups, limit: i.limit } }),
          output: (raw) => {
            const r = raw;
            return { results: r.results ?? [], total: r.total ?? 0 };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/salesforce/index.ts
import { z as z18 } from "zod";
function dataPath(suffix) {
  return `/services/data/${API_VERSION}/${suffix.replace(/^\/+/, "")}`;
}
function salesforce(options = {}) {
  const login = options.loginUrl ?? "https://login.salesforce.com";
  return defineProvider({
    id: "salesforce",
    displayName: "Salesforce",
    baseUrl: login,
    // fallback only; the per-connection instance_url overrides via resolveBaseUrl
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: `${login}/services/oauth2/authorize`,
      tokenUrl: `${login}/services/oauth2/token`,
      usePkce: true,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    // The org's API base IS the token response's instance_url — capture it as the connection base.
    resolveBaseUrl: (ctx) => ctx.tokenResponse?.instance_url,
    // identify() now runs against the instance host (set above), so it can read the user info.
    async identify(http) {
      const me = await http.get(
        "/services/oauth2/userinfo"
      );
      return {
        accountId: me.user_id ?? me.sub ?? "salesforce:user",
        ...me.email !== void 0 ? { email: me.email } : {},
        ...me.name !== void 0 ? { label: me.name } : {}
      };
    }
  });
}
function registerSalesforce(registry, options = {}) {
  registry.addBundle({ provider: salesforce(options), toolkits: [salesforceToolkit] });
}
var API_VERSION, salesforceToolkit;
var init_salesforce = __esm({
  "packages/connectors/src/providers/salesforce/index.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    API_VERSION = "v59.0";
    salesforceToolkit = defineToolkit({
      id: "salesforce",
      providerId: "salesforce",
      displayName: "Salesforce",
      actions: [
        httpAction({
          id: "salesforce.soql_query",
          description: "Run a SOQL query.",
          input: z18.object({ soql: z18.string() }),
          request: (i) => ({ method: "GET", path: dataPath("query"), query: { q: i.soql } }),
          output: (raw) => {
            const r = raw;
            return { totalSize: r.totalSize ?? 0, records: r.records ?? [], done: r.done ?? true };
          }
        }),
        httpAction({
          id: "salesforce.get_record",
          description: "Get an sObject record by id.",
          input: z18.object({ sobject: z18.string(), id: z18.string(), fields: z18.array(z18.string()).optional() }),
          request: (i) => ({
            method: "GET",
            path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`),
            query: { fields: i.fields?.join(",") }
          }),
          output: (raw) => raw
        }),
        httpAction({
          id: "salesforce.create_record",
          description: "Create an sObject record from a fields map.",
          mutating: true,
          risk: "medium",
          input: z18.object({ sobject: z18.string(), fields: z18.record(z18.unknown()) }),
          request: (i) => ({ method: "POST", path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}`), body: i.fields }),
          output: (raw) => raw
        }),
        httpAction({
          id: "salesforce.update_record",
          description: "Update an sObject record (partial).",
          mutating: true,
          risk: "medium",
          input: z18.object({ sobject: z18.string(), id: z18.string(), fields: z18.record(z18.unknown()) }),
          request: (i) => ({
            method: "PATCH",
            path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`),
            body: i.fields
          }),
          output: () => ({ updated: true })
        }),
        httpAction({
          id: "salesforce.delete_record",
          description: "Delete an sObject record by id.",
          mutating: true,
          risk: "high",
          input: z18.object({ sobject: z18.string(), id: z18.string() }),
          request: (i) => ({ method: "DELETE", path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`) }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/auth/direct.ts
function apiKey(config = {}) {
  const where = config.in ?? "header";
  const name = config.name ?? (where === "header" ? "Authorization" : "api_key");
  const prefix = config.prefix ?? "";
  return {
    kind: "api_key",
    applyAuth(creds, req) {
      if (creds.type !== "api_key") throw new Error("apiKey strategy received wrong credentials");
      if (where === "query") req.addQueryParam(name, creds.apiKey);
      else req.headers[name] = `${prefix}${creds.apiKey}`;
    },
    tokenOf(creds) {
      if (creds.type !== "api_key") throw new Error("apiKey strategy received wrong credentials");
      return creds.apiKey;
    }
  };
}
function bearer() {
  return {
    kind: "bearer",
    applyAuth(creds, req) {
      if (creds.type !== "bearer") throw new Error("bearer strategy received wrong credentials");
      req.headers.Authorization = `Bearer ${creds.token}`;
    },
    tokenOf(creds) {
      if (creds.type !== "bearer") throw new Error("bearer strategy received wrong credentials");
      return creds.token;
    }
  };
}
function custom(config) {
  return {
    kind: "custom",
    applyAuth(creds, req) {
      if (creds.type !== "custom") throw new Error("custom strategy received wrong credentials");
      config.apply(req, creds.values);
    },
    tokenOf() {
      throw new Error("custom strategy has no single token; use ctx.http");
    }
  };
}
var init_direct = __esm({
  "packages/connectors/src/auth/direct.ts"() {
    "use strict";
  }
});

// packages/connectors/src/providers/todoist/provider.ts
function todoist() {
  return defineProvider({
    id: "todoist",
    displayName: "Todoist",
    baseUrl: "https://api.todoist.com/rest/v2",
    auth: apiKey({ prefix: "Bearer " })
    // Todoist REST v2 exposes no clean identity endpoint, so we omit identify(): connectDirect
    // assigns accountId 'todoist:default' (one Todoist connection per owner — the common case).
  });
}
var init_provider8 = __esm({
  "packages/connectors/src/providers/todoist/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/todoist/toolkit.ts
import { z as z19 } from "zod";
function taskSummary(t) {
  return {
    id: t.id,
    content: t.content,
    description: t.description,
    due: t.due,
    priority: t.priority,
    project_id: t.project_id,
    is_completed: t.is_completed
  };
}
var todoistToolkit;
var init_toolkit5 = __esm({
  "packages/connectors/src/providers/todoist/toolkit.ts"() {
    "use strict";
    init_authoring();
    todoistToolkit = defineToolkit({
      id: "todoist",
      providerId: "todoist",
      displayName: "Todoist",
      actions: [
        httpAction({
          id: "todoist.list_tasks",
          description: "List active tasks, optionally filtered by project or a Todoist filter query.",
          input: z19.object({
            project_id: z19.string().optional(),
            filter: z19.string().optional().describe('Todoist filter, e.g. "today | overdue"')
          }),
          request: (i) => ({ method: "GET", path: "/tasks", query: { project_id: i.project_id, filter: i.filter } }),
          output: (raw) => ({ tasks: (raw ?? []).map(taskSummary) })
        }),
        httpAction({
          id: "todoist.create_task",
          description: "Create a task.",
          mutating: true,
          risk: "low",
          input: z19.object({
            content: z19.string(),
            description: z19.string().optional(),
            due_string: z19.string().optional().describe('Natural language due date, e.g. "tomorrow at 9am"'),
            project_id: z19.string().optional(),
            priority: z19.number().int().min(1).max(4).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/tasks",
            body: {
              content: i.content,
              description: i.description,
              due_string: i.due_string,
              project_id: i.project_id,
              priority: i.priority
            }
          }),
          output: (raw) => taskSummary(raw)
        }),
        httpAction({
          id: "todoist.complete_task",
          description: "Mark a task complete (close it).",
          mutating: true,
          risk: "low",
          input: z19.object({ id: z19.string() }),
          request: (i) => ({ method: "POST", path: `/tasks/${encodeURIComponent(i.id)}/close` }),
          // The close endpoint returns 204 No Content; surface a stable result regardless.
          output: () => ({ completed: true })
        }),
        httpAction({
          id: "todoist.update_task",
          description: "Update fields on an existing task.",
          mutating: true,
          risk: "low",
          input: z19.object({
            id: z19.string(),
            content: z19.string().optional(),
            description: z19.string().optional(),
            due_string: z19.string().optional(),
            priority: z19.number().int().min(1).max(4).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: `/tasks/${encodeURIComponent(i.id)}`,
            body: { content: i.content, description: i.description, due_string: i.due_string, priority: i.priority }
          }),
          output: () => ({ updated: true })
        }),
        httpAction({
          id: "todoist.list_projects",
          description: "List the user\u2019s projects.",
          input: z19.object({}),
          request: () => ({ method: "GET", path: "/projects" }),
          output: (raw) => ({
            projects: (raw ?? []).map((p) => ({ id: p.id, name: p.name }))
          })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/todoist/index.ts
function registerTodoist(registry) {
  registry.addBundle({ provider: todoist(), toolkits: [todoistToolkit] });
}
var init_todoist = __esm({
  "packages/connectors/src/providers/todoist/index.ts"() {
    "use strict";
    init_provider8();
    init_toolkit5();
  }
});

// packages/connectors/src/providers/airtable/provider.ts
function airtable() {
  return defineProvider({
    id: "airtable",
    displayName: "Airtable",
    baseUrl: "https://api.airtable.com/v0",
    auth: apiKey({ prefix: "Bearer " }),
    async identify(http) {
      const me = await http.get("/meta/whoami");
      if (!me.id) throw new Error("airtable identify: whoami returned no id");
      return {
        accountId: me.id,
        ...me.email !== void 0 ? { email: me.email } : {},
        label: me.email ?? me.id
      };
    }
  });
}
var init_provider9 = __esm({
  "packages/connectors/src/providers/airtable/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/airtable/toolkit.ts
import { z as z20 } from "zod";
function recordSummary(r) {
  return { id: r.id, fields: r.fields ?? {}, createdTime: r.createdTime };
}
var airtableToolkit;
var init_toolkit6 = __esm({
  "packages/connectors/src/providers/airtable/toolkit.ts"() {
    "use strict";
    init_authoring();
    airtableToolkit = defineToolkit({
      id: "airtable",
      providerId: "airtable",
      displayName: "Airtable",
      actions: [
        httpAction({
          id: "airtable.list_bases",
          description: "List the Airtable bases the token can access.",
          input: z20.object({}),
          request: () => ({ method: "GET", path: "/meta/bases" }),
          output: (raw) => {
            const r = raw;
            return { bases: (r.bases ?? []).map((b) => ({ id: b.id, name: b.name, permissionLevel: b.permissionLevel })) };
          }
        }),
        httpAction({
          id: "airtable.list_records",
          description: "List records in a table. Optionally filter with a formula or pick a view.",
          input: z20.object({
            baseId: z20.string(),
            tableIdOrName: z20.string(),
            maxRecords: z20.number().int().positive().max(100).optional(),
            view: z20.string().optional(),
            filterByFormula: z20.string().optional().describe(`Airtable formula, e.g. "{Status}='Done'"`)
          }),
          request: (i) => ({
            method: "GET",
            path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}`,
            query: { maxRecords: i.maxRecords, view: i.view, filterByFormula: i.filterByFormula }
          }),
          output: (raw) => {
            const r = raw;
            return { records: (r.records ?? []).map(recordSummary), offset: r.offset };
          }
        }),
        httpAction({
          id: "airtable.get_record",
          description: "Get a single record by id.",
          input: z20.object({ baseId: z20.string(), tableIdOrName: z20.string(), recordId: z20.string() }),
          request: (i) => ({
            method: "GET",
            path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`
          }),
          output: (raw) => recordSummary(raw)
        }),
        httpAction({
          id: "airtable.create_record",
          description: "Create a record with the given fields.",
          mutating: true,
          risk: "medium",
          input: z20.object({
            baseId: z20.string(),
            tableIdOrName: z20.string(),
            fields: z20.record(z20.unknown()),
            typecast: z20.boolean().optional()
          }),
          request: (i) => ({
            method: "POST",
            path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}`,
            body: { fields: i.fields, ...i.typecast !== void 0 ? { typecast: i.typecast } : {} }
          }),
          output: (raw) => recordSummary(raw)
        }),
        httpAction({
          id: "airtable.update_record",
          description: "Update fields on an existing record (partial update).",
          mutating: true,
          risk: "medium",
          input: z20.object({
            baseId: z20.string(),
            tableIdOrName: z20.string(),
            recordId: z20.string(),
            fields: z20.record(z20.unknown()),
            typecast: z20.boolean().optional()
          }),
          request: (i) => ({
            method: "PATCH",
            path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`,
            body: { fields: i.fields, ...i.typecast !== void 0 ? { typecast: i.typecast } : {} }
          }),
          output: (raw) => recordSummary(raw)
        }),
        httpAction({
          id: "airtable.delete_record",
          description: "Delete a record by id.",
          mutating: true,
          risk: "high",
          input: z20.object({ baseId: z20.string(), tableIdOrName: z20.string(), recordId: z20.string() }),
          request: (i) => ({
            method: "DELETE",
            path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`
          }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/airtable/index.ts
function registerAirtable(registry) {
  registry.addBundle({ provider: airtable(), toolkits: [airtableToolkit] });
}
var init_airtable = __esm({
  "packages/connectors/src/providers/airtable/index.ts"() {
    "use strict";
    init_provider9();
    init_toolkit6();
  }
});

// packages/connectors/src/providers/readwise/provider.ts
function readwise() {
  return defineProvider({
    id: "readwise",
    displayName: "Readwise",
    baseUrl: "https://readwise.io/api/v2",
    auth: apiKey({ prefix: "Token " })
  });
}
var init_provider10 = __esm({
  "packages/connectors/src/providers/readwise/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/readwise/highlights.ts
import { z as z21 } from "zod";
var readwiseHighlights;
var init_highlights = __esm({
  "packages/connectors/src/providers/readwise/highlights.ts"() {
    "use strict";
    init_authoring();
    readwiseHighlights = defineToolkit({
      id: "readwise",
      providerId: "readwise",
      displayName: "Readwise",
      actions: [
        httpAction({
          id: "readwise.list_highlights",
          description: "List highlights (paginated).",
          input: z21.object({
            page: z21.number().int().positive().optional(),
            page_size: z21.number().int().positive().max(1e3).default(50),
            book_id: z21.number().int().optional()
          }),
          request: (i) => ({ method: "GET", path: "/highlights/", query: { page: i.page, page_size: i.page_size, book_id: i.book_id } }),
          output: (raw) => {
            const r = raw;
            return { count: r.count, results: r.results ?? [], next: r.next ?? void 0 };
          }
        }),
        httpAction({
          id: "readwise.list_books",
          description: "List books/sources (paginated).",
          input: z21.object({ page: z21.number().int().positive().optional(), page_size: z21.number().int().positive().max(1e3).default(50) }),
          request: (i) => ({ method: "GET", path: "/books/", query: { page: i.page, page_size: i.page_size } }),
          output: (raw) => {
            const r = raw;
            return { count: r.count, results: r.results ?? [] };
          }
        }),
        httpAction({
          id: "readwise.create_highlight",
          description: "Create one or more highlights.",
          mutating: true,
          risk: "low",
          input: z21.object({
            highlights: z21.array(
              z21.object({
                text: z21.string(),
                title: z21.string().optional(),
                author: z21.string().optional(),
                source_url: z21.string().optional(),
                note: z21.string().optional()
              })
            )
          }),
          request: (i) => ({ method: "POST", path: "/highlights/", body: { highlights: i.highlights } }),
          output: (raw) => ({ created: raw })
        }),
        httpAction({
          id: "readwise.list_documents",
          description: "List Reader documents (Readwise Reader v3).",
          input: z21.object({ location: z21.string().optional().describe("new | later | archive | feed"), pageCursor: z21.string().optional() }),
          request: (i) => ({ method: "GET", path: "https://readwise.io/api/v3/list/", query: { location: i.location, pageCursor: i.pageCursor } }),
          output: (raw) => {
            const r = raw;
            return { count: r.count, results: r.results ?? [], nextPageCursor: r.nextPageCursor ?? void 0 };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/readwise/index.ts
function registerReadwise(registry) {
  registry.addBundle({ provider: readwise(), toolkits: [readwiseHighlights] });
}
var init_readwise = __esm({
  "packages/connectors/src/providers/readwise/index.ts"() {
    "use strict";
    init_provider10();
    init_highlights();
  }
});

// packages/connectors/src/providers/stripe/provider.ts
function stripe() {
  return defineProvider({
    id: "stripe",
    displayName: "Stripe",
    baseUrl: "https://api.stripe.com/v1",
    auth: bearer(),
    async identify(http) {
      const a = await http.get("/account");
      if (!a.id) throw new Error("stripe identify: /account returned no id");
      return {
        accountId: a.id,
        ...a.email !== void 0 ? { email: a.email } : {},
        label: a.business_profile?.name ?? a.email ?? a.id
      };
    }
  });
}
function stripeForm(obj2) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj2)) if (v !== void 0) p.set(k, String(v));
  return p.toString();
}
var init_provider11 = __esm({
  "packages/connectors/src/providers/stripe/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/stripe/toolkit.ts
import { z as z22 } from "zod";
function list(raw) {
  const r = raw;
  return { data: r.data ?? [], has_more: !!r.has_more };
}
var stripeToolkit;
var init_toolkit7 = __esm({
  "packages/connectors/src/providers/stripe/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_provider11();
    stripeToolkit = defineToolkit({
      id: "stripe",
      providerId: "stripe",
      displayName: "Stripe",
      actions: [
        httpAction({
          id: "stripe.list_customers",
          description: "List customers (optionally filter by email).",
          input: z22.object({ limit: z22.number().int().positive().max(100).default(10), email: z22.string().optional() }),
          request: (i) => ({ method: "GET", path: "/customers", query: { limit: i.limit, email: i.email } }),
          output: list
        }),
        httpAction({
          id: "stripe.get_customer",
          description: "Get a customer by id.",
          input: z22.object({ customerId: z22.string() }),
          request: (i) => ({ method: "GET", path: `/customers/${encodeURIComponent(i.customerId)}` }),
          output: (raw) => raw
        }),
        httpAction({
          id: "stripe.list_charges",
          description: "List recent charges.",
          input: z22.object({ limit: z22.number().int().positive().max(100).default(10), customer: z22.string().optional() }),
          request: (i) => ({ method: "GET", path: "/charges", query: { limit: i.limit, customer: i.customer } }),
          output: list
        }),
        httpAction({
          id: "stripe.list_invoices",
          description: "List invoices.",
          input: z22.object({ limit: z22.number().int().positive().max(100).default(10), customer: z22.string().optional() }),
          request: (i) => ({ method: "GET", path: "/invoices", query: { limit: i.limit, customer: i.customer } }),
          output: list
        }),
        httpAction({
          id: "stripe.list_subscriptions",
          description: "List subscriptions.",
          input: z22.object({ limit: z22.number().int().positive().max(100).default(10), customer: z22.string().optional() }),
          request: (i) => ({ method: "GET", path: "/subscriptions", query: { limit: i.limit, customer: i.customer } }),
          output: list
        }),
        httpAction({
          id: "stripe.create_customer",
          description: "Create a customer.",
          mutating: true,
          risk: "high",
          input: z22.object({ email: z22.string().optional(), name: z22.string().optional(), description: z22.string().optional() }),
          request: (i) => ({
            method: "POST",
            path: "/customers",
            rawBody: stripeForm({ email: i.email, name: i.name, description: i.description }),
            contentType: "application/x-www-form-urlencoded"
          }),
          output: (raw) => raw
        })
      ]
    });
  }
});

// packages/connectors/src/providers/stripe/index.ts
function registerStripe(registry) {
  registry.addBundle({ provider: stripe(), toolkits: [stripeToolkit] });
}
var init_stripe = __esm({
  "packages/connectors/src/providers/stripe/index.ts"() {
    "use strict";
    init_provider11();
    init_toolkit7();
  }
});

// packages/connectors/src/providers/plaid/provider.ts
function plaid(options = {}) {
  return defineProvider({
    id: "plaid",
    displayName: "Plaid",
    baseUrl: options.baseUrl ?? "https://sandbox.plaid.com",
    auth: custom({
      secretFields: ["client_id", "secret"],
      apply: (req, v) => {
        req.setBodyField("client_id", v.client_id);
        req.setBodyField("secret", v.secret);
      }
    })
  });
}
var init_provider12 = __esm({
  "packages/connectors/src/providers/plaid/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/plaid/toolkit.ts
import { z as z23 } from "zod";
var plaidToolkit;
var init_toolkit8 = __esm({
  "packages/connectors/src/providers/plaid/toolkit.ts"() {
    "use strict";
    init_authoring();
    plaidToolkit = defineToolkit({
      id: "plaid",
      providerId: "plaid",
      displayName: "Plaid",
      actions: [
        httpAction({
          id: "plaid.get_accounts",
          description: "Get the accounts for a linked item (access_token).",
          input: z23.object({ access_token: z23.string() }),
          request: (i) => ({ method: "POST", path: "/accounts/get", body: { access_token: i.access_token } }),
          output: (raw) => {
            const r = raw;
            return { accounts: r.accounts ?? [], item: r.item };
          }
        }),
        httpAction({
          id: "plaid.get_balance",
          description: "Get real-time balances for a linked item.",
          input: z23.object({ access_token: z23.string() }),
          request: (i) => ({ method: "POST", path: "/accounts/balance/get", body: { access_token: i.access_token } }),
          output: (raw) => {
            const r = raw;
            return { accounts: r.accounts ?? [] };
          }
        }),
        httpAction({
          id: "plaid.get_transactions",
          description: "Get transactions for a linked item over a date range (YYYY-MM-DD).",
          input: z23.object({
            access_token: z23.string(),
            start_date: z23.string(),
            end_date: z23.string(),
            count: z23.number().int().positive().max(500).optional(),
            offset: z23.number().int().min(0).optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/transactions/get",
            body: {
              access_token: i.access_token,
              start_date: i.start_date,
              end_date: i.end_date,
              ...i.count !== void 0 || i.offset !== void 0 ? { options: { count: i.count, offset: i.offset } } : {}
            }
          }),
          output: (raw) => {
            const r = raw;
            return { transactions: r.transactions ?? [], total: r.total_transactions ?? 0 };
          }
        }),
        httpAction({
          id: "plaid.get_item",
          description: "Get metadata about a linked item.",
          input: z23.object({ access_token: z23.string() }),
          request: (i) => ({ method: "POST", path: "/item/get", body: { access_token: i.access_token } }),
          output: (raw) => raw
        })
      ]
    });
  }
});

// packages/connectors/src/providers/plaid/index.ts
function registerPlaid(registry, options = {}) {
  registry.addBundle({ provider: plaid(options), toolkits: [plaidToolkit] });
}
var init_plaid = __esm({
  "packages/connectors/src/providers/plaid/index.ts"() {
    "use strict";
    init_provider12();
    init_toolkit8();
  }
});

// packages/connectors/src/providers/telegram/provider.ts
function telegramResult(raw) {
  const env = raw;
  if (!env || env.ok !== true) {
    throw new ConnectorError("provider_error", `telegram: ${env?.description ?? "request failed"}`);
  }
  return env.result;
}
function telegram() {
  return defineProvider({
    id: "telegram",
    displayName: "Telegram",
    baseUrl: "https://api.telegram.org",
    auth: custom({
      secretFields: ["token"],
      apply: (req, v) => {
        const u = new URL(req.url);
        u.pathname = `/bot${v.token}${u.pathname}`;
        req.setUrl(u.toString());
      }
    }),
    async identify(http) {
      const me = telegramResult(await http.get("/getMe"));
      return {
        accountId: String(me.id),
        label: me.username ?? me.first_name ?? `bot:${me.id}`
      };
    }
  });
}
var init_provider13 = __esm({
  "packages/connectors/src/providers/telegram/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
    init_errors();
  }
});

// packages/connectors/src/providers/telegram/toolkit.ts
import { z as z24 } from "zod";
var telegramToolkit;
var init_toolkit9 = __esm({
  "packages/connectors/src/providers/telegram/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_provider13();
    telegramToolkit = defineToolkit({
      id: "telegram",
      providerId: "telegram",
      displayName: "Telegram",
      actions: [
        httpAction({
          id: "telegram.send_message",
          description: "Send a text message to a Telegram chat (the primary notification verb).",
          mutating: true,
          risk: "low",
          input: z24.object({
            chatId: z24.union([z24.string(), z24.number()]).describe("Chat id or @channelusername"),
            text: z24.string(),
            parseMode: z24.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
            disableNotification: z24.boolean().optional().describe("Deliver silently (no sound)")
          }),
          request: (i) => ({
            method: "POST",
            path: "/sendMessage",
            body: {
              chat_id: i.chatId,
              text: i.text,
              ...i.parseMode ? { parse_mode: i.parseMode } : {},
              ...i.disableNotification ? { disable_notification: i.disableNotification } : {}
            }
          }),
          output: (raw) => {
            const r = telegramResult(raw);
            return { messageId: r.message_id, chatId: r.chat.id };
          }
        }),
        httpAction({
          id: "telegram.send_photo",
          description: "Send a photo (by URL or file_id) to a Telegram chat, with an optional caption.",
          mutating: true,
          risk: "low",
          input: z24.object({
            chatId: z24.union([z24.string(), z24.number()]),
            photo: z24.string().describe("Photo URL or Telegram file_id"),
            caption: z24.string().optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/sendPhoto",
            body: { chat_id: i.chatId, photo: i.photo, ...i.caption ? { caption: i.caption } : {} }
          }),
          output: (raw) => {
            const r = telegramResult(raw);
            return { messageId: r.message_id };
          }
        }),
        httpAction({
          id: "telegram.get_me",
          description: "Get the bot's own identity (id, username).",
          input: z24.object({}),
          request: () => ({ method: "GET", path: "/getMe" }),
          output: (raw) => telegramResult(raw)
        }),
        httpAction({
          id: "telegram.get_updates",
          description: "Poll for incoming updates (messages sent to the bot) \u2014 e.g. to discover a chat id.",
          input: z24.object({
            offset: z24.number().int().optional(),
            limit: z24.number().int().positive().max(100).default(25)
          }),
          request: (i) => ({ method: "GET", path: "/getUpdates", query: { offset: i.offset, limit: i.limit } }),
          output: (raw) => ({ updates: telegramResult(raw) })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/telegram/index.ts
function registerTelegram(registry) {
  registry.addBundle({ provider: telegram(), toolkits: [telegramToolkit] });
}
var init_telegram = __esm({
  "packages/connectors/src/providers/telegram/index.ts"() {
    "use strict";
    init_provider13();
    init_toolkit9();
  }
});

// packages/connectors/src/providers/whatsapp/provider.ts
function whatsapp() {
  return defineProvider({
    id: "whatsapp",
    displayName: "WhatsApp",
    baseUrl: "https://graph.facebook.com",
    auth: custom({
      secretFields: ["access_token", "phone_number_id"],
      apply: (req, v) => {
        req.headers.Authorization = `Bearer ${v.access_token}`;
        const u = new URL(req.url);
        u.pathname = u.pathname.replace(/^\/v21\.0/, `/v21.0/${v.phone_number_id}`);
        req.setUrl(u.toString());
      }
    }),
    async identify(http) {
      const me = await http.get("/v21.0", {
        query: { fields: "display_phone_number,verified_name" }
      });
      return {
        accountId: me.display_phone_number ?? "whatsapp",
        label: me.verified_name ?? me.display_phone_number ?? "WhatsApp"
      };
    }
  });
}
var init_provider14 = __esm({
  "packages/connectors/src/providers/whatsapp/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/whatsapp/toolkit.ts
import { z as z25 } from "zod";
var whatsappToolkit;
var init_toolkit10 = __esm({
  "packages/connectors/src/providers/whatsapp/toolkit.ts"() {
    "use strict";
    init_authoring();
    whatsappToolkit = defineToolkit({
      id: "whatsapp",
      providerId: "whatsapp",
      displayName: "WhatsApp",
      actions: [
        httpAction({
          id: "whatsapp.send_message",
          description: "Send a free-form text message to a WhatsApp user. Only reaches people who messaged your number in the last 24h; outside that window use send_template.",
          mutating: true,
          risk: "low",
          input: z25.object({
            to: z25.string().describe("Recipient phone number in international format, e.g. 15551234567"),
            body: z25.string()
          }),
          request: (i) => ({
            method: "POST",
            path: "/v21.0/messages",
            body: { messaging_product: "whatsapp", to: i.to, type: "text", text: { body: i.body, preview_url: false } }
          }),
          output: (raw) => ({ messageId: raw.messages?.[0]?.id })
        }),
        httpAction({
          id: "whatsapp.send_template",
          description: "Send an approved WhatsApp template message (works outside the 24h session window).",
          mutating: true,
          risk: "low",
          input: z25.object({
            to: z25.string(),
            name: z25.string().describe("Approved template name"),
            languageCode: z25.string().default("en_US")
          }),
          request: (i) => ({
            method: "POST",
            path: "/v21.0/messages",
            body: {
              messaging_product: "whatsapp",
              to: i.to,
              type: "template",
              template: { name: i.name, language: { code: i.languageCode } }
            }
          }),
          output: (raw) => ({ messageId: raw.messages?.[0]?.id })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/whatsapp/index.ts
function registerWhatsapp(registry) {
  registry.addBundle({ provider: whatsapp(), toolkits: [whatsappToolkit] });
}
var init_whatsapp = __esm({
  "packages/connectors/src/providers/whatsapp/index.ts"() {
    "use strict";
    init_provider14();
    init_toolkit10();
  }
});

// packages/connectors/src/providers/gitlab/provider.ts
function gitlab() {
  return defineProvider({
    id: "gitlab",
    displayName: "GitLab",
    baseUrl: "https://gitlab.com/api/v4",
    auth: bearer(),
    async identify(http) {
      const me = await http.get("/user");
      return {
        accountId: String(me.id),
        ...me.email !== void 0 ? { email: me.email } : {},
        label: me.username
      };
    }
  });
}
var init_provider15 = __esm({
  "packages/connectors/src/providers/gitlab/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/gitlab/toolkit.ts
import { z as z26 } from "zod";
var projectId, gitlabToolkit;
var init_toolkit11 = __esm({
  "packages/connectors/src/providers/gitlab/toolkit.ts"() {
    "use strict";
    init_authoring();
    projectId = z26.union([z26.string(), z26.number()]);
    gitlabToolkit = defineToolkit({
      id: "gitlab",
      providerId: "gitlab",
      displayName: "GitLab",
      actions: [
        httpAction({
          id: "gitlab.list_projects",
          description: "List projects the authenticated user is a member of.",
          input: z26.object({ perPage: z26.number().int().positive().max(100).default(20) }),
          request: (i) => ({ method: "GET", path: "/projects", query: { membership: true, per_page: i.perPage } }),
          output: (raw) => {
            const r = raw ?? [];
            return { projects: r.map((p) => ({ id: p.id, name: p.name, path: p.path_with_namespace, webUrl: p.web_url })) };
          }
        }),
        httpAction({
          id: "gitlab.list_issues",
          description: "List issues across the user\u2019s projects.",
          input: z26.object({
            state: z26.enum(["opened", "closed", "all"]).default("opened"),
            perPage: z26.number().int().positive().max(100).default(20)
          }),
          request: (i) => ({ method: "GET", path: "/issues", query: { state: i.state, per_page: i.perPage } }),
          output: (raw) => {
            const r = raw ?? [];
            return { issues: r.map((x) => ({ id: x.id, iid: x.iid, title: x.title, state: x.state, webUrl: x.web_url })) };
          }
        }),
        httpAction({
          id: "gitlab.get_project",
          description: "Get a project by numeric id or url-encoded `group/repo` path.",
          input: z26.object({ id: projectId }),
          request: (i) => ({ method: "GET", path: `/projects/${encodeURIComponent(String(i.id))}` }),
          output: (raw) => {
            const p = raw;
            return { id: p.id, name: p.name, path: p.path_with_namespace, webUrl: p.web_url };
          }
        }),
        httpAction({
          id: "gitlab.create_issue",
          description: "Create an issue in a project.",
          mutating: true,
          risk: "medium",
          input: z26.object({ id: projectId, title: z26.string(), description: z26.string().optional() }),
          request: (i) => ({
            method: "POST",
            path: `/projects/${encodeURIComponent(String(i.id))}/issues`,
            body: { title: i.title, description: i.description }
          }),
          output: (raw) => {
            const x = raw;
            return { id: x.id, iid: x.iid, webUrl: x.web_url };
          }
        }),
        httpAction({
          id: "gitlab.list_merge_requests",
          description: "List merge requests across the user\u2019s projects.",
          input: z26.object({
            state: z26.enum(["opened", "closed", "merged", "all"]).default("opened"),
            perPage: z26.number().int().positive().max(100).default(20)
          }),
          request: (i) => ({ method: "GET", path: "/merge_requests", query: { state: i.state, per_page: i.perPage } }),
          output: (raw) => {
            const r = raw ?? [];
            return { mergeRequests: r.map((x) => ({ id: x.id, iid: x.iid, title: x.title, state: x.state, webUrl: x.web_url })) };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/gitlab/index.ts
function registerGitlab(registry) {
  registry.addBundle({ provider: gitlab(), toolkits: [gitlabToolkit] });
}
var init_gitlab = __esm({
  "packages/connectors/src/providers/gitlab/index.ts"() {
    "use strict";
    init_provider15();
    init_toolkit11();
  }
});

// packages/connectors/src/providers/confluence/provider.ts
function confluence(options = {}) {
  return defineProvider({
    id: "confluence",
    displayName: "Confluence",
    // No baseUrl — the API base is per-site (built from a cloudId in each action).
    // `offline_access` guarantees a refresh token; `read:me` lets us read the account.
    identityScopes: ["offline_access", "read:me"],
    auth: oauth2({
      authorizationUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      usePkce: false,
      authParams: { audience: "api.atlassian.com", prompt: "consent" },
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const resources = await http.get(
        "https://api.atlassian.com/oauth/token/accessible-resources"
      );
      const first = resources?.[0];
      if (!first) throw new Error("confluence identify: token has no accessible Atlassian sites");
      return { accountId: first.id, label: first.name ?? first.id, config: { cloudId: first.id } };
    }
  });
}
var init_provider16 = __esm({
  "packages/connectors/src/providers/confluence/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
  }
});

// packages/connectors/src/providers/confluence/toolkit.ts
import { z as z27 } from "zod";
function base2(config) {
  return `https://api.atlassian.com/ex/confluence/${encodeURIComponent(String(config.cloudId))}/wiki`;
}
var SCOPE2, confluenceToolkit;
var init_toolkit12 = __esm({
  "packages/connectors/src/providers/confluence/toolkit.ts"() {
    "use strict";
    init_authoring();
    SCOPE2 = { read: "read:confluence-content.all", write: "write:confluence-content" };
    confluenceToolkit = defineToolkit({
      id: "confluence",
      providerId: "confluence",
      displayName: "Confluence",
      actions: [
        httpAction({
          id: "confluence.search_pages",
          description: "Search Confluence content with a CQL query.",
          scopes: [SCOPE2.read],
          input: z27.object({
            cql: z27.string().describe('CQL, e.g. text ~ "roadmap" AND type = page'),
            limit: z27.number().int().positive().max(100).default(25)
          }),
          request: (i, { config }) => ({
            method: "GET",
            path: `${base2(config)}/rest/api/search`,
            query: { cql: i.cql, limit: i.limit }
          }),
          output: (raw) => {
            const r = raw;
            return {
              results: (r.results ?? []).map((hit) => ({
                id: hit.content?.id,
                title: hit.content?.title ?? hit.title,
                type: hit.content?.type
              }))
            };
          }
        }),
        httpAction({
          id: "confluence.get_page",
          description: "Get a Confluence page by id, including its storage-format body.",
          scopes: [SCOPE2.read],
          input: z27.object({ id: z27.string() }),
          request: (i, { config }) => ({
            method: "GET",
            path: `${base2(config)}/api/v2/pages/${encodeURIComponent(i.id)}`,
            query: { "body-format": "storage" }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, title: r.title, spaceId: r.spaceId, body: r.body?.storage?.value };
          }
        }),
        httpAction({
          id: "confluence.create_page",
          description: "Create a Confluence page in a space (storage-format body).",
          mutating: true,
          risk: "medium",
          scopes: [SCOPE2.write],
          input: z27.object({
            spaceId: z27.string(),
            title: z27.string(),
            value: z27.string().describe("Storage-format (HTML-ish) page body")
          }),
          request: (i, { config }) => ({
            method: "POST",
            path: `${base2(config)}/api/v2/pages`,
            body: { spaceId: i.spaceId, status: "current", title: i.title, body: { representation: "storage", value: i.value } }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, title: r.title };
          }
        }),
        httpAction({
          id: "confluence.list_spaces",
          description: "List Confluence spaces on the site.",
          scopes: [SCOPE2.read],
          input: z27.object({ limit: z27.number().int().positive().max(100).default(25) }),
          request: (i, { config }) => ({ method: "GET", path: `${base2(config)}/api/v2/spaces`, query: { limit: i.limit } }),
          output: (raw) => {
            const r = raw;
            return { spaces: (r.results ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name })) };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/confluence/index.ts
function registerConfluence(registry, options = {}) {
  registry.addBundle({ provider: confluence(options), toolkits: [confluenceToolkit] });
}
var init_confluence = __esm({
  "packages/connectors/src/providers/confluence/index.ts"() {
    "use strict";
    init_provider16();
    init_toolkit12();
  }
});

// packages/connectors/src/providers/asana/provider.ts
function asana() {
  return defineProvider({
    id: "asana",
    displayName: "Asana",
    baseUrl: "https://app.asana.com/api/1.0",
    auth: bearer(),
    async identify(http) {
      const me = await http.get("/users/me");
      const user = me.data;
      if (!user?.gid) throw new Error("asana identify: /users/me returned no gid");
      return {
        accountId: user.gid,
        ...user.email !== void 0 ? { email: user.email } : {},
        label: user.name ?? user.email ?? user.gid
      };
    }
  });
}
var init_provider17 = __esm({
  "packages/connectors/src/providers/asana/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/asana/toolkit.ts
import { z as z28 } from "zod";
function data2(raw) {
  return raw.data;
}
var asanaToolkit;
var init_toolkit13 = __esm({
  "packages/connectors/src/providers/asana/toolkit.ts"() {
    "use strict";
    init_authoring();
    asanaToolkit = defineToolkit({
      id: "asana",
      providerId: "asana",
      displayName: "Asana",
      actions: [
        httpAction({
          id: "asana.list_workspaces",
          description: "List the workspaces the user can access.",
          input: z28.object({}),
          request: () => ({ method: "GET", path: "/workspaces" }),
          output: (raw) => ({ workspaces: data2(raw) })
        }),
        httpAction({
          id: "asana.list_projects",
          description: "List projects, optionally scoped to a workspace.",
          input: z28.object({
            workspace: z28.string().optional().describe("Workspace gid to scope to"),
            limit: z28.number().int().positive().max(100).default(25)
          }),
          request: (i) => ({ method: "GET", path: "/projects", query: { workspace: i.workspace, limit: i.limit } }),
          output: (raw) => ({ projects: data2(raw) })
        }),
        httpAction({
          id: "asana.list_tasks",
          description: "List tasks. Scope with assignee+workspace, or by project.",
          input: z28.object({
            assignee: z28.string().optional().describe('Assignee gid (use "me" for the current user)'),
            workspace: z28.string().optional().describe("Workspace gid (required with assignee)"),
            project: z28.string().optional().describe("Project gid"),
            limit: z28.number().int().positive().max(100).default(25)
          }),
          request: (i) => ({
            method: "GET",
            path: "/tasks",
            query: { assignee: i.assignee, workspace: i.workspace, project: i.project, limit: i.limit }
          }),
          output: (raw) => ({ tasks: data2(raw) })
        }),
        httpAction({
          id: "asana.get_task",
          description: "Get a single task by gid.",
          input: z28.object({ gid: z28.string() }),
          request: (i) => ({ method: "GET", path: `/tasks/${encodeURIComponent(i.gid)}` }),
          output: (raw) => data2(raw)
        }),
        httpAction({
          id: "asana.create_task",
          description: "Create a task in a workspace and/or projects.",
          mutating: true,
          risk: "low",
          input: z28.object({
            name: z28.string(),
            notes: z28.string().optional(),
            workspace: z28.string().optional().describe("Workspace gid"),
            projects: z28.array(z28.string()).optional().describe("Project gids to add the task to")
          }),
          request: (i) => ({
            method: "POST",
            path: "/tasks",
            body: {
              data: {
                name: i.name,
                ...i.notes !== void 0 ? { notes: i.notes } : {},
                ...i.workspace !== void 0 ? { workspace: i.workspace } : {},
                ...i.projects !== void 0 ? { projects: i.projects } : {}
              }
            }
          }),
          output: (raw) => data2(raw)
        }),
        httpAction({
          id: "asana.complete_task",
          description: "Mark a task complete.",
          mutating: true,
          risk: "low",
          input: z28.object({ gid: z28.string() }),
          request: (i) => ({ method: "PUT", path: `/tasks/${encodeURIComponent(i.gid)}`, body: { data: { completed: true } } }),
          output: () => ({ completed: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/asana/index.ts
function registerAsana(registry) {
  registry.addBundle({ provider: asana(), toolkits: [asanaToolkit] });
}
var init_asana = __esm({
  "packages/connectors/src/providers/asana/index.ts"() {
    "use strict";
    init_provider17();
    init_toolkit13();
  }
});

// packages/connectors/src/providers/zendesk/provider.ts
function zendesk() {
  return defineProvider({
    id: "zendesk",
    displayName: "Zendesk",
    // Placeholder host; the custom strategy rewrites it to the connection's subdomain.
    baseUrl: "https://placeholder.zendesk.com",
    auth: custom({
      secretFields: ["subdomain", "email", "api_token"],
      apply: (req, v) => {
        const basic = Buffer.from(`${v.email}/token:${v.api_token}`).toString("base64");
        req.headers.Authorization = `Basic ${basic}`;
        const u = new URL(req.url);
        u.host = `${v.subdomain}.zendesk.com`;
        req.setUrl(u.toString());
      }
    }),
    async identify(http) {
      const me = await http.get("/api/v2/users/me.json");
      return {
        accountId: String(me.user.id),
        ...me.user.email !== void 0 ? { email: me.user.email } : {},
        ...me.user.name !== void 0 ? { label: me.user.name } : {}
      };
    }
  });
}
var init_provider18 = __esm({
  "packages/connectors/src/providers/zendesk/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/zendesk/toolkit.ts
import { z as z29 } from "zod";
function ticketSummary(t) {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    createdAt: t.created_at,
    updatedAt: t.updated_at
  };
}
var zendeskToolkit;
var init_toolkit14 = __esm({
  "packages/connectors/src/providers/zendesk/toolkit.ts"() {
    "use strict";
    init_authoring();
    zendeskToolkit = defineToolkit({
      id: "zendesk",
      providerId: "zendesk",
      displayName: "Zendesk",
      actions: [
        httpAction({
          id: "zendesk.search",
          description: "Search Zendesk (tickets, users, orgs) with a query string.",
          input: z29.object({ query: z29.string() }),
          request: (i) => ({ method: "GET", path: "/api/v2/search.json", query: { query: i.query } }),
          output: (raw) => {
            const r = raw;
            return { results: r.results ?? [], count: r.count };
          }
        }),
        httpAction({
          id: "zendesk.list_tickets",
          description: "List recent tickets.",
          input: z29.object({}),
          request: () => ({ method: "GET", path: "/api/v2/tickets.json" }),
          output: (raw) => {
            const r = raw;
            return { tickets: (r.tickets ?? []).map(ticketSummary) };
          }
        }),
        httpAction({
          id: "zendesk.get_ticket",
          description: "Get a single ticket by id.",
          input: z29.object({ id: z29.union([z29.string(), z29.number()]) }),
          request: (i) => ({ method: "GET", path: `/api/v2/tickets/${encodeURIComponent(String(i.id))}.json` }),
          output: (raw) => ticketSummary(raw.ticket ?? {})
        }),
        httpAction({
          id: "zendesk.create_ticket",
          description: "Create a ticket with a subject and an initial comment body.",
          mutating: true,
          risk: "medium",
          input: z29.object({ subject: z29.string(), body: z29.string(), priority: z29.enum(["low", "normal", "high", "urgent"]).optional() }),
          request: (i) => ({
            method: "POST",
            path: "/api/v2/tickets.json",
            body: { ticket: { subject: i.subject, comment: { body: i.body }, ...i.priority ? { priority: i.priority } : {} } }
          }),
          output: (raw) => ticketSummary(raw.ticket ?? {})
        }),
        httpAction({
          id: "zendesk.add_comment",
          description: "Add a comment to an existing ticket (public by default).",
          mutating: true,
          risk: "medium",
          input: z29.object({
            id: z29.union([z29.string(), z29.number()]),
            body: z29.string(),
            public: z29.boolean().default(true)
          }),
          request: (i) => ({
            method: "PUT",
            path: `/api/v2/tickets/${encodeURIComponent(String(i.id))}.json`,
            body: { ticket: { comment: { body: i.body, public: i.public } } }
          }),
          output: (raw) => ticketSummary(raw.ticket ?? {})
        })
      ]
    });
  }
});

// packages/connectors/src/providers/zendesk/index.ts
function registerZendesk(registry) {
  registry.addBundle({ provider: zendesk(), toolkits: [zendeskToolkit] });
}
var init_zendesk = __esm({
  "packages/connectors/src/providers/zendesk/index.ts"() {
    "use strict";
    init_provider18();
    init_toolkit14();
  }
});

// packages/connectors/src/providers/dropbox/provider.ts
function dropbox(options = {}) {
  return defineProvider({
    id: "dropbox",
    displayName: "Dropbox",
    baseUrl: "https://api.dropboxapi.com/2",
    auth: oauth2({
      authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
      tokenUrl: "https://api.dropboxapi.com/oauth2/token",
      revokeUrl: "https://api.dropboxapi.com/2/auth/token/revoke",
      usePkce: true,
      authParams: { token_access_type: "offline" },
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    revokeUrl: "https://api.dropboxapi.com/2/auth/token/revoke",
    async identify(http) {
      const me = await http.post("/users/get_current_account");
      const accountId = me.account_id ?? me.email;
      if (!accountId) throw new Error("dropbox identify: get_current_account returned no id");
      return {
        accountId,
        ...me.email !== void 0 ? { email: me.email } : {},
        label: me.name?.display_name ?? me.email ?? accountId
      };
    }
  });
}
var DROPBOX_SCOPES;
var init_provider19 = __esm({
  "packages/connectors/src/providers/dropbox/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    DROPBOX_SCOPES = {
      accountRead: "account_info.read",
      filesMetadataRead: "files.metadata.read",
      filesContentRead: "files.content.read",
      filesContentWrite: "files.content.write"
    };
  }
});

// packages/connectors/src/providers/dropbox/toolkit.ts
import { z as z30 } from "zod";
var dropboxToolkit;
var init_toolkit15 = __esm({
  "packages/connectors/src/providers/dropbox/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_provider19();
    dropboxToolkit = defineToolkit({
      id: "dropbox",
      providerId: "dropbox",
      displayName: "Dropbox",
      actions: [
        httpAction({
          id: "dropbox.list_folder",
          description: 'List the entries in a Dropbox folder (root is the empty string "").',
          scopes: [DROPBOX_SCOPES.filesMetadataRead],
          input: z30.object({
            path: z30.string().default("").describe('Folder path, e.g. "/Documents" ("" = root)'),
            recursive: z30.boolean().default(false)
          }),
          request: (i) => ({ method: "POST", path: "/files/list_folder", body: { path: i.path, recursive: i.recursive } }),
          output: (raw) => {
            const r = raw;
            return { entries: r.entries ?? [], cursor: r.cursor, hasMore: !!r.has_more };
          }
        }),
        httpAction({
          id: "dropbox.search",
          description: "Search files and folders by name/content.",
          scopes: [DROPBOX_SCOPES.filesMetadataRead],
          input: z30.object({ query: z30.string(), maxResults: z30.number().int().positive().max(1e3).default(25) }),
          request: (i) => ({
            method: "POST",
            path: "/files/search_v2",
            body: { query: i.query, options: { max_results: i.maxResults } }
          }),
          output: (raw) => {
            const r = raw;
            return { matches: r.matches ?? [] };
          }
        }),
        httpAction({
          id: "dropbox.get_metadata",
          description: "Get metadata for a file or folder by path.",
          scopes: [DROPBOX_SCOPES.filesMetadataRead],
          input: z30.object({ path: z30.string() }),
          request: (i) => ({ method: "POST", path: "/files/get_metadata", body: { path: i.path } })
        }),
        httpAction({
          id: "dropbox.create_folder",
          description: "Create a folder at the given path.",
          mutating: true,
          risk: "medium",
          scopes: [DROPBOX_SCOPES.filesContentWrite],
          input: z30.object({ path: z30.string().describe('Full path of the new folder, e.g. "/New Folder"') }),
          request: (i) => ({ method: "POST", path: "/files/create_folder_v2", body: { path: i.path } }),
          output: (raw) => {
            const r = raw;
            return { id: r.metadata?.id, path: r.metadata?.path_display };
          }
        }),
        httpAction({
          id: "dropbox.delete",
          description: "Delete a file or folder at the given path.",
          mutating: true,
          risk: "high",
          scopes: [DROPBOX_SCOPES.filesContentWrite],
          input: z30.object({ path: z30.string() }),
          request: (i) => ({ method: "POST", path: "/files/delete_v2", body: { path: i.path } }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/dropbox/index.ts
function registerDropbox(registry, options = {}) {
  registry.addBundle({ provider: dropbox(options), toolkits: [dropboxToolkit] });
}
var init_dropbox = __esm({
  "packages/connectors/src/providers/dropbox/index.ts"() {
    "use strict";
    init_provider19();
    init_toolkit15();
  }
});

// packages/connectors/src/providers/box/provider.ts
function box(options = {}) {
  return defineProvider({
    id: "box",
    displayName: "Box",
    baseUrl: "https://api.box.com/2.0",
    identityScopes: [],
    revokeUrl: BOX_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: "https://account.box.com/api/oauth2/authorize",
      tokenUrl: "https://api.box.com/oauth2/token",
      revokeUrl: BOX_REVOKE_URL,
      usePkce: false,
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const me = await http.get("/users/me");
      const accountId = String(me.id);
      return {
        accountId,
        ...me.login !== void 0 ? { email: me.login } : {},
        label: me.name ?? me.login ?? accountId
      };
    }
  });
}
var BOX_REVOKE_URL;
var init_provider20 = __esm({
  "packages/connectors/src/providers/box/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    BOX_REVOKE_URL = "https://api.box.com/oauth2/revoke";
  }
});

// packages/connectors/src/providers/box/toolkit.ts
import { z as z31 } from "zod";
function itemSummary(i) {
  return {
    id: i.id,
    name: i.name,
    type: i.type,
    ...i.size !== void 0 ? { size: i.size } : {},
    ...i.modified_at !== void 0 ? { modifiedAt: i.modified_at } : {}
  };
}
var boxToolkit;
var init_toolkit16 = __esm({
  "packages/connectors/src/providers/box/toolkit.ts"() {
    "use strict";
    init_authoring();
    boxToolkit = defineToolkit({
      id: "box",
      providerId: "box",
      displayName: "Box",
      actions: [
        httpAction({
          id: "box.list_folder_items",
          description: 'List the files and folders inside a Box folder (root folder id is "0").',
          input: z31.object({ folderId: z31.string().default("0") }),
          request: (i) => ({ method: "GET", path: `/folders/${encodeURIComponent(i.folderId)}/items` }),
          output: (raw) => {
            const r = raw;
            return { entries: (r.entries ?? []).map(itemSummary) };
          }
        }),
        httpAction({
          id: "box.get_file",
          description: "Get a Box file\u2019s metadata by id.",
          input: z31.object({ fileId: z31.string() }),
          request: (i) => ({ method: "GET", path: `/files/${encodeURIComponent(i.fileId)}` }),
          output: (raw) => itemSummary(raw)
        }),
        httpAction({
          id: "box.search",
          description: "Search Box for files and folders by keyword.",
          input: z31.object({ query: z31.string() }),
          request: (i) => ({ method: "GET", path: "/search", query: { query: i.query } }),
          output: (raw) => {
            const r = raw;
            return { entries: (r.entries ?? []).map(itemSummary) };
          }
        }),
        httpAction({
          id: "box.create_folder",
          description: "Create a new folder in Box (defaults to the root folder).",
          mutating: true,
          risk: "medium",
          input: z31.object({ name: z31.string(), parentId: z31.string().default("0") }),
          request: (i) => ({ method: "POST", path: "/folders", body: { name: i.name, parent: { id: i.parentId } } }),
          output: (raw) => itemSummary(raw)
        }),
        httpAction({
          id: "box.delete_file",
          description: "Permanently delete a Box file by id.",
          mutating: true,
          risk: "high",
          input: z31.object({ fileId: z31.string() }),
          request: (i) => ({ method: "DELETE", path: `/files/${encodeURIComponent(i.fileId)}` }),
          output: () => ({ deleted: true })
        })
      ]
    });
  }
});

// packages/connectors/src/providers/box/index.ts
function registerBox(registry, options = {}) {
  registry.addBundle({ provider: box(options), toolkits: [boxToolkit] });
}
var init_box = __esm({
  "packages/connectors/src/providers/box/index.ts"() {
    "use strict";
    init_provider20();
    init_toolkit16();
  }
});

// packages/connectors/src/providers/quickbooks/provider.ts
function quickbooks(options = {}) {
  return defineProvider({
    id: "quickbooks",
    displayName: "QuickBooks",
    // No baseUrl — the API base is per-company (built from a realmId in each action).
    // `offline_access` guarantees a refresh token; `openid` identifies the Intuit user.
    identityScopes: ["openid", "offline_access"],
    revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    auth: oauth2({
      authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      usePkce: false,
      tokenAuthMethod: "client_secret_basic",
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    // The realmId (company id) arrives on the OAuth callback, not from an API call: read it from
    // the callback params and bind it to the connection so actions never carry it as input.
    // eslint-disable-next-line @typescript-eslint/require-await
    async identify(_http, ctx) {
      const realmId = ctx.params?.realmId;
      if (!realmId) {
        throw new Error("quickbooks identify: missing realmId callback param (Intuit returns it on the redirect)");
      }
      return { accountId: realmId, label: `QuickBooks company ${realmId}`, config: { realmId } };
    },
    // identify needs a connect-time callback param it can't have at probe time, so declare an
    // explicit health check: a real read of the company info against the stored realmId.
    async healthCheck(http, { config }) {
      const realmId = String(config.realmId);
      await http.get(`https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`, {
        headers: { Accept: "application/json" }
      });
    }
  });
}
var init_provider21 = __esm({
  "packages/connectors/src/providers/quickbooks/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
  }
});

// packages/connectors/src/providers/quickbooks/toolkit.ts
import { z as z32 } from "zod";
function base3(config) {
  return `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(String(config.realmId))}`;
}
var SCOPE3, JSON_HEADERS, quickbooksToolkit;
var init_toolkit17 = __esm({
  "packages/connectors/src/providers/quickbooks/toolkit.ts"() {
    "use strict";
    init_authoring();
    SCOPE3 = "com.intuit.quickbooks.accounting";
    JSON_HEADERS = { Accept: "application/json" };
    quickbooksToolkit = defineToolkit({
      id: "quickbooks",
      providerId: "quickbooks",
      displayName: "QuickBooks",
      actions: [
        httpAction({
          id: "quickbooks.query",
          description: 'Run a QuickBooks SQL-like query (e.g. "SELECT * FROM Customer MAXRESULTS 20").',
          scopes: [SCOPE3],
          input: z32.object({
            query: z32.string().describe("Intuit query, e.g. SELECT * FROM Customer MAXRESULTS 20")
          }),
          request: (i, { config }) => ({ method: "GET", path: `${base3(config)}/query`, query: { query: i.query }, headers: JSON_HEADERS }),
          output: (raw) => {
            const r = raw;
            return r.QueryResponse ?? raw;
          }
        }),
        httpAction({
          id: "quickbooks.get_customer",
          description: "Get a QuickBooks customer by id.",
          scopes: [SCOPE3],
          input: z32.object({ id: z32.string() }),
          request: (i, { config }) => ({ method: "GET", path: `${base3(config)}/customer/${encodeURIComponent(i.id)}`, headers: JSON_HEADERS }),
          output: (raw) => {
            const r = raw;
            return r.Customer ?? raw;
          }
        }),
        httpAction({
          id: "quickbooks.list_invoices",
          description: "List recent QuickBooks invoices.",
          scopes: [SCOPE3],
          input: z32.object({}),
          request: (_i, { config }) => ({
            method: "GET",
            path: `${base3(config)}/query`,
            query: { query: "SELECT * FROM Invoice MAXRESULTS 20" },
            headers: JSON_HEADERS
          }),
          output: (raw) => {
            const r = raw;
            return r.QueryResponse ?? raw;
          }
        }),
        httpAction({
          id: "quickbooks.get_company_info",
          description: "Get the QuickBooks company (organization) info.",
          scopes: [SCOPE3],
          input: z32.object({}),
          request: (_i, { config }) => ({
            method: "GET",
            path: `${base3(config)}/companyinfo/${encodeURIComponent(String(config.realmId))}`,
            headers: JSON_HEADERS
          }),
          output: (raw) => {
            const r = raw;
            return r.CompanyInfo ?? raw;
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/quickbooks/index.ts
function registerQuickbooks(registry, options = {}) {
  registry.addBundle({ provider: quickbooks(options), toolkits: [quickbooksToolkit] });
}
var init_quickbooks = __esm({
  "packages/connectors/src/providers/quickbooks/index.ts"() {
    "use strict";
    init_provider21();
    init_toolkit17();
  }
});

// packages/connectors/src/providers/resend/provider.ts
function resend() {
  return defineProvider({
    id: "resend",
    displayName: "Resend",
    baseUrl: "https://api.resend.com",
    auth: apiKey({ prefix: "Bearer " }),
    async healthCheck(http) {
      await http.get("/domains");
    }
  });
}
var init_provider22 = __esm({
  "packages/connectors/src/providers/resend/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/resend/emails.ts
import { z as z33 } from "zod";
var recipients, resendEmails;
var init_emails = __esm({
  "packages/connectors/src/providers/resend/emails.ts"() {
    "use strict";
    init_authoring();
    recipients = z33.union([z33.string(), z33.array(z33.string())]);
    resendEmails = defineToolkit({
      id: "resend",
      providerId: "resend",
      displayName: "Resend",
      actions: [
        httpAction({
          id: "resend.send_email",
          description: "Send a transactional email via Resend.",
          mutating: true,
          risk: "medium",
          input: z33.object({
            from: z33.string().describe('Sender, e.g. "Acme <hi@acme.com>" (a verified Resend domain)'),
            to: recipients,
            subject: z33.string(),
            html: z33.string().optional(),
            text: z33.string().optional(),
            cc: recipients.optional(),
            bcc: recipients.optional(),
            replyTo: z33.string().optional()
          }),
          request: (i) => ({
            method: "POST",
            path: "/emails",
            body: {
              from: i.from,
              to: i.to,
              subject: i.subject,
              ...i.html !== void 0 ? { html: i.html } : {},
              ...i.text !== void 0 ? { text: i.text } : {},
              ...i.cc !== void 0 ? { cc: i.cc } : {},
              ...i.bcc !== void 0 ? { bcc: i.bcc } : {},
              ...i.replyTo !== void 0 ? { reply_to: i.replyTo } : {}
            }
          }),
          output: (raw) => {
            const r = raw;
            return { id: r.id };
          }
        }),
        httpAction({
          id: "resend.get_email",
          description: "Get a previously sent email by id.",
          input: z33.object({ id: z33.string() }),
          request: (i) => ({ method: "GET", path: `/emails/${encodeURIComponent(i.id)}` }),
          output: (raw) => {
            const r = raw;
            return { id: r.id, from: r.from, to: r.to, subject: r.subject, last_event: r.last_event };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/resend/index.ts
function registerResend(registry) {
  registry.addBundle({ provider: resend(), toolkits: [resendEmails] });
}
var init_resend = __esm({
  "packages/connectors/src/providers/resend/index.ts"() {
    "use strict";
    init_provider22();
    init_emails();
  }
});

// packages/connectors/src/providers/mailgun/provider.ts
function mailgun(options = {}) {
  const baseUrl = options.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  return defineProvider({
    id: "mailgun",
    displayName: "Mailgun",
    baseUrl,
    auth: custom({
      secretFields: ["api_key"],
      apply: (req, v) => {
        req.headers.Authorization = `Basic ${Buffer.from(`api:${v.api_key}`).toString("base64")}`;
      }
    }),
    async healthCheck(http) {
      await http.get("/v4/domains");
    }
  });
}
var init_provider23 = __esm({
  "packages/connectors/src/providers/mailgun/provider.ts"() {
    "use strict";
    init_direct();
    init_authoring();
  }
});

// packages/connectors/src/providers/mailgun/messages.ts
import { z as z34 } from "zod";
var recipients2, join4, mailgunMessages;
var init_messages = __esm({
  "packages/connectors/src/providers/mailgun/messages.ts"() {
    "use strict";
    init_authoring();
    recipients2 = z34.union([z34.string(), z34.array(z34.string())]);
    join4 = (r) => Array.isArray(r) ? r.join(",") : r;
    mailgunMessages = defineToolkit({
      id: "mailgun",
      providerId: "mailgun",
      displayName: "Mailgun",
      actions: [
        httpAction({
          id: "mailgun.send_message",
          description: "Send a transactional email via Mailgun.",
          mutating: true,
          risk: "medium",
          input: z34.object({
            domain: z34.string().describe("Your Mailgun sending domain, e.g. mg.acme.com"),
            from: z34.string().describe('Sender, e.g. "Acme <postmaster@mg.acme.com>"'),
            to: recipients2,
            subject: z34.string(),
            text: z34.string().optional(),
            html: z34.string().optional(),
            cc: recipients2.optional(),
            bcc: recipients2.optional()
          }),
          request: (i) => {
            const form = new URLSearchParams();
            form.set("from", i.from);
            form.set("to", join4(i.to));
            form.set("subject", i.subject);
            if (i.text !== void 0) form.set("text", i.text);
            if (i.html !== void 0) form.set("html", i.html);
            if (i.cc !== void 0) form.set("cc", join4(i.cc));
            if (i.bcc !== void 0) form.set("bcc", join4(i.bcc));
            return {
              method: "POST",
              path: `/v3/${encodeURIComponent(i.domain)}/messages`,
              rawBody: form.toString(),
              contentType: "application/x-www-form-urlencoded"
            };
          },
          output: (raw) => {
            const r = raw;
            return { id: r.id, message: r.message };
          }
        })
      ]
    });
  }
});

// packages/connectors/src/providers/mailgun/index.ts
function registerMailgun(registry, options = {}) {
  registry.addBundle({ provider: mailgun(options), toolkits: [mailgunMessages] });
}
var init_mailgun = __esm({
  "packages/connectors/src/providers/mailgun/index.ts"() {
    "use strict";
    init_provider23();
    init_messages();
  }
});

// packages/connectors/src/providers/twitter/provider.ts
function twitter(options = {}) {
  return defineProvider({
    id: "twitter",
    displayName: "X (Twitter)",
    baseUrl: "https://api.x.com",
    // Always requested: identify() needs users.read; tweet.read is the baseline read scope; and
    // offline.access is required for X to mint a refresh token (the engine's auto-refresh needs it).
    identityScopes: ["users.read", "tweet.read", "offline.access"],
    revokeUrl: REVOKE_URL,
    auth: oauth2({
      authorizationUrl: "https://x.com/i/oauth2/authorize",
      tokenUrl: "https://api.x.com/2/oauth2/token",
      revokeUrl: REVOKE_URL,
      usePkce: true,
      // X confidential clients send client credentials as HTTP Basic on the token endpoint.
      tokenAuthMethod: "client_secret_basic",
      ...options.fetch ? { fetch: options.fetch } : {}
    }),
    async identify(http) {
      const res = await http.get("/2/users/me");
      const u = res.data;
      if (!u?.id) throw new Error("twitter identify: /2/users/me returned no id");
      return {
        accountId: u.id,
        label: u.username ? `@${u.username}` : u.name ?? u.id
      };
    }
  });
}
var REVOKE_URL;
var init_provider24 = __esm({
  "packages/connectors/src/providers/twitter/provider.ts"() {
    "use strict";
    init_oauth2();
    init_authoring();
    REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
  }
});

// packages/connectors/src/mcp/json-schema.ts
import { z as z35 } from "zod";
function asSchema(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
function describe(zt, node) {
  const d = node.description;
  return typeof d === "string" && d ? zt.describe(d) : zt;
}
function typeOf(node) {
  const t = node.type;
  return Array.isArray(t) ? t[0] : t;
}
function nodeToZod(node) {
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const lits = node.enum.map((v) => z35.literal(v));
    const u = lits.length === 1 ? lits[0] : z35.union(lits);
    return describe(u, node);
  }
  if ("const" in node) return describe(z35.literal(node.const), node);
  switch (typeOf(node)) {
    case "string":
      return describe(z35.string(), node);
    case "integer":
    case "number":
      return describe(z35.number(), node);
    case "boolean":
      return describe(z35.boolean(), node);
    case "null":
      return describe(z35.null(), node);
    case "array": {
      const items = asSchema(node.items);
      return describe(z35.array(items ? nodeToZod(items) : z35.unknown()), node);
    }
    case "object":
      return describe(objectToZod(node), node);
    default:
      return describe(z35.unknown(), node);
  }
}
function objectToZod(node) {
  const props = asSchema(node.properties) ?? {};
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const shape = {};
  for (const [key, raw] of Object.entries(props)) {
    const sub = asSchema(raw);
    let zt = sub ? nodeToZod(sub) : z35.unknown();
    if (!required.has(key)) zt = zt.optional();
    shape[key] = zt;
  }
  return z35.object(shape).passthrough();
}
function jsonSchemaToZodObject(schema) {
  const node = asSchema(schema);
  if (!node) return z35.object({}).passthrough();
  if (typeOf(node) === "object" || node.properties) return objectToZod(node);
  return z35.object({}).passthrough();
}
var init_json_schema = __esm({
  "packages/connectors/src/mcp/json-schema.ts"() {
    "use strict";
  }
});

// packages/connectors/src/providers/twitter/operations.generated.ts
var TWITTER_OPS;
var init_operations_generated = __esm({
  "packages/connectors/src/providers/twitter/operations.generated.ts"() {
    "use strict";
    TWITTER_OPS = [
      { "id": "twitter.add_chat_group_members", "operationId": "addChatGroupMembers", "method": "POST", "path": "/2/chat/conversations/{id}/members", "description": "Add members to a Chat group conversation", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["action_signatures", "conversation_key_version", "conversation_participant_keys", "encrypted_avatar_url", "encrypted_title", "user_ids"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "action_signatures": { "description": "Cryptographic signatures for the add-members action.", "type": "array", "items": { "description": "Cryptographic signature for a chat action.", "type": "object", "properties": { "encoded_message_event_detail": { "description": "Base64-encoded message event detail.", "type": "string" }, "message_event_signature": { "description": "Message event signature for verification.", "type": "object", "properties": { "message_signing_key_info_list": { "description": "List of signing key information for message verification.", "type": "array" }, "public_key_version": { "description": "The version of the public key used for signing.", "type": "string" }, "signature": { "description": "The signature of the message event.", "type": "string" }, "signature_version": { "description": "The version of the signature algorithm.", "type": "string" }, "signing_public_key": { "description": "The public key used for signing.", "type": "string" } } }, "message_id": { "description": "ID of the message being signed.", "type": "string" }, "signature_payload": { "description": "Cryptographic signature payload.", "type": "string" } } } }, "conversation_key_version": { "description": "Version of the new rotated conversation key.", "type": "string" }, "conversation_participant_keys": { "description": "Encrypted conversation keys for each new participant after key rotation.", "type": "array", "items": { "description": "A participant's encrypted conversation key.", "type": "object", "properties": { "encrypted_conversation_key": { "description": "Conversation key encrypted with this participant's public key.", "type": "string" }, "public_key_version": { "description": "Version of the participant's public key used for encryption.", "type": "string" }, "user_id": { "description": "Participant user ID.", "type": "string" } } } }, "encrypted_avatar_url": { "description": "Re-encrypted group avatar URL with new conversation key.", "type": "string" }, "encrypted_title": { "description": "Re-encrypted group title with new conversation key.", "type": "string" }, "user_ids": { "description": "List of user IDs to add to the group conversation.", "type": "array", "items": { "description": "User ID to add.", "type": "string" } } }, "required": ["id", "user_ids"] } },
      { "id": "twitter.add_lists_member", "operationId": "addListsMember", "method": "POST", "path": "/2/lists/{id}/members", "description": "Add List member", "tags": ["Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["user_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "user_id"] } },
      { "id": "twitter.add_user_public_key", "operationId": "addUserPublicKey", "method": "POST", "path": "/2/users/{id}/public_keys", "description": "Add public key", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["generate_version", "public_key", "version"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "generate_version": { "description": "When true, the server generates a new version.", "type": "boolean" }, "public_key": { "description": "Public key registration payload.", "type": "object", "properties": { "identity_public_key_signature": { "description": "Signature over the identity public key.", "type": "string" }, "public_key": { "description": "Identity public key (base64 encoded).", "type": "string" }, "public_key_fingerprint": { "description": "Fingerprint of the identity public key.", "type": "string" }, "registration_method": { "description": "Registration method for the public key.", "type": "string" }, "signing_public_key": { "description": "Signing public key (base64 encoded).", "type": "string" }, "signing_public_key_signature": { "description": "Signature over the signing public key.", "type": "string" } } }, "version": { "description": "Public key version.", "type": "string" } }, "required": ["id", "public_key", "version"] } },
      { "id": "twitter.append_media_upload", "operationId": "appendMediaUpload", "method": "POST", "path": "/2/media/upload/{id}/append", "description": "Append Media upload", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["body"], "bodyRoot": true, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Media.", "type": "string" }, "body": {} }, "required": ["id"] } },
      { "id": "twitter.article_create_draft", "operationId": "articleCreateDraft", "method": "POST", "path": "/2/articles/draft", "description": "Create draft Article", "tags": ["Articles"], "scopes": ["tweet.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["content_state", "cover_media", "title"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "content_state": { "description": "DraftJS content state representing the article body.", "type": "object", "properties": { "blocks": { "description": "The text blocks that make up the article body.", "type": "array", "items": { "description": "A DraftJS content block.", "type": "object", "properties": { "data": { "description": "Block-level metadata for mentions, hashtags, cashtags, and URLs.", "type": "object" }, "entity_ranges": { "description": "References to entries in entities.", "type": "array" }, "inline_style_ranges": { "description": "Inline formatting ranges.", "type": "array" }, "key": { "description": "Optional block key.", "type": "string" }, "text": { "description": "The text content of this block.", "type": "string" }, "type": { "description": "The block type.", "enum": ["unstyled", "header-one", "header-two", "header-three", "unordered-list-item", "ordered-list-item", "blockquote", "atomic"] } }, "required": ["text", "type"] } }, "entities": { "description": "Non-text entities referenced by blocks (links, embedded posts, images).", "type": "array", "items": { "type": "object", "properties": { "key": { "description": "The entity key referenced by entity_ranges.", "type": "string" }, "value": { "type": "object" } }, "required": ["key", "value"] } } }, "required": ["blocks", "entities"] }, "cover_media": { "description": "A reference to uploaded media, identified by category and ID.", "type": "object", "properties": { "media_category": { "description": "The media category (e.g., TWEET_IMAGE).", "type": "string" }, "media_id": { "description": "The media ID from the media upload endpoint.", "type": "string" } }, "required": ["media_category", "media_id"] }, "title": { "description": "The title of the article.", "type": "string" } }, "required": ["title", "content_state"] } },
      { "id": "twitter.article_publish", "operationId": "articlePublish", "method": "POST", "path": "/2/articles/{article_id}/publish", "description": "Publish Article", "tags": ["Articles"], "scopes": ["tweet.write"], "mutating": true, "risk": "medium", "pathParams": ["article_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "article_id": { "type": "string", "description": "The ID of the draft article to publish." } }, "required": ["article_id"] } },
      { "id": "twitter.block_users_dms", "operationId": "blockUsersDms", "method": "POST", "path": "/2/users/{id}/dm/block", "description": "Block DMs", "tags": ["Users"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.chat_media_download", "operationId": "chatMediaDownload", "method": "GET", "path": "/2/chat/media/{id}/{media_hash_key}", "description": "Download Chat Media", "tags": ["Chat"], "scopes": ["media.write"], "mutating": false, "risk": "low", "pathParams": ["id", "media_hash_key"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "media_hash_key": { "description": "The media hash key returned from the upload initialize step. Alphanumeric characters only.", "type": "string" } }, "required": ["id", "media_hash_key"] } },
      { "id": "twitter.chat_media_upload_append", "operationId": "chatMediaUploadAppend", "method": "POST", "path": "/2/chat/media/upload/{id}/append", "description": "Append Chat Media Upload", "tags": ["Chat"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["body"], "bodyRoot": true, "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "The session/resume id from initialize." }, "body": {} }, "required": ["id", "body"] } },
      { "id": "twitter.chat_media_upload_finalize", "operationId": "chatMediaUploadFinalize", "method": "POST", "path": "/2/chat/media/upload/{id}/finalize", "description": "Finalize Chat Media Upload", "tags": ["Chat"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["conversation_id", "media_hash_key", "message_id", "num_parts", "ttl_msec"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "The session/resume id from initialize." }, "conversation_id": { "description": "XChat conversation identifier for the upload.", "type": "string" }, "media_hash_key": { "description": "Media hash key returned from initialize.", "type": "string" }, "message_id": { "description": "Optional message identifier associated with the upload.", "type": "string" }, "num_parts": { "description": "Total number of uploaded parts as a numeric string.", "type": "string" }, "ttl_msec": { "description": "Optional TTL for the media in milliseconds.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.chat_media_upload_initialize", "operationId": "chatMediaUploadInitialize", "method": "POST", "path": "/2/chat/media/upload/initialize", "description": "Initialize Chat Media Upload", "tags": ["Chat"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["conversation_id", "total_bytes"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "conversation_id": { "description": "XChat conversation identifier for the upload.", "type": "string" }, "total_bytes": { "description": "Total size of the media upload in bytes.", "type": "integer" } }, "required": [] } },
      { "id": "twitter.create_chat_conversation", "operationId": "createChatConversation", "method": "POST", "path": "/2/chat/conversations/group", "description": "Create Chat Group Conversation", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["action_signatures", "base64_encoded_key_rotation", "conversation_id", "conversation_key_version", "conversation_participant_keys", "group_admins", "group_avatar_url", "group_description", "group_members", "group_name", "ttl_msec"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "action_signatures": { "description": "Cryptographic signatures for the create action.", "type": "array", "items": { "description": "Cryptographic signature for a chat action.", "type": "object", "properties": { "encoded_message_event_detail": { "description": "Base64-encoded message event detail.", "type": "string" }, "message_event_signature": { "description": "Message event signature for verification.", "type": "object", "properties": { "message_signing_key_info_list": { "description": "List of signing key information for message verification.", "type": "array" }, "public_key_version": { "description": "The version of the public key used for signing.", "type": "string" }, "signature": { "description": "The signature of the message event.", "type": "string" }, "signature_version": { "description": "The version of the signature algorithm.", "type": "string" }, "signing_public_key": { "description": "The public key used for signing.", "type": "string" } } }, "message_id": { "description": "ID of the message being signed.", "type": "string" }, "signature_payload": { "description": "Cryptographic signature payload.", "type": "string" } } } }, "base64_encoded_key_rotation": { "description": "Base64-encoded key rotation payload.", "type": "string" }, "conversation_id": { "description": "Client-generated conversation ID.", "type": "string" }, "conversation_key_version": { "description": "Version of the conversation encryption key.", "type": "string" }, "conversation_participant_keys": { "description": "Encrypted conversation keys for each participant.", "type": "array", "items": { "description": "A participant's encrypted conversation key.", "type": "object", "properties": { "encrypted_conversation_key": { "description": "Conversation key encrypted with this participant's public key.", "type": "string" }, "public_key_version": { "description": "Version of the participant's public key used for encryption.", "type": "string" }, "user_id": { "description": "Participant user ID.", "type": "string" } } } }, "group_admins": { "description": "User IDs of group admins. Defaults to the creator if omitted.", "type": "array", "items": { "description": "User ID.", "type": "string" } }, "group_avatar_url": { "description": "URL of the avatar image for the group conversation.", "type": "string" }, "group_description": { "description": "Description for the group conversation.", "type": "string" }, "group_members": { "description": "User IDs of group members to include in the conversation.", "type": "array", "items": { "description": "User ID.", "type": "string" } }, "group_name": { "description": "Display name for the group conversation.", "type": "string" }, "ttl_msec": { "description": "Message time-to-live in milliseconds. Messages expire after this duration.", "type": "string" } }, "required": ["conversation_id", "conversation_key_version", "conversation_participant_keys", "group_members"] } },
      { "id": "twitter.create_community_notes", "operationId": "createCommunityNotes", "method": "POST", "path": "/2/notes", "description": "Create a Community Note", "tags": ["Community Notes"], "scopes": ["tweet.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["info", "post_id", "test_mode"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "info": { "description": "A X Community Note is a note on a Post.", "type": "object", "properties": { "classification": { "description": "Community Note classification type.", "enum": ["misinformed_or_potentially_misleading", "not_misleading"] }, "is_media_note": { "description": "Whether the note is a media note.", "type": "boolean" }, "misleading_tags": { "type": "array", "items": { "description": "Community Note misleading tags type.", "enum": ["disputed_claim_as_fact", "factual_error", "manipulated_media", "misinterpreted_satire", "missing_important_context", "other", "outdated_information"] } }, "text": { "description": "The text summary in the Community Note.", "type": "string" }, "trustworthy_sources": { "description": "Whether the note provided trustworthy links.", "type": "boolean" } }, "required": ["text", "classification", "misleading_tags", "trustworthy_sources"] }, "post_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "test_mode": { "description": "If true, the note being submitted is only for testing the capability of the bot, and won't be publicly visible. If false, the note being submitted will be a new proposed note on the product.", "type": "boolean" } }, "required": ["test_mode", "post_id", "info"] } },
      { "id": "twitter.create_compliance_jobs", "operationId": "createComplianceJobs", "method": "POST", "path": "/2/compliance/jobs", "description": "Create Compliance Job", "tags": ["Compliance"], "scopes": [], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["name", "resumable", "type"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "name": { "description": "User-provided name for a compliance job.", "type": "string" }, "resumable": { "description": "If true, this endpoint will return a pre-signed URL with resumable uploads enabled.", "type": "boolean" }, "type": { "description": "Type of compliance job to list.", "enum": ["tweets", "users"] } }, "required": ["type"] } },
      { "id": "twitter.create_direct_messages_by_conversation_id", "operationId": "createDirectMessagesByConversationId", "method": "POST", "path": "/2/dm_conversations/{dm_conversation_id}/messages", "description": "Create DM message by conversation ID", "tags": ["Direct Messages"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["dm_conversation_id"], "bodyParams": ["body"], "bodyRoot": true, "inputSchema": { "type": "object", "properties": { "dm_conversation_id": { "type": "string", "description": "The DM Conversation ID." }, "body": {} }, "required": ["dm_conversation_id"] } },
      { "id": "twitter.create_direct_messages_by_participant_id", "operationId": "createDirectMessagesByParticipantId", "method": "POST", "path": "/2/dm_conversations/with/{participant_id}/messages", "description": "Create DM message by participant ID", "tags": ["Direct Messages"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["participant_id"], "bodyParams": ["body"], "bodyRoot": true, "inputSchema": { "type": "object", "properties": { "participant_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "body": {} }, "required": ["participant_id"] } },
      { "id": "twitter.create_direct_messages_conversation", "operationId": "createDirectMessagesConversation", "method": "POST", "path": "/2/dm_conversations", "description": "Create DM conversation", "tags": ["Direct Messages"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["conversation_type", "message", "participant_ids"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "conversation_type": { "description": "The conversation type that is being created.", "enum": ["Group"] }, "message": {}, "participant_ids": { "description": "Participants for the DM Conversation.", "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } } }, "required": ["conversation_type", "participant_ids", "message"] } },
      { "id": "twitter.create_lists", "operationId": "createLists", "method": "POST", "path": "/2/lists", "description": "Create List", "tags": ["Lists"], "scopes": ["list.read", "list.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["description", "name", "private"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "description": { "type": "string" }, "name": { "type": "string" }, "private": { "type": "boolean" } }, "required": ["name"] } },
      { "id": "twitter.create_media_metadata", "operationId": "createMediaMetadata", "method": "POST", "path": "/2/media/metadata", "description": "Create Media metadata", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["id", "metadata"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Media.", "type": "string" }, "metadata": { "type": "object", "properties": { "allow_download_status": { "type": "object", "properties": { "allow_download": { "type": "boolean" } } }, "alt_text": { "type": "object", "properties": { "text": { "description": "Description of media ( <= 1000 characters )", "type": "string" } }, "required": ["text"] }, "audience_policy": { "type": "object", "properties": { "creator_subscriptions": { "type": "array", "items": { "enum": ["Any"] } }, "x_subscriptions": { "type": "array", "items": { "enum": ["Any"] } } } }, "content_expiration": { "type": "object", "properties": { "timestamp_sec": { "description": "Expiration time for content as a Unix timestamp in seconds", "type": "number" } }, "required": ["timestamp_sec"] }, "domain_restrictions": { "type": "object", "properties": { "whitelist": { "description": "List of whitelisted domains", "type": "array", "items": { "type": "string" } } }, "required": ["whitelist"] }, "found_media_origin": { "type": "object", "properties": { "id": { "description": "Unique Identifier of media within provider ( <= 24 characters ))", "type": "string" }, "provider": { "description": "The media provider (e.g., 'giphy') that sourced the media ( <= 8 Characters )", "type": "string" } }, "required": ["provider", "id"] }, "geo_restrictions": {}, "management_info": { "type": "object", "properties": { "managed": { "description": "Indicates if the media is managed by Media Studio", "type": "boolean" } }, "required": ["managed"] }, "preview_image": { "type": "object", "properties": { "media_key": { "type": "object", "properties": { "media": { "description": "The unique identifier of this Media.", "type": "string" }, "media_category": { "description": "The media category of media", "enum": ["TweetImage"] } } } }, "required": ["media_key"] }, "sensitive_media_warning": { "type": "object", "properties": { "adult_content": { "description": "Indicates if the content contains adult material", "type": "boolean" }, "graphic_violence": { "description": "Indicates if the content depicts graphic violence", "type": "boolean" }, "other": { "description": "Indicates if the content has other sensitive characteristics", "type": "boolean" } } }, "shared_info": { "type": "object", "properties": { "shared": { "description": "Indicates if the media is shared in direct messages", "type": "boolean" } }, "required": ["shared"] }, "sticker_info": { "type": "object", "properties": { "stickers": { "description": "Stickers list must not be empty and should not exceed 25", "type": "array", "items": { "type": "object" } } }, "required": ["stickers"] }, "upload_source": { "type": "object", "properties": { "upload_source": { "description": "Records the source (e.g., app, device) from which the media was uploaded", "type": "string" } }, "required": ["upload_source"] } } } }, "required": ["id"] } },
      { "id": "twitter.create_media_subtitles", "operationId": "createMediaSubtitles", "method": "POST", "path": "/2/media/subtitles", "description": "Create Media subtitles", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["id", "media_category", "subtitles"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Media.", "type": "string" }, "media_category": { "description": "The media category of uploaded media to which subtitles should be added/deleted", "enum": ["AmplifyVideo", "TweetVideo"] }, "subtitles": { "type": "object", "properties": { "display_name": { "description": "Language name in a human readable form", "type": "string" }, "id": { "description": "The unique identifier of this Media.", "type": "string" }, "language_code": { "description": `The language code should be a BCP47 code (e.g. 'EN", "SP")`, "type": "string" } } } }, "required": [] } },
      { "id": "twitter.create_posts", "operationId": "createPosts", "method": "POST", "path": "/2/tweets", "description": "Create or Edit Post", "tags": ["Tweets"], "scopes": ["tweet.read", "tweet.write", "users.read"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["card_uri", "community_id", "direct_message_deep_link", "edit_options", "for_super_followers_only", "geo", "made_with_ai", "media", "nullcast", "paid_partnership", "poll", "quote_tweet_id", "reply", "reply_settings", "share_with_followers", "text"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "card_uri": { "description": "Card Uri Parameter. This is mutually exclusive from Quote Tweet Id, Poll, Media, and Direct Message Deep Link.", "type": "string" }, "community_id": { "description": "The unique identifier of this Community.", "type": "string" }, "direct_message_deep_link": { "description": "Link to take the conversation from the public timeline to a private Direct Message.", "type": "string" }, "edit_options": { "description": "Options for editing an existing Post. When provided, this request will edit the specified Post instead of creating a new one.", "type": "object", "properties": { "previous_post_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["previous_post_id"] }, "for_super_followers_only": { "description": "Exclusive Tweet for super followers.", "type": "boolean" }, "geo": { "description": "Place ID being attached to the Tweet for geo location.", "type": "object", "properties": { "place_id": { "type": "string" } } }, "made_with_ai": { "description": "Whether this Post contains AI-generated media. When true, the Post will be labeled accordingly.", "type": "boolean" }, "media": { "description": "Media information being attached to created Tweet. This is mutually exclusive from Quote Tweet Id, Poll, and Card URI.", "type": "object", "properties": { "call_to_actions": { "description": "Call-to-action button rendered on the media entity. Exactly one variant should be set.", "type": "object", "properties": { "app_install": { "description": "App Install CTA. At least one store id should be provided.", "type": "object", "properties": { "app_store_id": { "description": "Apple App Store iPhone app id.", "type": "string" }, "ipad_app_store_id": { "description": "Apple App Store iPad app id.", "type": "string" }, "play_store_id": { "description": "Google Play Store app id.", "type": "string" } } }, "visit_site": { "description": "Visit Site CTA.", "type": "object", "properties": { "url": { "description": "HTTPS URL the CTA links to.", "type": "string" } }, "required": ["url"] }, "watch_now": { "description": "Watch Now CTA.", "type": "object", "properties": { "url": { "description": "HTTPS URL the CTA links to.", "type": "string" } }, "required": ["url"] } } }, "description": { "description": "Description for the media. Rendered on the Post card for video and Amplify content.", "type": "string" }, "embeddable": { "description": "When true, the media's asset URLs do not expire and external syndicated playback is allowed.", "type": "boolean" }, "media_ids": { "description": "A list of Media Ids to be attached to a created Tweet.", "type": "array", "items": { "description": "The unique identifier of this Media.", "type": "string" } }, "preview_media_id": { "description": "The unique identifier of this Media.", "type": "string" }, "tagged_user_ids": { "description": "A list of User Ids to be tagged in the media for created Tweet.", "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "title": { "description": "Title for the media. Rendered on the Post card for video and Amplify content.", "type": "string" } }, "required": ["media_ids"] }, "nullcast": { "description": "Nullcasted (promoted-only) Posts do not appear in the public timeline and are not served to followers.", "type": "boolean" }, "paid_partnership": { "description": "Whether this Post is a paid partnership. When true, the Post will be labeled as a paid promotion.", "type": "boolean" }, "poll": { "description": "Poll options for a Tweet with a poll. This is mutually exclusive from Media, Quote Tweet Id, and Card URI.", "type": "object", "properties": { "duration_minutes": { "description": "Duration of the poll in minutes.", "type": "integer" }, "options": { "type": "array", "items": { "description": "The text of a poll choice.", "type": "string" } }, "reply_settings": { "description": "Settings to indicate who can reply to the Tweet.", "enum": ["following", "mentionedUsers", "subscribers", "verified"] } }, "required": ["options", "duration_minutes"] }, "quote_tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "reply": { "description": "Tweet information of the Tweet being replied to.", "type": "object", "properties": { "auto_populate_reply_metadata": { "description": "If set to true, reply metadata will be automatically populated.", "type": "boolean" }, "exclude_reply_user_ids": { "description": "A list of User Ids to be excluded from the reply Tweet.", "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "in_reply_to_tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["in_reply_to_tweet_id"] }, "reply_settings": { "description": "Settings to indicate who can reply to the Tweet.", "enum": ["following", "mentionedUsers", "subscribers", "verified"] }, "share_with_followers": { "description": "Share community post with followers too.", "type": "boolean" }, "text": { "description": "The content of the Tweet.", "type": "string" } }, "required": [] } },
      { "id": "twitter.create_users_bookmark", "operationId": "createUsersBookmark", "method": "POST", "path": "/2/users/{id}/bookmarks", "description": "Create Bookmark", "tags": ["Users", "Bookmarks"], "scopes": ["bookmark.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["tweet_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "tweet_id"] } },
      { "id": "twitter.delete_activity_subscription", "operationId": "deleteActivitySubscription", "method": "DELETE", "path": "/2/activity/subscriptions/{subscription_id}", "description": "Deletes X activity subscription", "tags": ["Activity"], "scopes": [], "mutating": true, "risk": "high", "pathParams": ["subscription_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "subscription_id": { "description": "The unique identifier of this subscription.", "type": "string" } }, "required": ["subscription_id"] } },
      { "id": "twitter.delete_activity_subscriptions_by_ids", "operationId": "deleteActivitySubscriptionsByIds", "method": "DELETE", "path": "/2/activity/subscriptions", "description": "Delete X activity subscriptions by IDs", "tags": ["Activity"], "scopes": [], "mutating": true, "risk": "high", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "The unique identifier of this subscription.", "type": "string" }, "description": "Comma-separated list of subscription IDs to delete." } }, "required": ["ids"] } },
      { "id": "twitter.delete_all_connections", "operationId": "deleteAllConnections", "method": "DELETE", "path": "/2/connections/all", "description": "Terminate all connections", "tags": ["Connections"], "scopes": [], "mutating": true, "risk": "high", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": {}, "required": [] } },
      { "id": "twitter.delete_community_notes", "operationId": "deleteCommunityNotes", "method": "DELETE", "path": "/2/notes/{id}", "description": "Delete a Community Note", "tags": ["Community Notes"], "scopes": ["tweet.write"], "mutating": true, "risk": "high", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Community Note.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.delete_connections_by_endpoint", "operationId": "deleteConnectionsByEndpoint", "method": "DELETE", "path": "/2/connections/{endpoint_id}", "description": "Terminate connections by endpoint", "tags": ["Connections"], "scopes": [], "mutating": true, "risk": "high", "pathParams": ["endpoint_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "endpoint_id": { "enum": ["filtered_stream", "sample_stream", "sample10_stream", "firehose_stream", "tweets_compliance_stream", "users_compliance_stream", "tweet_label_stream", "firehose_stream_lang_en", "firehose_stream_lang_ja", "firehose_stream_lang_ko", "firehose_stream_lang_pt", "likes_firehose_stream", "likes_sample10_stream", "likes_compliance_stream"], "description": "The endpoint ID to terminate connections for." } }, "required": ["endpoint_id"] } },
      { "id": "twitter.delete_connections_by_uuids", "operationId": "deleteConnectionsByUuids", "method": "DELETE", "path": "/2/connections", "description": "Terminate multiple connections", "tags": ["Connections"], "scopes": [], "mutating": true, "risk": "high", "pathParams": [], "bodyParams": ["uuids"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "uuids": { "description": "Array of connection UUIDs to terminate", "type": "array", "items": { "type": "string" } } }, "required": ["uuids"] } },
      { "id": "twitter.delete_direct_messages_events", "operationId": "deleteDirectMessagesEvents", "method": "DELETE", "path": "/2/dm_events/{event_id}", "description": "Delete DM event", "tags": ["Direct Messages"], "scopes": ["dm.read", "dm.write"], "mutating": true, "risk": "high", "pathParams": ["event_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "event_id": { "description": "Unique identifier of a DM Event.", "type": "string" } }, "required": ["event_id"] } },
      { "id": "twitter.delete_lists", "operationId": "deleteLists", "method": "DELETE", "path": "/2/lists/{id}", "description": "Delete List", "tags": ["Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.delete_media_subtitles", "operationId": "deleteMediaSubtitles", "method": "DELETE", "path": "/2/media/subtitles", "description": "Delete Media subtitles", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "high", "pathParams": [], "bodyParams": ["id", "language_code", "media_category"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Media.", "type": "string" }, "language_code": { "description": `The language code should be a BCP47 code (e.g. 'EN", "SP")`, "type": "string" }, "media_category": { "description": "The media category of uploaded media to which subtitles should be added/deleted", "enum": ["AmplifyVideo", "TweetVideo"] } }, "required": [] } },
      { "id": "twitter.delete_posts", "operationId": "deletePosts", "method": "DELETE", "path": "/2/tweets/{id}", "description": "Delete Post", "tags": ["Tweets"], "scopes": ["tweet.read", "tweet.write", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.delete_users_bookmark", "operationId": "deleteUsersBookmark", "method": "DELETE", "path": "/2/users/{id}/bookmarks/{tweet_id}", "description": "Delete Bookmark", "tags": ["Users", "Bookmarks"], "scopes": ["bookmark.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "tweet_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "tweet_id"] } },
      { "id": "twitter.dm_conversations_media_download", "operationId": "dmConversationsMediaDownload", "method": "GET", "path": "/2/dm_conversations/media/{dm_id}/{media_id}/{resource_id}", "description": "Download DM Media", "tags": ["Direct Messages"], "scopes": ["dm.read"], "mutating": false, "risk": "low", "pathParams": ["dm_id", "media_id", "resource_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "dm_id": { "description": "Unique identifier of a DM Event.", "type": "string" }, "media_id": { "description": "The unique identifier of this Media.", "type": "string" }, "resource_id": { "description": "The resource identifier of the media file, including file extension.", "type": "string" } }, "required": ["dm_id", "media_id", "resource_id"] } },
      { "id": "twitter.evaluate_community_notes", "operationId": "evaluateCommunityNotes", "method": "POST", "path": "/2/evaluate_note", "description": "Evaluate a Community Note", "tags": ["Community Notes"], "scopes": ["tweet.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["note_text", "post_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "note_text": { "description": "Text for the community note.", "type": "string" }, "post_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["post_id", "note_text"] } },
      { "id": "twitter.finalize_media_upload", "operationId": "finalizeMediaUpload", "method": "POST", "path": "/2/media/upload/{id}/finalize", "description": "Finalize Media upload", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Media.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.follow_list", "operationId": "followList", "method": "POST", "path": "/2/users/{id}/followed_lists", "description": "Follow List", "tags": ["Users", "Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["list_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "list_id": { "description": "The unique identifier of this List.", "type": "string" } }, "required": ["id", "list_id"] } },
      { "id": "twitter.follow_user", "operationId": "followUser", "method": "POST", "path": "/2/users/{id}/following", "description": "Follow User", "tags": ["Users"], "scopes": ["follows.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["target_user_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "target_user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "target_user_id"] } },
      { "id": "twitter.get_account_activity_subscription_count", "operationId": "getAccountActivitySubscriptionCount", "method": "GET", "path": "/2/account_activity/subscriptions/count", "description": "Get subscription count", "tags": ["Account Activity"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": {}, "required": [] } },
      { "id": "twitter.get_activity_subscriptions", "operationId": "getActivitySubscriptions", "method": "GET", "path": "/2/activity/subscriptions", "description": "Get X activity subscriptions", "tags": ["Activity"], "scopes": ["like.read", "tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "max_results": { "type": "integer", "description": "The maximum number of results to return per page. Defaults to 1000 when unspecified; use pagination_token (from response meta.next_token) to fetch additional pages." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" } }, "required": [] } },
      { "id": "twitter.get_chat_conversation", "operationId": "getChatConversation", "method": "GET", "path": "/2/chat/conversations/{id}", "description": "Get Chat Conversation", "tags": ["Chat"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "The conversation ID. For 1:1 conversations, use the recipient user ID or dash-separated canonical ID. For group conversations, use the group ID (prefixed with 'g')." }, "chat_conversation.fields": { "description": "The fields available for a ChatConversation object.", "type": "array", "items": { "enum": ["admin_ids", "created_at", "group_avatar_url", "group_name", "id", "is_muted", "member_ids", "message_ttl_msec", "participant_ids", "screen_capture_blocking_enabled", "screen_capture_detection_enabled", "type", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [ChatConversation](#ChatConversation) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["admin_ids", "member_ids", "participant_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_chat_conversation_events", "operationId": "getChatConversationEvents", "method": "GET", "path": "/2/chat/conversations/{id}/events", "description": "Get Chat Conversation Events", "tags": ["Chat"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "max_results": { "type": "integer", "description": "Maximum number of message events to return." }, "pagination_token": { "type": "string", "description": "Token for pagination to retrieve the next page of results." }, "chat_message_event.fields": { "description": "The fields available for a ChatMessageEvent object.", "type": "array", "items": { "enum": ["conversation_id", "conversation_token", "created_at_msec", "encoded_event", "id", "is_trusted", "message_event_signature", "previous_id", "sender_id"] } } }, "required": ["id"] } },
      { "id": "twitter.get_chat_conversations", "operationId": "getChatConversations", "method": "GET", "path": "/2/chat/conversations", "description": "Get Chat Conversations", "tags": ["Chat"], "scopes": ["dm.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "max_results": { "type": "integer", "description": "Maximum number of conversations to return." }, "pagination_token": { "type": "string", "description": "Token for pagination to retrieve the next page of results." }, "chat_conversation.fields": { "description": "The fields available for a ChatConversation object.", "type": "array", "items": { "enum": ["admin_ids", "created_at", "group_avatar_url", "group_name", "id", "is_muted", "member_ids", "message_ttl_msec", "participant_ids", "screen_capture_blocking_enabled", "screen_capture_detection_enabled", "type", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [ChatConversation](#ChatConversation) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["admin_ids", "member_ids", "participant_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": [] } },
      { "id": "twitter.get_communities_by_id", "operationId": "getCommunitiesById", "method": "GET", "path": "/2/communities/{id}", "description": "Get Community by ID", "tags": ["Communities"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Community.", "type": "string" }, "community.fields": { "description": "The fields available for a Community object.", "type": "array", "items": { "enum": ["access", "created_at", "description", "id", "join_policy", "member_count", "name"] } } }, "required": ["id"] } },
      { "id": "twitter.get_compliance_jobs", "operationId": "getComplianceJobs", "method": "GET", "path": "/2/compliance/jobs", "description": "Get Compliance Jobs", "tags": ["Compliance"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "type": { "enum": ["tweets", "users"], "description": "Type of Compliance Job to list." }, "status": { "enum": ["created", "in_progress", "failed", "complete"], "description": "Status of Compliance Job to list." }, "compliance_job.fields": { "description": "The fields available for a ComplianceJob object.", "type": "array", "items": { "enum": ["created_at", "download_expires_at", "download_url", "id", "name", "resumable", "status", "type", "upload_expires_at", "upload_url"] } } }, "required": ["type"] } },
      { "id": "twitter.get_compliance_jobs_by_id", "operationId": "getComplianceJobsById", "method": "GET", "path": "/2/compliance/jobs/{id}", "description": "Get Compliance Job by ID", "tags": ["Compliance"], "scopes": [], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Compliance Job ID.", "type": "string" }, "compliance_job.fields": { "description": "The fields available for a ComplianceJob object.", "type": "array", "items": { "enum": ["created_at", "download_expires_at", "download_url", "id", "name", "resumable", "status", "type", "upload_expires_at", "upload_url"] } } }, "required": ["id"] } },
      { "id": "twitter.get_connection_history", "operationId": "getConnectionHistory", "method": "GET", "path": "/2/connections", "description": "Get Connection History", "tags": ["Connections"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "status": { "enum": ["active", "inactive", "all"], "description": "Filter by connection status. Use 'active' for current connections, 'inactive' for historical/disconnected connections, or 'all' for both." }, "endpoints": { "type": "array", "items": { "enum": ["filtered_stream", "sample_stream", "sample10_stream", "firehose_stream", "tweets_compliance_stream", "users_compliance_stream", "tweet_label_stream", "firehose_stream_lang_en", "firehose_stream_lang_ja", "firehose_stream_lang_ko", "firehose_stream_lang_pt", "likes_firehose_stream", "likes_sample10_stream", "likes_compliance_stream"] }, "description": "Filter by streaming endpoint. Specify one or more endpoint names to filter results." }, "max_results": { "type": "integer", "description": "The maximum number of results to return per page." }, "pagination_token": { "type": "string", "description": "Token for paginating through results. Use the value from 'next_token' in the previous response." }, "connection.fields": { "description": "The fields available for a Connection object.", "type": "array", "items": { "enum": ["client_ip", "connected_at", "disconnect_reason", "disconnected_at", "endpoint_name", "id"] } } }, "required": [] } },
      { "id": "twitter.get_direct_messages_events", "operationId": "getDirectMessagesEvents", "method": "GET", "path": "/2/dm_events", "description": "Get DM events", "tags": ["Direct Messages"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "event_types": { "type": "array", "items": { "enum": ["MessageCreate", "ParticipantsJoin", "ParticipantsLeave"] }, "description": "The set of event_types to include in the results." }, "dm_event.fields": { "description": "The fields available for a DmEvent object.", "type": "array", "items": { "enum": ["attachments", "created_at", "dm_conversation_id", "entities", "event_type", "id", "participant_ids", "referenced_tweets", "sender_id", "text"] } }, "expansions": { "description": "The list of fields you can expand for a [DmEvent](#DmEvent) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["attachments.media_keys", "participant_ids", "referenced_tweets.id", "sender_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": [] } },
      { "id": "twitter.get_direct_messages_events_by_conversation_id", "operationId": "getDirectMessagesEventsByConversationId", "method": "GET", "path": "/2/dm_conversations/{id}/dm_events", "description": "Get DM events for a DM conversation", "tags": ["Direct Messages"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of a DM conversation. This can either be a numeric string, or a pair of numeric strings separated by a '-' character in the case of one-on-one DM Conversations.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "event_types": { "type": "array", "items": { "enum": ["MessageCreate", "ParticipantsJoin", "ParticipantsLeave"] }, "description": "The set of event_types to include in the results." }, "dm_event.fields": { "description": "The fields available for a DmEvent object.", "type": "array", "items": { "enum": ["attachments", "created_at", "dm_conversation_id", "entities", "event_type", "id", "participant_ids", "referenced_tweets", "sender_id", "text"] } }, "expansions": { "description": "The list of fields you can expand for a [DmEvent](#DmEvent) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["attachments.media_keys", "participant_ids", "referenced_tweets.id", "sender_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_direct_messages_events_by_id", "operationId": "getDirectMessagesEventsById", "method": "GET", "path": "/2/dm_events/{event_id}", "description": "Get DM event by ID", "tags": ["Direct Messages"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["event_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "event_id": { "description": "Unique identifier of a DM Event.", "type": "string" }, "dm_event.fields": { "description": "The fields available for a DmEvent object.", "type": "array", "items": { "enum": ["attachments", "created_at", "dm_conversation_id", "entities", "event_type", "id", "participant_ids", "referenced_tweets", "sender_id", "text"] } }, "expansions": { "description": "The list of fields you can expand for a [DmEvent](#DmEvent) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["attachments.media_keys", "participant_ids", "referenced_tweets.id", "sender_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["event_id"] } },
      { "id": "twitter.get_direct_messages_events_by_participant_id", "operationId": "getDirectMessagesEventsByParticipantId", "method": "GET", "path": "/2/dm_conversations/with/{participant_id}/dm_events", "description": "Get DM events for a DM conversation", "tags": ["Direct Messages"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["participant_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "participant_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "event_types": { "type": "array", "items": { "enum": ["MessageCreate", "ParticipantsJoin", "ParticipantsLeave"] }, "description": "The set of event_types to include in the results." }, "dm_event.fields": { "description": "The fields available for a DmEvent object.", "type": "array", "items": { "enum": ["attachments", "created_at", "dm_conversation_id", "entities", "event_type", "id", "participant_ids", "referenced_tweets", "sender_id", "text"] } }, "expansions": { "description": "The list of fields you can expand for a [DmEvent](#DmEvent) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["attachments.media_keys", "participant_ids", "referenced_tweets.id", "sender_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["participant_id"] } },
      { "id": "twitter.get_insights_historical", "operationId": "getInsightsHistorical", "method": "GET", "path": "/2/insights/historical", "description": "Get historical Post insights", "tags": ["Tweets"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "tweet_ids": { "type": "array", "items": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "List of PostIds for historical metrics." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the end of the time range." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the start of the time range." }, "granularity": { "enum": ["Daily", "Hourly", "Weekly", "Total"], "description": "granularity of metrics response." }, "requested_metrics": { "type": "array", "items": { "enum": ["AppInstallAttempts", "AppOpens", "DetailExpands", "EmailTweet", "Engagements", "Follows", "HashtagClicks", "Impressions", "Likes", "LinkClicks", "MediaEngagements", "MediaViews", "PermalinkClicks", "ProfileVisits", "QuoteTweets", "Replies", "Retweets", "UniqueVideoViews", "UrlClicks", "UserProfileClicks", "VideoCompletions", "VideoPlayed25Percent", "VideoPlayed50Percent", "VideoPlayed75Percent", "VideoStarts", "VideoViews"] }, "description": "request metrics for historical request." }, "engagement.fields": { "description": "The fields available for a Engagement object.", "type": "array", "items": { "enum": ["errors", "measurement"] } } }, "required": ["tweet_ids", "end_time", "start_time", "granularity", "requested_metrics"] } },
      { "id": "twitter.get_insights28_hr", "operationId": "getInsights28Hr", "method": "GET", "path": "/2/insights/28hr", "description": "Get 28-hour Post insights", "tags": ["Tweets"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "tweet_ids": { "type": "array", "items": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "List of PostIds for 28hr metrics." }, "granularity": { "enum": ["Daily", "Hourly", "Weekly", "Total"], "description": "granularity of metrics response." }, "requested_metrics": { "type": "array", "items": { "enum": ["AppInstallAttempts", "AppOpens", "DetailExpands", "EmailTweet", "Engagements", "Follows", "HashtagClicks", "Impressions", "Likes", "LinkClicks", "MediaEngagements", "MediaViews", "PermalinkClicks", "ProfileVisits", "QuoteTweets", "Replies", "Retweets", "UniqueVideoViews", "UrlClicks", "UserProfileClicks", "VideoCompletions", "VideoPlayed25Percent", "VideoPlayed50Percent", "VideoPlayed75Percent", "VideoStarts", "VideoViews"] }, "description": "request metrics for historical request." }, "engagement.fields": { "description": "The fields available for a Engagement object.", "type": "array", "items": { "enum": ["errors", "measurement"] } } }, "required": ["tweet_ids", "granularity", "requested_metrics"] } },
      { "id": "twitter.get_lists_by_id", "operationId": "getListsById", "method": "GET", "path": "/2/lists/{id}", "description": "Get List by ID", "tags": ["Lists"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "list.fields": { "description": "The fields available for a List object.", "type": "array", "items": { "enum": ["created_at", "description", "follower_count", "id", "member_count", "name", "owner_id", "private"] } }, "expansions": { "description": "The list of fields you can expand for a [List](#List) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["owner_id"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_lists_followers", "operationId": "getListsFollowers", "method": "GET", "path": "/2/lists/{id}/followers", "description": "Get List followers", "tags": ["Lists", "Users"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_lists_members", "operationId": "getListsMembers", "method": "GET", "path": "/2/lists/{id}/members", "description": "Get List members", "tags": ["Lists", "Users"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_lists_posts", "operationId": "getListsPosts", "method": "GET", "path": "/2/lists/{id}/tweets", "description": "Get List Posts", "tags": ["Lists", "Tweets"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_media_analytics", "operationId": "getMediaAnalytics", "method": "GET", "path": "/2/media/analytics", "description": "Get Media analytics", "tags": ["Media"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "media_keys": { "type": "array", "items": { "description": "The Media Key identifier for this attachment.", "type": "string" }, "description": "A comma separated list of Media Keys. Up to 100 are allowed in a single request." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the end of the time range." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the start of the time range." }, "granularity": { "enum": ["hourly", "daily", "total"], "description": "The granularity for the search counts results." }, "media_analytics.fields": { "description": "The fields available for a MediaAnalytics object.", "type": "array", "items": { "enum": ["cta_url_clicks", "cta_watch_clicks", "media_key", "play_from_tap", "playback25", "playback50", "playback75", "playback_complete", "playback_start", "timestamp", "video_views", "watch_time_ms"] } } }, "required": ["media_keys", "end_time", "start_time", "granularity"] } },
      { "id": "twitter.get_media_by_media_key", "operationId": "getMediaByMediaKey", "method": "GET", "path": "/2/media/{media_key}", "description": "Get Media by media key", "tags": ["Media"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": ["media_key"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "media_key": { "description": "The Media Key identifier for this attachment.", "type": "string" }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } } }, "required": ["media_key"] } },
      { "id": "twitter.get_media_by_media_keys", "operationId": "getMediaByMediaKeys", "method": "GET", "path": "/2/media", "description": "Get Media by media keys", "tags": ["Media"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "media_keys": { "type": "array", "items": { "description": "The Media Key identifier for this attachment.", "type": "string" }, "description": "A comma separated list of Media Keys. Up to 100 are allowed in a single request." }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } } }, "required": ["media_keys"] } },
      { "id": "twitter.get_media_upload_status", "operationId": "getMediaUploadStatus", "method": "GET", "path": "/2/media/upload", "description": "Get Media upload status", "tags": ["Media"], "scopes": ["media.write"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "media_id": { "description": "The unique identifier of this Media.", "type": "string" }, "command": { "enum": ["STATUS"], "description": "The command for the media upload request." } }, "required": ["media_id"] } },
      { "id": "twitter.get_news", "operationId": "getNews", "method": "GET", "path": "/2/news/{id}", "description": "Get news stories by ID", "tags": ["News"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of news story.", "type": "string" }, "news.fields": { "description": "The fields available for a News object.", "type": "array", "items": { "enum": ["category", "cluster_posts_results", "contexts", "disclaimer", "hook", "id", "keywords", "name", "summary", "updated_at"] } } }, "required": ["id"] } },
      { "id": "twitter.get_open_api_spec", "operationId": "getOpenApiSpec", "method": "GET", "path": "/2/openapi.json", "description": "Get OpenAPI Spec.", "tags": ["General"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": {}, "required": [] } },
      { "id": "twitter.get_posts_analytics", "operationId": "getPostsAnalytics", "method": "GET", "path": "/2/tweets/analytics", "description": "Get Post analytics", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "A comma separated list of Post IDs. Up to 100 are allowed in a single request." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the end of the time range." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The UTC timestamp representing the start of the time range." }, "granularity": { "enum": ["hourly", "daily", "weekly", "total"], "description": "The granularity for the search counts results." }, "analytics.fields": { "description": "The fields available for a Analytics object.", "type": "array", "items": { "enum": ["app_install_attempts", "app_opens", "bookmarks", "detail_expands", "email_tweet", "engagements", "follows", "hashtag_clicks", "id", "impressions", "likes", "media_views", "permalink_clicks", "quote_tweets", "replies", "retweets", "shares", "timestamp", "unfollows", "unlikes", "url_clicks", "user_profile_clicks"] } } }, "required": ["ids", "end_time", "start_time", "granularity"] } },
      { "id": "twitter.get_posts_by_id", "operationId": "getPostsById", "method": "GET", "path": "/2/tweets/{id}", "description": "Get Post by ID", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_posts_by_ids", "operationId": "getPostsByIds", "method": "GET", "path": "/2/tweets", "description": "Get Posts by IDs", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "A comma separated list of Post IDs. Up to 100 are allowed in a single request." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["ids"] } },
      { "id": "twitter.get_posts_counts_all", "operationId": "getPostsCountsAll", "method": "GET", "path": "/2/tweets/counts/all", "description": "Get count of all Posts", "tags": ["Tweets"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "One query/rule/filter for matching Posts. Refer to https://t.co/rulelength to identify the max query length." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The oldest UTC timestamp from which the Posts will be provided. Timestamp is in second granularity and is inclusive (i.e. 12:00:01 includes the first second of the minute)." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The newest, most recent UTC timestamp to which the Posts will be provided. Timestamp is in second granularity and is exclusive (i.e. 12:00:01 excludes the first second of the minute)." }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "next_token": { "description": "A base36 pagination token.", "type": "string" }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "granularity": { "enum": ["minute", "hour", "day"], "description": "The granularity for the search counts results." }, "search_count.fields": { "description": "The fields available for a SearchCount object.", "type": "array", "items": { "enum": ["end", "start", "tweet_count"] } } }, "required": ["query"] } },
      { "id": "twitter.get_posts_counts_recent", "operationId": "getPostsCountsRecent", "method": "GET", "path": "/2/tweets/counts/recent", "description": "Get count of recent Posts", "tags": ["Tweets"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "One query/rule/filter for matching Posts. Refer to https://t.co/rulelength to identify the max query length." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The oldest UTC timestamp (from most recent 7 days) from which the Posts will be provided. Timestamp is in second granularity and is inclusive (i.e. 12:00:01 includes the first second of the minute)." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The newest, most recent UTC timestamp to which the Posts will be provided. Timestamp is in second granularity and is exclusive (i.e. 12:00:01 excludes the first second of the minute)." }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "next_token": { "description": "A base36 pagination token.", "type": "string" }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "granularity": { "enum": ["minute", "hour", "day"], "description": "The granularity for the search counts results." }, "search_count.fields": { "description": "The fields available for a SearchCount object.", "type": "array", "items": { "enum": ["end", "start", "tweet_count"] } } }, "required": ["query"] } },
      { "id": "twitter.get_posts_liking_users", "operationId": "getPostsLikingUsers", "method": "GET", "path": "/2/tweets/{id}/liking_users", "description": "Get Liking Users", "tags": ["Tweets", "Users"], "scopes": ["like.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_posts_quoted_posts", "operationId": "getPostsQuotedPosts", "method": "GET", "path": "/2/tweets/{id}/quote_tweets", "description": "Get Quoted Posts", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results to be returned." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "exclude": { "type": "array", "items": { "enum": ["replies", "retweets"] }, "description": "The set of entities to exclude (e.g. 'replies' or 'retweets')." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_posts_reposted_by", "operationId": "getPostsRepostedBy", "method": "GET", "path": "/2/tweets/{id}/retweeted_by", "description": "Get Reposted by", "tags": ["Tweets", "Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_posts_reposts", "operationId": "getPostsReposts", "method": "GET", "path": "/2/tweets/{id}/retweets", "description": "Get Reposts", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_spaces_buyers", "operationId": "getSpacesBuyers", "method": "GET", "path": "/2/spaces/{id}/buyers", "description": "Get Space ticket buyers", "tags": ["Spaces", "Tweets"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Space.", "type": "string" }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_spaces_by_creator_ids", "operationId": "getSpacesByCreatorIds", "method": "GET", "path": "/2/spaces/by/creator_ids", "description": "Get Spaces by creator IDs", "tags": ["Spaces"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "user_ids": { "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "The IDs of Users to search through." }, "space.fields": { "description": "The fields available for a Space object.", "type": "array", "items": { "enum": ["created_at", "creator_id", "ended_at", "host_ids", "id", "invited_user_ids", "is_ticketed", "lang", "participant_count", "scheduled_start", "speaker_ids", "started_at", "state", "subscriber_count", "title", "topic_ids", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [Space](#Space) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["creator_id", "host_ids", "invited_user_ids", "speaker_ids", "topic_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "topic.fields": { "description": "The fields available for a Topic object.", "type": "array", "items": { "enum": ["description", "id", "name"] } } }, "required": ["user_ids"] } },
      { "id": "twitter.get_spaces_by_id", "operationId": "getSpacesById", "method": "GET", "path": "/2/spaces/{id}", "description": "Get space by ID", "tags": ["Spaces"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Space.", "type": "string" }, "space.fields": { "description": "The fields available for a Space object.", "type": "array", "items": { "enum": ["created_at", "creator_id", "ended_at", "host_ids", "id", "invited_user_ids", "is_ticketed", "lang", "participant_count", "scheduled_start", "speaker_ids", "started_at", "state", "subscriber_count", "title", "topic_ids", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [Space](#Space) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["creator_id", "host_ids", "invited_user_ids", "speaker_ids", "topic_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "topic.fields": { "description": "The fields available for a Topic object.", "type": "array", "items": { "enum": ["description", "id", "name"] } } }, "required": ["id"] } },
      { "id": "twitter.get_spaces_by_ids", "operationId": "getSpacesByIds", "method": "GET", "path": "/2/spaces", "description": "Get Spaces by IDs", "tags": ["Spaces"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "The unique identifier of this Space.", "type": "string" }, "description": "The list of Space IDs to return." }, "space.fields": { "description": "The fields available for a Space object.", "type": "array", "items": { "enum": ["created_at", "creator_id", "ended_at", "host_ids", "id", "invited_user_ids", "is_ticketed", "lang", "participant_count", "scheduled_start", "speaker_ids", "started_at", "state", "subscriber_count", "title", "topic_ids", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [Space](#Space) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["creator_id", "host_ids", "invited_user_ids", "speaker_ids", "topic_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "topic.fields": { "description": "The fields available for a Topic object.", "type": "array", "items": { "enum": ["description", "id", "name"] } } }, "required": ["ids"] } },
      { "id": "twitter.get_spaces_posts", "operationId": "getSpacesPosts", "method": "GET", "path": "/2/spaces/{id}/tweets", "description": "Get Space Posts", "tags": ["Spaces", "Tweets"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this Space.", "type": "string" }, "max_results": { "type": "integer", "description": "The number of Posts to fetch from the provided space. If not provided, the value will default to the maximum of 100." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_trends_by_woeid", "operationId": "getTrendsByWoeid", "method": "GET", "path": "/2/trends/by/woeid/{woeid}", "description": "Get Trends by WOEID", "tags": ["Trends"], "scopes": [], "mutating": false, "risk": "low", "pathParams": ["woeid"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "woeid": { "type": "integer", "description": "The WOEID of the place to lookup a trend for." }, "max_trends": { "type": "integer", "description": "The maximum number of results." }, "trend.fields": { "description": "The fields available for a Trend object.", "type": "array", "items": { "enum": ["trend_name", "tweet_count"] } } }, "required": ["woeid"] } },
      { "id": "twitter.get_trends_personalized_trends", "operationId": "getTrendsPersonalizedTrends", "method": "GET", "path": "/2/users/personalized_trends", "description": "Get personalized Trends", "tags": ["Trends"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "personalized_trend.fields": { "description": "The fields available for a PersonalizedTrend object.", "type": "array", "items": { "enum": ["category", "post_count", "trend_name", "trending_since"] } } }, "required": [] } },
      { "id": "twitter.get_usage", "operationId": "getUsage", "method": "GET", "path": "/2/usage/tweets", "description": "Get usage", "tags": ["Usage"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "days": { "type": "integer", "description": "The number of days for which you need usage for." }, "usage.fields": { "description": "The fields available for a Usage object.", "type": "array", "items": { "enum": ["cap_reset_day", "daily_client_app_usage", "daily_project_usage", "project_cap", "project_id", "project_usage"] } } }, "required": [] } },
      { "id": "twitter.get_users_affiliates", "operationId": "getUsersAffiliates", "method": "GET", "path": "/2/users/{id}/affiliates", "description": "Get affiliates", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_blocking", "operationId": "getUsersBlocking", "method": "GET", "path": "/2/users/{id}/blocking", "description": "Get blocking", "tags": ["Users"], "scopes": ["block.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_bookmark_folders", "operationId": "getUsersBookmarkFolders", "method": "GET", "path": "/2/users/{id}/bookmarks/folders", "description": "Get Bookmark folders", "tags": ["Users", "Bookmarks"], "scopes": ["bookmark.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.get_users_bookmarks", "operationId": "getUsersBookmarks", "method": "GET", "path": "/2/users/{id}/bookmarks", "description": "Get Bookmarks", "tags": ["Users", "Bookmarks"], "scopes": ["bookmark.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_bookmarks_by_folder_id", "operationId": "getUsersBookmarksByFolderId", "method": "GET", "path": "/2/users/{id}/bookmarks/folders/{folder_id}", "description": "Get Bookmarks by folder ID", "tags": ["Users", "Bookmarks"], "scopes": ["bookmark.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id", "folder_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "folder_id": { "description": "The unique identifier of this Bookmark folder.", "type": "string" } }, "required": ["id", "folder_id"] } },
      { "id": "twitter.get_users_by_id", "operationId": "getUsersById", "method": "GET", "path": "/2/users/{id}", "description": "Get User by ID", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_by_ids", "operationId": "getUsersByIds", "method": "GET", "path": "/2/users", "description": "Get Users by IDs", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "A list of User IDs, comma-separated. You can specify up to 100 IDs." }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["ids"] } },
      { "id": "twitter.get_users_by_username", "operationId": "getUsersByUsername", "method": "GET", "path": "/2/users/by/username/{username}", "description": "Get User by username", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["username"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "username": { "type": "string", "description": "A username." }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["username"] } },
      { "id": "twitter.get_users_by_usernames", "operationId": "getUsersByUsernames", "method": "GET", "path": "/2/users/by", "description": "Get Users by usernames", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "usernames": { "type": "array", "items": { "description": "The X handle (screen name) of this User.", "type": "string" }, "description": "A list of usernames, comma-separated." }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["usernames"] } },
      { "id": "twitter.get_users_followed_lists", "operationId": "getUsersFollowedLists", "method": "GET", "path": "/2/users/{id}/followed_lists", "description": "Get followed Lists", "tags": ["Users", "Lists"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "list.fields": { "description": "The fields available for a List object.", "type": "array", "items": { "enum": ["created_at", "description", "follower_count", "id", "member_count", "name", "owner_id", "private"] } }, "expansions": { "description": "The list of fields you can expand for a [List](#List) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["owner_id"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_followers", "operationId": "getUsersFollowers", "method": "GET", "path": "/2/users/{id}/followers", "description": "Get followers", "tags": ["Users"], "scopes": ["follows.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_following", "operationId": "getUsersFollowing", "method": "GET", "path": "/2/users/{id}/following", "description": "Get following", "tags": ["Users"], "scopes": ["follows.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base32 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_liked_posts", "operationId": "getUsersLikedPosts", "method": "GET", "path": "/2/users/{id}/liked_tweets", "description": "Get liked Posts", "tags": ["Users", "Tweets"], "scopes": ["like.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_list_memberships", "operationId": "getUsersListMemberships", "method": "GET", "path": "/2/users/{id}/list_memberships", "description": "Get List memberships", "tags": ["Users", "Lists"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "list.fields": { "description": "The fields available for a List object.", "type": "array", "items": { "enum": ["created_at", "description", "follower_count", "id", "member_count", "name", "owner_id", "private"] } }, "expansions": { "description": "The list of fields you can expand for a [List](#List) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["owner_id"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_me", "operationId": "getUsersMe", "method": "GET", "path": "/2/users/me", "description": "Get my User", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": [] } },
      { "id": "twitter.get_users_mentions", "operationId": "getUsersMentions", "method": "GET", "path": "/2/users/{id}/mentions", "description": "Get mentions", "tags": ["Users", "Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The earliest UTC timestamp from which the Posts will be provided. The since_id parameter takes precedence if it is also specified." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The latest UTC timestamp to which the Posts will be provided. The until_id parameter takes precedence if it is also specified." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_muting", "operationId": "getUsersMuting", "method": "GET", "path": "/2/users/{id}/muting", "description": "Get muting", "tags": ["Users"], "scopes": ["mute.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_owned_lists", "operationId": "getUsersOwnedLists", "method": "GET", "path": "/2/users/{id}/owned_lists", "description": "Get owned Lists", "tags": ["Users", "Lists"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A 'long' pagination token.", "type": "string" }, "list.fields": { "description": "The fields available for a List object.", "type": "array", "items": { "enum": ["created_at", "description", "follower_count", "id", "member_count", "name", "owner_id", "private"] } }, "expansions": { "description": "The list of fields you can expand for a [List](#List) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["owner_id"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_pinned_lists", "operationId": "getUsersPinnedLists", "method": "GET", "path": "/2/users/{id}/pinned_lists", "description": "Get pinned Lists", "tags": ["Users", "Lists"], "scopes": ["list.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "list.fields": { "description": "The fields available for a List object.", "type": "array", "items": { "enum": ["created_at", "description", "follower_count", "id", "member_count", "name", "owner_id", "private"] } }, "expansions": { "description": "The list of fields you can expand for a [List](#List) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["owner_id"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_posts", "operationId": "getUsersPosts", "method": "GET", "path": "/2/users/{id}/tweets", "description": "Get Posts", "tags": ["Users", "Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "exclude": { "type": "array", "items": { "enum": ["replies", "retweets"] }, "description": "The set of entities to exclude (e.g. 'replies' or 'retweets')." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The earliest UTC timestamp from which the Posts will be provided. The since_id parameter takes precedence if it is also specified." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The latest UTC timestamp to which the Posts will be provided. The until_id parameter takes precedence if it is also specified." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_public_key", "operationId": "getUsersPublicKey", "method": "GET", "path": "/2/users/{id}/public_keys", "description": "Get user public keys", "tags": ["Users", "Chat"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "public_key.fields": { "description": "The fields available for a PublicKey object.", "type": "array", "items": { "enum": ["identity_public_key_signature", "juicebox_config", "public_key", "signing_public_key", "version"] } } }, "required": ["id"] } },
      { "id": "twitter.get_users_public_keys", "operationId": "getUsersPublicKeys", "method": "GET", "path": "/2/users/public_keys", "description": "Get public keys for multiple users", "tags": ["Users", "Chat"], "scopes": ["dm.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "description": "A list of User IDs, comma-separated. You can specify up to 100 IDs." }, "public_key.fields": { "description": "The fields available for a PublicKey object.", "type": "array", "items": { "enum": ["identity_public_key_signature", "juicebox_config", "public_key", "signing_public_key", "version"] } } }, "required": ["ids"] } },
      { "id": "twitter.get_users_reposts_of_me", "operationId": "getUsersRepostsOfMe", "method": "GET", "path": "/2/users/reposts_of_me", "description": "Get Reposts of me", "tags": ["Users"], "scopes": ["timeline.read", "tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": [] } },
      { "id": "twitter.get_users_timeline", "operationId": "getUsersTimeline", "method": "GET", "path": "/2/users/{id}/timelines/reverse_chronological", "description": "Get Timeline", "tags": ["Users", "Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "exclude": { "type": "array", "items": { "enum": ["replies", "retweets"] }, "description": "The set of entities to exclude (e.g. 'replies' or 'retweets')." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The earliest UTC timestamp from which the Posts will be provided. The since_id parameter takes precedence if it is also specified." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The latest UTC timestamp to which the Posts will be provided. The until_id parameter takes precedence if it is also specified." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["id"] } },
      { "id": "twitter.hide_posts_reply", "operationId": "hidePostsReply", "method": "PUT", "path": "/2/tweets/{tweet_id}/hidden", "description": "Hide reply", "tags": ["Tweets"], "scopes": ["tweet.moderate.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["tweet_id"], "bodyParams": ["hidden"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "hidden": { "type": "boolean" } }, "required": ["tweet_id", "hidden"] } },
      { "id": "twitter.initialize_chat_conversation_keys", "operationId": "initializeChatConversationKeys", "method": "POST", "path": "/2/chat/conversations/{id}/keys", "description": "Initialize Conversation Keys", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["action_signatures", "base64_encoded_key_rotation", "conversation_key_version", "conversation_participant_keys"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "action_signatures": { "description": "Cryptographic signatures for the key initialization action.", "type": "array", "items": { "description": "Cryptographic signature for a chat action.", "type": "object", "properties": { "encoded_message_event_detail": { "description": "Base64-encoded message event detail.", "type": "string" }, "message_event_signature": { "description": "Message event signature for verification.", "type": "object", "properties": { "message_signing_key_info_list": { "description": "List of signing key information for message verification.", "type": "array" }, "public_key_version": { "description": "The version of the public key used for signing.", "type": "string" }, "signature": { "description": "The signature of the message event.", "type": "string" }, "signature_version": { "description": "The version of the signature algorithm.", "type": "string" }, "signing_public_key": { "description": "The public key used for signing.", "type": "string" } } }, "message_id": { "description": "ID of the message being signed.", "type": "string" }, "signature_payload": { "description": "Cryptographic signature payload.", "type": "string" } } } }, "base64_encoded_key_rotation": { "description": "Base64-encoded key rotation payload for ratchet tree key management.", "type": "string" }, "conversation_key_version": { "description": "Version of the conversation encryption key (typically a timestamp in milliseconds).", "type": "string" }, "conversation_participant_keys": { "description": "The conversation key encrypted for each participant using their public key.", "type": "array", "items": { "description": "A participant's encrypted conversation key.", "type": "object", "properties": { "encrypted_conversation_key": { "description": "Conversation key encrypted with this participant's public key.", "type": "string" }, "public_key_version": { "description": "Version of the participant's public key used for encryption.", "type": "string" }, "user_id": { "description": "Participant user ID.", "type": "string" } } } } }, "required": ["id", "conversation_key_version", "conversation_participant_keys"] } },
      { "id": "twitter.initialize_chat_group", "operationId": "initializeChatGroup", "method": "POST", "path": "/2/chat/conversations/group/initialize", "description": "Initialize Chat Group", "tags": ["Chat"], "scopes": ["dm.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": {}, "required": [] } },
      { "id": "twitter.initialize_media_upload", "operationId": "initializeMediaUpload", "method": "POST", "path": "/2/media/upload/initialize", "description": "Initialize media upload", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["additional_owners", "media_category", "media_type", "shared", "total_bytes"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "additional_owners": { "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "media_category": { "description": "A string enum value which identifies a media use-case. This identifier is used to enforce use-case specific constraints (e.g. file size, video duration) and enable advanced features.", "enum": ["amplify_video", "tweet_gif", "tweet_image", "tweet_video", "dm_gif", "dm_image", "dm_video", "subtitles"] }, "media_type": { "description": "The type of media.", "enum": ["video/mp4", "video/webm", "video/mp2t", "video/quicktime", "text/srt", "text/vtt", "image/jpeg", "image/gif", "image/bmp", "image/png", "image/webp", "image/pjpeg", "image/tiff", "model/gltf-binary", "model/vnd.usdz+zip"] }, "shared": { "description": "Whether this media is shared or not.", "type": "boolean" }, "total_bytes": { "description": "The total size of the media upload in bytes.", "type": "integer" } }, "required": [] } },
      { "id": "twitter.like_post", "operationId": "likePost", "method": "POST", "path": "/2/users/{id}/likes", "description": "Like Post", "tags": ["Users", "Tweets"], "scopes": ["like.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["tweet_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "tweet_id"] } },
      { "id": "twitter.mark_chat_conversation_read", "operationId": "markChatConversationRead", "method": "POST", "path": "/2/chat/conversations/{id}/read", "description": "Mark Conversation as Read", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["seen_until_sequence_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "seen_until_sequence_id": { "description": "The sequence ID of the last message to mark as read up to.", "type": "string" } }, "required": ["id", "seen_until_sequence_id"] } },
      { "id": "twitter.media_upload", "operationId": "mediaUpload", "method": "POST", "path": "/2/media/upload", "description": "Upload media", "tags": ["Media"], "scopes": ["media.write"], "mutating": true, "risk": "medium", "pathParams": [], "bodyParams": ["additional_owners", "media", "media_category", "media_type", "shared"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "additional_owners": { "type": "array", "items": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "media": {}, "media_category": { "description": "A string enum value which identifies a media use-case. This identifier is used to enforce use-case specific constraints (e.g. file size) and enable advanced features.", "enum": ["tweet_image", "dm_image", "subtitles"] }, "media_type": { "description": "The type of image or subtitle.", "enum": ["text/srt", "text/vtt", "image/jpeg", "image/bmp", "image/png", "image/webp", "image/pjpeg", "image/tiff"] }, "shared": { "description": "Whether this media is shared or not.", "type": "boolean" } }, "required": ["media", "media_category"] } },
      { "id": "twitter.mute_user", "operationId": "muteUser", "method": "POST", "path": "/2/users/{id}/muting", "description": "Mute User", "tags": ["Users"], "scopes": ["mute.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["target_user_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "target_user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "target_user_id"] } },
      { "id": "twitter.pin_list", "operationId": "pinList", "method": "POST", "path": "/2/users/{id}/pinned_lists", "description": "Pin List", "tags": ["Users", "Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["list_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "list_id": { "description": "The unique identifier of this List.", "type": "string" } }, "required": ["id", "list_id"] } },
      { "id": "twitter.remove_lists_member_by_user_id", "operationId": "removeListsMemberByUserId", "method": "DELETE", "path": "/2/lists/{id}/members/{user_id}", "description": "Remove List member", "tags": ["Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "user_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "user_id"] } },
      { "id": "twitter.repost_post", "operationId": "repostPost", "method": "POST", "path": "/2/users/{id}/retweets", "description": "Repost Post", "tags": ["Users", "Tweets"], "scopes": ["tweet.read", "tweet.write", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["tweet_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "tweet_id"] } },
      { "id": "twitter.search_communities", "operationId": "searchCommunities", "method": "GET", "path": "/2/communities/search", "description": "Search Communities", "tags": ["Communities"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "Query to search communities." }, "max_results": { "type": "integer", "description": "The maximum number of search results to be returned by a request." }, "next_token": { "description": "The next token.", "type": "string" }, "pagination_token": { "description": "The next token.", "type": "string" }, "community.fields": { "description": "The fields available for a Community object.", "type": "array", "items": { "enum": ["access", "created_at", "description", "id", "join_policy", "member_count", "name"] } } }, "required": ["query"] } },
      { "id": "twitter.search_community_notes_written", "operationId": "searchCommunityNotesWritten", "method": "GET", "path": "/2/notes/search/notes_written", "description": "Search for Community Notes Written", "tags": ["Community Notes"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "test_mode": { "type": "boolean", "description": "If true, return the notes the caller wrote for the test. If false, return the notes the caller wrote on the product." }, "pagination_token": { "type": "string", "description": "Pagination token to get next set of posts eligible for notes." }, "max_results": { "type": "integer", "description": "Max results to return." }, "note.fields": { "description": "The fields available for a Note object.", "type": "array", "items": { "enum": ["id", "info", "scoring_status", "status", "test_result"] } } }, "required": ["test_mode"] } },
      { "id": "twitter.search_eligible_posts", "operationId": "searchEligiblePosts", "method": "GET", "path": "/2/notes/search/posts_eligible_for_notes", "description": "Search for Posts Eligible for Community Notes", "tags": ["Community Notes"], "scopes": ["tweet.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "test_mode": { "type": "boolean", "description": "If true, return a list of posts that are for the test. If false, return a list of posts that the bots can write proposed notes on the product." }, "pagination_token": { "type": "string", "description": "Pagination token to get next set of posts eligible for notes." }, "max_results": { "type": "integer", "description": "Max results to return." }, "post_selection": { "type": "string", "description": "The selection of posts to return. Valid values are 'feed_size: [small|large|xl|xxl], feed_lang: [en|es|...|all]'. Default (if not specified) is 'feed_size: small, feed_lang: en'. Only top AI writers have access to large, xl, and xxl size feeds." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["test_mode"] } },
      { "id": "twitter.search_news", "operationId": "searchNews", "method": "GET", "path": "/2/news/search", "description": "Search News", "tags": ["News"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "The search query." }, "max_results": { "type": "integer", "description": "The number of results to return." }, "max_age_hours": { "type": "integer", "description": "The maximum age of the News story to search for." }, "news.fields": { "description": "The fields available for a News object.", "type": "array", "items": { "enum": ["category", "cluster_posts_results", "contexts", "disclaimer", "hook", "id", "keywords", "name", "summary", "updated_at"] } } }, "required": ["query"] } },
      { "id": "twitter.search_posts_all", "operationId": "searchPostsAll", "method": "GET", "path": "/2/tweets/search/all", "description": "Search all Posts", "tags": ["Tweets"], "scopes": [], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "One query/rule/filter for matching Posts. Refer to https://t.co/rulelength to identify the max query length." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The oldest UTC timestamp from which the Posts will be provided. Timestamp is in second granularity and is inclusive (i.e. 12:00:01 includes the first second of the minute)." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The newest, most recent UTC timestamp to which the Posts will be provided. Timestamp is in second granularity and is exclusive (i.e. 12:00:01 excludes the first second of the minute)." }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of search results to be returned by a request." }, "next_token": { "description": "A base36 pagination token.", "type": "string" }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "sort_order": { "enum": ["recency", "relevancy"], "description": "This order in which to return results." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["query"] } },
      { "id": "twitter.search_posts_recent", "operationId": "searchPostsRecent", "method": "GET", "path": "/2/tweets/search/recent", "description": "Search recent Posts", "tags": ["Tweets"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "One query/rule/filter for matching Posts. Refer to https://t.co/rulelength to identify the max query length." }, "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The oldest UTC timestamp from which the Posts will be provided. Timestamp is in second granularity and is inclusive (i.e. 12:00:01 includes the first second of the minute)." }, "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:mm:ssZ. The newest, most recent UTC timestamp to which the Posts will be provided. Timestamp is in second granularity and is exclusive (i.e. 12:00:01 excludes the first second of the minute)." }, "since_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "until_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of search results to be returned by a request." }, "next_token": { "description": "A base36 pagination token.", "type": "string" }, "pagination_token": { "description": "A base36 pagination token.", "type": "string" }, "sort_order": { "enum": ["recency", "relevancy"], "description": "This order in which to return results." }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [Tweet](#Tweet) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_tweet_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "entities.note.mentions.username", "referenced_tweets.id", "referenced_tweets.id.attachments.media_keys", "referenced_tweets.id.author_id"] } }, "media.fields": { "description": "The fields available for a Media object.", "type": "array", "items": { "enum": ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] } }, "poll.fields": { "description": "The fields available for a Poll object.", "type": "array", "items": { "enum": ["duration_minutes", "end_datetime", "id", "options", "voting_status"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "place.fields": { "description": "The fields available for a Place object.", "type": "array", "items": { "enum": ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] } } }, "required": ["query"] } },
      { "id": "twitter.search_spaces", "operationId": "searchSpaces", "method": "GET", "path": "/2/spaces/search", "description": "Search Spaces", "tags": ["Spaces"], "scopes": ["space.read", "tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "The search query." }, "state": { "enum": ["live", "scheduled", "all"], "description": "The state of Spaces to search for." }, "max_results": { "type": "integer", "description": "The number of results to return." }, "space.fields": { "description": "The fields available for a Space object.", "type": "array", "items": { "enum": ["created_at", "creator_id", "ended_at", "host_ids", "id", "invited_user_ids", "is_ticketed", "lang", "participant_count", "scheduled_start", "speaker_ids", "started_at", "state", "subscriber_count", "title", "topic_ids", "updated_at"] } }, "expansions": { "description": "The list of fields you can expand for a [Space](#Space) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["creator_id", "host_ids", "invited_user_ids", "speaker_ids", "topic_ids"] } }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "topic.fields": { "description": "The fields available for a Topic object.", "type": "array", "items": { "enum": ["description", "id", "name"] } } }, "required": ["query"] } },
      { "id": "twitter.search_users", "operationId": "searchUsers", "method": "GET", "path": "/2/users/search", "description": "Search Users", "tags": ["Users"], "scopes": ["tweet.read", "users.read"], "mutating": false, "risk": "low", "pathParams": [], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "query": { "description": "The the search string by which to query for users.", "type": "string" }, "max_results": { "type": "integer", "description": "The maximum number of results." }, "next_token": { "description": "A base36 pagination token.", "type": "string" }, "user.fields": { "description": "The fields available for a User object.", "type": "array", "items": { "enum": ["affiliation", "confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "most_recent_tweet_id", "name", "parody", "pinned_tweet_id", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] } }, "expansions": { "description": "The list of fields you can expand for a [User](#User) object. If the field has an ID, it can be expanded into a full object.", "type": "array", "items": { "enum": ["affiliation.user_id", "most_recent_tweet_id", "pinned_tweet_id"] } }, "tweet.fields": { "description": "The fields available for a Tweet object.", "type": "array", "items": { "enum": ["article", "attachments", "author_id", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "edit_history_tweet_ids", "entities", "geo", "id", "in_reply_to_user_id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_request_suggestions", "note_tweet", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "referenced_tweets", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] } } }, "required": ["query"] } },
      { "id": "twitter.send_chat_message", "operationId": "sendChatMessage", "method": "POST", "path": "/2/chat/conversations/{id}/messages", "description": "Send Chat Message", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["conversation_token", "encoded_message_create_event", "encoded_message_event_signature", "message_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" }, "conversation_token": { "description": "Optional conversation token.", "type": "string" }, "encoded_message_create_event": { "description": "Base64-encoded Thrift MessageCreateEvent containing encrypted message contents.", "type": "string" }, "encoded_message_event_signature": { "description": "Base64-encoded Thrift MessageEventSignature for message verification.", "type": "string" }, "message_id": { "description": "Unique identifier for this message.", "type": "string" } }, "required": ["id", "message_id", "encoded_message_create_event"] } },
      { "id": "twitter.send_chat_typing_indicator", "operationId": "sendChatTypingIndicator", "method": "POST", "path": "/2/chat/conversations/{id}/typing", "description": "Send Typing Indicator", "tags": ["Chat"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Identifies the conversation target. Accepts three formats: (1) a recipient user ID for 1:1 conversations (e.g., '1215441834412953600'), (2) a legacy 1:1 conversation ID with two user IDs separated by a dash (e.g., '1215441834412953600-1603419180975409153'), or (3) a group conversation ID prefixed with 'g' (e.g., 'g1234567890123456789'). The server constructs the canonical conversation ID from the authenticated user and recipient when a single user ID is provided.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.unblock_users_dms", "operationId": "unblockUsersDms", "method": "POST", "path": "/2/users/{id}/dm/unblock", "description": "Unblock DMs", "tags": ["Users"], "scopes": ["dm.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id"] } },
      { "id": "twitter.unfollow_list", "operationId": "unfollowList", "method": "DELETE", "path": "/2/users/{id}/followed_lists/{list_id}", "description": "Unfollow List", "tags": ["Users", "Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "list_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "list_id": { "description": "The unique identifier of this List.", "type": "string" } }, "required": ["id", "list_id"] } },
      { "id": "twitter.unfollow_user", "operationId": "unfollowUser", "method": "DELETE", "path": "/2/users/{source_user_id}/following/{target_user_id}", "description": "Unfollow User", "tags": ["Users"], "scopes": ["follows.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["source_user_id", "target_user_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "source_user_id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "target_user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["source_user_id", "target_user_id"] } },
      { "id": "twitter.unlike_post", "operationId": "unlikePost", "method": "DELETE", "path": "/2/users/{id}/likes/{tweet_id}", "description": "Unlike Post", "tags": ["Users", "Tweets"], "scopes": ["like.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "tweet_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "tweet_id"] } },
      { "id": "twitter.unmute_user", "operationId": "unmuteUser", "method": "DELETE", "path": "/2/users/{source_user_id}/muting/{target_user_id}", "description": "Unmute User", "tags": ["Users"], "scopes": ["mute.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["source_user_id", "target_user_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "source_user_id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "target_user_id": { "description": "Unique identifier of this User. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["source_user_id", "target_user_id"] } },
      { "id": "twitter.unpin_list", "operationId": "unpinList", "method": "DELETE", "path": "/2/users/{id}/pinned_lists/{list_id}", "description": "Unpin List", "tags": ["Users", "Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "list_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "list_id": { "description": "The unique identifier of this List.", "type": "string" } }, "required": ["id", "list_id"] } },
      { "id": "twitter.unrepost_post", "operationId": "unrepostPost", "method": "DELETE", "path": "/2/users/{id}/retweets/{source_tweet_id}", "description": "Unrepost Post", "tags": ["Users", "Tweets"], "scopes": ["tweet.read", "tweet.write", "users.read"], "mutating": true, "risk": "high", "pathParams": ["id", "source_tweet_id"], "bodyParams": [], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "Unique identifier of this User. The value must be the same as the authenticated user.", "type": "string" }, "source_tweet_id": { "description": "Unique identifier of this Tweet. This is returned as a string in order to avoid complications with languages and tools that cannot handle large integers.", "type": "string" } }, "required": ["id", "source_tweet_id"] } },
      { "id": "twitter.update_activity_subscription", "operationId": "updateActivitySubscription", "method": "PUT", "path": "/2/activity/subscriptions/{subscription_id}", "description": "Update X activity subscription", "tags": ["Activity"], "scopes": [], "mutating": true, "risk": "medium", "pathParams": ["subscription_id"], "bodyParams": ["tag", "webhook_id"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "subscription_id": { "description": "The unique identifier of this subscription.", "type": "string" }, "tag": { "type": "string" }, "webhook_id": { "description": "The unique identifier of this webhook config.", "type": "string" } }, "required": ["subscription_id"] } },
      { "id": "twitter.update_lists", "operationId": "updateLists", "method": "PUT", "path": "/2/lists/{id}", "description": "Update List", "tags": ["Lists"], "scopes": ["list.write", "tweet.read", "users.read"], "mutating": true, "risk": "medium", "pathParams": ["id"], "bodyParams": ["description", "name", "private"], "bodyRoot": false, "inputSchema": { "type": "object", "properties": { "id": { "description": "The unique identifier of this List.", "type": "string" }, "description": { "type": "string" }, "name": { "type": "string" }, "private": { "type": "boolean" } }, "required": ["id"] } }
    ];
  }
});

// packages/connectors/src/providers/twitter/toolkit.ts
import { z as z36 } from "zod";
function idIncluded(operationId, id, allow, deny) {
  if (deny && (deny.has(operationId) || deny.has(id))) return false;
  if (allow && !(allow.has(operationId) || allow.has(id))) return false;
  return true;
}
function tagsAllowed(opTags, allowTags) {
  if (!allowTags || allowTags.size === 0) return true;
  return opTags.some((t) => allowTags.has(t.toLowerCase()));
}
function included(op, allow, deny, allowTags) {
  return idIncluded(op.operationId, op.id, allow, deny) && tagsAllowed(op.tags, allowTags);
}
function buildRequest(op, input) {
  let path24 = op.path;
  for (const p of op.pathParams) {
    path24 = path24.replace(`{${p}}`, encodeURIComponent(String(input[p] ?? "")));
  }
  let body;
  if (op.bodyRoot) {
    body = input.body;
  } else if (op.bodyParams.length) {
    const b = {};
    for (const k of op.bodyParams) if (input[k] !== void 0) b[k] = input[k];
    if (Object.keys(b).length) body = b;
  }
  const pathSet = new Set(op.pathParams);
  const bodySet = new Set(op.bodyRoot ? ["body"] : op.bodyParams);
  const query = {};
  for (const [k, v] of Object.entries(input)) {
    if (pathSet.has(k) || bodySet.has(k)) continue;
    if (v === void 0 || v === null) continue;
    query[k] = Array.isArray(v) ? v.join(",") : v;
  }
  return {
    method: op.method,
    path: path24,
    ...Object.keys(query).length ? { query } : {},
    ...body !== void 0 ? { body } : {}
  };
}
function toAction(op) {
  return httpAction({
    id: op.id,
    description: op.description,
    ...op.scopes.length ? { scopes: op.scopes } : {},
    mutating: op.mutating,
    risk: op.risk,
    input: jsonSchemaToZodObject(op.inputSchema),
    request: (input) => buildRequest(op, input)
  });
}
function mediaIdOf(res) {
  const d = res.data;
  if (!d) return void 0;
  if (d.id) return d.id;
  if (d.media_id_string) return d.media_id_string;
  return d.media_id != null ? String(d.media_id) : void 0;
}
function buildUploadMediaAction(chunkBytes) {
  return action({
    id: "twitter.upload_media",
    description: "Upload an image, GIF, or video in one call (handles chunked init/append/finalize). `media` is base64-encoded file bytes. Returns a media id to pass to create_posts as media.media_ids. For video, poll twitter.get_media_upload_status if still processing.",
    scopes: ["media.write"],
    mutating: true,
    risk: "medium",
    input: z36.object({
      media: z36.string().describe("Base64-encoded media bytes"),
      media_type: z36.string().describe("MIME type, e.g. image/png, image/gif, video/mp4"),
      media_category: z36.string().optional().describe("tweet_image | tweet_gif | tweet_video | dm_image | dm_gif | dm_video | subtitles"),
      additional_owners: z36.array(z36.string()).optional().describe("User ids also allowed to use the media")
    }),
    async execute(ctx, input) {
      const bytes = Buffer.from(input.media, "base64");
      if (bytes.length === 0) throw new ConnectorError("invalid_input", "twitter.upload_media: media is empty");
      const init = await ctx.http.post("/2/media/upload/initialize", {
        media_type: input.media_type,
        total_bytes: bytes.length,
        ...input.media_category ? { media_category: input.media_category } : {},
        ...input.additional_owners ? { additional_owners: input.additional_owners } : {}
      });
      const id = mediaIdOf(init);
      if (!id) throw new ConnectorError("provider_error", "twitter.upload_media: initialize returned no media id");
      let segment = 0;
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const chunk = bytes.subarray(offset, offset + chunkBytes).toString("base64");
        await ctx.http.post(`/2/media/upload/${encodeURIComponent(id)}/append`, {
          segment_index: segment,
          media: chunk
        });
        segment++;
      }
      const finalized = await ctx.http.post(`/2/media/upload/${encodeURIComponent(id)}/finalize`, {});
      const data3 = finalized.data;
      return data3 ?? finalized;
    }
  });
}
function buildTwitterToolkit(options = {}) {
  const allow = options.allowlist?.length ? new Set(options.allowlist) : void 0;
  const deny = options.denylist?.length ? new Set(options.denylist) : void 0;
  const allowTags = options.tags?.length ? new Set(options.tags.map((t) => t.toLowerCase())) : void 0;
  const actions2 = TWITTER_OPS.filter((op) => included(op, allow, deny, allowTags)).map(toAction);
  if (idIncluded("uploadMedia", "twitter.upload_media", allow, deny) && tagsAllowed(["Media", "Tweets"], allowTags)) {
    actions2.push(buildUploadMediaAction(options.mediaChunkBytes ?? DEFAULT_MEDIA_CHUNK_BYTES));
  }
  return defineToolkit({
    id: "twitter",
    providerId: "twitter",
    displayName: "X (Twitter)",
    actions: actions2
  });
}
var DEFAULT_MEDIA_CHUNK_BYTES, twitterToolkit;
var init_toolkit18 = __esm({
  "packages/connectors/src/providers/twitter/toolkit.ts"() {
    "use strict";
    init_authoring();
    init_errors();
    init_json_schema();
    init_operations_generated();
    DEFAULT_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
    twitterToolkit = buildTwitterToolkit();
  }
});

// packages/connectors/src/providers/twitter/index.ts
function registerTwitter(registry, options = {}) {
  const { allowlist, denylist, tags, mediaChunkBytes, ...providerOptions } = options;
  const toolkit = buildTwitterToolkit({
    ...allowlist ? { allowlist } : {},
    ...denylist ? { denylist } : {},
    ...tags ? { tags } : {},
    ...mediaChunkBytes !== void 0 ? { mediaChunkBytes } : {}
  });
  registry.addBundle({ provider: twitter(providerOptions), toolkits: [toolkit] });
}
var init_twitter = __esm({
  "packages/connectors/src/providers/twitter/index.ts"() {
    "use strict";
    init_provider24();
    init_toolkit18();
  }
});

// packages/connectors/src/providers/index.ts
function registerAllProviders(registry, opts = {}) {
  registerGoogle(registry, opts);
  registerSlack(registry, opts);
  registerNotion(registry, opts);
  registerMicrosoft(registry, opts);
  registerLinear(registry, opts);
  registerJira(registry, opts);
  registerDiscord(registry, opts);
  registerCalendly(registry, opts);
  registerRaindrop(registry, opts);
  registerZoom(registry, opts);
  registerHubspot(registry, opts);
  registerSalesforce(registry, opts);
  registerTodoist(registry);
  registerAirtable(registry);
  registerReadwise(registry);
  registerStripe(registry);
  registerPlaid(registry);
  registerTelegram(registry);
  registerWhatsapp(registry);
  registerGitlab(registry);
  registerConfluence(registry, opts);
  registerAsana(registry);
  registerZendesk(registry);
  registerDropbox(registry, opts);
  registerBox(registry, opts);
  registerQuickbooks(registry, opts);
  registerResend(registry);
  registerMailgun(registry);
  registerTwitter(registry, { ...opts.fetch ? { fetch: opts.fetch } : {}, ...opts.twitter ?? {} });
}
var PROVIDER_CATALOG, DEFAULT_AUTH_CONFIGS;
var init_providers = __esm({
  "packages/connectors/src/providers/index.ts"() {
    "use strict";
    init_google();
    init_slack();
    init_notion();
    init_microsoft();
    init_linear();
    init_jira();
    init_discord();
    init_calendly();
    init_raindrop();
    init_zoom();
    init_hubspot();
    init_salesforce();
    init_todoist();
    init_airtable();
    init_readwise();
    init_stripe();
    init_plaid();
    init_telegram();
    init_whatsapp();
    init_gitlab();
    init_confluence();
    init_asana();
    init_zendesk();
    init_dropbox();
    init_box();
    init_quickbooks();
    init_resend();
    init_mailgun();
    init_twitter();
    PROVIDER_CATALOG = [
      { id: "google", displayName: "Google", method: "oauth2" },
      { id: "slack", displayName: "Slack", method: "oauth2" },
      { id: "notion", displayName: "Notion", method: "oauth2" },
      { id: "microsoft", displayName: "Microsoft 365", method: "oauth2" },
      { id: "linear", displayName: "Linear", method: "oauth2" },
      { id: "jira", displayName: "Jira", method: "oauth2" },
      { id: "discord", displayName: "Discord", method: "oauth2" },
      { id: "calendly", displayName: "Calendly", method: "oauth2" },
      { id: "raindrop", displayName: "Raindrop", method: "oauth2" },
      { id: "zoom", displayName: "Zoom", method: "oauth2" },
      { id: "hubspot", displayName: "HubSpot", method: "oauth2" },
      { id: "salesforce", displayName: "Salesforce", method: "oauth2" },
      { id: "todoist", displayName: "Todoist", method: "api_key", credentialFields: ["token"] },
      { id: "airtable", displayName: "Airtable", method: "api_key", credentialFields: ["token"] },
      { id: "readwise", displayName: "Readwise", method: "api_key", credentialFields: ["apiKey"] },
      { id: "stripe", displayName: "Stripe", method: "api_key", credentialFields: ["token"] },
      { id: "plaid", displayName: "Plaid", method: "custom", credentialFields: ["client_id", "secret"] },
      { id: "telegram", displayName: "Telegram", method: "custom", credentialFields: ["token"] },
      { id: "whatsapp", displayName: "WhatsApp", method: "custom", credentialFields: ["access_token", "phone_number_id"] },
      { id: "gitlab", displayName: "GitLab", method: "api_key", credentialFields: ["token"] },
      { id: "confluence", displayName: "Confluence", method: "oauth2" },
      { id: "asana", displayName: "Asana", method: "api_key", credentialFields: ["token"] },
      { id: "zendesk", displayName: "Zendesk", method: "custom", credentialFields: ["subdomain", "email", "api_token"] },
      { id: "dropbox", displayName: "Dropbox", method: "oauth2" },
      { id: "box", displayName: "Box", method: "oauth2" },
      { id: "quickbooks", displayName: "QuickBooks", method: "oauth2" },
      { id: "resend", displayName: "Resend", method: "api_key", credentialFields: ["apiKey"] },
      { id: "mailgun", displayName: "Mailgun", method: "custom", credentialFields: ["api_key"] },
      { id: "twitter", displayName: "X (Twitter)", method: "oauth2" }
    ];
    DEFAULT_AUTH_CONFIGS = [
      // Example — fill in a registered public client id to make Google zero-config:
      // {
      //   id: 'google', providerId: 'google', scheme: 'oauth2', scope: 'global', isDefault: true,
      //   oauth: { clientId: '<PUBLIC_CLIENT_ID>.apps.googleusercontent.com',
      //            redirectUri: 'http://localhost:4224/api/connectors/callback' },
      //   status: 'active',
      // },
    ];
  }
});

// packages/connectors/src/core/projection-shared.ts
function toToolName(actionId) {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, "__");
}
function projectedDescription(action2) {
  if (!action2.deprecated) return action2.description;
  const note = action2.replacedBy ? `DEPRECATED \u2014 use \`${action2.replacedBy}\` instead.` : "DEPRECATED.";
  return `${note} ${action2.description}`;
}
function accountDisplay(choice) {
  const base4 = choice.email ?? choice.label;
  if (!base4) return void 0;
  return choice.authConfigLabel ? `${base4} (${choice.authConfigLabel})` : base4;
}
function modelSafeOutcome(outcome) {
  switch (outcome.reason) {
    case "auth_required":
      return {
        status: "authorization_required",
        provider: outcome.providerId,
        message: `This needs a connected ${outcome.providerId} account. The app is prompting the user to authorize \u2014 tell them to complete it, then retry.`
      };
    case "needs_account":
      return {
        status: "choose_account",
        provider: outcome.providerId,
        // Carry the minting-config tiebreaker so the same email via two clients is distinguishable
        // (e.g. "me@gmail.com (Work)" vs "(Personal)") — §7. Still never the opaque connectionId.
        // These exact strings round-trip: resolution accepts them back (runtime `tokensFor`).
        accounts: outcome.choices.map(accountDisplay).filter(Boolean),
        message: "Multiple accounts are connected. Ask the user which one, then retry with the `account` field set to that exact value."
      };
    case "needs_consent":
      return {
        status: "additional_permission_required",
        provider: outcome.providerId,
        missingScopes: outcome.missingScopes,
        message: "This account needs additional permission. The app is prompting the user to grant it \u2014 tell them to complete it, then retry."
      };
    case "auth_config_required":
      return {
        status: "choose_connection_method",
        provider: outcome.providerId,
        options: outcome.choices.map((c) => c.label).filter(Boolean),
        message: "This provider has more than one connection method. Ask the user which to use; the app will then start the connect flow."
      };
    case "approval_required":
      return {
        status: "approval_required",
        message: "This action needs the user\u2019s approval. The app is asking them now \u2014 retry once they approve."
      };
    case "error":
      return {
        status: "error",
        code: outcome.code,
        message: outcome.message,
        ...outcome.indeterminate ? { indeterminate: true } : {}
      };
  }
}
var init_projection_shared = __esm({
  "packages/connectors/src/core/projection-shared.ts"() {
    "use strict";
  }
});

// packages/connectors/src/ai-sdk/index.ts
import { tool } from "ai";
import { z as z37 } from "zod";
async function toToolSet(runtime, options = {}) {
  const ownerId = options.ownerId;
  const caller = options.caller ?? { type: "agent" };
  const all = runtime.getToolkits();
  const selected = options.toolkits ? all.filter((t) => options.toolkits.includes(t.id)) : all;
  const providerIds = [...new Set(selected.map((t) => t.providerId))];
  const accountsByProvider = /* @__PURE__ */ new Map();
  for (const providerId of providerIds) {
    const choices = await runtime.listAccountChoices(providerId, ownerId ? { ownerId } : {});
    accountsByProvider.set(providerId, choices.map(accountDisplay).filter((s) => !!s));
  }
  const tools = {};
  for (const toolkit of selected) {
    const accounts = accountsByProvider.get(toolkit.providerId) ?? [];
    const accountDesc = accounts.length > 1 ? `Which connected account to act as. One of: ${accounts.map((a) => `"${a}"`).join(", ")}. Omit only if the user clearly means a single account.` : "Which connected account to act as (email or label). Usually omit \u2014 there is at most one connected account.";
    const pin = options.connectionPins?.[toolkit.id];
    for (const a of toolkit.actions) {
      const baseSchema = a.input;
      const inputSchema = pin ? baseSchema : baseSchema.extend({ account: z37.string().optional().describe(accountDesc) });
      tools[toToolName(a.id)] = tool({
        description: projectedDescription(a),
        inputSchema,
        execute: async (args) => {
          const { account, ...rest } = args;
          const outcome = await runtime.runAction(a.id, rest, {
            ...ownerId ? { ownerId } : {},
            ...pin ? { connectionId: pin } : account ? { account } : {},
            caller
          });
          if (outcome.ok) return options.redactor ? options.redactor.redact(outcome.result) : outcome.result;
          options.onPause?.(a.id, outcome);
          return modelSafeOutcome(outcome);
        }
      });
    }
  }
  return tools;
}
var init_ai_sdk = __esm({
  "packages/connectors/src/ai-sdk/index.ts"() {
    "use strict";
    init_projection_shared();
  }
});

// packages/connectors/src/mcp/ingest.ts
async function ingestMcpServer(registry, store, secretBox, opts) {
  const safe = opts.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const providerId = `mcp_${safe}`;
  const risk = opts.defaultRisk ?? "high";
  const mutating = opts.defaultMutating ?? true;
  const { tools } = await opts.client.listTools();
  const overrides = opts.toolOverrides ?? {};
  const actions2 = tools.filter((t) => overrides[t.name]?.enabled !== false).map((t) => {
    const toolMutating = overrides[t.name]?.mutating ?? mutating;
    return action({
      id: `mcp.${safe}.${t.name}`,
      description: t.description ? `${t.description} (via MCP server "${opts.name}")` : `External MCP tool "${t.name}" from "${opts.name}".`,
      // Preserve the tool's real input schema (converted JSON Schema → Zod) so the model gets
      // typed args; an absent/exotic schema falls back to a permissive passthrough object. The
      // remote server is still the authoritative validator.
      input: jsonSchemaToZodObject(t.inputSchema),
      mutating: toolMutating,
      risk: toolMutating ? risk : "low",
      // a tool the user trusts (non-mutating) reads through the gate
      async execute(_ctx, input) {
        const res = await opts.client.callTool({ name: t.name, arguments: input });
        return { server: opts.name, tool: t.name, isError: res.isError ?? false, content: res.content };
      }
    });
  });
  const provider2 = defineProvider({ id: providerId, displayName: `MCP: ${opts.name}`, auth: bearer() });
  registry.addBundle({
    provider: provider2,
    toolkits: [defineToolkit({ id: providerId, providerId, displayName: `MCP: ${opts.name}`, actions: actions2 })]
  });
  const ownerId = opts.ownerId ?? "local";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const connection = {
    id: opts.connectionId ?? newId(),
    ownerId,
    providerId,
    accountId: opts.name,
    label: opts.name,
    scopes: [],
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  await store.save(connection, await secretBox.seal({ type: "bearer", token: opts.sessionToken ?? "mcp-session" }));
  return {
    providerId,
    toolkitId: providerId,
    connectionId: connection.id,
    toolCount: actions2.length,
    tools: tools.map((t) => ({ name: t.name, description: t.description }))
  };
}
var init_ingest = __esm({
  "packages/connectors/src/mcp/ingest.ts"() {
    "use strict";
    init_authoring();
    init_json_schema();
    init_direct();
    init_ids();
  }
});

// packages/connectors/src/mcp/client.ts
async function connectMcpClient(opts) {
  const clientMod = await import("@modelcontextprotocol/sdk/client/index.js");
  const httpMod = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new clientMod.Client({ name: opts.name ?? "connectors-engine", version: opts.version ?? "0.0.1" });
  const transport = new httpMod.StreamableHTTPClientTransport(new URL(opts.url), {
    ...opts.authProvider ? { authProvider: opts.authProvider } : {},
    ...opts.headers ? { requestInit: { headers: opts.headers } } : {}
  });
  await client.connect(transport);
  return {
    async listTools() {
      const res = await client.listTools();
      return {
        tools: (res.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      };
    },
    async callTool(params) {
      const res = await client.callTool({ name: params.name, arguments: params.arguments ?? {} }, void 0, {
        timeout: 12e4,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 6e5
      });
      return { content: res.content, isError: res.isError ?? false };
    },
    async close() {
      await client.close();
    }
  };
}
var init_client = __esm({
  "packages/connectors/src/mcp/client.ts"() {
    "use strict";
  }
});

// packages/connectors/src/mcp/index.ts
var init_mcp = __esm({
  "packages/connectors/src/mcp/index.ts"() {
    "use strict";
    init_ingest();
    init_client();
  }
});

// src/lib/notifications/caller.ts
function isNotifierDelivery(caller, actionId) {
  return caller?.type === NOTIFIER_CALLER.type && caller.id === NOTIFIER_CALLER.id && NOTIFIER_DELIVERY_ACTIONS.has(actionId);
}
var NOTIFIER_CALLER, NOTIFIER_DELIVERY_ACTIONS;
var init_caller = __esm({
  "src/lib/notifications/caller.ts"() {
    "use strict";
    NOTIFIER_CALLER = { type: "app", id: "notifier" };
    NOTIFIER_DELIVERY_ACTIONS = /* @__PURE__ */ new Set(["telegram.send_message"]);
  }
});

// src/lib/notifications/render.ts
function render(event, channel) {
  return { title: event.title, body: event.body, url: resolveUrl2(event.url, channel.kind) };
}
function resolveUrl2(path24, kind) {
  if (!path24) return "";
  if (/^https?:\/\//i.test(path24)) return path24;
  if (!EXTERNAL_KINDS.has(kind)) return path24;
  const base4 = getRemoteBaseUrl() ?? getLanBaseUrl();
  if (!base4) return "";
  return `${base4.replace(/\/+$/, "")}${path24.startsWith("/") ? path24 : `/${path24}`}`;
}
var EXTERNAL_KINDS;
var init_render2 = __esm({
  "src/lib/notifications/render.ts"() {
    "use strict";
    init_bootstrap();
    EXTERNAL_KINDS = /* @__PURE__ */ new Set(["connector"]);
  }
});

// src/lib/notifications/adapters/telegram.ts
var telegramAdapter;
var init_telegram2 = __esm({
  "src/lib/notifications/adapters/telegram.ts"() {
    "use strict";
    init_runtime2();
    init_caller();
    telegramAdapter = {
      kind: "connector",
      providerId: "telegram",
      validateConfig(channel) {
        const chatId = channel.config.chatId;
        if (chatId === void 0 || chatId === null || chatId === "") {
          throw new Error("telegram channel is missing config.chatId");
        }
      },
      async deliver(channel, rendered) {
        const chatId = channel.config.chatId;
        const text2 = [rendered.title, "", rendered.body, rendered.url].filter((p) => p !== "").join("\n");
        const outcome = await (await getConnectorRuntime()).runAction(
          "telegram.send_message",
          { chatId, text: text2 },
          {
            ownerId: getConnectorOwnerId(),
            ...channel.connectionId ? { connectionId: channel.connectionId } : {},
            caller: NOTIFIER_CALLER
          }
        );
        if (!outcome.ok) {
          const reason = "reason" in outcome ? outcome.reason : "unknown";
          const detail = outcome.reason === "error" ? `: ${outcome.message}` : "";
          throw new Error(`telegram delivery failed (${reason})${detail}`);
        }
        const messageId = outcome.result?.messageId;
        return messageId !== void 0 ? { providerMessageId: String(messageId) } : {};
      }
    };
  }
});

// src/lib/notifications/web-push/vapid.ts
import fs13 from "fs";
import path14 from "path";
import webpush from "web-push";
function hardenMode(target, mode) {
  try {
    fs13.chmodSync(target, mode);
  } catch {
  }
}
function getVapidKeys() {
  if (cached2) return cached2;
  const dir = path14.join(getConfigDir(), "notifications");
  const file = path14.join(dir, "vapid.json");
  try {
    const parsed = JSON.parse(fs13.readFileSync(file, "utf8"));
    if (parsed.publicKey && parsed.privateKey) {
      hardenMode(dir, 448);
      hardenMode(file, 384);
      cached2 = parsed;
      return parsed;
    }
  } catch {
  }
  const generated = webpush.generateVAPIDKeys();
  const value = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  fs13.mkdirSync(dir, { recursive: true, mode: 448 });
  hardenMode(dir, 448);
  fs13.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 384 });
  hardenMode(file, 384);
  cached2 = value;
  return value;
}
function configureWebPush() {
  const { publicKey, privateKey } = getVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
}
var cached2, VAPID_SUBJECT;
var init_vapid = __esm({
  "src/lib/notifications/web-push/vapid.ts"() {
    "use strict";
    init_paths();
    cached2 = null;
    VAPID_SUBJECT = process.env.NOTIFIER_VAPID_SUBJECT ?? "mailto:notifier@localhost";
  }
});

// src/lib/notifications/adapters/web-push.ts
import webpush2 from "web-push";
var webPushAdapter;
var init_web_push = __esm({
  "src/lib/notifications/adapters/web-push.ts"() {
    "use strict";
    init_queries();
    init_vapid();
    webPushAdapter = {
      kind: "web_push",
      async deliver(channel, rendered) {
        const subscriptions = listWebPushSubscriptions(channel.userId);
        if (subscriptions.length === 0) throw new Error("no web push subscriptions for this user");
        configureWebPush();
        const payload = JSON.stringify({ title: rendered.title, body: rendered.body, url: rendered.url });
        let sent = 0;
        const errors = [];
        await Promise.all(
          subscriptions.map(async (s) => {
            try {
              await webpush2.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload
              );
              sent += 1;
            } catch (err) {
              const status = err.statusCode;
              if (status === 404 || status === 410) {
                deleteWebPushSubscriptionByEndpoint(s.endpoint);
              } else {
                errors.push(err instanceof Error ? err.message : String(err));
              }
            }
          })
        );
        if (sent === 0) {
          throw new Error(
            `web push reached 0/${subscriptions.length} subscriptions${errors.length ? `: ${errors[0]}` : " (all expired/pruned)"}`
          );
        }
        return {};
      }
    };
  }
});

// src/lib/notifications/adapters/registry.ts
function adapterKey(kind, providerId) {
  return kind === "connector" ? `connector:${providerId ?? ""}` : kind;
}
function resolveAdapter(channel) {
  return byKey.get(adapterKey(channel.kind, channel.providerId));
}
var ADAPTERS, byKey;
var init_registry2 = __esm({
  "src/lib/notifications/adapters/registry.ts"() {
    "use strict";
    init_telegram2();
    init_web_push();
    ADAPTERS = [telegramAdapter, webPushAdapter];
    byKey = new Map(
      ADAPTERS.map((a) => [adapterKey(a.kind, a.providerId), a])
    );
  }
});

// src/lib/notifications/notify.ts
async function notify(event, options = {}, deps = {}) {
  const resolveAdapter2 = deps.resolveAdapter ?? resolveAdapter;
  try {
    const channels = resolveChannels(event, options);
    if (channels.length === 0) return;
    for (const channel of channels) {
      upsertDelivery({
        userId: event.userId,
        eventType: event.type,
        dedupeKey: event.dedupeKey,
        channelId: channel.id,
        event
      });
    }
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const deliveries = listProcessableDeliveries(event.dedupeKey, [...channelById.keys()]);
    await Promise.all(
      deliveries.map(async (delivery) => {
        const channel = channelById.get(delivery.channelId);
        if (!channel) return;
        try {
          const adapter = resolveAdapter2(channel);
          if (!adapter) {
            markDeliveryFailed(delivery.id, `no adapter for kind=${channel.kind} provider=${channel.providerId ?? "-"}`);
            return;
          }
          adapter.validateConfig?.(channel);
          const rendered = render(event, channel);
          const result = await adapter.deliver(channel, rendered);
          markDeliverySent(delivery.id, {
            rendered,
            ...result.providerMessageId !== void 0 ? { providerMessageId: result.providerMessageId } : {}
          });
        } catch (err) {
          markDeliveryFailed(delivery.id, err instanceof Error ? err.message : String(err));
        }
      })
    );
  } catch (err) {
    console.error("[notifier] notify failed", { type: event.type, dedupeKey: event.dedupeKey, err });
  }
}
function resolveChannels(event, options) {
  if (options.deliverTo) {
    return options.deliverTo.map((id) => getNotificationChannel(id)).filter((c) => !!c && c.enabled && c.userId === event.userId);
  }
  return listNotificationChannels({ userId: event.userId, enabled: true }).filter(
    (c) => (c.events ?? []).includes(event.type)
  );
}
var init_notify = __esm({
  "src/lib/notifications/notify.ts"() {
    "use strict";
    init_queries();
    init_render2();
    init_registry2();
  }
});

// src/lib/notifications/events.ts
function eventCatalogEntry(type) {
  return EVENT_CATALOG.find((e) => e.type === type);
}
function defaultChannelEvents() {
  return EVENT_CATALOG.filter((e) => e.routing === "matrix" && e.defaultOn).map((e) => e.type);
}
var EVENT_CATALOG, MATRIX_EVENT_TYPES;
var init_events = __esm({
  "src/lib/notifications/events.ts"() {
    "use strict";
    EVENT_CATALOG = [
      {
        type: "execution.needs_input",
        label: "Agent needs input",
        description: "An execution is blocked waiting on you (a permission or question request).",
        routing: "matrix",
        defaultOn: true
      },
      {
        type: "execution.finished",
        label: "Execution finished",
        description: "An execution completed (done or failed), with a summary.",
        routing: "matrix",
        defaultOn: true
      },
      {
        type: "connector.approval_required",
        label: "Approval needed",
        description: "A connector action needs your approval before it runs.",
        routing: "matrix",
        defaultOn: true
      },
      {
        type: "deck.surfaced",
        label: "Deck surfaced something",
        description: "Your proactive deck surfaced a new item. (Inert until the deck emission point lands.)",
        routing: "matrix",
        defaultOn: true
      },
      {
        type: "trigger.run_completed",
        label: "Scheduled run result",
        description: "A scheduled job's result, delivered to the channels you bound it to.",
        routing: "binding",
        defaultOn: false
      }
    ];
    MATRIX_EVENT_TYPES = EVENT_CATALOG.filter(
      (e) => e.routing === "matrix"
    ).map((e) => e.type);
  }
});

// src/lib/notifications/index.ts
var notifications_exports = {};
__export(notifications_exports, {
  EVENT_CATALOG: () => EVENT_CATALOG,
  MATRIX_EVENT_TYPES: () => MATRIX_EVENT_TYPES,
  NOTIFIER_CALLER: () => NOTIFIER_CALLER,
  NOTIFIER_DELIVERY_ACTIONS: () => NOTIFIER_DELIVERY_ACTIONS,
  defaultChannelEvents: () => defaultChannelEvents,
  eventCatalogEntry: () => eventCatalogEntry,
  isNotifierDelivery: () => isNotifierDelivery,
  notify: () => notify
});
var init_notifications = __esm({
  "src/lib/notifications/index.ts"() {
    "use strict";
    init_notify();
    init_events();
    init_caller();
  }
});

// src/lib/connectors/approval.ts
import { randomUUID } from "crypto";
function grantKey(i) {
  return [i.connection.ownerId, i.actionId, i.connection.id, i.inputDigest, i.actionVersion].join("|");
}
function appApprovalPolicy(opts = {}) {
  return {
    async check(input) {
      if (isNotifierDelivery(input.caller, input.actionId)) return "allow";
      if (opts.autoApprove) return "allow";
      if (!input.mutating) return "allow";
      const key = grantKey(input);
      const exp = grants.get(key);
      if (exp && exp > Date.now()) {
        grants.delete(key);
        return "allow";
      }
      if (![...pending.values()].some((p) => p.key === key)) {
        const id = randomUUID();
        pending.set(id, {
          id,
          key,
          ownerId: input.connection.ownerId,
          actionId: input.actionId,
          connectionId: input.connection.id,
          risk: input.risk,
          preview: input.inputPreview,
          createdAt: Date.now()
        });
        void Promise.resolve().then(() => (init_notifications(), notifications_exports)).then(
          ({ notify: notify3 }) => notify3({
            type: "connector.approval_required",
            userId: input.connection.ownerId,
            dedupeKey: `connector.approval_required:${id}`,
            title: "Approval needed",
            body: `Approve "${input.actionId}"?`,
            url: "/connectors-test"
          })
        ).catch(() => {
        });
      }
      return "ask";
    }
  };
}
var GRANT_TTL_MS, pending, grants;
var init_approval = __esm({
  "src/lib/connectors/approval.ts"() {
    "use strict";
    init_caller();
    GRANT_TTL_MS = 5 * 6e4;
    pending = /* @__PURE__ */ new Map();
    grants = /* @__PURE__ */ new Map();
  }
});

// src/lib/connectors/mcp-servers.ts
import fs14 from "fs";
import path15 from "path";
import { uuidv7 as uuidv73 } from "uuidv7";
function mcpServerStore(deps) {
  const file = path15.join(deps.dir, "mcp-servers.json");
  const readAll = () => {
    try {
      const raw = fs14.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeAll = (rows) => {
    fs14.mkdirSync(deps.dir, { recursive: true, mode: 448 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs14.writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 384 });
    fs14.renameSync(tmp, file);
    try {
      fs14.chmodSync(file, 384);
    } catch {
    }
  };
  const sealSecret = async (secret) => deps.secretBox.seal({ secret });
  return {
    list() {
      return readAll().map((r) => r.entry);
    },
    get(id) {
      return readAll().find((r) => r.entry.id === id)?.entry ?? null;
    },
    getBySlug(slug) {
      return readAll().find((r) => r.entry.slug === slug)?.entry ?? null;
    },
    async create(input, secret) {
      return deps.lock.withLock("mcp-servers", async () => {
        const rows = readAll();
        if (!input.slug) throw new McpStoreError("invalid", "slug is required");
        if (rows.some((r) => r.entry.slug === input.slug)) {
          throw new McpStoreError("slug_taken", `an MCP server named "${input.slug}" already exists`);
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const entry = {
          id: uuidv73(),
          slug: input.slug,
          displayName: input.displayName || input.slug,
          url: input.url,
          enabled: input.enabled ?? true,
          auth: input.auth,
          ...input.tools ? { tools: input.tools } : {},
          createdAt: now,
          updatedAt: now
        };
        const row2 = { entry };
        if (secret && input.auth.kind !== "none") row2.sealed = await sealSecret(secret);
        rows.push(row2);
        writeAll(rows);
        return entry;
      });
    },
    async update(id, patch) {
      return deps.lock.withLock("mcp-servers", async () => {
        const rows = readAll();
        const row2 = rows.find((r) => r.entry.id === id);
        if (!row2) return null;
        if (patch.displayName !== void 0) row2.entry.displayName = patch.displayName;
        if (patch.url !== void 0) row2.entry.url = patch.url;
        if (patch.enabled !== void 0) row2.entry.enabled = patch.enabled;
        if (patch.auth !== void 0) row2.entry.auth = patch.auth;
        if (patch.toolOverrides !== void 0) row2.entry.toolOverrides = patch.toolOverrides;
        if (patch.secret !== void 0) {
          row2.sealed = patch.secret === null ? void 0 : await sealSecret(patch.secret);
        }
        row2.entry.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        writeAll(rows);
        return row2.entry;
      });
    },
    async remove(id) {
      return deps.lock.withLock("mcp-servers", async () => {
        const rows = readAll();
        const next = rows.filter((r) => r.entry.id !== id);
        if (next.length === rows.length) return false;
        writeAll(next);
        return true;
      });
    },
    async setHealth(id, health) {
      await deps.lock.withLock("mcp-servers", async () => {
        const rows = readAll();
        const row2 = rows.find((r) => r.entry.id === id);
        if (!row2) return;
        row2.entry.lastStatus = health.lastStatus;
        row2.entry.lastError = health.lastError ?? void 0;
        row2.entry.lastToolCount = health.lastToolCount;
        row2.entry.lastCheckedAt = health.lastCheckedAt;
        if (health.tools !== void 0) row2.entry.tools = health.tools;
        writeAll(rows);
      });
    },
    async openSecret(id) {
      const row2 = readAll().find((r) => r.entry.id === id);
      if (!row2?.sealed) return null;
      try {
        const opened = await deps.secretBox.open(row2.sealed);
        return opened.secret;
      } catch {
        return null;
      }
    },
    async getOAuthState(id) {
      const row2 = readAll().find((r) => r.entry.id === id);
      if (!row2?.sealedOAuth) return null;
      try {
        return await deps.secretBox.open(row2.sealedOAuth);
      } catch {
        return null;
      }
    },
    async setOAuthState(id, state5) {
      await deps.lock.withLock("mcp-servers", async () => {
        const rows = readAll();
        const row2 = rows.find((r) => r.entry.id === id);
        if (!row2) return;
        row2.sealedOAuth = await deps.secretBox.seal(state5);
        row2.entry.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        writeAll(rows);
      });
    }
  };
}
var McpStoreError;
var init_mcp_servers = __esm({
  "src/lib/connectors/mcp-servers.ts"() {
    "use strict";
    McpStoreError = class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "McpStoreError";
      }
    };
  }
});

// src/lib/connectors/mcp-oauth.ts
function makeMcpOAuthProvider(deps) {
  let cache = null;
  const get = async () => cache ??= await deps.load();
  const put = async (next) => {
    cache = next;
    await deps.save(next);
  };
  return {
    get redirectUrl() {
      return deps.redirectUrl;
    },
    get clientMetadata() {
      return {
        client_name: deps.clientName,
        redirect_uris: [deps.redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
        // public client; auth-code + PKCE
      };
    },
    async clientInformation() {
      return (await get()).clientInformation;
    },
    async saveClientInformation(info) {
      await put({ ...await get(), clientInformation: info });
    },
    async tokens() {
      return (await get()).tokens;
    },
    async saveTokens(tokens) {
      await put({ ...await get(), tokens });
    },
    async redirectToAuthorization(url) {
      deps.onRedirect?.(url);
    },
    async saveCodeVerifier(verifier) {
      await put({ ...await get(), codeVerifier: verifier });
    },
    async codeVerifier() {
      const v = (await get()).codeVerifier;
      if (!v) throw new Error("no PKCE code verifier saved for this MCP server");
      return v;
    },
    async invalidateCredentials(scope) {
      const next = { ...await get() };
      if (scope === "all" || scope === "tokens") delete next.tokens;
      if (scope === "all" || scope === "client") delete next.clientInformation;
      if (scope === "all" || scope === "verifier") delete next.codeVerifier;
      await put(next);
    }
  };
}
var init_mcp_oauth = __esm({
  "src/lib/connectors/mcp-oauth.ts"() {
    "use strict";
  }
});

// src/lib/connectors/runtime.ts
var runtime_exports = {};
__export(runtime_exports, {
  MCP_TIMEOUT_MS: () => MCP_TIMEOUT_MS,
  buildCredential: () => buildCredential,
  getConnectorAdmin: () => getConnectorAdmin,
  getConnectorOwnerId: () => getConnectorOwnerId,
  getConnectorRedirectUri: () => getConnectorRedirectUri,
  getConnectorRuntime: () => getConnectorRuntime,
  getConnectorTools: () => getConnectorTools,
  getMcpOAuthRedirectUrl: () => getMcpOAuthRedirectUrl,
  getMcpServerStore: () => getMcpServerStore,
  getProviderStatuses: () => getProviderStatuses,
  invalidateConnectorRuntime: () => invalidateConnectorRuntime,
  mcpAuthHeaders: () => mcpAuthHeaders,
  mcpConnectionId: () => mcpConnectionId,
  mcpOAuthProviderFor: () => mcpOAuthProviderFor,
  resolveWorkspaceConnectorFilter: () => resolveWorkspaceConnectorFilter,
  withTimeout: () => withTimeout
});
import fs15 from "fs";
import path16 from "path";
function parseEnvList(value) {
  if (!value) return void 0;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : void 0;
}
function getConnectorRedirectUri() {
  return process.env.CONNECTORS_REDIRECT_URI ?? DEFAULT_REDIRECT;
}
function oauthClientFromEnv(providerId) {
  const up = providerId.toUpperCase();
  const clientId = process.env[`CONNECTORS_${up}_CLIENT_ID`] ?? (providerId === "google" ? process.env.GOOGLE_CLIENT_ID : void 0);
  const clientSecret = process.env[`CONNECTORS_${up}_CLIENT_SECRET`] ?? (providerId === "google" ? process.env.GOOGLE_CLIENT_SECRET : void 0);
  if (!clientId || !clientSecret) return null;
  const redirectUri = process.env[`CONNECTORS_${up}_REDIRECT_URI`] ?? (providerId === "google" ? process.env.CONNECTORS_GOOGLE_REDIRECT_URI : void 0) ?? getConnectorRedirectUri();
  return { clientId, clientSecret, redirectUri };
}
function buildAuthConfigs() {
  const configs = [];
  for (const entry of PROVIDER_CATALOG) {
    if (entry.method !== "oauth2") continue;
    const c = oauthClientFromEnv(entry.id);
    if (!c) continue;
    configs.push({
      id: entry.id,
      providerId: entry.id,
      scheme: "oauth2",
      isDefault: true,
      scope: "global",
      oauth: { clientId: c.clientId, redirectUri: c.redirectUri },
      clientSecret: c.clientSecret,
      status: "active"
    });
  }
  return configs;
}
async function getProviderStatuses() {
  const admin = await getConnectorAdmin();
  return Promise.all(
    PROVIDER_CATALOG.map(async (entry) => {
      let configured = entry.method !== "oauth2";
      if (entry.method === "oauth2") {
        const hasEnvOrBundled = oauthClientFromEnv(entry.id) !== null || DEFAULT_AUTH_CONFIGS.some((c) => c.providerId === entry.id);
        configured = hasEnvOrBundled || (await admin.list(entry.id)).length > 0;
      }
      return { ...entry, configured };
    })
  );
}
function buildCredential(kind, fields) {
  const first = () => Object.values(fields)[0] ?? "";
  switch (kind) {
    case "api_key":
      return { type: "api_key", apiKey: fields.apiKey ?? fields.token ?? fields.key ?? first() };
    case "bearer":
      return { type: "bearer", token: fields.token ?? fields.apiKey ?? fields.key ?? first() };
    case "basic":
      return { type: "basic", username: fields.username ?? "", password: fields.password ?? "" };
    case "custom":
      return { type: "custom", values: fields };
    case "oauth1":
      return {
        type: "oauth1",
        consumerKey: fields.consumerKey ?? "",
        consumerSecret: fields.consumerSecret ?? "",
        ...fields.token ? { token: fields.token } : {},
        ...fields.tokenSecret ? { tokenSecret: fields.tokenSecret } : {}
      };
    case "aws_sigv4":
      return {
        type: "aws_sigv4",
        accessKeyId: fields.accessKeyId ?? "",
        secretAccessKey: fields.secretAccessKey ?? "",
        ...fields.sessionToken ? { sessionToken: fields.sessionToken } : {},
        ...fields.region ? { region: fields.region } : {},
        ...fields.service ? { service: fields.service } : {}
      };
    case "jwt":
      return { type: "jwt", key: fields.key ?? first() };
    case "oauth2":
      throw new Error("oauth2 providers connect via the redirect flow, not connectDirect");
  }
}
function connectorsDir() {
  return path16.join(getConfigDir(), "connectors");
}
function hardenMode2(target, mode) {
  try {
    fs15.chmodSync(target, mode);
  } catch {
  }
}
function getOrCreateKey(dir) {
  const keyPath = path16.join(dir, "key");
  try {
    const existing = fs15.readFileSync(keyPath, "utf8").trim();
    if (existing) {
      hardenMode2(dir, 448);
      hardenMode2(keyPath, 384);
      return existing;
    }
  } catch {
  }
  fs15.mkdirSync(dir, { recursive: true, mode: 448 });
  hardenMode2(dir, 448);
  const key = generateSecretKey();
  fs15.writeFileSync(keyPath, key, { mode: 384 });
  hardenMode2(keyPath, 384);
  return key;
}
function getMcpServerStore() {
  if (mcpStoreCached) return mcpStoreCached;
  const dir = connectorsDir();
  const lock = fileLock({ dir: path16.join(dir, "locks") });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  return mcpStoreCached = mcpServerStore({ dir, secretBox, lock });
}
function mcpConnectionId(slug) {
  return `mcp-${slug}`;
}
function getMcpOAuthRedirectUrl(serverId) {
  const origin = new URL(getConnectorRedirectUri()).origin;
  return `${origin}/api/connectors/mcp-oauth/${serverId}`;
}
function mcpOAuthProviderFor(entry, onRedirect) {
  const store = getMcpServerStore();
  return makeMcpOAuthProvider({
    redirectUrl: getMcpOAuthRedirectUrl(entry.id),
    clientName: APP_NAME,
    load: async () => await store.getOAuthState(entry.id) ?? {},
    save: async (state5) => store.setOAuthState(entry.id, state5),
    ...onRedirect ? { onRedirect } : {}
  });
}
function mcpAuthHeaders(auth, secret) {
  if (!secret) return void 0;
  if (auth.kind === "bearer") return { Authorization: `Bearer ${secret}` };
  if (auth.kind === "header") return { [auth.header]: secret };
  return void 0;
}
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}
function getConnectorOwnerId() {
  return process.env.CONNECTORS_OWNER_ID ?? "local";
}
function dedupeById(configs) {
  const byId = /* @__PURE__ */ new Map();
  for (const c of configs) byId.set(c.id, c);
  return [...byId.values()];
}
async function build() {
  const dir = connectorsDir();
  const lock = fileLock({ dir: path16.join(dir, "locks") });
  const store = fileStore({ dir, lock });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  const authConfigStore = authConfigFileStore({ dir, lock });
  const registry = createRegistry();
  const twitterAllowlist = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_ALLOWLIST);
  const twitterDenylist = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_DENYLIST);
  const twitterTags = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_TAGS);
  registerAllProviders(registry, {
    twitter: {
      ...twitterAllowlist ? { allowlist: twitterAllowlist } : {},
      ...twitterDenylist ? { denylist: twitterDenylist } : {},
      ...twitterTags ? { tags: twitterTags } : {}
    }
  });
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox,
    lock,
    redactor: createRedactor(),
    // The production registry: bundled default public clients ∪ operator env clients (in-process)
    // ∪ the persisted BYO store (`.config/connectors/auth-configs.json`, secrets sealed). The home
    // store — managed via the admin/UI — is the durable, syncs-with-your-home path; env is a
    // bootstrap layer.
    authConfigs: storeAuthConfigRegistry({
      bundled: dedupeById([...DEFAULT_AUTH_CONFIGS, ...buildAuthConfigs()]),
      store: authConfigStore,
      secretBox
    }),
    // Real grant-remembering gate (reads allow, mutating → grant-or-ask). Dev auto-allows so the
    // chat works end-to-end; production runs the real gate (resolve via /api/connectors/approve).
    approval: appApprovalPolicy({ autoApprove: process.env.NODE_ENV !== "production" }),
    onActionRun: (e) => {
      if (e.phase === "finish") {
        console.log(`[connectors] ${e.actionId} \u2192 ${e.status}`);
      }
    }
  });
  const admin = createAuthConfigAdmin({
    store: authConfigStore,
    connections: store,
    secretBox,
    getProvider: (id) => registry.getProvider(id)
  });
  const mcpClients = [];
  const mcpStore = getMcpServerStore();
  for (const entry of mcpStore.list()) {
    if (!entry.enabled) continue;
    try {
      let client;
      let sessionToken = "mcp-session";
      if (entry.auth.kind === "oauth") {
        const state5 = await mcpStore.getOAuthState(entry.id);
        if (!state5?.tokens) {
          await mcpStore.setHealth(entry.id, {
            lastStatus: "unreachable",
            lastError: "Awaiting authorization",
            lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          continue;
        }
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, authProvider: mcpOAuthProviderFor(entry) }),
          MCP_TIMEOUT_MS,
          `connect MCP "${entry.slug}"`
        );
      } else {
        const secret = await mcpStore.openSecret(entry.id);
        sessionToken = secret ?? "mcp-session";
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, headers: mcpAuthHeaders(entry.auth, secret) }),
          MCP_TIMEOUT_MS,
          `connect MCP "${entry.slug}"`
        );
      }
      const res = await withTimeout(
        ingestMcpServer(registry, store, secretBox, {
          name: entry.slug,
          client,
          connectionId: mcpConnectionId(entry.slug),
          sessionToken,
          ...entry.toolOverrides ? { toolOverrides: entry.toolOverrides } : {}
        }),
        MCP_TIMEOUT_MS,
        `ingest MCP "${entry.slug}"`
      );
      mcpClients.push(client);
      await mcpStore.setHealth(entry.id, {
        lastStatus: "ok",
        lastToolCount: res.toolCount,
        lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
        tools: res.tools
        // refresh the persisted tool list for the UI
      });
    } catch (e) {
      await mcpStore.setHealth(entry.id, {
        lastStatus: "unreachable",
        lastError: e instanceof Error ? e.message : String(e),
        lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
      }).catch(() => {
      });
      console.warn(`[connectors] MCP server "${entry.slug}" not ingested: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { runtime, admin, mcpClients };
}
async function closeClients(b) {
  await Promise.all(b.mcpClients.map((c) => c.close().catch(() => {
  })));
}
async function getBuilt() {
  if (cachedBuilt) return cachedBuilt;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    for (; ; ) {
      const myGen = generation;
      const built = await build();
      if (myGen === generation) {
        cachedBuilt = built;
        return built;
      }
      await closeClients(built).catch(() => {
      });
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
async function getConnectorRuntime() {
  return (await getBuilt()).runtime;
}
async function getConnectorAdmin() {
  return (await getBuilt()).admin;
}
function invalidateConnectorRuntime() {
  generation += 1;
  const old = cachedBuilt;
  cachedBuilt = null;
  if (old) void closeClients(old).catch(() => {
  });
}
async function getConnectorTools(ownerId = getConnectorOwnerId(), opts = {}) {
  const runtime = await getConnectorRuntime();
  const connections = await runtime.listConnections({ ownerId });
  if (connections.length === 0) return {};
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  let toolkitIds = runtime.getToolkits().filter((t) => connectedProviders.has(t.providerId)).map((t) => t.id);
  if (opts.toolkits) toolkitIds = toolkitIds.filter((id) => opts.toolkits.includes(id));
  if (toolkitIds.length === 0) return {};
  return toToolSet(runtime, {
    ownerId,
    toolkits: toolkitIds,
    ...opts.connectionPins ? { connectionPins: opts.connectionPins } : {},
    caller: { type: "agent" },
    onPause: (actionId, outcome) => {
      if (!outcome.ok) console.log(`[connectors] ${actionId} paused \u2192 ${outcome.reason}`);
    }
  });
}
async function resolveWorkspaceConnectorFilter(workspaceId, ownerId = getConnectorOwnerId()) {
  const scopes = getWorkspace(workspaceId)?.connectorScopes ?? [];
  if (scopes.length === 0) return { toolkits: [], connectionPins: {} };
  const runtime = await getConnectorRuntime();
  const connections = await runtime.listConnections({ ownerId });
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));
  const toolkits = [];
  const connectionPins = {};
  for (const scope of scopes) {
    const toolkit = toolkitsById.get(scope.toolkitId);
    if (!toolkit) continue;
    if (!connectedProviders.has(toolkit.providerId)) continue;
    if (scope.account) {
      const matches = connections.filter(
        (c) => c.providerId === toolkit.providerId && c.accountId === scope.account.accountId && (c.authConfigId ?? void 0) === (scope.account.authConfigId ?? void 0)
      );
      if (matches.length !== 1) continue;
      connectionPins[scope.toolkitId] = matches[0].id;
    }
    toolkits.push(scope.toolkitId);
  }
  return { toolkits, connectionPins };
}
var DEFAULT_REDIRECT, mcpStoreCached, MCP_TIMEOUT_MS, generation, cachedBuilt, inFlight;
var init_runtime2 = __esm({
  "src/lib/connectors/runtime.ts"() {
    "use strict";
    init_src();
    init_crypto();
    init_store();
    init_providers();
    init_ai_sdk();
    init_mcp();
    init_approval();
    init_paths();
    init_mcp_servers();
    init_mcp_oauth();
    init_app();
    init_queries();
    DEFAULT_REDIRECT = "http://localhost:4224/api/connectors/callback";
    mcpStoreCached = null;
    MCP_TIMEOUT_MS = 1e4;
    generation = 0;
    cachedBuilt = null;
    inFlight = null;
  }
});

// src/lib/deck/calendar-connector.ts
var calendar_connector_exports = {};
__export(calendar_connector_exports, {
  ensureCalendarProvider: () => ensureCalendarProvider
});
function isAllDay(value) {
  return !!value && !value.includes("T");
}
async function fetchGoogleCalendarDay(date) {
  try {
    const { getConnectorRuntime: getConnectorRuntime2, getConnectorOwnerId: getConnectorOwnerId2 } = await Promise.resolve().then(() => (init_runtime2(), runtime_exports));
    const ownerId = getConnectorOwnerId2();
    const runtime = await getConnectorRuntime2();
    const connections = await runtime.listConnections({ ownerId });
    const conn = connections.find((c) => c.providerId === GOOGLE_PROVIDER_ID);
    if (!conn) return [];
    const dayStart = /* @__PURE__ */ new Date(`${date}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) return [];
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const outcome = await runtime.runAction(
      "google_calendar.list_events",
      {
        calendarId: "primary",
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        maxResults: 100
      },
      { ownerId, connectionId: conn.id, caller: { type: "app" } }
    );
    if (!outcome.ok) {
      const detail = outcome.reason === "error" ? `${outcome.reason}: ${outcome.code} \u2014 ${outcome.message}` : outcome.reason;
      console.warn(`[calendar] list_events not ok (${detail}) \u2014 treating day as open`);
      return [];
    }
    const blocks = [];
    for (const e of outcome.result.events ?? []) {
      if (!e.start || !e.end) continue;
      if (e.status === "cancelled") continue;
      if (isAllDay(e.start)) continue;
      blocks.push({
        start: e.start,
        end: e.end,
        title: e.summary ?? "Busy",
        source: GOOGLE_PROVIDER_ID
      });
    }
    return blocks;
  } catch (err) {
    console.warn("[calendar] connector read failed \u2014 treating day as open", err);
    return [];
  }
}
function ensureCalendarProvider() {
  if (hasCalendarProvider()) return;
  setCalendarProvider((date) => fetchGoogleCalendarDay(date));
}
var GOOGLE_PROVIDER_ID;
var init_calendar_connector = __esm({
  "src/lib/deck/calendar-connector.ts"() {
    "use strict";
    init_calendar();
    GOOGLE_PROVIDER_ID = "google";
  }
});

// src/lib/deck/date.ts
function todayLocalDate(now = /* @__PURE__ */ new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
var init_date = __esm({
  "src/lib/deck/date.ts"() {
    "use strict";
  }
});

// src/lib/deck/instructions.ts
import fs16 from "fs";
import path17 from "path";
function readDeckInstructions() {
  try {
    const p = path17.join(getAppRoot(), DECK_INSTRUCTIONS_FILENAME);
    if (!fs16.existsSync(p)) return null;
    const content = fs16.readFileSync(p, "utf8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
var DECK_INSTRUCTIONS_FILENAME;
var init_instructions = __esm({
  "src/lib/deck/instructions.ts"() {
    "use strict";
    init_paths();
    DECK_INSTRUCTIONS_FILENAME = "DECK.md";
  }
});

// src/lib/deck/connector-tools.ts
function toToolName2(actionId) {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, "__");
}
async function getReadOnlyConnectorTools(ownerId = getConnectorOwnerId()) {
  try {
    const runtime = await getConnectorRuntime();
    const connections = await runtime.listConnections({ ownerId });
    if (connections.length === 0) return {};
    const connectedProviders = new Set(connections.map((c) => c.providerId));
    const readOnly = /* @__PURE__ */ new Set();
    for (const tk of runtime.getToolkits()) {
      if (!connectedProviders.has(tk.providerId)) continue;
      for (const a of tk.actions) {
        if (!a.mutating) readOnly.add(toToolName2(a.id));
      }
    }
    const all = await getConnectorTools(ownerId);
    const filtered = {};
    for (const [name, t] of Object.entries(all)) {
      if (readOnly.has(name)) filtered[name] = t;
    }
    return filtered;
  } catch (err) {
    console.warn("[deck] read-only connector tools unavailable", err);
    return {};
  }
}
var init_connector_tools = __esm({
  "src/lib/deck/connector-tools.ts"() {
    "use strict";
    init_runtime2();
  }
});

// src/lib/embeddings/search.ts
var search_exports = {};
__export(search_exports, {
  ftsSearch: () => ftsSearch,
  hybridSearch: () => hybridSearch,
  hybridSearchWithEntities: () => hybridSearchWithEntities,
  vectorSearch: () => vectorSearch
});
async function vectorSearch(query, limit = 20) {
  const db = getRawDb();
  const queryVector = await generateEmbedding(query);
  const queryEmbedding = new Float32Array(queryVector);
  const rows = db.prepare(
    `SELECT e.entity_type AS entityType, e.entity_id AS entityId, v.distance
       FROM embeddings_vec v
       JOIN embeddings e ON e.id = v.rowid
       WHERE v.embedding MATCH ?
       ORDER BY v.distance
       LIMIT ?`
  ).all(queryEmbedding, limit);
  return rows.map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    score: 1 - r.distance
    // cosine similarity = 1 - cosine distance
  }));
}
function ftsSearch(query, limit = 20) {
  const db = getRawDb();
  const searchTerm = query.trim().replace(/['"]/g, "").split(/\s+/).map((t) => `"${t}"*`).join(" ");
  const hits = [];
  try {
    const taskRows = db.prepare(
      `SELECT t.id, rank
         FROM tasks_fts
         JOIN tasks t ON t.rowid = tasks_fts.rowid
         WHERE tasks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
    ).all(searchTerm, limit);
    for (const r of taskRows) {
      hits.push({
        entityType: "task",
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank))
      });
    }
  } catch {
  }
  try {
    const noteRows = db.prepare(
      `SELECT n.id, rank
         FROM notes_fts
         JOIN notes n ON n.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
    ).all(searchTerm, limit);
    for (const r of noteRows) {
      hits.push({
        entityType: "note",
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank))
      });
    }
  } catch {
  }
  try {
    const streamRows = db.prepare(
      `SELECT s.id, rank
         FROM stream_fts
         JOIN stream s ON s.rowid = stream_fts.rowid
         WHERE stream_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
    ).all(searchTerm, limit);
    for (const r of streamRows) {
      hits.push({
        entityType: "stream",
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank))
      });
    }
  } catch {
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
async function hybridSearch(query, { limit = 20, vectorWeight = 0.7 } = {}) {
  const bm25Weight = 1 - vectorWeight;
  const [vecResults, ftsResults] = await Promise.all([
    vectorSearch(query, limit * 2).catch((err) => {
      if (process.env.OPENAI_API_KEY) {
        console.warn("[search] vector search failed, falling back to FTS:", err);
      }
      return [];
    }),
    Promise.resolve(ftsSearch(query, limit * 2))
  ]);
  const merged = /* @__PURE__ */ new Map();
  for (const hit of vecResults) {
    const key = `${hit.entityType}:${hit.entityId}`;
    merged.set(key, {
      entityType: hit.entityType,
      entityId: hit.entityId,
      score: vectorWeight * hit.score
    });
  }
  for (const hit of ftsResults) {
    const key = `${hit.entityType}:${hit.entityId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.score += bm25Weight * hit.score;
    } else {
      merged.set(key, {
        entityType: hit.entityType,
        entityId: hit.entityId,
        score: bm25Weight * hit.score
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}
function truncate3(value) {
  return typeof value === "string" && value.length > SNIPPET_MAX ? value.slice(0, SNIPPET_MAX) + "..." : value;
}
async function hybridSearchWithEntities(query, { limit = 10, vectorWeight } = {}) {
  const hits = await hybridSearch(query, { limit, ...vectorWeight !== void 0 ? { vectorWeight } : {} });
  const db = getRawDb();
  return hits.map((hit) => {
    let entity;
    if (hit.entityType === "task") {
      entity = db.prepare(
        "SELECT id, title, description, status, area_id AS areaId, hard_deadline AS hardDeadline, user_context AS userContext, body FROM tasks WHERE id = ?"
      ).get(hit.entityId);
      if (entity) entity.body = truncate3(entity.body);
    } else if (hit.entityType === "note") {
      entity = db.prepare("SELECT id, title, body, area_id AS areaId, task_id AS taskId FROM notes WHERE id = ?").get(hit.entityId);
      if (entity) entity.body = truncate3(entity.body);
    } else if (hit.entityType === "stream") {
      entity = db.prepare("SELECT id, raw_text AS rawText, created_at AS createdAt, source FROM stream WHERE id = ?").get(hit.entityId);
      if (entity) entity.rawText = truncate3(entity.rawText);
    }
    if (!entity) return null;
    return { type: hit.entityType, score: hit.score, ...entity };
  }).filter((e) => e !== null);
}
var SNIPPET_MAX;
var init_search = __esm({
  "src/lib/embeddings/search.ts"() {
    "use strict";
    init_db();
    init_embed();
    SNIPPET_MAX = 500;
  }
});

// src/lib/ai/deck-generation.ts
import { z as z38 } from "zod";
function buildDeckPrompt(data3) {
  const sections = [];
  if (data3.userProfile) {
    sections.push(`[User Profile]
${data3.userProfile}`);
  }
  if (data3.deckInstructions) {
    sections.push(`[Your Source Instructions]
${data3.deckInstructions.trim()}`);
  }
  if (data3.areas.length > 0) {
    const areaLines = data3.areas.map((a) => {
      const ctx = a.userContext ? `: "${a.userContext}"` : "";
      return `- [${a.id}] ${a.name}${ctx} (${a.status})`;
    });
    sections.push(`[Areas]
${areaLines.join("\n")}`);
  }
  const taskLines = data3.tasks.map((t, i) => {
    const parts = [`${i + 1}. [${t.id}] ${t.title}`];
    const meta = [];
    if (t.areaName) meta.push(`area: ${t.areaName}`);
    if (t.effort) meta.push(`effort: ${t.effort}`);
    if (t.energy) meta.push(`energy: ${t.energy}`);
    if (t.estimatedMinutes) meta.push(`~${t.estimatedMinutes}m`);
    if (t.hardDeadline) meta.push(`deadline: ${t.hardDeadline}`);
    if (t.lastProgressAt) meta.push(`last progress: ${t.lastProgressAt}`);
    if (t.timesDeferred > 0) meta.push(`deferred: ${t.timesDeferred}x`);
    if (t.blockedOn) meta.push(`BLOCKED: ${t.blockedOn}`);
    if (meta.length > 0) parts.push(`   ${meta.join(" | ")}`);
    if (t.parentTitle) parts.push(`   parent: ${t.parentTitle}`);
    if (t.description) parts.push(`   ${t.description}`);
    if (t.userContext) parts.push(`   user note: ${t.userContext}`);
    if (t.subtasks && t.subtasks.length > 0) {
      const done = t.subtasks.filter((s) => s.completed).length;
      const remaining = t.subtasks.filter((s) => !s.completed).map((s) => s.title);
      parts.push(
        `   subtasks: ${done}/${t.subtasks.length} done${remaining.length > 0 ? ` (remaining: ${remaining.join(", ")})` : ""}`
      );
    }
    return parts.join("\n");
  });
  sections.push(`[Active Tasks: roughly ordered by current priority]
${taskLines.join("\n\n")}`);
  if (data3.recentCompletions.length > 0) {
    const compLines = data3.recentCompletions.map((c) => {
      const area = c.areaName ? ` (${c.areaName})` : "";
      return `- "${c.taskTitle}"${area}, completed ${c.completedAt}`;
    });
    sections.push(`[Recent Completions: last 5 days]
${compLines.join("\n")}`);
  }
  if (data3.previousDeckItems && data3.previousDeckItems.length > 0) {
    const prevLines = data3.previousDeckItems.map((p) => {
      const status = p.status === "done" ? "DONE \u2713" : p.status === "gone" ? "no longer exists" : "still open";
      return `- [${p.taskId}] "${p.title}": ${status}`;
    });
    sections.push(
      `[Previous Deck: what you surfaced last time, with current status]
${prevLines.join("\n")}

Return a reconciliation decision (carry / defer / drop) for every item above. Carry momentum. Don't silently lose anything.`
    );
  }
  if (data3.timeContext) {
    const tc = data3.timeContext;
    const lines = [
      `Workday: ${tc.workdayStart} to ${tc.workdayEnd}. Roughly ${tc.availableMinutes} minutes of task time available today.`
    ];
    if (tc.hasCalendar && tc.gaps.length > 0) {
      lines.push("Open gaps between meetings:");
      for (const g2 of tc.gaps) lines.push(`  - ${g2.label}`);
      lines.push("Slot deep work into the largest gaps. Fit light/quick tasks into short ones.");
    } else {
      lines.push("No calendar connected. Size the deck to the available minutes, leave slots null.");
    }
    sections.push(`[Today's Time]
${lines.join("\n")}`);
  }
  const contextParts = [];
  if (data3.generationContext.context) {
    contextParts.push(data3.generationContext.context);
  }
  if (data3.generationContext.contextTags && data3.generationContext.contextTags.length > 0) {
    contextParts.push(`Signals: ${data3.generationContext.contextTags.join(", ")}`);
  }
  if (contextParts.length > 0) {
    sections.push(`[User Context for Today]
${contextParts.join("\n")}`);
  }
  return sections.join("\n\n");
}
var DECK_GENERATION_TASK_LIMIT, DECK_MAX_ITEMS, DECK_MIN_ITEMS, ALT_MAX_ITEMS, ALT_MIN_ITEMS, deckGenerationContextSchema, deckResponseSchema, CONTEXT_GATHERING_PROMPT, DECK_SYSTEM_PROMPT;
var init_deck_generation = __esm({
  "src/lib/ai/deck-generation.ts"() {
    "use strict";
    DECK_GENERATION_TASK_LIMIT = 50;
    DECK_MAX_ITEMS = 7;
    DECK_MIN_ITEMS = 3;
    ALT_MAX_ITEMS = 10;
    ALT_MIN_ITEMS = 3;
    deckGenerationContextSchema = z38.object({
      context: z38.string().optional(),
      contextTags: z38.array(z38.string()).optional(),
      /** Explicit time budget for today (minutes). Overrides calendar/workday
       *  derivation when set — e.g. the "I only have 2 hours" steer. */
      availableMinutes: z38.number().int().positive().optional()
    });
    deckResponseSchema = z38.object({
      items: z38.array(
        z38.object({
          taskId: z38.string().describe("The task ID from the provided task list"),
          rationale: z38.string().describe("One sentence: why this task, why this position in the ranking"),
          continuityContext: z38.string().nullable().describe(
            'If the task has recent progress or subtask completion, a brief note like "Last session: got OAuth working, error handling next". Null if not applicable.'
          ),
          slot: z38.object({
            start: z38.string().describe('Start time label, e.g. "9:00 AM"'),
            end: z38.string().describe('End time label, e.g. "10:30 AM"'),
            reason: z38.string().describe('Why here, e.g. "your only 90-min open block"')
          }).nullable().describe(
            "Where this task sits in the real day. ONLY set when the calendar has meaningful open gaps to place work into. Null otherwise (including when there is no calendar)."
          )
        })
      ).min(DECK_MIN_ITEMS).max(DECK_MAX_ITEMS).describe("The priority stack: ranked list of tasks to focus on today, most important first"),
      alternatives: z38.array(
        z38.object({
          taskId: z38.string().describe("The task ID from the provided task list"),
          reason: z38.string().describe("Why this task did not make the deck but is worth knowing about")
        })
      ).min(ALT_MIN_ITEMS).max(ALT_MAX_ITEMS).describe(
        "Tasks the AI considered but ranked lower: good candidates if the user finishes the deck or wants to swap"
      ),
      framing: z38.string().nullable().describe(
        "One-line summary of the recommended shape of the user's day. Only include if the user context or task landscape meaningfully shapes the day. Null if nothing notable."
      ),
      reconciliation: z38.array(
        z38.object({
          taskId: z38.string().describe("A task ID that was on the PREVIOUS deck"),
          decision: z38.enum(["carry", "defer", "drop"]).describe(
            "carry = keep it on today's deck. defer = still matters but not today. drop = no longer worth doing"
          ),
          reason: z38.string().describe("One sentence explaining the carry/defer/drop call")
        })
      ).describe(
        "One entry for EACH task that was on the previous deck (see the [Previous Deck] section). Empty array if no previous deck was provided."
      )
    });
    CONTEXT_GATHERING_PROMPT = `You are the context-gathering step in a task-prioritization pipeline for a personal productivity app. You receive the user's active tasks, areas, and today's context. Your job: gather any LIVE context that helps plan their day well, then write a short brief of it.

Tools available to you:
- searchKnowledgeBase: the user's own notes, stream entries, and tasks (semantic + keyword search).
- get_day_shape: the user's available work time for a date \u2014 busy calendar blocks, free gaps, and total free minutes, ALREADY COMPUTED. Use this for anything about how much time they have or when to slot work. NEVER compute free/busy from raw calendar events yourself; call get_day_shape.
- You may also have READ-ONLY tools for the user's connected services (calendars, task/issue trackers, docs, messaging, etc.). Only ever read/list/get \u2014 never create, send, or modify anything.

How much to consult:
- The user's own instructions are the most important guidance. If a [Your Source Instructions] section is present, follow it \u2014 it says which sources to use and how, and it OVERRIDES everything below whenever they conflict.
- Otherwise, as a sensible default: consult the connected services that are relevant to planning today \u2014 a calendar for available time, a task/issue tracker for work they're responsible for \u2014 and skip what isn't useful. A simple day may need nothing.
- If a tool errors or a service isn't connected, just move on. Never block on it.

Then output a concise CONTEXT BRIEF (a few lines) of what you found that's relevant to today: the shape of their time, any external items/issues that should influence priorities, and anything time-sensitive. Clearly mark items that are EXTERNAL (not in their task list) so the planner treats them as context, not as deck entries.`;
    DECK_SYSTEM_PROMPT = `You are the prioritization engine for Eon, a personal productivity app. The user is sitting down to work and needs clarity on what to focus on today.

You will receive their active tasks (roughly pre-ordered by current priority), areas of life/work, recent completions, optional context for today, and optionally a [Live Context] brief gathered from their knowledge base and connected tools (calendar, issue trackers, etc.).

YOUR JOB: Pick ${DECK_MIN_ITEMS}-${DECK_MAX_ITEMS} tasks for the deck (the priority stack) and ${ALT_MIN_ITEMS}-${ALT_MAX_ITEMS} alternatives. Return task IDs from the provided list. Never invent tasks.

USING [Live Context]: factor it into ranking and framing \u2014 calendar/time info constrains how much fits and when; external issues or signals can raise or lower a task's urgency. IMPORTANT: deck items and alternatives must still be task IDs from the provided [Active Tasks] list. An external item (e.g. an issue from a connected tool that isn't in the task list) can inform your decisions but cannot itself be a deck entry.

RANKING PRINCIPLES:
- Hard deadlines are the strongest signal. Due today/tomorrow = near top. Overdue = top.
- Tasks with recent progress have momentum. They're easier to pick up. Favor continuation.
- User context is king. If they indicate low energy, time constraints, or specific focus, that overrides default ordering.
- The pre-existing sort order reflects the user's general priorities. Respect it unless you have a specific reason to reorder (deadline, momentum, user context today).
- High timesDeferred means the user doesn't want to do this right now. Don't push it unless it has an approaching deadline.
- Blocked tasks (blockedOn is set) should NEVER appear in the deck or alternatives.
- Aim for a realistic day. Don't pack 12 hours of work. 5-7 items with a mix of effort sizes.
- Context tags from the user (like "Low energy today") should meaningfully shift your selections, e.g., favor lighter tasks, fewer items.

FOR EACH DECK ITEM: Write a rationale, one sentence explaining why this task and why this position. Reference the user's areas or context when relevant. Be specific, not generic.

FOR ALTERNATIVES: Explain why they didn't make the cut. "Lower priority than today's deadlines" is better than "not as important."

framing: If the user's context or the task landscape shapes the day (time constraints, heavy deadlines, energy signals), write one line. Otherwise omit entirely.

RECONCILING YESTERDAY \u2192 TODAY:
- If a [Previous Deck] is provided, you MUST return a "reconciliation" entry for EVERY task that was on it.
  - carry: still the right thing to work today. Also include it in the deck (with a continuityContext note about where it left off when you can).
  - defer: still matters but not today (lower priority than today's load, or no room). Do NOT put it in the deck. It moves to the user's "bumped" lane with your reason.
  - drop: genuinely no longer worth doing. Do NOT put it in the deck.
- Completed items need no special handling beyond a reconciliation entry (carry only if there's a follow-up). Prefer carrying momentum. "old" is not a reason to drop.

WHEN SOMETHING HAS TO GIVE (light guidance, use judgment, not a rigid rule):
- A realistic day can't hold everything. When you must choose what to defer, prefer deferring lower-priority, lighter, or softer-deadline work.
- Treat a hard deadline, or an item the user explicitly prioritized, as expensive to defer. Only defer it if truly forced, and say so plainly in the reason.
- Every defer/drop is visible and one-tap reversible to the user, so make the honest call rather than hedging by keeping too much on the deck.

SIZING & SLOTTING (when [Today's Time] is provided):
- Size the deck to the available minutes. Don't pile on more estimated work than fits the day. A deck the user can actually finish beats an aspirational pile.
- If the calendar shows open gaps, place each item with a "slot" (start/end label + reason): deep/heavy work in the largest gaps, light/quick tasks in short ones. Leave slot null if there's no calendar or no clean fit.
- Honest deadlines: if a hard-deadline task's remaining days are mostly consumed by meetings/commitments, treat it as effectively more urgent and rank it up. Say so in the rationale.`;
  }
});

// src/lib/ai/generate-deck.ts
var generate_deck_exports = {};
__export(generate_deck_exports, {
  generateDeck: () => generateDeck
});
import { Output, generateText, tool as tool2, stepCountIs } from "ai";
import { openai as openai2 } from "@ai-sdk/openai";
import { z as z39 } from "zod";
import { eq as eq3, and as and3, desc as desc2, sql as sql3, isNull as isNull2, isNotNull as isNotNull2, gte as gte2, lte as lte2, inArray as inArray2 } from "drizzle-orm";
function collectSearchResults(steps) {
  const results = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName === "searchKnowledgeBase" && Array.isArray(tr.output)) {
        results.push(...tr.output);
      }
    }
  }
  if (results.length === 0) return "";
  const seen = /* @__PURE__ */ new Set();
  const unique = results.filter((r) => {
    const id = r.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return unique.map((r) => {
    const rec = r;
    const type = rec.type;
    if (type === "task") {
      return `- Task: "${rec.title}"${rec.description ? `: ${rec.description}` : ""}${rec.userContext ? ` (note: ${rec.userContext})` : ""}`;
    }
    if (type === "note") {
      const body = rec.body;
      const snippet = body ? `: ${body.slice(0, 200)}${body.length > 200 ? "..." : ""}` : "";
      return `- Note: "${rec.title}"${snippet}`;
    }
    if (type === "stream") {
      const text2 = rec.rawText;
      const snippet = text2 ? text2.slice(0, 200) + (text2.length > 200 ? "..." : "") : "";
      return `- Stream entry (${rec.createdAt}): ${snippet}`;
    }
    return null;
  }).filter(Boolean).join("\n");
}
async function generateDeck(generationContext, opts = {}) {
  const db = getDb();
  const now = /* @__PURE__ */ new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1e3).toISOString();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  const activeTasks = db.select().from(tasks).where(and3(eq3(tasks.status, "active"), isNull2(tasks.parentId), isNull2(tasks.blockedOn))).orderBy(sql3`${tasks.sortKey} ASC NULLS LAST`, desc2(tasks.createdAt)).limit(DECK_GENERATION_TASK_LIMIT).all();
  const deadlineTasks = db.select().from(tasks).where(
    and3(
      eq3(tasks.status, "active"),
      isNotNull2(tasks.hardDeadline),
      lte2(tasks.hardDeadline, sevenDaysFromNow),
      isNull2(tasks.blockedOn)
    )
  ).orderBy(tasks.hardDeadline).all();
  const recurringDue = db.select().from(tasks).where(
    and3(
      eq3(tasks.status, "active"),
      isNotNull2(tasks.recurrence),
      lte2(tasks.nextRecurrenceAt, todayStr),
      isNull2(tasks.blockedOn)
    )
  ).all();
  const taskMap = /* @__PURE__ */ new Map();
  for (const t of activeTasks) taskMap.set(t.id, t);
  for (const t of deadlineTasks) taskMap.set(t.id, t);
  for (const t of recurringDue) taskMap.set(t.id, t);
  const allTasks = Array.from(taskMap.values());
  const parentIds = allTasks.map((t) => t.id);
  const allSubtasks = parentIds.length > 0 ? db.select().from(tasks).where(and3(eq3(tasks.status, "active"), isNotNull2(tasks.parentId))).all().filter((s) => s.parentId && taskMap.has(s.parentId)) : [];
  const completedSubtasks = parentIds.length > 0 ? db.select().from(tasks).where(and3(eq3(tasks.status, "done"), isNotNull2(tasks.parentId))).all().filter((s) => s.parentId && taskMap.has(s.parentId)) : [];
  const subtasksByParent = /* @__PURE__ */ new Map();
  for (const s of [...allSubtasks, ...completedSubtasks]) {
    if (!s.parentId) continue;
    const list2 = subtasksByParent.get(s.parentId) ?? [];
    list2.push({ id: s.id, title: s.title, completed: s.status === "done" });
    subtasksByParent.set(s.parentId, list2);
  }
  const activeAreas = db.select().from(areas).where(eq3(areas.status, "active")).orderBy(areas.sortOrder).all();
  const areaMap = new Map(activeAreas.map((a) => [a.id, a.name]));
  const recentCompletions = db.select({
    taskTitle: tasks.title,
    completedAt: taskCompletions.completedAt,
    areaId: tasks.areaId
  }).from(taskCompletions).innerJoin(tasks, eq3(taskCompletions.taskId, tasks.id)).where(gte2(taskCompletions.completedAt, fiveDaysAgo)).orderBy(desc2(taskCompletions.completedAt)).limit(20).all();
  const previousDeck = getLatestDeck();
  let previousDeckItems = [];
  if (previousDeck) {
    const prevIds = previousDeck.items.map((i) => i.taskId);
    if (prevIds.length > 0) {
      const rows = db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(inArray2(tasks.id, prevIds)).all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      previousDeckItems = previousDeck.items.map((it) => {
        const t = byId.get(it.taskId);
        const status = !t ? "gone" : t.status === "done" ? "done" : "active";
        return { taskId: it.taskId, title: t?.title ?? "(removed task)", status };
      });
    }
  }
  const userProfile = void 0;
  const parentTitleMap = /* @__PURE__ */ new Map();
  for (const t of allTasks) parentTitleMap.set(t.id, t.title);
  const promptTasks = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    outcome: t.outcome,
    parentId: t.parentId,
    parentTitle: t.parentId ? parentTitleMap.get(t.parentId) : void 0,
    areaName: t.areaId ? areaMap.get(t.areaId) : void 0,
    energy: t.energy,
    effort: t.effort,
    estimatedMinutes: t.estimatedMinutes,
    hardDeadline: t.hardDeadline,
    lastProgressAt: t.lastProgressAt,
    timesDeferred: t.timesDeferred,
    blockedOn: t.blockedOn,
    userContext: t.userContext,
    subtasks: subtasksByParent.get(t.id)
  }));
  const promptAreas = activeAreas.map((a) => ({
    id: a.id,
    name: a.name,
    userContext: a.userContext,
    status: a.status
  }));
  const promptCompletions = recentCompletions.map((c) => ({
    taskTitle: c.taskTitle,
    completedAt: c.completedAt,
    areaName: c.areaId ? areaMap.get(c.areaId) : void 0
  }));
  const forDate = todayLocalDate();
  const us = getUserState();
  const workdayStart = us?.workdayStart ?? "09:00";
  const workdayEnd = us?.workdayEnd ?? "18:00";
  const calendarBlocks = await getCalendarEventsForDay(forDate);
  const gaps = computeFreeGaps(calendarBlocks, { workdayStart, workdayEnd, date: forDate });
  const calendarMinutes = availableMinutes(gaps);
  const effectiveMinutes = generationContext.availableMinutes ?? us?.availableMinutes ?? calendarMinutes;
  const timeContext = {
    availableMinutes: effectiveMinutes,
    workdayStart,
    workdayEnd,
    hasCalendar: calendarBlocks.length > 0,
    gaps: gaps.map((g2) => ({ label: formatGap(g2), minutes: g2.minutes }))
  };
  const deckInstructions = readDeckInstructions() ?? void 0;
  const basePrompt = buildDeckPrompt({
    tasks: promptTasks,
    areas: promptAreas,
    recentCompletions: promptCompletions,
    previousDeckItems,
    timeContext,
    generationContext,
    userProfile,
    deckInstructions
  });
  const get_day_shape = tool2({
    description: "The user's available work time for a date: busy calendar blocks, free gaps, and total free minutes \u2014 already computed. Use for anything about how much time they have or when to slot work; never do free/busy math yourself.",
    inputSchema: z39.object({
      date: z39.string().optional().describe("YYYY-MM-DD; defaults to today")
    }),
    execute: async ({ date }) => {
      const d = date || forDate;
      try {
        const blocks = d === forDate ? calendarBlocks : await getCalendarEventsForDay(d);
        const g2 = d === forDate ? gaps : computeFreeGaps(blocks, { workdayStart, workdayEnd, date: d });
        return {
          date: d,
          workday: `${workdayStart}-${workdayEnd}`,
          calendarConnected: blocks.length > 0,
          busy: blocks.map((b) => ({ start: b.start, end: b.end, title: b.title })),
          freeGaps: g2.map(formatGap),
          freeMinutes: availableMinutes(g2)
        };
      } catch {
        return { date: d, calendarConnected: false, freeMinutes: null, note: "calendar unavailable" };
      }
    }
  });
  const connectorTools = await getReadOnlyConnectorTools();
  const contextModel = process.env.MODEL_STANDARD || "gpt-5.4-mini";
  let gatheredBrief = "";
  let searchContext = "";
  try {
    const contextResult = await generateText({
      model: openai2(contextModel),
      system: CONTEXT_GATHERING_PROMPT,
      prompt: basePrompt,
      tools: { searchKnowledgeBase, get_day_shape, ...connectorTools },
      stopWhen: stepCountIs(10)
    });
    gatheredBrief = contextResult.text?.trim() ?? "";
    searchContext = collectSearchResults(contextResult.steps);
  } catch (err) {
    console.warn("[deck] context gathering failed, generating without live context", err);
  }
  const liveContext = gatheredBrief ? `

[Live Context]
Gathered from your connected tools and knowledge base:
${gatheredBrief}` : searchContext ? `

[Live Context]
From your notes, stream entries, and related tasks:
${searchContext}` : "";
  const enrichedPrompt = `${basePrompt}${liveContext}`;
  const model = process.env.MODEL_STANDARD || "gpt-5.4-mini";
  const result = await generateText({
    model: openai2(model),
    output: Output.object({ schema: deckResponseSchema }),
    system: DECK_SYSTEM_PROMPT,
    prompt: enrichedPrompt
  });
  const aiResponse = result.output;
  if (!aiResponse) {
    throw new Error("Deck generation produced no output");
  }
  const deckItems = aiResponse.items.map((item) => ({
    taskId: item.taskId,
    rationale: item.rationale,
    continuityContext: item.continuityContext,
    source: "ai",
    slotStart: item.slot?.start ?? null,
    slotEnd: item.slot?.end ?? null,
    slotReason: item.slot?.reason ?? null
  }));
  const prevIdSet = new Set(previousDeckItems.map((p) => p.taskId));
  const newItemIds = new Set(deckItems.map((i) => i.taskId));
  const changes = [];
  const titleById = /* @__PURE__ */ new Map();
  for (const p of previousDeckItems) titleById.set(p.taskId, p.title);
  for (const t of allTasks) titleById.set(t.id, t.title);
  for (const r of aiResponse.reconciliation ?? []) {
    if (!prevIdSet.has(r.taskId)) continue;
    if (r.decision === "carry") {
      if (!newItemIds.has(r.taskId)) continue;
      changes.push({
        kind: "carried",
        taskId: r.taskId,
        title: titleById.get(r.taskId),
        reason: r.reason,
        source: "reconcile"
      });
    } else {
      if (newItemIds.has(r.taskId)) continue;
      changes.push({
        kind: r.decision === "defer" ? "deferred" : "dropped",
        taskId: r.taskId,
        title: titleById.get(r.taskId),
        reason: r.reason,
        source: "reconcile"
      });
    }
  }
  if (previousDeck) {
    for (const item of deckItems) {
      if (!prevIdSet.has(item.taskId)) {
        changes.push({
          kind: "added",
          taskId: item.taskId,
          title: titleById.get(item.taskId),
          reason: item.rationale,
          source: "reconcile"
        });
      }
    }
  }
  return supersedeAndInsertDeck({
    forDate,
    context: generationContext.context ?? null,
    contextTags: generationContext.contextTags ?? [],
    framing: aiResponse.framing ?? null,
    items: deckItems,
    alternatives: aiResponse.alternatives,
    searchContext: gatheredBrief || searchContext || null,
    model,
    origin: opts.origin ?? "manual",
    changes,
    calendarSnapshot: calendarBlocks
  });
}
var searchKnowledgeBase;
var init_generate_deck = __esm({
  "src/lib/ai/generate-deck.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_queries();
    init_date();
    init_calendar();
    init_instructions();
    init_connector_tools();
    init_search();
    init_deck_generation();
    searchKnowledgeBase = tool2({
      description: "Search the user's knowledge base (tasks, notes, and stream-of-consciousness entries) using semantic + keyword hybrid search. Returns matching entities with relevance scores.",
      inputSchema: z39.object({
        query: z39.string().describe("Search query: a topic, keyword, or natural language phrase")
      }),
      execute: async ({ query }) => {
        try {
          return await hybridSearchWithEntities(query, { limit: 8 });
        } catch {
          return [];
        }
      }
    });
  }
});

// src/lib/deck/change-router.ts
function routeChange(change, ctx) {
  const budget = ctx.interruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  if (ctx.mutedKinds?.has(change.kind)) {
    return { channel: "absorb", reason: "muted: you routinely dismiss this kind" };
  }
  const wantsInterrupt = !!change.needsDecision && !!change.timeSensitive;
  if (wantsInterrupt) {
    if (ctx.interruptsToday >= budget) {
      return { channel: "digest", reason: "interrupt-worthy, but the daily interrupt budget is spent" };
    }
    if (ctx.inFocus && change.magnitude !== "major") {
      return { channel: "digest", reason: "held: you\u2019re in a focus block, will surface at your next break" };
    }
    return { channel: "interrupt", reason: "needs your decision and can\u2019t wait" };
  }
  const notable = change.magnitude === "notable" || change.magnitude === "major" || change.touchesPriority === true || change.kind === "bumped" || change.kind === "deferred" || change.kind === "dropped";
  if (notable) {
    return { channel: "digest", reason: "worth knowing, surfaced at a calm moment" };
  }
  return { channel: "absorb", reason: "handled cleanly, discoverable, not pushed" };
}
function routeChanges(changes, ctx) {
  let fired = ctx.interruptsToday;
  return changes.map((change) => {
    const decision = routeChange(change, { ...ctx, interruptsToday: fired });
    if (decision.channel === "interrupt") fired++;
    return { change, decision };
  });
}
var DEFAULT_INTERRUPT_BUDGET;
var init_change_router = __esm({
  "src/lib/deck/change-router.ts"() {
    "use strict";
    DEFAULT_INTERRUPT_BUDGET = 2;
  }
});

// src/lib/deck/reconcile-external.ts
var reconcile_external_exports = {};
__export(reconcile_external_exports, {
  reconcileDeckWithExternalChanges: () => reconcileDeckWithExternalChanges
});
import { inArray as inArray3 } from "drizzle-orm";
function blockKey(b) {
  return `${b.start}|${b.end}|${b.title}`;
}
function diffBlocks(prev, curr) {
  const prevKeys = new Set(prev.map(blockKey));
  const currKeys = new Set(curr.map(blockKey));
  return {
    added: curr.filter((b) => !prevKeys.has(blockKey(b))),
    removed: prev.filter((b) => !currKeys.has(blockKey(b)))
  };
}
function countTodaysInterrupts(date) {
  let n = 0;
  for (const v of getDeckVersions(date)) {
    for (const c of v.changes ?? []) {
      if (c.channel === "interrupt") n++;
    }
  }
  return n;
}
async function reconcileDeckWithExternalChanges(opts = {}) {
  const date = opts.date ?? todayLocalDate();
  const deck = getActiveDeckForDate(date);
  if (!deck) {
    return { changed: false, deck: null, decisions: [], summary: "No active deck for today." };
  }
  if (!hasCalendarProvider()) {
    return { changed: false, deck, decisions: [], summary: "No calendar connected." };
  }
  const current = await getCalendarEventsForDay(date);
  const previous = deck.calendarSnapshot ?? [];
  const diff = diffBlocks(previous, current);
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return { changed: false, deck, decisions: [], summary: "No calendar changes." };
  }
  const { workdayStart, workdayEnd } = getWorkdayBounds();
  const gaps = computeFreeGaps(current, { workdayStart, workdayEnd, date });
  const nowAvailable = availableMinutes(gaps);
  const items = deck.items;
  const ids = items.map((i) => i.taskId);
  const estById = /* @__PURE__ */ new Map();
  const titleById = /* @__PURE__ */ new Map();
  const deadlineById = /* @__PURE__ */ new Map();
  if (ids.length > 0) {
    const db = getDb();
    const rows = db.select({
      id: tasks.id,
      est: tasks.estimatedMinutes,
      title: tasks.title,
      deadline: tasks.hardDeadline
    }).from(tasks).where(inArray3(tasks.id, ids)).all();
    for (const r of rows) {
      estById.set(r.id, r.est ?? DEFAULT_TASK_MINUTES);
      titleById.set(r.id, r.title);
      deadlineById.set(r.id, r.deadline ?? null);
    }
  }
  const itemMinutes = (i) => estById.get(i.taskId) ?? DEFAULT_TASK_MINUTES;
  const keep = [...items];
  const proposals = [];
  let required = keep.reduce((s, i) => s + itemMinutes(i), 0);
  while (current.length > 0 && nowAvailable < required && keep.length > 1) {
    const victim = keep.pop();
    required -= itemMinutes(victim);
    const hasDeadline = !!deadlineById.get(victim.taskId);
    proposals.push({
      kind: "bumped",
      taskId: victim.taskId,
      reason: `A new commitment shrank today to ~${nowAvailable}m of task time. Moved off to keep the day realistic.`,
      source: "calendar",
      touchesPriority: hasDeadline,
      // A hard-deadline item forced off the deck is a real conflict only the
      // user can resolve → escalate it.
      needsDecision: hasDeadline,
      timeSensitive: hasDeadline,
      magnitude: hasDeadline ? "major" : "notable"
    });
  }
  if (proposals.length === 0) {
    return {
      changed: false,
      deck,
      decisions: [],
      summary: "Calendar changed but the deck still fits."
    };
  }
  const decisions = routeChanges(proposals, {
    inFocus: !!opts.inFocus,
    interruptsToday: countTodaysInterrupts(date)
  });
  const changes = decisions.map(({ change, decision }) => ({
    kind: change.kind,
    taskId: change.taskId,
    title: titleById.get(change.taskId),
    reason: change.reason,
    source: "calendar",
    channel: decision.channel
  }));
  const newDeck = supersedeAndInsertDeck({
    forDate: date,
    context: deck.context,
    contextTags: deck.contextTags ?? [],
    framing: deck.framing,
    items: keep,
    alternatives: deck.alternatives,
    searchContext: deck.searchContext,
    model: deck.model,
    origin: "midday",
    changes,
    calendarSnapshot: current
  });
  return {
    changed: true,
    deck: newDeck,
    decisions,
    summary: `Bumped ${proposals.length} item(s) after a calendar change.`
  };
}
var DEFAULT_TASK_MINUTES;
var init_reconcile_external = __esm({
  "src/lib/deck/reconcile-external.ts"() {
    "use strict";
    init_queries();
    init_db();
    init_schema();
    init_date();
    init_calendar();
    init_change_router();
    DEFAULT_TASK_MINUTES = 30;
  }
});

// src/lib/notifications/emit.ts
async function notifyRunTerminal(runId) {
  const run3 = getRun(runId);
  if (!run3 || run3.status !== "completed" && run3.status !== "failed") return;
  const ok2 = run3.status === "completed";
  const trigger = run3.triggerId ? getTrigger(run3.triggerId) : void 0;
  if (!run3.executionId && trigger?.targetKind === "orchestrator") {
    const deliverTo = trigger.deliverResultTo ?? [];
    if (deliverTo.length === 0) return;
    await notify(
      {
        type: "trigger.run_completed",
        userId: trigger.userId,
        dedupeKey: `trigger.run_completed:${runId}`,
        title: trigger.name,
        body: run3.summary ?? (ok2 ? "Scheduled run completed." : "Scheduled run failed."),
        url: `/triggers/${trigger.id}`
      },
      { deliverTo }
    );
    return;
  }
  if (!run3.executionId) return;
  const execution = getExecution(run3.executionId);
  if (!execution) return;
  await notify({
    type: "execution.finished",
    userId: execution.userId,
    dedupeKey: `execution.finished:${runId}`,
    title: `${ok2 ? "\u2705" : "\u274C"} ${execution.label ?? "Execution"}`,
    body: run3.summary ?? (ok2 ? "Execution completed." : "Execution failed."),
    url: `/executions/${execution.id}`
  });
}
async function notifyNeedsInput(args) {
  const session = getChatSession(args.sessionId);
  if (!session) return;
  await notify({
    type: "execution.needs_input",
    userId: session.userId,
    dedupeKey: `execution.needs_input:${args.requestId}`,
    title: args.title,
    body: args.body,
    url: session.executionId ? `/executions/${session.executionId}` : "/"
  });
}
var init_emit = __esm({
  "src/lib/notifications/emit.ts"() {
    "use strict";
    init_queries();
    init_notify();
  }
});

// src/lib/runs/rate-lease.ts
function acquireApiLease() {
  if (state2.inflight < CAPACITY) {
    state2.inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    state2.waiters.push(() => {
      state2.inflight++;
      resolve();
    });
  });
}
function releaseApiLease() {
  state2.inflight = Math.max(0, state2.inflight - 1);
  const next = state2.waiters.shift();
  if (next) next();
}
async function withApiLease(fn) {
  await acquireApiLease();
  try {
    return await fn();
  } finally {
    releaseApiLease();
  }
}
var CAPACITY, STATE_KEY2, globalRef2, state2;
var init_rate_lease = __esm({
  "src/lib/runs/rate-lease.ts"() {
    "use strict";
    CAPACITY = (() => {
      const raw = process.env.FLOW_API_LEASE_CAPACITY;
      if (!raw) return 4;
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
    })();
    STATE_KEY2 = /* @__PURE__ */ Symbol.for("@flow/rate-lease-state");
    globalRef2 = globalThis;
    if (!globalRef2[STATE_KEY2]) {
      globalRef2[STATE_KEY2] = { inflight: 0, waiters: [] };
    }
    state2 = globalRef2[STATE_KEY2];
  }
});

// src/lib/orchestrator/harness-surface.ts
import fs17 from "fs";
import path18 from "path";
function resolveServerPort() {
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  const lastPort = readAuthConfig()?.lastPort;
  if (typeof lastPort === "number" && lastPort > 0) return lastPort;
  return 4224;
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function cliEnvPrefix() {
  const parts = [`${APP_ROOT_ENV}=${shellQuote(getAppRoot())}`];
  const dbOverride = process.env[DB_PATH_ENV];
  if (dbOverride) parts.push(`${DB_PATH_ENV}=${shellQuote(dbOverride)}`);
  return parts.join(" ");
}
function resolveCliCommand() {
  if (process.env[`${APP_SHORT_ID.toUpperCase()}_CLI_COMMAND`]) {
    return process.env[`${APP_SHORT_ID.toUpperCase()}_CLI_COMMAND`];
  }
  const base4 = process.env.NODE_ENV !== "production" ? `pnpm --silent --dir ${process.cwd()} cli:dev` : APP_SHORT_ID;
  return `${cliEnvPrefix()} ${base4}`;
}
function modeSection(mode, cliCommand) {
  switch (mode) {
    case "harness_mcp":
      return `## Your tools (MCP)

The \`${ORCHESTRATOR_MCP_SERVER_NAME}\` MCP server is attached to this session, one typed
tool per action: \`list_tasks\`, \`get_task\`, \`create_task\`, \`update_task\`,
\`complete_task\`, \`list_notes\`, \`get_note\`, \`create_note\`, \`update_note\`,
\`list_stream\`, \`get_stream_item\`, \`create_stream_item\`, \`promote_stream\`,
\`dismiss_stream\`, \`list_areas\`, \`get_area\`, \`create_area\`, \`update_area\`, \`get_deck\`,
\`update_deck\`, \`regenerate_deck\`, \`reconcile_deck\`, \`search\`, \`get_user_state\`,
\`update_user_state\`. Execution oversight via \`list_executions\`,
\`get_session_messages\`, \`send_session_message\`, \`get_pending_input\`,
\`answer_pending_input\`. Plus workspace/trigger/run management and
\`describe_paths\` / \`describe_schema\` / \`list_skills\`.

Use these MCP tools for every read and write. Reading files in your home dir
for ambient context is fine. Writing through anything but the tools is not.

The \`${CONNECTORS_MCP_SERVER_NAME}\` MCP server is also attached when the user has connected
external accounts, typed tools to act on them (e.g. \`gmail__send_email\`,
\`google_calendar__create_event\`, \`slack__post_message\`), provider-namespaced.
When several accounts of a provider are connected, pass \`account\`. A tool may
return a structured next-step (authorization_required, choose_account,
additional_permission_required, approval_required) instead of a result. Relay
it and retry after the user acts. Never improvise an auth flow.`;
    case "harness_skills":
      return `## Your tools (CLI)

Run actions through the CLI via Bash. The command is:

    ${cliCommand} agent <action> [params]

- Output is JSON on stdout. Errors are JSON on stderr with exit code 1.
- Simple params are flags. Complex input goes through \`--input '<json>'\`:

      ${cliCommand} agent list_tasks --status active
      ${cliCommand} agent search "standup notes" --limit 5
      ${cliCommand} agent create_task --input '{"title":"Ship the manifest","effort":"small"}'
      ${cliCommand} agent complete_task <task-id>

- \`${cliCommand} agent --help\` lists every action. \`<action> --help\` shows params.

Use the CLI for every read and write. Reading files in your home dir for
ambient context is fine. Writing through anything but the CLI is not.`;
    case "legacy":
      return "";
  }
}
function renderOrchestratorBrief(mode, cliCommand = resolveCliCommand()) {
  if (mode === "legacy") return renderBaseBrief();
  return `# Orchestrator session

You are ${APP_NAME}'s orchestrator, a productivity agent operating on the
user's behalf inside their task + note + deck system. This directory is the
app's home: the SQLite database, markdown mirror, and attachments live
right here.

**Never edit files here directly.** The markdown mirror is a one-way export
(the app overwrites external edits), and direct writes bypass embeddings,
mirror sync, and attachment derivation. Every mutation goes through the
actions described below. If a capability you need isn't exposed, say so
rather than working around it through the filesystem.

${modeSection(mode, cliCommand)}

${DOMAIN_BRIEF}

The \`orchestrator\` skill carries the deeper writing conventions (title
style, energy/effort defaults, task-vs-note, error envelope). Load it when
you start doing real work.

Debugging or extending ${APP_NAME} itself is a different role: that happens
in the source repo, not here.`;
}
function orchestratorMcpServer(port = resolveServerPort()) {
  const token = readAuthConfig()?.localToken;
  if (!token) {
    console.warn("[harness-surface] no localToken in config.json, skipping MCP attachment");
    return null;
  }
  return {
    name: ORCHESTRATOR_MCP_SERVER_NAME,
    type: "http",
    url: `http://localhost:${port}/api/orchestrator/mcp`,
    headers: { Authorization: `Bearer ${token}` }
  };
}
function connectorsMcpServer(port = resolveServerPort(), opts = {}) {
  const token = readAuthConfig()?.localToken;
  if (!token) return null;
  const base4 = `http://localhost:${port}/api/connectors/mcp`;
  const url = opts.workspaceId ? `${base4}?ws=${encodeURIComponent(opts.workspaceId)}` : base4;
  return {
    name: CONNECTORS_MCP_SERVER_NAME,
    type: "http",
    url,
    headers: { Authorization: `Bearer ${token}` }
  };
}
function removeStaleMcpConfig(root) {
  try {
    fs17.rmSync(path18.join(root, "tmp", "orchestrator-mcp.json"), { force: true });
  } catch {
  }
}
async function installOrchestratorSurface(mode) {
  const root = ensureAppRoot();
  ensureBrainDir();
  const brief = renderOrchestratorBrief(mode);
  const { installInstructions } = await import("@agentex/agent");
  await installInstructions(brief, {
    location: "workspace",
    cwd: root,
    runtimes: ["claude", "codex"],
    managedTag: FLOW_MANAGED_TAG
  });
  removeStaleMcpConfig(root);
  return {
    claudeMdPath: path18.join(root, "CLAUDE.md"),
    agentsMdPath: path18.join(root, "AGENTS.md")
  };
}
function orchestratorSessionConfig(mode, opts = {}) {
  if (mode === "legacy") return {};
  const config = {
    disallowedTools: [...ORCHESTRATOR_DISALLOWED_TOOLS],
    strictMcpConfig: true
  };
  if (mode === "harness_mcp") {
    const servers = [orchestratorMcpServer(opts.port), connectorsMcpServer(opts.port)].filter(
      (s) => s !== null
    );
    if (servers.length > 0) config.mcpServers = servers;
  }
  return config;
}
function renderContentFocusPrompt(focus) {
  const noun = focus.entityType;
  return `# Focused on one ${noun}

You are embedded in the ${noun} editor's side-panel chat. The user is viewing a single ${noun} and your job is to help with THAT ${noun}.

Focused ${noun}: ${noun}:${focus.entityId}

How to work here:
- Read it with \`get_${noun}\` (id "${focus.entityId}") before acting, the user may be editing it in the panel right now, so the tools are the truth, not anything you remember.
- Change it with \`update_${noun}\` using that id. Make the edit directly when asked, then confirm in one line what you changed. The user can review a diff and undo, so act decisively instead of asking permission for routine edits.
- Stay on this ${noun}. Don't read or modify other tasks/notes/areas unless the user explicitly asks you to look beyond it.
- Keep replies short and concrete: this is a narrow side panel, not the full orchestrator chat.`;
}
var ORCHESTRATOR_MCP_SERVER_NAME, CONNECTORS_MCP_SERVER_NAME, DOMAIN_BRIEF, ORCHESTRATOR_DISALLOWED_TOOLS;
var init_harness_surface = __esm({
  "src/lib/orchestrator/harness-surface.ts"() {
    "use strict";
    init_app();
    init_claude_md_template();
    init_paths();
    init_config_file();
    ORCHESTRATOR_MCP_SERVER_NAME = "orchestrator";
    CONNECTORS_MCP_SERVER_NAME = "connectors";
    DOMAIN_BRIEF = `## Personalization & memory

Two user-owned files shape who you're working with and how you show up.
Treat them as authoritative. **Never edit them**, they belong to the user.
On Claude they're imported automatically below. On other harnesses, read
them at the start of a session.

@USER.md
@SOUL.md

Your durable cross-session memory is \`MEMORY.md\`, the record of what
you've learned and decided across conversations. Consult it for past context
and keep it current through your tools. It can grow large, so read it when
relevant rather than assuming it's already in context.

## Domain model

- **Tasks** are action items: title, description, body (markdown), outcome
  (definition of done), status (\`active | done | archived\`), energy
  (\`deep | light\`), effort (\`trivial | small | medium | large | epic\`),
  hardDeadline, recurrence ("daily", "weekly", "monthly", "yearly", or "3d"),
  blockedOn, parentId (subtasks), areaId, contextTags, userContext.
- **Notes**: freeform markdown (ideas, meeting notes, research): body,
  optional title, optional area/task link.
- **Areas**: life/work domains ("Work", "Health"). Tasks and notes belong
  to areas.
- **Deck** is the day's ranked priority stack: 3 to 7 tasks plus alternatives.
  Regenerating runs the full AI prioritization pipeline (slow, only on
  explicit request).
- **Stream** is the quick-capture inbox: brain dumps awaiting triage (see
  Stream triage).
- **User state** is the user's current context: active area/task, energy,
  available minutes, free-text focus.
- **Workspaces & executions**: workspaces are repos/folders the user
  delegates coding work into. Executions are agent sessions running inside
  them. You can watch and steer them (see Execution oversight).

## Stream triage

The stream is the user's zero-friction capture inbox. Your job is to keep it
empty without losing anything:

- \`list_stream\` (defaults to pending) \u2192 for each item decide:
  - **Actionable** \u2192 \`promote_stream\` with \`to=task\` and a shaped
    imperative title ("Ship the manifest", not the raw dump). Use
    \`parentId\` when it's clearly a step of an existing task.
  - **Worth keeping, not actionable** \u2192 \`promote_stream\` with \`to=note\`
    (link \`taskId\`/\`areaId\` when context is clear).
  - **Noise / duplicate / stale** \u2192 \`dismiss_stream\`.
- Promotion preserves the user's raw text as the body and carries
  attachments. Shape the *title*, don't rewrite their words.
- When the right shape is genuinely ambiguous, ask the user instead of
  guessing, or leave it pending. An unforced wrong file is worse than an
  untriaged item.
- Reference what you created with entity markers so the user can inspect.
- \`create_stream_item\` works the other way: when the user gives you
  something that should be kept but isn't clearly a task or note yet, file
  it into the stream rather than force-fitting it.

"Triage my stream every morning" is a one-liner trigger
(\`create_trigger\`, \`target_kind=orchestrator\`).

## Execution oversight

You are the conductor over the executing agents:

- \`list_executions\`: every active execution with status flags: \`running\`
  (turn in flight), \`awaitingInput\` (blocked on a permission/question), and
  \`unread\` (finished output the user hasn't viewed, matches the rail's
  Unread section). "What needs my attention?" = unread + awaitingInput.
- \`get_session_messages\`: the condensed transcript tail of a session.
  **Always read before acting.** Know where the agent actually is.
- \`send_session_message\`: drop a message into an execution: nudge a
  stalled one, add context, redirect. Delivery is asynchronous. Re-check
  the transcript for the response.
- \`get_pending_input\` / \`answer_pending_input\`: when a session is
  \`awaitingInput\`, its turn is **blocked**: queued messages won't reach it
  until the prompt is resolved. Fetch the prompt, then answer it:
  questions (allow=true + answers keyed by question text) when the user's
  intent is clear from context. **Permission prompts default to surfacing
  to the user**, approve only what the user explicitly asked for or has
  delegated to you.

Rules: never send to your own session id. Don't poll executions the user
didn't ask about.

For recurring duties ("check my executions every morning and nudge stalled
ones"), create a trigger with \`target_kind=orchestrator\`. Scheduled fires
run with this same tool surface.

## This conversation is long-running

You are a persistent assistant in one continuous thread that can span days
or weeks, and the user just keeps talking to you. That changes how you work:

- **The world moves between messages.** The user edits tasks in the UI,
  triggers fire, executions finish, all while you're not looking. What
  you fetched earlier in the conversation is a cache. The tools are the
  truth. Re-read state before acting on anything you remember.
- **Your clock may be stale.** The date you were given at session start can
  be days old by the current message. When timing matters (deadlines,
  "today", recurrence), check the current date with \`date\` first.
- **Older context may be compacted** into summaries. If you need exactly
  what was said or decided, look it up (\`search\`, \`get_session_messages\`,
  the entity itself) rather than reconstructing from memory.
- **Pick up mid-conversation.** Never re-introduce yourself, recap
  unprompted, or greet like a new session. Continue the relationship.

## Rules that matter

- **IDs are UUIDs, never names.** Look ids up first (\`list_areas\`,
  \`list_tasks\`, \`search\`) before passing them anywhere.
- **Complete via \`complete_task\`**, never \`update_task\` with
  status=done. Completion records history and rolls recurring tasks.
- **Archive instead of delete.** There are no delete actions by design.
- **Search before creating** to avoid duplicates, and before answering
  "what was I doing about X".
- **Act, don't describe.** When the user asks for something actionable, do
  it with your tools, then confirm briefly.

## Entity references (required)

When you mention a specific task, note, area, deck, or execution, write a
reference so the UI renders an interactive chip:

- \`[[task:UUID]]\` \xB7 \`[[note:UUID]]\` \xB7 \`[[area:UUID]]\` \xB7 \`[[deck:UUID]]\`
- \`[[execution:SESSION_ID]]\`: use the \`sessionId\` from
  \`list_executions\` / \`get_session_messages\`. The chip shows the
  execution's live status and opens it on click. Always include one when
  reporting on an execution.

Formatting rules, these are load-bearing for the UI:

- Plain text only: never inside backticks, code blocks, lists, tables, or
  blockquotes.
- Each reference on its own line at the top level of your reply.
- Prefer a reference over restating an entity's title in prose.

User messages may reference uploaded files as \`[[file:<name>]]\`. The file
lives at \`attachments/<name>\` under your home dir. Read it when you need the
content.

## Output style

- Plain markdown, concise and action-oriented. Bullets over paragraphs.
- Never echo raw JSON or tool output: summarize, then reference entities.
- A brief confirmation plus entity references is the ideal shape of a reply.`;
    ORCHESTRATOR_DISALLOWED_TOOLS = ["Write", "Edit", "NotebookEdit"];
  }
});

// src/lib/executor/event-writer.ts
var localEventWriter;
var init_event_writer = __esm({
  "src/lib/executor/event-writer.ts"() {
    "use strict";
    init_queries();
    localEventWriter = {
      async write(event) {
        insertChatEvent(event);
      }
    };
  }
});

// src/lib/executor/harness.ts
function mapHarnessToProvider(harness) {
  switch (harness) {
    case "claude_code":
      return "claude";
    case "codex":
      return "codex";
    default:
      return harness;
  }
}
var init_harness = __esm({
  "src/lib/executor/harness.ts"() {
    "use strict";
  }
});

// src/lib/executor/pending-input.ts
import { parseAskUserQuestion } from "@agentex/agent";
function classifyRequest(sessionId, req) {
  const questions = parseAskUserQuestion(req);
  if (questions) {
    return {
      kind: "question",
      requestId: req.toolUseId,
      sessionId,
      toolUseId: req.toolUseId,
      questions,
      originalInput: req.input,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    kind: "permission",
    requestId: req.toolUseId,
    sessionId,
    toolUseId: req.toolUseId,
    toolName: req.toolName,
    input: req.input,
    title: req.title ?? null,
    description: req.description ?? null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function register(pending2) {
  return new Promise((resolve, reject) => {
    state3.byId.set(pending2.requestId, { pending: pending2, resolve, reject });
    let set = state3.bySession.get(pending2.sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      state3.bySession.set(pending2.sessionId, set);
    }
    set.add(pending2.requestId);
    notify2(pending2.sessionId);
  });
}
function rejectAllForSession(sessionId, reason) {
  const ids = state3.bySession.get(sessionId);
  if (!ids || ids.size === 0) return;
  for (const id of [...ids]) {
    const entry = state3.byId.get(id);
    if (!entry) continue;
    remove(id);
    entry.resolve({ allow: false, message: reason });
  }
  notify2(sessionId);
}
function listForSession(sessionId) {
  const ids = state3.bySession.get(sessionId);
  if (!ids) return [];
  const out = [];
  for (const id of ids) {
    const entry = state3.byId.get(id);
    if (entry) out.push(entry.pending);
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}
function notify2(sessionId) {
  publishPendingInput(sessionId, listForSession(sessionId));
}
function remove(requestId) {
  const entry = state3.byId.get(requestId);
  if (!entry) return;
  state3.byId.delete(requestId);
  const set = state3.bySession.get(entry.pending.sessionId);
  if (set) {
    set.delete(requestId);
    if (set.size === 0) state3.bySession.delete(entry.pending.sessionId);
  }
}
var STATE_KEY3, globalRef3, state3;
var init_pending_input = __esm({
  "src/lib/executor/pending-input.ts"() {
    "use strict";
    init_bus();
    STATE_KEY3 = /* @__PURE__ */ Symbol.for("@flow/pending-input-state");
    globalRef3 = globalThis;
    if (!globalRef3[STATE_KEY3]) {
      globalRef3[STATE_KEY3] = { byId: /* @__PURE__ */ new Map(), bySession: /* @__PURE__ */ new Map() };
    }
    state3 = globalRef3[STATE_KEY3];
  }
});

// src/lib/pricing/models.json
var models_default;
var init_models = __esm({
  "src/lib/pricing/models.json"() {
    models_default = {
      "anthropic/claude-opus-4-8": {
        input: 1500,
        cached: 150,
        cacheCreation: 1875,
        output: 7500
      },
      "anthropic/claude-opus-4-7": {
        input: 1500,
        cached: 150,
        cacheCreation: 1875,
        output: 7500
      },
      "anthropic/claude-opus-4-6": {
        input: 1500,
        cached: 150,
        cacheCreation: 1875,
        output: 7500
      },
      "anthropic/claude-sonnet-4-6": {
        input: 300,
        cached: 30,
        cacheCreation: 375,
        output: 1500
      },
      "anthropic/claude-sonnet-4-5": {
        input: 300,
        cached: 30,
        cacheCreation: 375,
        output: 1500
      },
      "anthropic/claude-haiku-4-5": {
        input: 100,
        cached: 10,
        cacheCreation: 125,
        output: 500
      },
      "openai/gpt-5": {
        input: 250,
        cached: 25,
        cacheCreation: 250,
        output: 1e3
      },
      "openai/gpt-5-mini": {
        input: 50,
        cached: 5,
        cacheCreation: 50,
        output: 200
      }
    };
  }
});

// src/lib/pricing/models.ts
function warnUnknownModelOnce(model) {
  if (warnedUnknownModels.has(model)) return;
  warnedUnknownModels.add(model);
  console.warn(
    `[pricing] no entry for model "${model}". Cost will fall back to the provider's reported costUsd or zero. Add a row to src/lib/pricing/models.json to enable accurate fallback.`
  );
}
function pricingFor(model) {
  if (!model) return ZERO_PRICING;
  const candidates = pricingCandidates(model);
  for (const id of candidates) {
    if (TABLE[id]) return TABLE[id];
  }
  warnUnknownModelOnce(model);
  return ZERO_PRICING;
}
function pricingCandidates(model) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const prefixed = (id) => {
    if (id.includes("/")) return [id];
    return [id, `anthropic/${id}`, `openai/${id}`];
  };
  for (const id of prefixed(model)) add(id);
  const stripped = model.replace(/-\d{8}$/, "");
  if (stripped !== model) {
    for (const id of prefixed(stripped)) add(id);
  }
  const tier = stripped.replace(/(gpt-?\d+)\.\d+/i, "$1");
  if (tier !== stripped) {
    for (const id of prefixed(tier)) add(id);
  }
  return out;
}
function costForUsage(model, usage) {
  const p = pricingFor(model);
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cached3 = usage.cachedInputTokens ?? 0;
  const creation = usage.cacheCreationInputTokens ?? 0;
  const cents = (input * p.input + output * p.output + cached3 * p.cached + creation * p.cacheCreation) / 1e6;
  return cents / 100;
}
function captureFromResultEvent(event) {
  if (!event || typeof event !== "object") {
    return {
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0
    };
  }
  const e = event;
  const model = e.model ?? null;
  const usage = e.usage ?? {};
  const inputTokens = Number(usage.inputTokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? 0) || 0;
  const cachedInputTokens = Number(usage.cachedInputTokens ?? 0) || 0;
  const cacheCreationInputTokens = Number(usage.cacheCreationInputTokens ?? 0) || 0;
  const reported = typeof e.costUsd === "number" && Number.isFinite(e.costUsd) ? e.costUsd : null;
  const costUsd = reported != null ? reported : costForUsage(model, { inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens });
  return { model, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, costUsd };
}
var TABLE, ZERO_PRICING, warnedUnknownModels;
var init_models2 = __esm({
  "src/lib/pricing/models.ts"() {
    "use strict";
    init_models();
    TABLE = models_default;
    ZERO_PRICING = { input: 0, cached: 0, cacheCreation: 0, output: 0 };
    warnedUnknownModels = /* @__PURE__ */ new Set();
  }
});

// src/lib/runs/artifact-bucket.ts
function refKey(ref) {
  return `${ref.kind}:${ref.id}`;
}
function beginRun(runId, chatSessionId) {
  state4.bySession.set(chatSessionId, runId);
  if (!state4.byRun.has(runId)) state4.byRun.set(runId, /* @__PURE__ */ new Map());
}
function endRun(runId, chatSessionId) {
  const current = state4.bySession.get(chatSessionId);
  if (current === runId) state4.bySession.delete(chatSessionId);
  const accum = state4.byRun.get(runId);
  state4.byRun.delete(runId);
  return accum ? Array.from(accum.values()) : [];
}
function getActiveRunForSession(chatSessionId) {
  return state4.bySession.get(chatSessionId) ?? null;
}
function pushArtifactRef(runId, ref) {
  const bucket = state4.byRun.get(runId);
  if (!bucket) return;
  bucket.set(refKey(ref), ref);
}
function peekArtifactRefs(runId) {
  const bucket = state4.byRun.get(runId);
  return bucket ? Array.from(bucket.values()) : [];
}
async function runWith(runId, chatSessionId, body) {
  beginRun(runId, chatSessionId);
  try {
    return await body();
  } finally {
    endRun(runId, chatSessionId);
  }
}
var STATE_KEY4, globalRef4, state4, runArtifactBucket;
var init_artifact_bucket = __esm({
  "src/lib/runs/artifact-bucket.ts"() {
    "use strict";
    STATE_KEY4 = /* @__PURE__ */ Symbol.for("@flow/run-artifact-bucket");
    globalRef4 = globalThis;
    if (!globalRef4[STATE_KEY4]) {
      globalRef4[STATE_KEY4] = { bySession: /* @__PURE__ */ new Map(), byRun: /* @__PURE__ */ new Map() };
    }
    state4 = globalRef4[STATE_KEY4];
    runArtifactBucket = {
      beginRun,
      endRun,
      pushArtifactRef,
      peekArtifactRefs,
      getActiveRunForSession,
      runWith
    };
  }
});

// src/lib/runs/event-hooks.ts
async function handleRunStreamEvent(chatSessionId, event) {
  const runId = getActiveRunForSession(chatSessionId);
  if (!runId) return;
  switch (event.type) {
    case "tool_result":
      handleToolResult(runId, event);
      return;
    case "result":
      await handleResultEvent(runId, chatSessionId, event);
      return;
    default:
      return;
  }
}
function handleToolResult(runId, event) {
  if (event.type !== "tool_result") return;
  if (event.isError) return;
  const toolName = consumeToolCallName(event.toolCallId);
  if (!toolName) return;
  const kind = MUTATION_TOOL_TO_KIND[toolName];
  if (!kind) return;
  const id = extractEntityIdFromToolResult(event, kind);
  if (!id) return;
  pushArtifactRef(runId, { kind, id });
}
async function handleResultEvent(runId, chatSessionId, event) {
  if (event.type !== "result") return;
  const usage = captureFromResultEvent(event);
  const current = getRun(runId);
  if (!current) return;
  const sumPositive = (a, b) => (a ?? 0) + b;
  const summary = extractSummaryFromChat(chatSessionId) ?? current.summary;
  updateRun(runId, {
    model: current.model ?? usage.model,
    inputTokens: sumPositive(current.inputTokens, usage.inputTokens),
    outputTokens: sumPositive(current.outputTokens, usage.outputTokens),
    cachedInputTokens: sumPositive(current.cachedInputTokens, usage.cachedInputTokens),
    cacheCreationInputTokens: sumPositive(current.cacheCreationInputTokens, usage.cacheCreationInputTokens),
    costUsd: sumPositive(current.costUsd, usage.costUsd),
    summary,
    artifactRefs: peekArtifactRefs(runId)
  });
}
function registerToolCallName(toolCallId, toolName) {
  toolCallNames.set(toolCallId, toolName);
}
function consumeToolCallName(toolCallId) {
  if (!toolCallId) return null;
  const name = toolCallNames.get(toolCallId);
  if (name) toolCallNames.delete(toolCallId);
  return name ?? null;
}
function extractEntityIdFromToolResult(event, kind) {
  if (kind === "memory") return "MEMORY.md";
  const content = event.content;
  if (!content) return null;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "id" in parsed && typeof parsed.id === "string") {
          return parsed.id;
        }
      } catch {
      }
    }
    if (UUID_V7_RE.test(trimmed)) return trimmed;
    return null;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      const text2 = part?.text;
      if (typeof text2 === "string") {
        return extractEntityIdFromToolResult(
          { ...event, content: text2 },
          kind
        );
      }
    }
  }
  return null;
}
function extractSummaryFromChat(chatSessionId) {
  const events = listRecentChatEvents(chatSessionId, 50);
  for (const evt of events) {
    if (evt.role === "assistant" && evt.source === "agent" && evt.content) {
      const plain2 = stripMarkdown(evt.content);
      return truncate4(plain2, 200);
    }
  }
  return null;
}
function stripMarkdown(text2) {
  return text2.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]+)`/g, "$1").replace(/^#+\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(.*?)\1/g, "$2").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/\s+/g, " ").trim();
}
function truncate4(text2, max) {
  if (text2.length <= max) return text2;
  return text2.slice(0, max).trim() + "\u2026";
}
var UUID_V7_RE, MUTATION_TOOL_TO_KIND, STATE_KEY5, globalRef5, toolCallNames;
var init_event_hooks = __esm({
  "src/lib/runs/event-hooks.ts"() {
    "use strict";
    init_queries();
    init_models2();
    init_artifact_bucket();
    UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    MUTATION_TOOL_TO_KIND = {
      create_task: "task",
      update_task: "task",
      complete_task: "task",
      create_note: "note",
      update_note: "note",
      create_workspace: "workspace",
      archive_workspace: "workspace",
      // Memory edits land on a single sentinel; multiple per run dedupe.
      update_memory: "memory"
    };
    STATE_KEY5 = /* @__PURE__ */ Symbol.for("@flow/tool-call-name-cache");
    globalRef5 = globalThis;
    if (!globalRef5[STATE_KEY5]) globalRef5[STATE_KEY5] = /* @__PURE__ */ new Map();
    toolCallNames = globalRef5[STATE_KEY5];
  }
});

// src/lib/runs/budget.ts
function firstOfMonthUtcIso(now = /* @__PURE__ */ new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}
function currentMonthSpend(now = /* @__PURE__ */ new Date()) {
  return sumRunCostSince(firstOfMonthUtcIso(now));
}
function budgetSnapshot(now = /* @__PURE__ */ new Date()) {
  const us = getUserState();
  const budget = us?.monthlyBudgetUsd ?? null;
  const spend = currentMonthSpend(now);
  if (budget == null || budget <= 0) {
    return { budget, spend, fraction: null, state: "ok" };
  }
  const fraction = spend / budget;
  let state5 = "ok";
  if (fraction >= 1) state5 = "block";
  else if (fraction >= 0.75) state5 = "warn";
  return { budget, spend, fraction, state: state5 };
}
function budgetGate(now = /* @__PURE__ */ new Date()) {
  return budgetSnapshot(now).state;
}
var BUDGET_DISABLED_REASON;
var init_budget = __esm({
  "src/lib/runs/budget.ts"() {
    "use strict";
    init_queries();
    BUDGET_DISABLED_REASON = "budget_exceeded";
  }
});

// src/lib/executor/adapter.ts
var adapter_exports = {};
__export(adapter_exports, {
  ExecutorError: () => ExecutorError,
  _recordSessionInventory: () => _recordSessionInventory,
  _resetExecutorState: () => _resetExecutorState,
  abort: () => abort,
  close: () => close,
  dispatch: () => dispatch,
  forceClearInflight: () => forceClearInflight,
  getSessionInventory: () => getSessionInventory,
  invalidateAgentSession: () => invalidateAgentSession,
  isAgentSessionAlive: () => isAgentSessionAlive,
  isRunning: () => isRunning,
  listRunningSessions: () => listRunningSessions,
  parseStreamEvent: () => parseStreamEvent,
  persistStreamEvent: () => persistStreamEvent,
  recycleForModeChange: () => recycleForModeChange,
  recycleWorkspaceSessions: () => recycleWorkspaceSessions,
  resolveCwd: () => resolveCwd,
  stopTask: () => stopTask
});
import { existsSync as existsSync2 } from "fs";
import { uuidv7 as uuidv74 } from "uuidv7";
import { getProvider, commandInventoryFromEvent } from "@agentex/agent";
function setRunning(chatSessionId, running) {
  const wasRunning = runningSessions.has(chatSessionId);
  if (running) runningSessions.add(chatSessionId);
  else runningSessions.delete(chatSessionId);
  if (wasRunning !== running) {
    publishRuntime(chatSessionId, running);
  }
}
function listRunningSessions() {
  return Array.from(runningSessions);
}
function getSessionInventory(chatSessionId) {
  return sessionInventories.get(chatSessionId) ?? null;
}
function _recordSessionInventory(chatSessionId, event) {
  const inventory = commandInventoryFromEvent(event);
  if (inventory && !sessionInventories.has(chatSessionId)) {
    sessionInventories.set(chatSessionId, inventory);
  }
}
function _resetExecutorState() {
  agentSessions.clear();
  runningSessions.clear();
  inflightCount.clear();
  sessionInventories.clear();
}
function isRunning(chatSessionId) {
  return runningSessions.has(chatSessionId);
}
function isAgentSessionAlive(chatSessionId) {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return false;
  if (handle.state === "closed") return false;
  const proc = handle.proc;
  if (!proc) return true;
  if (proc.killed) return false;
  if (proc.exitCode !== null && proc.exitCode !== void 0) return false;
  return true;
}
function invalidateAgentSession(chatSessionId) {
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
}
function forceClearInflight(chatSessionId) {
  inflightCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
}
function startInflight(chatSessionId) {
  const next = (inflightCount.get(chatSessionId) ?? 0) + 1;
  inflightCount.set(chatSessionId, next);
  if (next === 1) setRunning(chatSessionId, true);
}
function endInflight(chatSessionId) {
  const cur = inflightCount.get(chatSessionId) ?? 0;
  const next = cur - 1;
  if (next <= 0) {
    inflightCount.delete(chatSessionId);
    setRunning(chatSessionId, false);
  } else {
    inflightCount.set(chatSessionId, next);
  }
}
async function dispatch(chatSessionId, userMessage, writer = localEventWriter, options = {}) {
  const session = getChatSessionWithExecution(chatSessionId);
  if (!session) throw new ExecutorError("not_found", `Session not found: ${chatSessionId}`);
  const agent = getAgent(session.agentId);
  if (!agent) throw new ExecutorError("not_found", `Agent not found: ${session.agentId}`);
  const selection = explicitAgentSelection(
    providerIdForHarness(agent.harness),
    { model: session.model, effort: session.effort }
  );
  if (selection.model !== session.model || selection.effort !== session.effort) {
    updateChatSession(session.id, {
      model: selection.model,
      effort: selection.effort
    });
  }
  if (!options.internalCall) {
    const savedSelection = getUserState();
    if (savedSelection?.defaultAgentHarness !== selection.providerId || savedSelection?.defaultAgentModel !== selection.model || savedSelection?.defaultAgentEffort !== selection.effort) {
      updateUserState({
        defaultAgentHarness: selection.providerId,
        defaultAgentModel: selection.model,
        defaultAgentEffort: selection.effort
      });
    }
  }
  const cwd = resolveCwd(session);
  if (!cwd) throw new ExecutorError("invalid_state", "Session has no resolvable cwd");
  if (!options.internalCall && !options.overBudget) {
    if (budgetGate() === "block") {
      throw new ExecutorError(
        "budget_exceeded",
        'Monthly budget exceeded. Send again with "over budget" confirmation to proceed.'
      );
    }
  }
  const provider2 = getProvider(mapHarnessToProvider(agent.harness));
  if (!provider2.capabilities.concurrentSend && inflightCount.has(chatSessionId)) {
    throw new ExecutorError(
      "already_running",
      "This provider does not support concurrent send."
    );
  }
  let manualRun = null;
  if (!options.internalCall) {
    const created = createRun({
      triggerId: null,
      workspaceId: session.workspaceId ?? null,
      executionId: session.executionId ?? null,
      chatSessionId,
      agentId: session.agentId,
      triggerKind: "manual",
      triggerPayload: null,
      scheduledFor: null,
      status: "queued"
    });
    markRunStarted(created.id);
    beginRun(created.id, chatSessionId);
    manualRun = { runId: created.id, ownsLifecycle: true };
  }
  startInflight(chatSessionId);
  try {
    const agentSession = await ensureAgentSession({
      chatSessionId,
      harness: agent.harness,
      cwd,
      sessionType: session.type,
      workspaceId: session.workspaceId ?? null,
      surfaceKind: session.surfaceKind,
      surfaceRef: session.surfaceRef,
      existingExternalSessionId: session.externalSessionId,
      permissionMode: session.permissionMode,
      model: selection.model,
      effort: selection.effort,
      writer
    });
    const { result } = await agentSession.send(userMessage);
    await result;
    if (manualRun?.ownsLifecycle) {
      markRunCompleted(manualRun.runId);
      void notifyRunTerminal(manualRun.runId).catch(() => {
      });
    }
  } catch (err) {
    if (manualRun?.ownsLifecycle) {
      markRunFailed(manualRun.runId, {
        errorCode: "agent_error",
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      void notifyRunTerminal(manualRun.runId).catch(() => {
      });
      try {
        bumpSessionOutcome(chatSessionId);
      } catch {
      }
    }
    throw err;
  } finally {
    endInflight(chatSessionId);
    if (manualRun?.ownsLifecycle) {
      endRun(manualRun.runId, chatSessionId);
    }
  }
}
async function abort(chatSessionId) {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  await handle.interrupt();
}
async function stopTask(chatSessionId, taskId) {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return { stopped: false };
  return handle.stopTask(taskId);
}
async function close(chatSessionId) {
  const handle = agentSessions.get(chatSessionId);
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
  inflightCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
  rejectAllForSession(chatSessionId, "Session closed");
  if (handle) {
    try {
      await handle.close();
    } catch {
    }
  }
}
async function recycleWorkspaceSessions(workspaceId) {
  const sessions = listChatSessions({ workspaceId, status: "active", type: "execution" });
  await Promise.all(sessions.map((s) => recycleForModeChange(s.id)));
}
async function recycleForModeChange(chatSessionId) {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
  try {
    await handle.close();
  } catch {
  }
}
function resolveOrchestratorMode() {
  const mode = getUserState()?.orchestratorMode;
  return mode === "harness_skills" || mode === "harness_mcp" ? mode : "harness_mcp";
}
async function ensureAgentSession(args) {
  const cached3 = agentSessions.get(args.chatSessionId);
  if (cached3) {
    if (isAgentSessionAlive(args.chatSessionId)) return cached3;
    invalidateAgentSession(args.chatSessionId);
  }
  const providerType = mapHarnessToProvider(args.harness);
  const provider2 = getProvider(providerType);
  if (!provider2.createSession) {
    throw new ExecutorError(
      "unsupported",
      `Provider "${providerType}" does not implement multi-turn createSession`
    );
  }
  const claudeMode = claudePermissionFlag(args.permissionMode);
  const config = {};
  const extraArgs = [];
  if (claudeMode) extraArgs.push("--permission-mode", claudeMode);
  if (args.model) config.model = args.model;
  if (args.effort) config.effort = args.effort;
  if (args.sessionType === "orchestration" || args.sessionType === "content") {
    const orchestratorMode = resolveOrchestratorMode();
    try {
      await installOrchestratorSurface(orchestratorMode);
      Object.assign(config, orchestratorSessionConfig(orchestratorMode));
      if (args.sessionType === "content" && providerType === "claude" && (args.surfaceKind === "task" || args.surfaceKind === "note") && args.surfaceRef) {
        extraArgs.push(
          "--append-system-prompt",
          renderContentFocusPrompt({ entityType: args.surfaceKind, entityId: args.surfaceRef })
        );
      }
      if (providerType !== "claude") {
        console.warn(
          `[executor] ${args.sessionType} session on provider "${providerType}": surface installed, but tool filtering / MCP attachment are ignored by this provider (no write guard).`
        );
      }
    } catch (err) {
      console.error("[executor] orchestrator surface install failed:", err);
    }
  }
  if (args.sessionType === "execution") {
    if (providerType === "claude") {
      config.strictMcpConfig = true;
      const scopes = args.workspaceId ? getWorkspace(args.workspaceId)?.connectorScopes ?? [] : [];
      if (scopes.length > 0 && args.workspaceId) {
        const server = connectorsMcpServer(void 0, { workspaceId: args.workspaceId });
        if (server) config.mcpServers = [server];
      }
    } else {
      const wantsConnectors = args.workspaceId ? (getWorkspace(args.workspaceId)?.connectorScopes.length ?? 0) > 0 : false;
      if (wantsConnectors) {
        console.warn(
          `[executor] execution on provider "${providerType}": connectors are unavailable (this harness does not enforce strict MCP tool-filtering).`
        );
      }
    }
  }
  if (extraArgs.length > 0) config.extraArgs = extraArgs;
  if (args.sessionType === "execution") {
    try {
      const cleanup = await removeOwnedProjectSkillLinks(args.cwd);
      if (cleanup.entries.some((entry) => entry.status === "error")) {
        console.warn("[executor] failed to clean one or more legacy project skill links");
      }
    } catch (err) {
      console.warn("[executor] failed to clean legacy project skill links:", err);
    }
  }
  const skillDirs = resolveSkillDirsForSession(args.cwd);
  if (skillDirs.length > 0) config.skillDirs = skillDirs;
  const handle = await provider2.createSession({
    cwd: args.cwd,
    sessionParams: args.existingExternalSessionId ? { sessionId: args.existingExternalSessionId } : void 0,
    config: Object.keys(config).length > 0 ? config : void 0,
    onUserInputRequest: (req) => handleUserInputRequest(args.chatSessionId, args.writer, req),
    onEvent: async (event) => {
      try {
        _recordSessionInventory(args.chatSessionId, event);
        await persistStreamEvent(args.chatSessionId, event, args.writer);
        capturePromotedSessionId(args.chatSessionId, event);
        await handleRunStreamEventSafe(args.chatSessionId, event);
      } catch (err) {
        console.error(`[executor] failed to persist event for ${args.chatSessionId}:`, err);
      }
    }
  });
  agentSessions.set(args.chatSessionId, handle);
  return handle;
}
function claudePermissionFlag(mode) {
  switch (mode) {
    case "bypass":
      return null;
    case "default":
      return "default";
    case "accept_edits":
      return "acceptEdits";
    case "plan":
      return "plan";
  }
}
async function handleUserInputRequest(chatSessionId, writer, req) {
  const session = getChatSession(chatSessionId);
  const mode = session?.permissionMode ?? "bypass";
  const pending2 = classifyRequest(chatSessionId, req);
  if (mode === "bypass" && pending2.kind === "permission") {
    return { allow: true, updatedInput: req.input };
  }
  try {
    await writer.write(buildPendingRequestEvent(chatSessionId, pending2));
  } catch (err) {
    console.error(`[executor] failed to persist pending event for ${chatSessionId}:`, err);
  }
  void notifyNeedsInput({
    sessionId: chatSessionId,
    requestId: pending2.requestId,
    title: pending2.kind === "permission" ? `Permission: ${pending2.toolName}` : "Agent has a question",
    body: pending2.kind === "permission" ? pending2.title ?? pending2.description ?? "The agent needs permission to continue." : "The agent is waiting for your answer."
  }).catch(() => {
  });
  const response = await register(pending2);
  try {
    await writer.write(buildPendingResponseEvent(chatSessionId, pending2, response));
  } catch (err) {
    console.error(`[executor] failed to persist response event for ${chatSessionId}:`, err);
  }
  if (pending2.kind === "permission" && pending2.toolName === "ExitPlanMode" && response.allow) {
    revertFromPlanMode(chatSessionId);
  }
  return response;
}
function revertFromPlanMode(chatSessionId) {
  const session = getChatSession(chatSessionId);
  if (!session || session.permissionMode !== "plan") return;
  const target = session.prePlanMode ?? "bypass";
  try {
    updateChatSession(chatSessionId, {
      permissionMode: target,
      prePlanMode: null
    });
  } catch (err) {
    console.error(`[executor] failed to revert plan mode for ${chatSessionId}:`, err);
  }
}
function buildPendingRequestEvent(chatSessionId, pending2) {
  const base4 = {
    sessionId: chatSessionId,
    externalEventId: uuidv74(),
    externalToolCallId: pending2.toolUseId,
    role: "system",
    createdAt: pending2.createdAt
  };
  if (pending2.kind === "question") {
    return {
      ...base4,
      source: "question_request",
      content: null,
      toolInput: { questions: pending2.questions },
      raw: { kind: "question", questions: pending2.questions }
    };
  }
  return {
    ...base4,
    source: "permission_request",
    content: pending2.title ?? pending2.description ?? null,
    toolName: pending2.toolName,
    toolInput: pending2.input,
    raw: {
      kind: "permission",
      title: pending2.title,
      description: pending2.description
    }
  };
}
function buildPendingResponseEvent(chatSessionId, pending2, response) {
  const base4 = {
    sessionId: chatSessionId,
    externalEventId: uuidv74(),
    externalToolCallId: pending2.toolUseId,
    role: "system",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (pending2.kind === "question") {
    const answers = response.updatedInput?.answers ?? null;
    return {
      ...base4,
      source: "question_response",
      content: answers ? formatAnswerSummary(answers) : "declined",
      toolInput: { answers, allow: response.allow },
      raw: { allow: response.allow, answers }
    };
  }
  return {
    ...base4,
    source: "permission_response",
    content: response.allow ? "allowed" : response.message ?? "denied",
    toolName: pending2.toolName,
    toolIsError: !response.allow,
    raw: {
      allow: response.allow,
      message: response.message ?? null
    }
  };
}
function formatAnswerSummary(answers) {
  return Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join("\n");
}
function formatRateLimitContent(status, limitType, resetAt) {
  const window = limitType ? limitType.replace(/_/g, " ") : null;
  const resetTime = resetAt ? formatResetTime(resetAt) : null;
  const lead = status === "exceeded" ? "Rate limit hit" : status === "blocked" ? "Request blocked" : `Rate limit (${status})`;
  const parts = [lead, window ? `\xB7 ${window}` : null, resetTime ? `\xB7 resets ${resetTime}` : null];
  return parts.filter(Boolean).join(" ");
}
function formatResetTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = /* @__PURE__ */ new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const day = date.toLocaleDateString(void 0, { weekday: "short" });
  return `${day} ${time}`;
}
function capturePromotedSessionId(chatSessionId, event) {
  if (event.type !== "system") return;
  if (!event.sessionId) return;
  const session = getChatSession(chatSessionId);
  if (!session || session.externalSessionId === event.sessionId) return;
  updateChatSession(chatSessionId, { externalSessionId: event.sessionId });
}
async function handleRunStreamEventSafe(chatSessionId, event) {
  try {
    if (event.type === "tool_call" && event.toolCallId) {
      registerToolCallName(event.toolCallId, event.name);
    }
    await handleRunStreamEvent(chatSessionId, event);
  } catch (err) {
    console.warn(`[runs] telemetry hook failed for ${chatSessionId}:`, err);
  }
}
async function persistStreamEvent(chatSessionId, event, writer = localEventWriter) {
  const row2 = parseStreamEvent(chatSessionId, event);
  if (!row2) return;
  await writer.write(row2);
}
function parseStreamEvent(chatSessionId, event) {
  const externalEventId = event.eventId ?? uuidv74();
  const createdAt = event.timestamp || (/* @__PURE__ */ new Date()).toISOString();
  const base4 = {
    sessionId: chatSessionId,
    externalEventId,
    raw: event,
    createdAt
  };
  switch (event.type) {
    case "system":
      return {
        ...base4,
        role: "system",
        source: "system",
        content: event.subtype ?? null
      };
    case "assistant":
      return {
        ...base4,
        role: "assistant",
        source: "agent",
        content: event.text ?? null
      };
    case "thinking":
      return {
        ...base4,
        role: "assistant",
        source: "thinking",
        content: event.text ?? null
      };
    case "tool_call":
      return {
        ...base4,
        role: "assistant",
        source: "tool_call",
        content: null,
        toolName: event.name,
        toolInput: event.input ?? null,
        externalToolCallId: event.toolCallId ?? null
      };
    case "tool_result":
      return {
        ...base4,
        role: "tool",
        source: "tool_result",
        content: event.content ?? null,
        toolIsError: event.isError ?? false,
        externalToolCallId: event.toolCallId ?? null
      };
    case "result":
      return {
        ...base4,
        role: "system",
        source: "result",
        content: null,
        toolIsError: event.isError ?? false
      };
    case "auth_required": {
      return {
        ...base4,
        role: "system",
        source: "auth_required",
        content: event.message ?? "Claude needs to log in again",
        toolInput: {
          httpStatus: event.httpStatus,
          reason: event.reason,
          loginCommand: event.loginCommand,
          providerType: event.providerType
        }
      };
    }
    case "rate_limit": {
      const ev = event;
      const status = (ev.status ?? "").toLowerCase();
      const isThrottle = status === "exceeded" || status === "blocked" || status === "limited" || status === "throttled";
      if (!isThrottle) return null;
      const friendly = formatRateLimitContent(status, ev.limitType ?? null, ev.resetAt ?? null);
      return {
        ...base4,
        role: "system",
        source: "rate_limit",
        content: friendly
      };
    }
    case "unknown":
      return mapUnknownEvent(chatSessionId, event, externalEventId, createdAt);
    default: {
      const fallback = event;
      return {
        sessionId: chatSessionId,
        externalEventId,
        role: "system",
        source: "unknown",
        content: fallback.type ?? null,
        raw: event,
        createdAt: fallback.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
      };
    }
  }
}
function mapUnknownEvent(chatSessionId, event, externalEventId, createdAt) {
  const ev = event;
  const claudeSubtype = typeof ev.raw?.["subtype"] === "string" ? ev.raw["subtype"] : null;
  const codexMethod = typeof ev.raw?.["method"] === "string" ? ev.raw["method"] : null;
  const subtype = claudeSubtype ?? codexMethod ?? ev.subtype ?? null;
  const rawContent = typeof ev.raw?.["content"] === "string" ? ev.raw["content"] : null;
  const base4 = {
    sessionId: chatSessionId,
    externalEventId,
    raw: event,
    createdAt
  };
  if (subtype !== null && CLAUDE_DISK_ONLY_NOISE.has(subtype)) {
    return null;
  }
  switch (subtype) {
    case "compact_boundary":
      return {
        ...base4,
        role: "system",
        source: "recap",
        content: "Context compacted"
      };
    case "api_error":
      return {
        ...base4,
        role: "system",
        source: "error",
        content: rawContent ?? "API error"
      };
    case "turn_duration":
      return null;
    case "away_summary":
    case "bridge_status":
    case null:
      return {
        ...base4,
        role: "system",
        source: "system",
        content: rawContent ?? subtype ?? null
      };
    default:
      return {
        ...base4,
        role: "system",
        source: "system",
        content: subtype
      };
  }
}
function resolveCwd(session) {
  if (session.worktreePath && existsSync2(session.worktreePath)) return session.worktreePath;
  if (!session.workspaceId) {
    return getAppRoot();
  }
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return null;
  if (workspace.isGit) return null;
  return workspace.cwd ?? null;
}
var ExecutorError, STATE_KEY6, globalRef6, agentSessions, runningSessions, inflightCount, sessionInventories, CLAUDE_DISK_ONLY_NOISE;
var init_adapter = __esm({
  "src/lib/executor/adapter.ts"() {
    "use strict";
    init_queries();
    init_paths();
    init_harness_surface();
    init_event_writer();
    init_harness();
    init_pending_input();
    init_bus();
    init_event_hooks();
    init_skills();
    init_artifact_bucket();
    init_queries();
    init_emit();
    init_budget();
    init_agent_options();
    init_shipped();
    ExecutorError = class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ExecutorError";
      }
    };
    STATE_KEY6 = /* @__PURE__ */ Symbol.for("@flow/executor-state");
    globalRef6 = globalThis;
    if (!globalRef6[STATE_KEY6]) {
      globalRef6[STATE_KEY6] = {
        agentSessions: /* @__PURE__ */ new Map(),
        runningSessions: /* @__PURE__ */ new Set(),
        inflightCount: /* @__PURE__ */ new Map(),
        sessionInventories: /* @__PURE__ */ new Map()
      };
    } else {
      if (!globalRef6[STATE_KEY6].sessionInventories) {
        globalRef6[STATE_KEY6].sessionInventories = /* @__PURE__ */ new Map();
      }
      if (!globalRef6[STATE_KEY6].inflightCount) {
        globalRef6[STATE_KEY6].inflightCount = /* @__PURE__ */ new Map();
      }
    }
    ({ agentSessions, runningSessions, inflightCount, sessionInventories } = globalRef6[STATE_KEY6]);
    CLAUDE_DISK_ONLY_NOISE = /* @__PURE__ */ new Set([
      "ai-title",
      "last-prompt",
      "attachment",
      "progress"
    ]);
  }
});

// src/lib/workspaces/files-to-copy.ts
import * as fs18 from "fs/promises";
import * as path19 from "path";
import picomatch from "picomatch";
function expandFilesToCopyPatterns(patterns) {
  const expanded = /* @__PURE__ */ new Set();
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    expanded.add(trimmed);
    if (!trimmed.includes("/") && !trimmed.startsWith("**")) {
      expanded.add(`**/${trimmed}`);
    }
  }
  return Array.from(expanded);
}
async function* walkFiles(root, relPrefix) {
  const here = path19.join(root, relPrefix);
  let entries;
  try {
    entries = await fs18.readdir(here, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(root, rel);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield rel;
    }
  }
}
async function copyFilesToWorktree(sourceCwd, destDir, patterns) {
  const expanded = expandFilesToCopyPatterns(patterns);
  if (expanded.length === 0) return 0;
  const matchers = expanded.map((p) => picomatch(p, { dot: true }));
  let copied = 0;
  for await (const rel of walkFiles(sourceCwd, "")) {
    if (!matchers.some((m) => m(rel))) continue;
    try {
      const to = path19.join(destDir, rel);
      await fs18.mkdir(path19.dirname(to), { recursive: true });
      await fs18.copyFile(path19.join(sourceCwd, rel), to);
      copied++;
    } catch {
    }
  }
  return copied;
}
var ALWAYS_SKIP;
var init_files_to_copy = __esm({
  "src/lib/workspaces/files-to-copy.ts"() {
    "use strict";
    ALWAYS_SKIP = /* @__PURE__ */ new Set([
      ".git",
      "node_modules",
      ".next",
      "dist",
      "build",
      ".cache",
      ".turbo",
      "coverage",
      "target",
      "vendor",
      ".venv",
      "venv",
      "__pycache__"
    ]);
  }
});

// src/lib/terminal/pty-manager.ts
import * as nodePty from "node-pty";
import * as fs19 from "fs";
import { randomUUID as randomUUID2 } from "crypto";
var MAX_BUFFER_BYTES, g, terminals;
var init_pty_manager = __esm({
  "src/lib/terminal/pty-manager.ts"() {
    "use strict";
    init_sanitize_child_env();
    MAX_BUFFER_BYTES = 256 * 1024;
    g = globalThis;
    if (!g.__ptyRegistry) g.__ptyRegistry = { terminals: /* @__PURE__ */ new Map() };
    terminals = g.__ptyRegistry.terminals;
  }
});

// src/lib/sessions/dispatch.ts
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
import { uuidv7 as uuidv75 } from "uuidv7";
async function provisionWorktreeForSession(args) {
  const { ws, executionId, sessionId, label, baseBranchOverride, prNumber, resume } = args;
  try {
    let worktree = null;
    if (resume) {
      worktree = await resumeWorktreeForSession({
        ws,
        worktreePath: resume.worktreePath,
        branch: resume.branch,
        baseSha: resume.baseSha,
        sessionId
      });
    }
    if (!worktree) {
      let baseRef = baseBranchOverride;
      if (prNumber !== null) {
        const fetched = await fetchPrHead({ ws, prNumber });
        baseRef = fetched.ref;
      }
      worktree = await createWorktreeForSession({
        ws,
        sessionId,
        sessionLabel: label,
        baseBranchOverride: baseRef
      });
    }
    markExecutionSetupComplete(executionId, {
      worktreePath: worktree.path,
      branchName: worktree.branch,
      baseSha: worktree.baseSha
    });
    if (worktree.path !== ws.cwd) {
      void runBackgroundProvisioning(executionId, ws, worktree.path, worktree.branch);
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[dispatch] worktree provisioning failed for execution ${executionId}:`, msg);
    recordExecutionSetupError(executionId, msg);
  }
}
async function runBackgroundProvisioning(executionId, ws, worktreePath, branch) {
  try {
    await copyFilesToWorktree(ws.cwd, worktreePath, ws.filesToCopy ?? []);
  } catch (err) {
    console.warn(`[dispatch] file copy failed for execution ${executionId}:`, err);
  }
  if (!ws.setupCommand?.trim()) return;
  setExecutionSetupScript(executionId, "running", null);
  try {
    const res = await runWorktreeScript({
      command: ws.setupCommand,
      worktreePath,
      sourceCheckoutPath: ws.cwd,
      branch
    });
    setExecutionSetupScript(
      executionId,
      res.ok ? "done" : "failed",
      res.ok ? null : tailLines(res.output)
    );
  } catch (err) {
    setExecutionSetupScript(executionId, "failed", err instanceof Error ? err.message : String(err));
  }
}
var execFileAsync2;
var init_dispatch = __esm({
  "src/lib/sessions/dispatch.ts"() {
    "use strict";
    init_queries();
    init_workspaces();
    init_files_to_copy();
    init_pty_manager();
    init_adapter();
    init_agent_options();
    execFileAsync2 = promisify2(execFile2);
  }
});

// src/lib/runs/dispatch.ts
var dispatch_exports = {};
__export(dispatch_exports, {
  dispatchRun: () => dispatchRun,
  ensureWorktreeReady: () => ensureWorktreeReady
});
import { existsSync as fsExistsSync } from "fs";
import { uuidv7 as uuidv76 } from "uuidv7";
import { eq as eq4 } from "drizzle-orm";
async function dispatchRun(args) {
  const { trigger, triggerKind: triggerKind2, triggerPayload = null, scheduledFor = null } = args;
  if (budgetGate() === "block") {
    updateTrigger(trigger.id, {
      enabled: false,
      disabledReason: BUDGET_DISABLED_REASON
    });
    const skipped = recordSkipped({
      trigger,
      executionId: null,
      workspaceId: trigger.workspaceId ?? null,
      chatSessionId: null,
      triggerKind: triggerKind2,
      triggerPayload,
      scheduledFor,
      reason: BUDGET_DISABLED_REASON
    });
    setTriggerLastRun(trigger.id, skipped.id, "skipped");
    return { run: skipped, chatSession: null };
  }
  const resolved = resolveTarget(trigger);
  const blocker = resolved.execution ? findActiveRunForExecution(resolved.execution.id) : findActiveRunForTrigger(trigger.id);
  if (blocker) {
    let policy = trigger.concurrencyPolicy;
    if (policy === "allow_concurrent" && resolved.execution) {
      console.warn(
        `[dispatch] trigger "${trigger.name}": allow_concurrent treated as skip_if_running for workspace target (executions-spec \xA75). True parallel execution mutation is a V2 feature.`
      );
      policy = "skip_if_running";
    }
    const desiredReason = triggerConcurrencyReason(policy);
    if (desiredReason !== null) {
      const wantsCoalesce = policy === "coalesce_if_active";
      const canCoalesce = wantsCoalesce && !!blocker.chatSessionId;
      if (canCoalesce) {
        appendCoalescedMessage({
          blockerChatSessionId: blocker.chatSessionId,
          trigger,
          triggerPayload
        });
      }
      let reason;
      if (canCoalesce) {
        reason = desiredReason;
      } else if (resolved.execution && blocker.triggerId !== trigger.id) {
        reason = "execution_busy";
      } else {
        reason = "trigger_busy";
      }
      const skipped = recordSkipped({
        trigger,
        executionId: resolved.execution?.id ?? null,
        workspaceId: resolved.execution?.workspaceId ?? trigger.workspaceId ?? null,
        // Link the skipped row back to the chat that absorbed the
        // prompt so it isn't orphaned in the inbox; null when we
        // degraded to plain skip.
        chatSessionId: canCoalesce ? blocker.chatSessionId : null,
        triggerKind: triggerKind2,
        triggerPayload,
        scheduledFor,
        reason
      });
      setTriggerLastRun(trigger.id, skipped.id, "skipped");
      return { run: skipped, chatSession: null };
    }
  }
  const chat = resolved.chat ?? createChatForFire(trigger, resolved.execution);
  const run3 = createRun({
    triggerId: trigger.id,
    workspaceId: resolved.execution?.workspaceId ?? trigger.workspaceId ?? null,
    executionId: resolved.execution?.id ?? null,
    chatSessionId: chat.id,
    agentId: trigger.agentId,
    triggerKind: triggerKind2,
    triggerPayload,
    scheduledFor,
    status: "queued"
  });
  if (!chat.createdByRunId) {
    const db = getDb();
    db.update(chatSessions).set({ createdByRunId: run3.id }).where(eq4(chatSessions.id, chat.id)).run();
  }
  markRunStarted(run3.id);
  void runUnderLease(run3.id, chat.id, trigger, resolved.execution, triggerPayload);
  return { run: run3, chatSession: chat };
}
function resolveTarget(trigger) {
  if (trigger.targetKind === "orchestrator") {
    return { execution: null, chat: null };
  }
  if (trigger.kind === "at" || trigger.kind === "manual") {
    if (!trigger.workspaceId) {
      throw new Error(`Trigger ${trigger.id} targets workspace but has no workspace_id`);
    }
    const ws = getWorkspace(trigger.workspaceId);
    const { execution: execution2, session } = createExecutionWithChat({
      workspaceId: trigger.workspaceId,
      agentId: trigger.agentId,
      label: trigger.name,
      setupStartedAt: ws?.isGit ? (/* @__PURE__ */ new Date()).toISOString() : null,
      model: trigger.model,
      effort: trigger.effort
    });
    return { execution: execution2, chat: session };
  }
  if (!trigger.workspaceId) {
    throw new Error(`Trigger ${trigger.id} targets workspace but has no workspace_id`);
  }
  let execution = null;
  if (trigger.owningExecutionId) {
    const existing = getExecution(trigger.owningExecutionId);
    if (existing && existing.status === "active") execution = existing;
  }
  if (!execution) {
    const ws = getWorkspace(trigger.workspaceId);
    const created = createExecutionWithChat({
      workspaceId: trigger.workspaceId,
      agentId: trigger.agentId,
      label: trigger.name,
      setupStartedAt: ws?.isGit ? (/* @__PURE__ */ new Date()).toISOString() : null,
      model: trigger.model,
      effort: trigger.effort
    });
    execution = created.execution;
    updateTrigger(trigger.id, { owningExecutionId: execution.id });
    return { execution, chat: created.session };
  }
  return { execution, chat: null };
}
function createChatForFire(trigger, execution) {
  const db = getDb();
  const id = uuidv76();
  return db.insert(chatSessions).values({
    id,
    agentId: trigger.agentId,
    type: execution ? "execution" : "orchestration",
    workspaceId: execution?.workspaceId ?? trigger.workspaceId ?? null,
    executionId: execution?.id ?? null,
    label: trigger.name,
    status: "active",
    // Propagate the trigger's per-run overrides onto the chat so the
    // executor adapter's `ensureAgentSession` picks them up via the
    // session row (it reads model/effort/permissionMode/etc. fresh
    // each turn). Trigger edits to model/effort take effect on the
    // next fire's chat — existing chats keep their snapshot.
    ...trigger.model !== null ? { model: trigger.model } : {},
    ...trigger.effort !== null ? { effort: trigger.effort } : {}
  }).returning().get();
}
function triggerConcurrencyReason(policy) {
  switch (policy) {
    case "skip_if_running":
      return "trigger_busy";
    case "coalesce_if_active":
      return "coalesced_into_active";
    case "allow_concurrent":
      return null;
  }
}
function appendCoalescedMessage(args) {
  const content = composeCoalescedContent(args.trigger, args.triggerPayload);
  try {
    insertChatEvent({
      sessionId: args.blockerChatSessionId,
      role: "user",
      source: "user",
      content,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    console.warn(`[dispatch] coalesce: failed to persist user event for ${args.blockerChatSessionId}:`, err);
    return;
  }
  void dispatch(args.blockerChatSessionId, content, void 0, { internalCall: true }).catch((err) => {
    console.warn(`[dispatch] coalesce: executor send failed for ${args.blockerChatSessionId}:`, err);
  });
}
function composeCoalescedContent(trigger, triggerPayload) {
  const header = `[from trigger ${trigger.name}]`;
  return `${header}

${composePromptWithPayload(trigger.prompt, triggerPayload)}`;
}
function recordSkipped(args) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return createRun({
    triggerId: args.trigger.id,
    executionId: args.executionId,
    workspaceId: args.workspaceId,
    chatSessionId: args.chatSessionId,
    agentId: args.trigger.agentId,
    triggerKind: args.triggerKind,
    triggerPayload: args.triggerPayload,
    scheduledFor: args.scheduledFor,
    status: "skipped",
    statusReason: args.reason,
    queuedAt: now,
    completedAt: now
  });
}
async function runUnderLease(runId, chatSessionId, trigger, execution, triggerPayload) {
  try {
    const ready = await ensureWorktreeReady(chatSessionId, execution);
    if (!ready.ok) {
      finalizeRunFailure(runId, trigger.id, new ProvisioningError(ready.error));
      updateTrigger(trigger.id, {
        enabled: false,
        disabledReason: "worktree_setup_failed"
      });
      bumpSessionOutcome(chatSessionId);
      return;
    }
    await withApiLease(async () => {
      const prompt = composePromptWithPayload(trigger.prompt, triggerPayload);
      try {
        insertChatEvent({
          sessionId: chatSessionId,
          role: "user",
          source: "user",
          content: prompt,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        console.warn(`[dispatch] failed to persist scheduled prompt event for ${chatSessionId}:`, err);
      }
      await runArtifactBucket.runWith(
        runId,
        chatSessionId,
        () => runWithTimeout(
          chatSessionId,
          trigger,
          () => dispatch(chatSessionId, prompt, void 0, { internalCall: true })
        )
      );
    });
    finalizeRunSuccessIfPending(runId, trigger.id);
  } catch (err) {
    finalizeRunFailure(runId, trigger.id, err);
  }
  bumpSessionOutcome(chatSessionId);
}
async function ensureWorktreeReady(chatSessionId, execution) {
  if (!execution) return { ok: true };
  const ws = getWorkspace(execution.workspaceId);
  if (!ws) return { ok: false, error: `Workspace ${execution.workspaceId} not found` };
  if (!ws.isGit) return { ok: true };
  if (execution.worktreePath && fsExistsSync(execution.worktreePath)) {
    return { ok: true };
  }
  if (execution.worktreePath && !fsExistsSync(execution.worktreePath)) {
    console.warn(
      `[dispatch] execution ${execution.id} worktreePath ${execution.worktreePath} is missing, reprovisioning`
    );
    resetExecutionForReprovision(execution.id);
  } else if (execution.setupError) {
    return { ok: false, error: `Worktree setup previously failed: ${execution.setupError}` };
  }
  await provisionWorktreeForSession({
    ws,
    executionId: execution.id,
    sessionId: chatSessionId,
    label: execution.label,
    baseBranchOverride: null,
    prNumber: execution.prNumber ?? null
  });
  const refreshed = getExecution(execution.id);
  if (!refreshed) return { ok: false, error: `Execution ${execution.id} vanished mid-provision` };
  if (refreshed.setupError) {
    return { ok: false, error: refreshed.setupError };
  }
  if (!refreshed.worktreePath || !fsExistsSync(refreshed.worktreePath)) {
    return { ok: false, error: "Worktree provisioning produced no usable path" };
  }
  return { ok: true };
}
async function runWithTimeout(chatSessionId, trigger, body) {
  const seconds = trigger.timeoutSeconds;
  if (!seconds || seconds <= 0) return body();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort(chatSessionId).catch(() => {
      });
      reject(new RunTimeoutError(seconds));
    }, seconds * 1e3);
  });
  try {
    return await Promise.race([body(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function composePromptWithPayload(prompt, payload) {
  if (payload == null) return prompt;
  if (typeof payload === "string") {
    return `${prompt}

--- trigger payload ---
${payload}`;
  }
  return `${prompt}

--- trigger payload (JSON) ---
\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``;
}
function finalizeRunSuccessIfPending(runId, triggerId) {
  const completed = markRunCompleted(runId);
  if (completed && completed.status === "completed" && triggerId) {
    setTriggerLastRun(triggerId, runId, "completed");
  }
  void notifyRunTerminal(runId).catch(() => {
  });
}
function finalizeRunFailure(runId, triggerId, err) {
  const message = err instanceof Error ? err.message : String(err);
  const errorCode = err instanceof ProvisioningError ? "worktree_setup_failed" : err instanceof RunTimeoutError ? "timeout" : "agent_error";
  markRunFailed(runId, { errorCode, errorMessage: message });
  if (triggerId) setTriggerLastRun(triggerId, runId, "failed");
  void notifyRunTerminal(runId).catch(() => {
  });
}
var ProvisioningError, RunTimeoutError;
var init_dispatch2 = __esm({
  "src/lib/runs/dispatch.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_queries();
    init_emit();
    init_rate_lease();
    init_adapter();
    init_dispatch();
    init_artifact_bucket();
    init_budget();
    ProvisioningError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "ProvisioningError";
      }
    };
    RunTimeoutError = class extends Error {
      constructor(timeoutSeconds) {
        super(`Run exceeded ${timeoutSeconds}s timeout`);
        this.timeoutSeconds = timeoutSeconds;
        this.name = "RunTimeoutError";
      }
    };
  }
});

// src/lib/scheduler/frequency.ts
var frequency_exports = {};
__export(frequency_exports, {
  describeFrequency: () => describeFrequency,
  frequencyToTrigger: () => frequencyToTrigger,
  triggerToFrequency: () => triggerToFrequency
});
function frequencyToTrigger(choice) {
  switch (choice.kind) {
    case "manual":
      return { kind: "manual", cronExpression: null };
    case "webhook":
      return { kind: "webhook", cronExpression: null };
    case "hourly":
      return { kind: "cron", cronExpression: "0 * * * *" };
    case "daily": {
      const { minute, hour } = parseHHMM(choice.time ?? "09:00");
      return { kind: "cron", cronExpression: `${minute} ${hour} * * *` };
    }
    case "weekly": {
      const { minute, hour } = parseHHMM(choice.time ?? "09:00");
      const dow = choice.weekday ?? 1;
      return { kind: "cron", cronExpression: `${minute} ${hour} * * ${dow}` };
    }
    case "monthly": {
      const { minute, hour } = parseHHMM(choice.time ?? "09:00");
      const dom = clampDay(choice.dayOfMonth ?? 1);
      return { kind: "cron", cronExpression: `${minute} ${hour} ${dom} * *` };
    }
    case "custom": {
      const expr = (choice.cronExpression ?? "").trim();
      if (!expr) throw new Error("custom cron requires a non-empty expression");
      return { kind: "cron", cronExpression: expr };
    }
  }
}
function triggerToFrequency(row2) {
  if (row2.kind === "manual") return { kind: "manual" };
  if (row2.kind === "webhook") return { kind: "webhook" };
  if (row2.kind !== "cron") return { kind: "custom", cronExpression: row2.cronExpression ?? "" };
  const expr = (row2.cronExpression ?? "").trim();
  if (!expr) return { kind: "custom", cronExpression: "" };
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { kind: "custom", cronExpression: expr };
  const [m, h, dom, month, dow] = parts;
  const minuteNum = Number(m);
  const hourNum = Number(h);
  const isInt = Number.isInteger(minuteNum) && Number.isInteger(hourNum);
  if (m === "0" && h === "*" && dom === "*" && month === "*" && dow === "*") {
    return { kind: "hourly" };
  }
  if (isInt && dom === "*" && month === "*" && dow === "*") {
    return { kind: "daily", time: formatHHMM(hourNum, minuteNum) };
  }
  const dowNum = Number(dow);
  if (isInt && dom === "*" && month === "*" && Number.isInteger(dowNum) && dowNum >= 0 && dowNum <= 6) {
    return {
      kind: "weekly",
      time: formatHHMM(hourNum, minuteNum),
      weekday: dowNum
    };
  }
  const domNum = Number(dom);
  if (isInt && month === "*" && dow === "*" && Number.isInteger(domNum) && domNum >= 1 && domNum <= 28) {
    return {
      kind: "monthly",
      time: formatHHMM(hourNum, minuteNum),
      dayOfMonth: domNum
    };
  }
  return { kind: "custom", cronExpression: expr };
}
function describeFrequency(row2) {
  if (row2.kind === "manual") return "Manual (Run now only)";
  if (row2.kind === "webhook") return "Webhook";
  if (row2.kind === "every") return `every ${row2.intervalSeconds ?? "?"}s`;
  if (row2.kind === "at") {
    return row2.runAt ? `once at ${formatIso(row2.runAt)}` : "once (no time)";
  }
  const choice = triggerToFrequency(row2);
  switch (choice.kind) {
    case "hourly":
      return "Hourly";
    case "daily":
      return `Daily at ${humanTime(choice.time)}`;
    case "weekly":
      return `Weekly on ${weekdayName(choice.weekday)} at ${humanTime(choice.time)}`;
    case "monthly":
      return `Monthly on the ${ordinal(choice.dayOfMonth)} at ${humanTime(choice.time)}`;
    case "custom":
      return `cron \`${row2.cronExpression}\` (${row2.timezone ?? "UTC"})`;
    default:
      return row2.cronExpression ?? "-";
  }
}
function parseHHMM(s) {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time "${s}", expected HH:MM`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Time "${s}" out of range`);
  }
  return { hour, minute };
}
function formatHHMM(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function humanTime(hhmm) {
  const { hour, minute } = parseHHMM(hhmm);
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}
function weekdayName(d) {
  return WEEKDAYS[d] ?? "Monday";
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
function clampDay(n) {
  if (!Number.isInteger(n) || n < 1) return 1;
  if (n > 28) return 28;
  return n;
}
function formatIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
var WEEKDAYS;
var init_frequency = __esm({
  "src/lib/scheduler/frequency.ts"() {
    "use strict";
    WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  }
});

// src/cli/index.ts
init_app();
import { Command } from "commander";

// src/cli/commands/start.ts
init_app();
init_bootstrap();
init_port();
init_db();
import { intro as intro2, outro as outro2, log as log2, spinner as spinner2 } from "@clack/prompts";
import pc3 from "picocolors";
import getPort from "get-port";

// src/lib/config/voice.ts
init_config_file();
function getVoiceEnabled() {
  return readAuthConfig()?.voiceEnabled === true;
}
function setVoiceEnabled(enabled) {
  writeAuthConfig({ voiceEnabled: enabled });
}

// src/lib/config/onboarded.ts
init_config_file();
function getIsOnboarded() {
  const config = readAuthConfig();
  return !!config?.onboardedAt;
}
function markOnboarded() {
  writeAuthConfig({ onboardedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function getOnboardedAt() {
  const config = readAuthConfig();
  if (!config?.onboardedAt) return null;
  const d = new Date(config.onboardedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

// src/cli/commands/start.ts
init_paths();

// src/cli/lib/server.ts
import { spawn, spawnSync } from "child_process";
import { createRequire } from "module";
var require2 = createRequire(import.meta.url);
function startNextServer(opts) {
  const nextBin = require2.resolve("next/dist/bin/next");
  const subcommand = opts.dev ? "dev" : "start";
  if (opts.portlessName) {
    return spawn(
      "portless",
      [opts.portlessName, process.execPath, nextBin, subcommand],
      { stdio: ["ignore", "inherit", "inherit"], env: process.env }
    );
  }
  return spawn(process.execPath, [nextBin, subcommand, "-p", String(opts.port)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(opts.port) }
  });
}
function isPortlessInstalled() {
  return spawnSync("command", ["-v", "portless"], {
    stdio: "ignore",
    shell: true
  }).status === 0;
}
async function waitForServer(baseUrl, timeoutMs = 3e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probe = await probeHealth(baseUrl);
    if (probe.status === "ok") return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not respond at ${baseUrl} within ${timeoutMs}ms`);
}
async function isOurServerRunning(baseUrl) {
  return (await probeHealth(baseUrl)).status === "ok";
}
async function probeHealth(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      if (res.status >= 502 && res.status <= 504) return { status: "offline" };
      return { status: "unknown-app", detail: `HTTP ${res.status}` };
    }
    const body = await res.json();
    if (typeof body.port !== "number" || typeof body.app !== "string") {
      return { status: "unknown-app", detail: "health response missing fields" };
    }
    return { status: "ok", info: { ok: body.ok ?? true, app: body.app, port: body.port } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(detail)) {
      return { status: "offline" };
    }
    return { status: "unreachable", detail };
  }
}

// src/cli/lib/browser.ts
import open from "open";
async function openBrowser(url) {
  await open(url);
}

// src/cli/commands/start.ts
init_shipped();

// src/lib/agent-skills/project-cleanup.ts
init_queries();
init_shipped();
async function cleanupKnownProjectSkillLinks() {
  const dirs = /* @__PURE__ */ new Set();
  try {
    for (const status of ["active", "archived"]) {
      for (const workspace of listWorkspaces({ status })) {
        if (workspace.cwd) dirs.add(workspace.cwd);
      }
    }
    for (const session of listChatSessions({ type: "execution" })) {
      if (session.worktreePath) dirs.add(session.worktreePath);
    }
  } catch {
    return { scanned: 0, removed: 0, errors: 1 };
  }
  let removed = 0;
  let errors = 0;
  for (const cwd of dirs) {
    try {
      const result = await removeOwnedProjectSkillLinks(cwd);
      removed += result.removed;
      errors += result.entries.filter((entry) => entry.status === "error").length;
    } catch {
      errors += 1;
    }
  }
  return { scanned: dirs.size, removed, errors };
}

// src/cli/commands/onboard.ts
init_app();
init_bootstrap();
init_db();
import { intro, outro, log, confirm, select, isCancel, spinner } from "@clack/prompts";
import pc from "picocolors";
init_shipped();

// src/cli/lib/voice.ts
import { spawn as spawn2 } from "child_process";
import path8 from "path";
var VOICE_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? "http://localhost:5092";
var DEFAULT_SERVICE = "parakeet-cpu";
function getVoiceContext(overrideService) {
  return {
    serviceUrl: VOICE_URL,
    composeFile: resolveComposeFile(),
    service: overrideService ?? DEFAULT_SERVICE
  };
}
function resolveComposeFile() {
  const override = process.env.FLOW_VOICE_COMPOSE;
  if (override) return override;
  return path8.resolve(process.cwd(), "modules/parakeet-stt/docker-compose.yml");
}
async function isDockerAvailable(timeoutMs = 5e3) {
  return new Promise((resolve) => {
    const child = spawn2("docker", ["info"], { stdio: "ignore" });
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(false);
    }, timeoutMs);
    timer.unref();
    child.on("exit", (code) => done(code === 0));
    child.on("error", () => done(false));
  });
}
async function isVoiceReady(ctx = getVoiceContext()) {
  try {
    const res = await fetch(`${ctx.serviceUrl}/health`, {
      signal: AbortSignal.timeout(1e3)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function startVoiceService(ctx = getVoiceContext()) {
  await runDockerCompose(["-f", ctx.composeFile, "up", "-d", ctx.service]);
}
async function stopVoiceService(ctx = getVoiceContext()) {
  await runDockerCompose(["-f", ctx.composeFile, "stop", ctx.service]).catch(() => {
  });
}
async function waitForVoiceReady(ctx = getVoiceContext(), timeoutMs = 18e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isVoiceReady(ctx)) return;
    await new Promise((r) => setTimeout(r, 1e3));
  }
  throw new Error(`Voice service did not become ready within ${timeoutMs}ms`);
}
function runDockerCompose(args) {
  return new Promise((resolve, reject) => {
    const child = spawn2("docker", ["compose", ...args], {
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// src/cli/commands/onboard.ts
async function onboardCommand(opts) {
  intro(pc.bgCyan(pc.black(` ${APP_NAME} onboard `)));
  const port = Number(opts.port ?? 4224);
  const s = spinner();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  const baseUrl = getLocalBaseUrl();
  const serverRunning = await isOurServerRunning(baseUrl);
  const alreadyOnboarded = getIsOnboarded();
  if (!alreadyOnboarded || opts.force) {
    if (opts.force && alreadyOnboarded) {
      log.info("Re-running setup (--force)");
    }
    await runWizard();
    markOnboarded();
    log.success("Setup complete");
    const startNow = await confirm({
      message: serverRunning ? "Server is already running. Open it now?" : "Start the server now?",
      initialValue: true
    });
    if (isCancel(startNow) || !startNow) {
      outro("All set. Run the default command anytime to start.");
      return;
    }
    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro(`Opened ${baseUrl}`);
      return;
    }
    outro("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }
  const at = getOnboardedAt();
  const whenLine = at ? pc.dim(`(onboarded ${at.toLocaleDateString()})`) : "";
  log.info(`You're already set up ${whenLine}`);
  const options = [];
  if (serverRunning) {
    options.push({ value: "open", label: "Open in browser", hint: baseUrl });
  } else {
    options.push({ value: "start", label: "Start the server" });
  }
  options.push({ value: "update", label: "Update configuration" });
  options.push({ value: "cancel", label: "Cancel" });
  const action2 = await select({
    message: "What would you like to do?",
    options
  });
  if (isCancel(action2) || action2 === "cancel") {
    outro("No changes.");
    return;
  }
  if (action2 === "open") {
    await openBrowser(info.pairingUrl);
    outro(`Opened http://localhost:${port}`);
    return;
  }
  if (action2 === "start") {
    outro("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }
  if (action2 === "update") {
    await runWizard();
    markOnboarded();
    log.success("Configuration updated");
    const followUp = await confirm({
      message: serverRunning ? "Server is running with the previous config. Open it?" : "Start the server now?",
      initialValue: true
    });
    if (isCancel(followUp) || !followUp) {
      outro("Done.");
      return;
    }
    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro(`Opened ${baseUrl}`);
      return;
    }
    outro("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
  }
}
async function runWizard() {
  const dockerOk = await isDockerAvailable();
  const currentPref = getVoiceEnabled();
  const voiceMsg = dockerOk ? "Enable voice (local speech-to-text via Docker/Parakeet)?" : "Enable voice? Docker is not running, so voice will stay off until you start it.";
  const voice = await confirm({
    message: voiceMsg,
    initialValue: dockerOk ? currentPref || currentPref === null : false
  });
  if (isCancel(voice)) {
    throw new Error("Setup cancelled");
  }
  setVoiceEnabled(!!voice);
  if (voice && !dockerOk) {
    log.info("Voice is enabled. Start Docker before running the server to activate it.");
  }
  const globalSkill = await confirm({
    message: "Make task and note actions available to agents in every project?",
    initialValue: getGlobalSkillPreference() ?? true
  });
  if (isCancel(globalSkill)) {
    throw new Error("Setup cancelled");
  }
  const skillResult = await configureGlobalSkill(!!globalSkill);
  if (skillResult.enabled) {
    if (skillResult.install.errors > 0) {
      throw new Error("Could not install the user-level productivity skill");
    }
    if (skillResult.install.conflicts > 0) {
      log.warn("A user-level skill named orchestrator already exists and was left unchanged.");
    }
  }
}

// src/cli/commands/doctor.ts
init_config_file();
init_paths();
import fs8 from "fs";
import net from "net";
import pc2 from "picocolors";
var defaultPort = Number(process.env.PORT ?? 4224);
var checks = [
  {
    name: "App root directory",
    run: () => {
      const dir = getAppRoot();
      const exists = fs8.existsSync(dir);
      return { ok: exists || true, detail: dir };
    }
  },
  {
    name: "Database file",
    run: () => {
      const p = getDbPath();
      const exists = fs8.existsSync(p);
      return {
        ok: true,
        detail: exists ? p : `will be created on first start (${p})`
      };
    }
  },
  {
    name: "Pairing token",
    run: () => {
      const config = readAuthConfig();
      return {
        ok: !!config?.localToken,
        detail: config?.localToken ? "present" : "missing. Run the `pair` command"
      };
    }
  },
  {
    name: `Default port available (${defaultPort})`,
    run: async () => {
      const free = await isPortFree(defaultPort);
      return {
        ok: free,
        detail: free ? "free" : `port ${defaultPort} is in use`
      };
    }
  },
  {
    name: "Voice (Parakeet STT)",
    run: async () => {
      const wanted = getVoiceEnabled();
      if (!wanted) return { ok: true, detail: "disabled in config" };
      if (await isVoiceReady()) return { ok: true, detail: "running" };
      if (!await isDockerAvailable()) {
        return { ok: false, detail: "enabled, but Docker daemon is not running" };
      }
      return { ok: true, detail: "enabled, will start on server launch" };
    }
  }
];
async function doctorCommand() {
  const results = await runDoctorChecks();
  printDoctorChecks(results);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
async function runDoctorChecks() {
  const out = [];
  for (const check of checks) {
    const result = await run(check);
    out.push({ name: check.name, ...result });
  }
  return out;
}
function printDoctorChecks(results, options = {}) {
  const failures = results.filter((r) => !r.ok);
  if (options.compact && failures.length === 0) {
    console.log(pc2.green("\u2713") + ` Diagnostics passed (${results.length} checks)`);
    return;
  }
  const toPrint = options.compact ? failures : results;
  for (const result of toPrint) {
    const icon = result.ok ? pc2.green("\u2713") : pc2.red("\u2717");
    const detail = result.detail ? pc2.dim(`: ${result.detail}`) : "";
    console.log(`${icon} ${result.name}${detail}`);
  }
}
async function run(check) {
  try {
    return await check.run();
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

// src/cli/commands/start.ts
function resolvePortless(opt) {
  if (!opt) return null;
  const name = typeof opt === "string" ? opt.trim() : APP_SHORT_ID;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new Error(
      `Invalid --portless name '${name}'. Use letters, digits, and hyphens (no leading hyphen).`
    );
  }
  return { name, url: `https://${name}.localhost` };
}
async function startCommand(opts) {
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }
  if (opts.hot) {
    process.env.NEXT_PUBLIC_HOT = "1";
  }
  intro2(pc3.bgCyan(pc3.black(` ${APP_NAME} `)));
  if (opts.dev) {
    log2.info(pc3.dim(`Data root: ${process.env[APP_ROOT_ENV]}`));
  }
  if (opts.hot) {
    log2.info(pc3.dim("Hot-path tracker enabled (NEXT_PUBLIC_HOT=1), see src/lib/_debug/hot-path.ts"));
  }
  const portless = resolvePortless(opts.portless);
  if (portless && !isPortlessInstalled()) {
    log2.error(
      `--portless requires the \`portless\` CLI on PATH. Install it from https://portless.sh and retry.`
    );
    process.exit(1);
  }
  setStaticUrl(portless?.url ?? null);
  const preferredPort = Number(opts.port ?? (opts.dev ? DEV_PORT : DEFAULT_PORT));
  const s = spinner2();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  try {
    const projectSkillCleanup = await cleanupKnownProjectSkillLinks();
    if (projectSkillCleanup.removed > 0) {
      log2.success(`Removed ${projectSkillCleanup.removed} legacy project skill symlink(s)`);
    }
    if (projectSkillCleanup.errors > 0) {
      log2.warn(`Could not inspect ${projectSkillCleanup.errors} legacy project skill target(s)`);
    }
  } catch (err) {
    log2.warn(
      `Legacy project skill cleanup skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  try {
    const appRootResult = await installAppRootSkills();
    if (appRootResult.installed > 0) {
      log2.success(`Installed ${appRootResult.installed} skill symlink(s) in the app data dir`);
    }
    if (getGlobalSkillPreference() === true) {
      const globalResult = await installGlobalSkills();
      if (globalResult.installed > 0) {
        log2.success(`Installed ${globalResult.installed} user-level skill symlink(s)`);
      }
    }
  } catch (err) {
    log2.warn(`Skill auto-install skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  const probeUrl = getStaticUrl() ?? `http://localhost:${preferredPort}`;
  if (await isOurServerRunning(probeUrl)) {
    const url2 = info.pairingUrl;
    log2.success(`Already running at ${probeUrl}`);
    if (opts.open) await openBrowser(url2);
    outro2(opts.open ? "Opened in browser" : `Open: ${url2}`);
    return;
  }
  if (!getIsOnboarded()) {
    if (process.stdin.isTTY) {
      await runWizard();
      markOnboarded();
      log2.success("Setup complete");
    } else {
      log2.info("Skipping CLI setup (non-interactive). Run `flow onboard` to configure.");
    }
  }
  const diagnostics = await runDoctorChecks();
  printDoctorChecks(diagnostics, { compact: true });
  const voiceWanted = opts.voice ?? getVoiceEnabled();
  let voiceStarted = false;
  if (voiceWanted) {
    voiceStarted = await bringUpVoice(s);
  }
  let port = 0;
  if (!portless) {
    port = await getPort({ port: preferredPort });
    if (port !== preferredPort) {
      log2.warn(`Port ${preferredPort} in use, using ${port}`);
    }
    process.env.PORT = String(port);
    setRunningPort(port);
  }
  s.start(
    portless ? `Starting dev server via portless (${portless.url})` : opts.dev ? "Starting dev server" : "Starting server"
  );
  const child = startNextServer({
    port,
    dev: opts.dev,
    portlessName: portless?.name
  });
  child.on("error", (err) => {
    log2.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });
  const readyTimeoutMs = opts.dev ? 12e4 : portless ? 12e4 : 9e4;
  await waitForServer(getLocalBaseUrl(), readyTimeoutMs);
  s.stop(`Server ready at ${getLocalBaseUrl()}`);
  const url = info.pairingUrl;
  if (opts.open) {
    await openBrowser(url);
    log2.success(`Opened ${url}`);
  } else {
    log2.info(`Open: ${url}`);
  }
  outro2("Press Ctrl-C to stop");
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!child.killed) child.kill(signal);
    if (voiceStarted) {
      await stopVoiceService().catch(() => {
      });
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await new Promise((resolve) => {
    child.on("exit", () => resolve());
  });
}
async function bringUpVoice(s) {
  const ctx = getVoiceContext();
  if (await isVoiceReady(ctx)) {
    log2.info("Voice already running, reusing existing container");
    return false;
  }
  if (!await isDockerAvailable()) {
    log2.warn("Voice enabled, but Docker is not running, continuing without voice");
    return false;
  }
  s.start("Starting voice sidecar (Parakeet)");
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    s.stop(`Voice ready at ${ctx.serviceUrl}`);
    return true;
  } catch (err) {
    s.stop(pc3.yellow("Voice failed to start, continuing without voice"));
    log2.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}

// src/cli/commands/stop.ts
init_app();
init_port();
init_paths();
import { execFileSync } from "child_process";
import { intro as intro3, outro as outro3, log as log3, spinner as spinner3 } from "@clack/prompts";
import pc4 from "picocolors";
async function stopCommand(opts) {
  intro3(pc4.bgCyan(pc4.black(` ${APP_NAME} stop `)));
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }
  const port = Number(opts.port ?? getRunningPort(opts.dev ? DEV_PORT : DEFAULT_PORT));
  if (!Number.isFinite(port) || port <= 0) {
    log3.error(`Invalid port: ${opts.port}`);
    outro3("Aborted");
    process.exit(1);
  }
  const timeoutMs = Math.max(500, Number(opts.timeout ?? 5e3));
  const probe = await probeHealth(`http://127.0.0.1:${port}`);
  if (probe.status === "offline") {
    log3.info(`Nothing listening on port ${port}`);
    outro3("Done");
    return;
  }
  if (probe.status !== "ok") {
    log3.error(
      `Port ${port} is in use, but doesn't look like ${APP_NAME} (${probe.status}` + ("detail" in probe ? `: ${probe.detail}` : "") + `). Refusing to kill it.`
    );
    outro3("Aborted");
    process.exit(1);
  }
  const listenerPid = findListenerPid(port);
  if (!listenerPid) {
    log3.error(`Could not resolve a PID for port ${port} (lsof returned nothing)`);
    outro3("Aborted");
    process.exit(1);
  }
  const targets = [listenerPid];
  const parent = getParent(listenerPid);
  if (parent && isFlowParent(parent.command)) {
    targets.unshift(parent.pid);
  }
  const s = spinner3();
  s.start(`Stopping ${APP_NAME} on port ${port} (PID ${targets.join(", ")})`);
  const signal = opts.force ? "SIGKILL" : "SIGTERM";
  for (const pid of targets) {
    try {
      process.kill(pid, signal);
    } catch (err) {
      const code = err.code;
      if (code !== "ESRCH") {
        s.stop(pc4.red(`Failed to signal PID ${pid}: ${err.message}`));
        outro3("Aborted");
        process.exit(1);
      }
    }
  }
  const cleared = await waitForPortClear(port, timeoutMs);
  if (cleared) {
    s.stop(`Stopped ${APP_NAME} on port ${port}`);
    outro3("Done");
    return;
  }
  if (signal !== "SIGKILL") {
    s.stop(pc4.yellow(`SIGTERM timed out after ${timeoutMs}ms, sending SIGKILL`));
    for (const pid of targets) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
    }
    const finalCleared = await waitForPortClear(port, 2e3);
    if (finalCleared) {
      log3.success(`Stopped ${APP_NAME} on port ${port}`);
      outro3("Done");
      return;
    }
  }
  log3.error(`Port ${port} still in use after kill. Check \`lsof -iTCP:${port}\``);
  outro3("Aborted");
  process.exit(1);
}
function findListenerPid(port) {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (!out) return null;
    const first = out.split(/\s+/)[0];
    const pid = Number(first);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}
function getParent(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!out) return null;
    const match = out.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) return null;
    const ppid = Number(match[1]);
    if (!Number.isFinite(ppid) || ppid <= 1) return null;
    const ppsOut = execFileSync("ps", ["-o", "command=", "-p", String(ppid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return { pid: ppid, command: ppsOut };
  } catch {
    return null;
  }
}
function isFlowParent(command) {
  return /\bnext\b.*\b(dev|start)\b/.test(command) || /tsx\s+src\/cli\/index\.ts/.test(command) || /\bcli\/index\.(ts|js)\b/.test(command);
}
async function waitForPortClear(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHealth(`http://127.0.0.1:${port}`);
    if (probe.status === "offline") return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// src/cli/commands/pair.ts
init_app();
init_bootstrap();
init_queries();
import os3 from "os";
import pc5 from "picocolors";

// src/cli/lib/qr.ts
import QRCode from "qrcode";
async function renderTerminalQr(text2) {
  return QRCode.toString(text2, {
    type: "terminal",
    small: true,
    margin: 1,
    errorCorrectionLevel: "L"
  });
}

// src/cli/commands/pair.ts
var BASE_URL_EXAMPLE = `https://${APP_SHORT_ID}.example.com`;
var ALLOWED_CLI_TYPES = [
  "computer",
  "phone",
  "tablet",
  "service",
  "other"
];
async function pairCommand(opts = {}) {
  if (opts.clearUrl) {
    clearRemoteBaseUrl();
    console.log(pc5.green("Cleared remote base URL."));
    return;
  }
  if (opts.setUrl) {
    try {
      const saved = setRemoteBaseUrl(opts.setUrl);
      console.log(pc5.green(`Saved remote base URL: ${saved}`));
    } catch (err) {
      console.error(pc5.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
    return;
  }
  const deviceType = resolveDeviceType(opts.type);
  if (deviceType === null) {
    console.error(
      pc5.red(
        `Invalid --type "${opts.type}". Must be one of: ${ALLOWED_CLI_TYPES.join(", ")}.`
      )
    );
    process.exit(1);
  }
  const host = ensureLocalToken();
  if (host.created) console.log(pc5.green("Initialized host."));
  const baseUrl = getLocalBaseUrl();
  const probe = await probeHealth(baseUrl);
  if (probe.status === "ok") {
    const cachedPort = getRunningPort();
    if (probe.info.port !== cachedPort) setRunningPort(probe.info.port);
  } else {
    printProbeWarning(baseUrl, probe);
  }
  const chosen = chooseBase(opts);
  if (!chosen) {
    console.error(
      pc5.red(
        `No LAN address available on this machine. Try without \`--lan\`, or pass \`--local\` for localhost.`
      )
    );
    process.exit(1);
  }
  const name = (opts.name ?? "").trim() || defaultDeviceName();
  const { key, token } = createApiKey({
    name,
    deviceType,
    description: `Paired via \`${APP_SHORT_ID} pair\` from ${os3.hostname()}`
  });
  const primaryUrl = buildPairingUrl(token.plaintext, chosen.base);
  const alternates = gatherAlternates(chosen, token.plaintext);
  console.log();
  console.log(
    pc5.bold(`${APP_SHORT_ID} pair`) + pc5.dim(`: created device "${key.name}" (${key.deviceType})`)
  );
  console.log();
  console.log(await renderTerminalQr(primaryUrl));
  console.log(pc5.bold(`${chosen.label} (primary):`));
  console.log(`  ${primaryUrl}`);
  if (alternates.length > 0) {
    console.log();
    console.log(pc5.bold("Also reachable at:"));
    const maxUrlLen = Math.max(...alternates.map((a) => a.url.length));
    for (const alt of alternates) {
      const padded = alt.url.padEnd(maxUrlLen, " ");
      console.log(`  ${padded}  ${pc5.dim(`(${alt.label})`)}`);
    }
  }
  console.log();
  console.log(pc5.dim(hintFor(chosen.source, getRemoteBaseUrl())));
  console.log();
  console.log(
    pc5.dim(
      `Rename or revoke this device anytime from the Devices sheet in the web app's top bar.`
    )
  );
  console.log();
  console.log(pc5.bold("Token") + pc5.dim(` (paste into any base URL as \`/#${PAIRING_TOKEN_FRAGMENT_KEY}=<token>\`):`));
  console.log(`  ${token.plaintext}`);
  console.log();
}
function gatherAlternates(primary, token) {
  const normalize = (u) => u.replace(/\/+$/, "");
  const seen = /* @__PURE__ */ new Set([normalize(primary.base)]);
  const all = [
    { label: "Remote", base: getRemoteBaseUrl() },
    { label: "Same network", base: getLanBaseUrl() },
    { label: "This machine", base: getLocalBaseUrl() }
  ];
  const out = [];
  for (const entry of all) {
    if (!entry.base) continue;
    const key = normalize(entry.base);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: entry.label, url: buildPairingUrl(token, entry.base) });
  }
  return out;
}
function defaultDeviceName() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `Paired device (${date})`;
}
function resolveDeviceType(raw) {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  return ALLOWED_CLI_TYPES.includes(lower) ? lower : null;
}
function chooseBase(opts) {
  if (opts.local) {
    return { label: "This machine", base: getLocalBaseUrl(), source: "local" };
  }
  if (opts.lan) {
    const lan2 = getLanBaseUrl();
    if (!lan2) return null;
    return { label: "Same network", base: lan2, source: "lan" };
  }
  const tunnel = getRemoteBaseUrl();
  if (tunnel) {
    return { label: "Remote", base: tunnel, source: "tunnel" };
  }
  const lan = getLanBaseUrl();
  if (lan) {
    return { label: "Same network", base: lan, source: "lan" };
  }
  return { label: "This machine", base: getLocalBaseUrl(), source: "local" };
}
function hintFor(source, tunnel) {
  switch (source) {
    case "tunnel":
      return `Using saved remote URL. Switch with \`--lan\` / \`--local\`, change with \`--set-url <url>\`, or forget with \`--clear-url\`.`;
    case "lan":
      if (!tunnel) {
        return `No remote URL saved, using your LAN address. Set one with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` to pair off-network devices.`;
      }
      return `Using LAN address (overriding saved remote URL). Run without \`--lan\` to use the remote URL.`;
    case "local":
      if (!tunnel) {
        return `Only localhost is usable from this machine. Set a remote URL with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` for off-network pairing.`;
      }
      return `Using localhost (overriding saved remote URL). Run without \`--local\` to use the remote URL.`;
  }
}
function printProbeWarning(baseUrl, probe) {
  switch (probe.status) {
    case "offline":
      console.log(
        pc5.yellow(
          `! Nothing is responding at ${baseUrl}. URL below assumes that target. Start the server or run \`${APP_SHORT_ID} pair\` again afterward.`
        )
      );
      return;
    case "unreachable":
      console.log(
        pc5.yellow(
          `! ${baseUrl} is reachable but /api/health didn't respond (${probe.detail}). If the dev server is still compiling, try again in a few seconds.`
        )
      );
      return;
    case "unknown-app":
      console.log(
        pc5.yellow(
          `! Something is responding at ${baseUrl} but it doesn't look like ${APP_SHORT_ID} (${probe.detail}).`
        )
      );
      return;
  }
}

// src/cli/commands/voice.ts
import { spawn as spawn3 } from "child_process";
import pc6 from "picocolors";
function registerVoiceCommand(program2) {
  const voice = program2.command("voice").description("Manage the voice (speech-to-text) sidecar");
  voice.command("status", { isDefault: true }).description("Show voice service status").action(statusAction);
  voice.command("start").description("Start the voice sidecar").action(startAction);
  voice.command("stop").description("Stop the voice sidecar (keeps model cache)").action(stopAction);
  voice.command("restart").description("Restart the voice sidecar").action(async () => {
    await stopAction();
    await startAction();
  });
  voice.command("enable").description("Remember to auto-start voice with the server").action(() => {
    setVoiceEnabled(true);
    console.log(pc6.green("Voice enabled."));
    console.log(pc6.dim("Run `voice start` now, or it will come up on next server start."));
  });
  voice.command("disable").description("Stop auto-starting voice with the server").action(() => {
    setVoiceEnabled(false);
    console.log(pc6.yellow("Voice disabled."));
    console.log(pc6.dim("The sidecar won't start automatically. Run `voice stop` if it's currently running."));
  });
  voice.command("logs").description("Tail voice sidecar logs (Ctrl-C to exit)").action(logsAction);
}
async function statusAction() {
  const ctx = getVoiceContext();
  const [dockerOk, voiceOk] = await Promise.all([isDockerAvailable(), isVoiceReady(ctx)]);
  const pref = getVoiceEnabled();
  console.log();
  row("Preference", pref ? pc6.green("enabled") : pc6.dim("disabled"));
  row("Docker daemon", dockerOk ? pc6.green("running") : pc6.red("not running"));
  row("Voice service", voiceOk ? pc6.green(`ready (${ctx.serviceUrl})`) : pc6.yellow("not responding"));
  console.log();
  if (!pref && !voiceOk) {
    console.log(pc6.dim("\u2192 `voice enable` to turn on, then `voice start`."));
  } else if (pref && !dockerOk) {
    console.log(pc6.dim("\u2192 Start Docker, then `voice start`."));
  } else if (pref && dockerOk && !voiceOk) {
    console.log(pc6.dim("\u2192 `voice start` to bring up the sidecar."));
  } else if (voiceOk) {
    console.log(pc6.dim("\u2192 Everything looks good."));
  }
}
async function startAction() {
  const ctx = getVoiceContext();
  if (await isVoiceReady(ctx)) {
    console.log(pc6.green(`Voice is already running at ${ctx.serviceUrl}`));
    return;
  }
  if (!await isDockerAvailable()) {
    console.error(pc6.red("Docker is not running."));
    console.error(pc6.dim("Start Docker Desktop (or your Docker daemon) and re-run this command."));
    process.exit(1);
  }
  console.log("Starting voice sidecar (this can take several minutes on the first run)\u2026");
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    console.log(pc6.green(`Voice ready at ${ctx.serviceUrl}`));
  } catch (err) {
    console.error(pc6.red("Voice failed to start."));
    console.error(err instanceof Error ? err.message : String(err));
    console.error(pc6.dim("Run `voice logs` to inspect container output."));
    process.exit(1);
  }
}
async function stopAction() {
  const ctx = getVoiceContext();
  if (!await isDockerAvailable()) {
    console.log(pc6.dim("Docker is not running, nothing to stop."));
    return;
  }
  await stopVoiceService(ctx);
  console.log(pc6.green("Voice stopped."));
}
function logsAction() {
  const ctx = getVoiceContext();
  return new Promise((resolve, reject) => {
    const child = spawn3(
      "docker",
      ["compose", "-f", ctx.composeFile, "logs", "-f", ctx.service],
      { stdio: "inherit" }
    );
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`logs exited with code ${code}`)));
    child.on("error", reject);
  });
}
function row(label, value) {
  console.log(`  ${label.padEnd(15)} ${value}`);
}

// src/cli/commands/snapshot.ts
init_mirror();
import pc7 from "picocolors";

// src/lib/export/snapshot.ts
import fsp4 from "fs/promises";
import fs9 from "fs";
import path10 from "path";

// src/lib/backup/index.ts
init_db();
import fsp3 from "fs/promises";
import path9 from "path";
async function backupDb(destPath) {
  await fsp3.mkdir(path9.dirname(destPath), { recursive: true });
  const db = getRawDb();
  await db.backup(destPath);
}

// src/lib/export/snapshot.ts
init_paths();
init_config();
init_app();
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
}
async function createSnapshot(opts = {}) {
  const outRoot = opts.outRoot ?? path10.join(getAppRoot(), "snapshots");
  const dir = path10.resolve(opts.outDir ?? path10.join(outRoot, `${APP_SHORT_ID}-snapshot-${timestamp()}`));
  await fsp4.mkdir(dir, { recursive: true });
  const dbDest = path10.join(dir, "data.db");
  await backupDb(dbDest);
  const dbStat = await fsp4.stat(dbDest);
  const mirrorDest = path10.join(dir, "mirror");
  await fsp4.mkdir(mirrorDest, { recursive: true });
  const brain = getBrainDir();
  let mirrorFileCount = 0;
  for (const type of ENTITY_TYPES) {
    const src = path10.join(brain, `${type}s`);
    if (!fs9.existsSync(src)) continue;
    const dest = path10.join(mirrorDest, `${type}s`);
    await fsp4.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(dest);
  }
  const archiveSrc = path10.join(brain, ".archive");
  if (fs9.existsSync(archiveSrc)) {
    const archiveDest = path10.join(mirrorDest, ".archive");
    await fsp4.cp(archiveSrc, archiveDest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(archiveDest);
  }
  await fsp4.writeFile(path10.join(dir, "README.md"), restoreReadme(), "utf8");
  return { dir, dbBytes: dbStat.size, mirrorFileCount };
}
function restoreReadme() {
  return `# ${APP_SHORT_ID} snapshot

Created: ${(/* @__PURE__ */ new Date()).toISOString()}

## Contents

- \`data.db\`: consistent SQLite dump
- \`mirror/\`: markdown copy of tasks, notes, areas, stream, .archive
  at the time of this snapshot. Wiki-linked in Obsidian-compatible format.

## Restore

1. Stop ${APP_SHORT_ID}.
2. Copy \`data.db\` \u2192 \`<brain>/data.db\` (replaces the live DB).
3. Start ${APP_SHORT_ID}. The markdown mirror regenerates on the next write
   via reconcile.

Note: attachments are **not** in this snapshot. For full restoration
including binary files, restore attachments separately from your cloud
backup (with S3 versioning if you need point-in-time).
`;
}
async function countMd(dir) {
  let count = 0;
  async function walk(d) {
    const entries = await fsp4.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path10.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".tmp")) continue;
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        count++;
      }
    }
  }
  await walk(dir);
  return count;
}

// src/cli/commands/snapshot.ts
function registerSnapshotCommand(program2) {
  program2.command("snapshot").description("Write a local, dated snapshot (DB + markdown) to <app-root>/snapshots/").option("-o, --out <path>", "custom output directory (bypasses dated-folder convention)").action(async (opts) => {
    const reconcile = await reconcileAll();
    if (reconcile.synced > 0) {
      console.log(pc7.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
    }
    const result = await createSnapshot({ outDir: opts.out });
    console.log(pc7.green("Snapshot complete."));
    console.log(pc7.dim(`  ${result.dir}`));
    console.log(`  db: ${formatBytes(result.dbBytes)}`);
    console.log(`  mirror: ${result.mirrorFileCount} markdown files`);
  });
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// src/cli/commands/commit.ts
init_mirror();
import pc8 from "picocolors";

// src/lib/git/commit.ts
init_paths();
init_app();
import fs10 from "fs";
import path11 from "path";
import { execFileSync as execFileSync2 } from "child_process";
function commitBrain() {
  const dir = ensureBrainDir();
  if (!fs10.existsSync(path11.join(dir, ".git"))) {
    run2("git", ["init", "--quiet", "--initial-branch=main"], dir);
  }
  run2("git", ["add", "."], dir);
  const dirty = hasStagedChanges(dir);
  if (!dirty) {
    return { dir, committed: false };
  }
  const message = `${APP_SHORT_ID}: ${(/* @__PURE__ */ new Date()).toISOString()}`;
  run2("git", ["commit", "--quiet", "--no-gpg-sign", "-m", message], dir);
  const sha = run2("git", ["rev-parse", "--short", "HEAD"], dir).trim();
  return { dir, committed: true, sha, message };
}
function hasStagedChanges(dir) {
  try {
    execFileSync2("git", ["diff", "--cached", "--quiet"], { cwd: dir, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}
function run2(cmd, args, cwd) {
  return execFileSync2(cmd, args, { cwd, encoding: "utf8" });
}

// src/cli/commands/commit.ts
function registerCommitCommand(program2) {
  program2.command("commit").description("Flush the mirror and git-commit the brain dir (init git if needed)").action(async () => {
    const reconcile = await reconcileAll();
    if (reconcile.synced > 0) {
      console.log(pc8.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
    }
    const result = commitBrain();
    if (!result.committed) {
      console.log(pc8.dim("No changes since last commit."));
      return;
    }
    console.log(pc8.green("Committed."));
    console.log(pc8.dim(`  ${result.sha}  ${result.message}`));
    console.log(pc8.dim(`  in ${result.dir}`));
  });
}

// src/cli/commands/export.ts
init_config();
init_reconcile();
init_paths();
import pc9 from "picocolors";
import fs11 from "fs/promises";
function registerExportCommand(program2) {
  const exportCmd = program2.command("export").description("Force a full sync of the live markdown mirror").action(async () => {
    if (!isMirrorEnabled()) {
      console.error(pc9.yellow(`Export mirror is disabled (${MIRROR_DISABLED_ENV}=1)`));
      process.exit(1);
    }
    console.log(pc9.dim(`Syncing mirror at ${getBrainDir()}\u2026`));
    const stats = await reconcileAll();
    console.log(pc9.green("Sync complete."));
    console.log(`  synced:   ${stats.synced}`);
    console.log(`  skipped:  ${stats.skipped}`);
    if (stats.orphaned > 0) {
      console.log(pc9.yellow(`  orphaned: ${stats.orphaned}  (files on disk with no DB row)`));
    }
    console.log(pc9.dim(`  elapsed:  ${stats.elapsedMs}ms`));
  });
  exportCmd.command("path").description("Print the brain directory").action(() => {
    console.log(getBrainDir());
  });
  exportCmd.command("status").description("Show mirror file counts per type").action(async () => {
    const root = getBrainDir();
    console.log(pc9.dim(`Brain: ${root}`));
    console.log(pc9.dim(`Enabled: ${isMirrorEnabled() ? "yes" : "no"}`));
    for (const type of ["tasks", "notes", "areas", "stream"]) {
      const count = await countMdFiles(`${root}/${type}`);
      console.log(`  ${type.padEnd(8)} ${count}`);
    }
  });
}
async function countMdFiles(dir) {
  try {
    const entries = await fs11.readdir(dir);
    return entries.filter((e) => !e.startsWith(".") && e.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

// src/cli/commands/agent.ts
import fs21 from "fs";

// src/lib/orchestrator/registry.ts
import fs20 from "fs";
import { z as z40 } from "zod";

// src/lib/orchestrator/types.ts
var ActionError = class extends Error {
  constructor(code, message, suggestion) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
    this.name = "ActionError";
  }
  toJSON() {
    return { error: this.code, message: this.message, suggestion: this.suggestion };
  }
};
function defineAction(action2) {
  return action2;
}

// src/lib/orchestrator/registry.ts
init_queries();

// src/lib/notifications/user.ts
function getNotifierUserId() {
  return process.env.NOTIFIER_USER_ID ?? "local";
}

// src/lib/orchestrator/registry.ts
init_workspaces();

// src/lib/scheduler/cron.ts
import { Cron } from "croner";
function validateCronExpression(expression, timezone = "UTC") {
  const trimmed = expression.trim();
  if (!trimmed) return { valid: false, error: "Cron expression is empty" };
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${fields.length}`
    };
  }
  try {
    const cron = new Cron(trimmed, { timezone });
    const previews = [];
    let cursor = null;
    for (let i = 0; i < 3; i++) {
      cursor = cron.nextRun(cursor ?? void 0);
      if (!cursor) break;
      previews.push(cursor.toISOString());
    }
    if (previews.length === 0) {
      return { valid: false, error: "Expression does not produce any future fires" };
    }
    return { valid: true, preview: previews };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Invalid cron expression"
    };
  }
}
function computeNextRun(trigger, from = /* @__PURE__ */ new Date()) {
  switch (trigger.kind) {
    case "manual":
    case "webhook":
      return null;
    case "at": {
      if (!trigger.runAt) return null;
      if (trigger.lastFiredAt) return null;
      const at = new Date(trigger.runAt);
      if (Number.isNaN(at.getTime())) return null;
      return at.toISOString();
    }
    case "every": {
      if (!trigger.intervalSeconds || trigger.intervalSeconds <= 0) return null;
      const base4 = trigger.lastFiredAt ? new Date(trigger.lastFiredAt) : from;
      let next = new Date(base4.getTime() + trigger.intervalSeconds * 1e3);
      while (next.getTime() <= from.getTime()) {
        next = new Date(next.getTime() + trigger.intervalSeconds * 1e3);
      }
      return next.toISOString();
    }
    case "cron": {
      if (!trigger.cronExpression) return null;
      try {
        const cron = new Cron(trigger.cronExpression, {
          timezone: trigger.timezone ?? "UTC"
        });
        const next = cron.nextRun(from);
        return next ? next.toISOString() : null;
      } catch {
        return null;
      }
    }
  }
}

// src/lib/triggers/webhook.ts
import crypto from "crypto";
var PUBLIC_ID_BYTES = 24;
var SECRET_BYTES = 32;
var WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
function generateWebhookCredentials() {
  const publicId = randomBase64Url(PUBLIC_ID_BYTES);
  const secret = randomBase64Url(SECRET_BYTES);
  const secretHash = crypto.createHash("sha256").update(secret).digest("hex");
  return { publicId, secret, secretHash };
}
function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// src/lib/triggers/reserved.ts
var RESERVED_TRIGGER_IDS = {
  /** Overnight deck pre-bake. Owned by src/lib/deck/trigger.ts. */
  morningDeck: "00000000-0000-0000-0000-000000000001"
};
var RESERVED = new Set(Object.values(RESERVED_TRIGGER_IDS));
function isReservedTrigger(id) {
  return RESERVED.has(id);
}
var RESERVED_LOCKED_FIELDS = [
  "name",
  "description",
  "prompt",
  "targetKind",
  "agentId",
  "kind"
];

// src/lib/orchestrator/registry.ts
init_skills();

// src/lib/orchestrator/server-client.ts
init_config_file();
init_bootstrap();
function serverBaseUrl() {
  return getLocalBaseUrl();
}
async function serverFetch(path24, init = {}) {
  const token = readAuthConfig()?.localToken;
  if (!token) {
    throw new ActionError(
      "unsupported",
      "No local auth token found (config.json). Has the app been initialized with `start`?"
    );
  }
  const base4 = serverBaseUrl();
  let res;
  try {
    res = await fetch(`${base4}/api${path24}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Connection: "close",
        ...init.headers ?? {}
      }
    });
  } catch {
    throw new ActionError(
      "conflict",
      `App server unreachable at ${base4}. Live session state and sends require the app to be running.`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ActionError(
      "conflict",
      `${init.method ?? "GET"} ${path24} \u2192 ${res.status}: ${body.slice(0, 300)}`
    );
  }
  return await res.json();
}
async function fetchLiveSignals() {
  try {
    const rail = await serverFetch("/sessions/rail");
    return {
      runningSessionIds: rail.runningSessionIds ?? [],
      pendingSessionIds: rail.pendingSessionIds ?? []
    };
  } catch {
    return null;
  }
}

// src/lib/orchestrator/session-oversight.ts
var CONTENT_MAX = 700;
var TOOL_INPUT_MAX = 200;
function truncate2(text2, max) {
  const cleaned = text2.trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1).trimEnd() + "\u2026";
}
var DROP_SOURCES = /* @__PURE__ */ new Set(["system", "thinking", "recap", "rate_limit", "unknown"]);
function condenseEvents(events) {
  const out = [];
  for (const e of events) {
    if (DROP_SOURCES.has(e.source)) continue;
    const row2 = { at: e.createdAt, kind: e.source };
    if (e.toolName) row2.tool = e.toolName;
    if (e.toolInput && Object.keys(e.toolInput).length > 0) {
      try {
        row2.input = truncate2(JSON.stringify(e.toolInput), TOOL_INPUT_MAX);
      } catch {
      }
    }
    if (e.content) row2.text = truncate2(e.content, CONTENT_MAX);
    if (e.toolIsError) row2.isError = true;
    out.push(row2);
  }
  return out;
}
function derivePendingFromEvents(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.source === "permission_response" || e.source === "question_response") return null;
    if (e.source === "permission_request" || e.source === "question_request") {
      const detailParts = [e.toolName, e.content].filter(Boolean);
      let detail = detailParts.join(": ");
      if (!detail && e.toolInput) {
        try {
          detail = truncate2(JSON.stringify(e.toolInput), TOOL_INPUT_MAX);
        } catch {
          detail = e.source;
        }
      }
      return {
        kind: e.source === "permission_request" ? "permission" : "question",
        detail: truncate2(detail || e.source, CONTENT_MAX),
        since: e.createdAt
      };
    }
  }
  return null;
}

// src/lib/utils/session-sort.ts
function latestActivityAt(s) {
  const outcome = s.lastOutcomeEventAt;
  const marker = s.unreadMarkerAt;
  if (outcome && marker) return outcome > marker ? outcome : marker;
  return outcome ?? marker ?? null;
}
function isSessionUnread(s) {
  const activity = latestActivityAt(s);
  if (!activity) return false;
  const lastViewed = s.lastViewedAt ?? "1970-01-01";
  return activity > lastViewed;
}

// src/lib/orchestrator/registry.ts
init_paths();
import path20 from "path";
var taskStatus = z40.enum(["active", "done", "archived"]);
var taskEnergy = z40.enum(["deep", "light"]);
var taskEffort = z40.enum(["trivial", "small", "medium", "large", "epic"]);
var noteStatus = z40.enum(["active", "archived"]);
var taskCreateShape = {
  title: z40.string().min(1),
  description: z40.string().optional(),
  body: z40.string().optional(),
  areaId: z40.string().nullable().optional(),
  workspaceId: z40.string().nullable().optional(),
  parentId: z40.string().nullable().optional(),
  status: taskStatus.optional(),
  energy: taskEnergy.nullable().optional(),
  effort: taskEffort.nullable().optional(),
  estimatedMinutes: z40.number().int().positive().nullable().optional(),
  hardDeadline: z40.string().nullable().optional(),
  reminderAt: z40.string().nullable().optional(),
  recurrence: z40.string().nullable().optional(),
  contextTags: z40.array(z40.string()).optional(),
  userContext: z40.string().nullable().optional(),
  outcome: z40.string().nullable().optional()
};
var noteCreateShape = {
  title: z40.string().optional(),
  body: z40.string().min(1),
  url: z40.string().nullable().optional(),
  areaId: z40.string().nullable().optional(),
  workspaceId: z40.string().nullable().optional(),
  taskId: z40.string().nullable().optional(),
  status: noteStatus.optional(),
  contextTags: z40.array(z40.string()).optional()
};
function resumeCommandForSession(harness, externalSessionId) {
  if (!externalSessionId) return null;
  if (harness === "claude" || harness === "claude_code") return `claude --resume ${externalSessionId}`;
  if (harness === "codex") return `codex resume ${externalSessionId}`;
  return null;
}
var describe_paths = defineAction({
  name: "describe_paths",
  description: "Print the resolved on-disk paths the app uses (app root, brain dir, db, config). Reflects <APP>_ROOT / <APP>_BRAIN_PATH / <APP>_DB_PATH env overrides.",
  params: {},
  handler: () => ({
    appRoot: getAppRoot(),
    brainDir: getBrainDir(),
    dbPath: getDbPath(),
    configPath: getConfigPath(),
    attachmentsDir: getAttachmentsDir(),
    tmpDir: getTmpDir(),
    dbExists: fs20.existsSync(getDbPath())
  })
});
var describe_schema = defineAction({
  name: "describe_schema",
  description: "Return the Drizzle schema source as text. Read-only reference for agents proposing new actions. Lets an agent ground itself in the real column shape without arbitrary SQL access.",
  params: {},
  handler: () => {
    const schemaPath = __require.resolve("@/lib/db/schema");
    const src = fs20.readFileSync(schemaPath, "utf8");
    return { path: schemaPath, source: src };
  }
});
var list_tasks_action = defineAction({
  name: "list_tasks",
  description: "List tasks with optional filters (status, area, parent, energy, text search).",
  params: {
    status: z40.union([taskStatus, z40.array(taskStatus)]).optional(),
    areaId: z40.string().nullable().optional(),
    parentId: z40.string().nullable().optional(),
    energy: taskEnergy.optional(),
    q: z40.string().optional(),
    limit: z40.number().int().positive().max(1e3).optional(),
    offset: z40.number().int().nonnegative().optional(),
    orderBy: z40.enum(["sortKey", "lastViewedAt", "hardDeadline", "createdAt", "updatedAt"]).optional()
  },
  handler: (_ctx, input) => listTasks(input)
});
var get_task_action = defineAction({
  name: "get_task",
  description: "Fetch a single task by id.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const task = getTask(id);
    if (!task) throw new ActionError("not_found", `Task not found: ${id}`);
    return task;
  }
});
var create_task_action = defineAction({
  name: "create_task",
  description: "Create a task. Embeddings + markdown mirror are updated automatically.",
  params: taskCreateShape,
  mutating: true,
  handler: (_ctx, input) => createTask(input)
});
var update_task_action = defineAction({
  name: "update_task",
  description: "Update a task by id. All fields optional. Unspecified fields keep their value.",
  params: {
    id: z40.string().min(1),
    ...Object.fromEntries(
      Object.entries(taskCreateShape).map(([k, v]) => [k, v.optional()])
    )
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const row2 = updateTask(id, rest, { source: "ai" });
    if (!row2) throw new ActionError("not_found", `Task not found: ${id}`);
    return row2;
  }
});
var complete_task_action = defineAction({
  name: "complete_task",
  description: "Mark a task complete. Recurring tasks roll to the next occurrence instead of closing.",
  params: {
    id: z40.string().min(1),
    note: z40.string().optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id, note }) => {
    const result = completeTask(id, note);
    if (!result) throw new ActionError("not_found", `Task not found: ${id}`);
    return result;
  }
});
var list_notes_action = defineAction({
  name: "list_notes",
  description: "List notes with optional filters (area, linked task, status).",
  params: {
    areaId: z40.string().nullable().optional(),
    taskId: z40.string().nullable().optional(),
    status: noteStatus.optional(),
    limit: z40.number().int().positive().max(1e3).optional(),
    offset: z40.number().int().nonnegative().optional(),
    orderBy: z40.enum(["lastViewedAt", "createdAt", "updatedAt"]).optional()
  },
  handler: (_ctx, input) => listNotes(input)
});
var get_note_action = defineAction({
  name: "get_note",
  description: "Fetch a single note by id.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const note = getNote(id);
    if (!note) throw new ActionError("not_found", `Note not found: ${id}`);
    return note;
  }
});
var create_note_action = defineAction({
  name: "create_note",
  description: "Create a note. Embeddings + markdown mirror are updated automatically.",
  params: noteCreateShape,
  mutating: true,
  handler: (_ctx, input) => createNote(input)
});
var update_note_action = defineAction({
  name: "update_note",
  description: "Update a note by id. All fields optional. Unspecified fields keep their value. Set status=archived instead of deleting. There is no delete action by design.",
  params: {
    id: z40.string().min(1),
    ...Object.fromEntries(
      Object.entries(noteCreateShape).map(([k, v]) => [k, v.optional()])
    )
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const row2 = updateNote(id, rest, { source: "ai" });
    if (!row2) throw new ActionError("not_found", `Note not found: ${id}`);
    return row2;
  }
});
var streamStatus = z40.enum(["pending", "promoted", "dismissed"]);
var list_stream_action = defineAction({
  name: "list_stream",
  description: "List stream items (quick-capture inbox). Defaults to status=pending, the untriaged queue.",
  params: {
    status: streamStatus.optional(),
    limit: z40.number().int().positive().max(500).optional(),
    offset: z40.number().int().nonnegative().optional()
  },
  handler: (_ctx, input) => listStream({ status: input.status ?? "pending", ...input })
});
var get_stream_item_action = defineAction({
  name: "get_stream_item",
  description: "Fetch a single stream item by id.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const row2 = getStream(id);
    if (!row2) throw new ActionError("not_found", `Stream item not found: ${id}`);
    return row2;
  }
});
var create_stream_item_action = defineAction({
  name: "create_stream_item",
  description: "Capture text into the stream inbox. Use when something should be kept but is not clearly a task or a note yet. The triage pass (human or agent) decides later.",
  params: {
    rawText: z40.string().min(1)
  },
  mutating: true,
  handler: (_ctx, { rawText }) => createStream({ rawText, source: "chat" })
});
var promote_stream_action = defineAction({
  name: "promote_stream",
  description: "Promote a pending stream item into a task or a note. Creates the entity and stamps the stream row's promotion links in one step. Shape the title yourself (imperative for tasks). The item's raw text and attachments carry over as the body unless overridden.",
  params: {
    id: z40.string().min(1),
    to: z40.enum(["task", "note"]),
    /** Shaped title. Tasks: imperative ("Ship the manifest"). Optional for notes. */
    title: z40.string().optional(),
    /** Override body; defaults to the item's raw text. */
    body: z40.string().optional(),
    areaId: z40.string().nullable().optional(),
    /** Task promotion only: create as a subtask of this task. */
    parentId: z40.string().nullable().optional(),
    /** Note promotion only: link the note to this task. */
    taskId: z40.string().nullable().optional(),
    energy: taskEnergy.nullable().optional(),
    effort: taskEffort.nullable().optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const item = getStream(input.id);
    if (!item) throw new ActionError("not_found", `Stream item not found: ${input.id}`);
    if (item.status !== "pending") {
      throw new ActionError(
        "conflict",
        `Stream item is already ${item.status}${item.promotedToType ? ` (\u2192 ${item.promotedToType} ${item.promotedToId})` : ""}.`
      );
    }
    const body = input.body ?? item.rawText;
    let promotedToType;
    let created;
    if (input.to === "task") {
      promotedToType = "task";
      created = createTask({
        rawInput: item.rawText,
        title: input.title ?? truncateForTitle(item.rawText),
        body,
        areaId: input.areaId ?? null,
        parentId: input.parentId ?? null,
        energy: input.energy ?? null,
        effort: input.effort ?? null,
        attachments: item.attachments ?? []
      });
    } else {
      promotedToType = "note";
      created = createNote({
        title: input.title,
        body,
        areaId: input.areaId ?? null,
        taskId: input.taskId ?? null,
        attachments: item.attachments ?? []
      });
    }
    const streamRow = updateStream(item.id, {
      status: "promoted",
      promotedToType,
      promotedToId: created.id,
      promotedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { stream: streamRow, [promotedToType]: created };
  }
});
var dismiss_stream_action = defineAction({
  name: "dismiss_stream",
  description: "Dismiss a pending stream item (noise, duplicates, no-longer-relevant). Dismissed items keep their text and stay searchable. This is triage, not deletion.",
  params: { id: z40.string().min(1) },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const item = getStream(id);
    if (!item) throw new ActionError("not_found", `Stream item not found: ${id}`);
    if (item.status !== "pending") {
      throw new ActionError("conflict", `Stream item is already ${item.status}.`);
    }
    return dismissStream(id, "agent");
  }
});
function truncateForTitle(rawText) {
  const firstLine = rawText.trim().split("\n")[0] ?? "";
  return firstLine.length <= 200 ? firstLine : firstLine.slice(0, 199).trimEnd() + "\u2026";
}
var areaStatus = z40.enum(["active", "inactive", "archived"]);
var areaShape = {
  name: z40.string().min(1),
  description: z40.string().nullable().optional(),
  emoji: z40.string().nullable().optional(),
  userContext: z40.string().nullable().optional(),
  status: areaStatus.optional(),
  sortOrder: z40.number().int().optional()
};
var list_areas_action = defineAction({
  name: "list_areas",
  description: 'List areas (life/work domains like "Work", "Health"). Areas organize tasks and notes. Look up area ids here before filtering or linking.',
  params: {
    status: z40.enum(["active", "inactive", "archived", "all"]).optional()
  },
  handler: (_ctx, { status }) => listAreas({ status })
});
var get_area_action = defineAction({
  name: "get_area",
  description: "Fetch a single area by id.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const area = getArea(id);
    if (!area) throw new ActionError("not_found", `Area not found: ${id}`);
    return area;
  }
});
var create_area_action = defineAction({
  name: "create_area",
  description: "Create an area (life/work domain) for organizing tasks and notes.",
  params: areaShape,
  mutating: true,
  handler: (_ctx, input) => createArea(input)
});
var update_area_action = defineAction({
  name: "update_area",
  description: "Update an area by id. All fields optional. Archive via status=archived. There is no delete.",
  params: {
    id: z40.string().min(1),
    ...Object.fromEntries(
      Object.entries(areaShape).map(([k, v]) => [k, v.optional()])
    )
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const row2 = updateArea(id, rest);
    if (!row2) throw new ActionError("not_found", `Area not found: ${id}`);
    return row2;
  }
});
var deckItemShape = z40.object({
  taskId: z40.string(),
  rationale: z40.string(),
  continuityContext: z40.string().nullable(),
  source: z40.enum(["ai", "user"])
});
var deckAlternativeShape = z40.object({
  taskId: z40.string(),
  reason: z40.string()
});
var get_deck_action = defineAction({
  name: "get_deck",
  description: "Get the deck, the day's ranked priority stack of tasks plus alternatives. Returns the latest deck unless an id is given.",
  params: { id: z40.string().min(1).optional() },
  handler: (_ctx, { id }) => {
    const deck = id ? getDeck(id) : getLatestDeck();
    if (!deck) {
      throw new ActionError("not_found", id ? `Deck not found: ${id}` : "No deck generated yet");
    }
    return deck;
  }
});
var update_deck_action = defineAction({
  name: "update_deck",
  description: "Update a deck by id: reorder or swap items, edit alternatives, or change the framing. Items carry source=user when the user (or an agent acting for them) placed them.",
  params: {
    id: z40.string().min(1),
    items: z40.array(deckItemShape).optional(),
    alternatives: z40.array(deckAlternativeShape).optional(),
    framing: z40.string().nullable().optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id, ...rest }) => {
    const updates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== void 0));
    const deck = updateDeck(id, updates);
    if (!deck) throw new ActionError("not_found", `Deck not found: ${id}`);
    return deck;
  }
});
var regenerate_deck_action = defineAction({
  name: "regenerate_deck",
  description: 'Run the full AI prioritization pipeline and persist a fresh deck. Slow (two model calls) and requires OPENAI_API_KEY. Optional context shapes the ranking (e.g. "low energy, 2 hours").',
  params: {
    context: z40.string().optional(),
    contextTags: z40.array(z40.string()).optional()
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const { ensureCalendarProvider: ensureCalendarProvider2 } = await Promise.resolve().then(() => (init_calendar_connector(), calendar_connector_exports));
    ensureCalendarProvider2();
    const { generateDeck: generateDeck2 } = await Promise.resolve().then(() => (init_generate_deck(), generate_deck_exports));
    return generateDeck2(input);
  }
});
var reconcile_deck_action = defineAction({
  name: "reconcile_deck",
  description: "Re-check today's deck against the live calendar and adapt it to external changes (e.g. a new meeting shrinks the day \u2192 bump the lowest-priority item, narrated and reversible). Deterministic, no model call, safe to run on a cadence. No-op until a calendar connector is registered.",
  params: {
    in_focus: z40.boolean().optional()
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const { ensureCalendarProvider: ensureCalendarProvider2 } = await Promise.resolve().then(() => (init_calendar_connector(), calendar_connector_exports));
    ensureCalendarProvider2();
    const { reconcileDeckWithExternalChanges: reconcileDeckWithExternalChanges2 } = await Promise.resolve().then(() => (init_reconcile_external(), reconcile_external_exports));
    return reconcileDeckWithExternalChanges2({ inFocus: input.in_focus });
  }
});
var search_action = defineAction({
  name: "search",
  description: "Hybrid semantic + keyword search across tasks, notes, and stream entries. Returns hydrated entities with relevance scores. Use to find context before creating or answering.",
  params: {
    query: z40.string().min(1),
    limit: z40.number().int().positive().max(50).optional()
  },
  cli: { positional: ["query"] },
  handler: async (_ctx, { query, limit }) => {
    const { hybridSearchWithEntities: hybridSearchWithEntities2 } = await Promise.resolve().then(() => (init_search(), search_exports));
    return hybridSearchWithEntities2(query, { limit });
  }
});
var get_user_state_action = defineAction({
  name: "get_user_state",
  description: "Get the user's current state: active area, active parent task, energy, available minutes, and free-text focus description.",
  params: {},
  handler: () => getUserState() ?? null
});
var update_user_state_action = defineAction({
  name: "update_user_state",
  description: "Update the user's current state (energy, available time, active area/task, focus text). Only these focus fields are exposed. App settings are not writable from the agent surface.",
  params: {
    activeAreaId: z40.string().nullable().optional(),
    activeParentTaskId: z40.string().nullable().optional(),
    activeEnergy: z40.enum(["deep", "light"]).nullable().optional(),
    availableMinutes: z40.number().int().nullable().optional(),
    description: z40.string().optional()
  },
  mutating: true,
  handler: (_ctx, input) => {
    const updates = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== void 0));
    return updateUserState(updates) ?? null;
  }
});
var workspaceStatus = z40.enum(["active", "archived"]);
var list_workspaces_action = defineAction({
  name: "list_workspaces",
  description: "List workspaces with aggregated session counts. Default filter is active.",
  params: {
    status: workspaceStatus.optional()
  },
  handler: (_ctx, { status }) => listWorkspaces({ status })
});
var get_workspace_action = defineAction({
  name: "get_workspace",
  description: "Fetch a single workspace by id.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const ws = getWorkspace(id);
    if (!ws) throw new ActionError("not_found", `Workspace not found: ${id}`);
    return ws;
  }
});
var create_workspace_action = defineAction({
  name: "create_workspace",
  description: "Create a workspace tied to a folder on disk. Git is auto-detected. For git repos the base branch is resolved from <remote>/HEAD with main/master fallback.",
  params: {
    name: z40.string().min(1),
    cwd: z40.string().min(1),
    emoji: z40.string().nullable().optional(),
    areaId: z40.string().nullable().optional(),
    baseBranch: z40.string().nullable().optional(),
    remoteName: z40.string().optional(),
    worktreeRoot: z40.string().nullable().optional()
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const cwd = path20.resolve(input.cwd);
    const isGit = await detectIsGit(cwd);
    const baseBranch = isGit ? input.baseBranch ?? await detectBaseBranch(cwd, input.remoteName ?? "origin") : null;
    return createWorkspace({
      name: input.name,
      emoji: input.emoji ?? null,
      cwd,
      isGit,
      baseBranch,
      remoteName: isGit ? input.remoteName ?? "origin" : null,
      worktreeRoot: isGit ? input.worktreeRoot ?? defaultWorktreeRoot(input.name) : null,
      areaId: input.areaId ?? null,
      status: "active"
    });
  }
});
var archive_workspace_action = defineAction({
  name: "archive_workspace",
  description: "Archive a workspace. Sessions stay queryable. Nothing on disk is touched.",
  params: { id: z40.string().min(1) },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const row2 = archiveWorkspace(id);
    if (!row2) throw new ActionError("not_found", `Workspace not found: ${id}`);
    return row2;
  }
});
var list_workspace_sessions_action = defineAction({
  name: "list_workspace_sessions",
  description: "List active execution sessions in a workspace, newest activity first.",
  params: {
    workspaceId: z40.string().min(1),
    status: workspaceStatus.optional()
  },
  cli: { positional: ["workspaceId"] },
  handler: (_ctx, { workspaceId, status }) => listChatSessions({ workspaceId, status: status ?? "active" })
});
var list_executions_action = defineAction({
  name: "list_executions",
  description: "List active execution sessions across all workspaces with status flags: running (turn in flight), awaitingInput (blocked on a prompt), unread (output the user has not viewed, what the rail's Unread section shows, minus currently-running sessions). The returned sessionId is the handle for get_session_messages, send_session_message, and [[execution:SESSION_ID]] links. When available, resumeCommand is the provider CLI command for the external session id.",
  params: {},
  handler: async () => {
    const rows = listRailSessions();
    const live = await fetchLiveSignals();
    return {
      /** False ⇒ the app server was unreachable: running/awaitingInput are unknown-but-idle. */
      live: live !== null,
      executions: rows.map((r) => {
        const running = live?.runningSessionIds.includes(r.id) ?? false;
        const agentHarness = getAgent(r.agentId)?.harness ?? null;
        return {
          sessionId: r.id,
          executionId: r.executionId,
          externalSessionId: r.externalSessionId,
          agentHarness,
          resumeCommand: resumeCommandForSession(agentHarness, r.externalSessionId),
          label: r.label,
          workspace: { id: r.workspaceId, name: r.workspaceName },
          branch: r.execution?.branchName ?? null,
          prNumber: r.execution?.prNumber ?? null,
          startedAt: r.startedAt,
          lastActivityAt: r.lastOutcomeEventAt ?? r.startedAt,
          running,
          awaitingInput: live?.pendingSessionIds.includes(r.id) ?? false,
          // Same derivation as the UI (isSessionUnread), same streaming
          // overlay as the rail's Unread section: a mid-turn session is
          // about to produce a fresh outcome, so it doesn't count as
          // unread yet. Keeps the agent's answer to "what's unread?"
          // identical to what the user sees in the rail.
          unread: !running && isSessionUnread(r)
        };
      })
    };
  }
});
var get_session_messages_action = defineAction({
  name: "get_session_messages",
  description: "Read the latest messages of a session (execution or orchestrator chat) as a condensed transcript tail (user/agent text, one-line tool calls, errors), plus whether the session is running or blocked on a permission/question prompt. The response includes app and provider ids plus a provider resume command when one is available. Read this before nudging a session.",
  params: {
    sessionId: z40.string().min(1),
    limit: z40.number().int().positive().max(200).optional()
  },
  cli: { positional: ["sessionId"] },
  handler: async (_ctx, { sessionId, limit }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError("not_found", `Session not found: ${sessionId}`);
    const agentHarness = getAgent(session.agentId)?.harness ?? null;
    const events = listChatEvents(sessionId, { limit: limit ?? 40 });
    const pending2 = derivePendingFromEvents(events);
    const live = await fetchLiveSignals();
    return {
      session: {
        id: session.id,
        label: session.label,
        type: session.type,
        status: session.status,
        workspaceId: session.workspaceId,
        executionId: session.executionId,
        externalSessionId: session.externalSessionId,
        agentHarness,
        resumeCommand: resumeCommandForSession(agentHarness, session.externalSessionId)
      },
      /** Null ⇒ server unreachable (live state unknown; nothing can be running while it is down). */
      running: live ? live.runningSessionIds.includes(sessionId) : null,
      awaitingInput: live ? live.pendingSessionIds.includes(sessionId) : pending2 !== null,
      /** What the session is blocked on, when derivable from the transcript. */
      pendingDetail: pending2,
      messages: condenseEvents(events)
    };
  }
});
var get_pending_input_action = defineAction({
  name: "get_pending_input",
  description: "List the permission/question prompts a session is blocked on right now (live server state). Each entry carries a requestId for answer_pending_input. A blocked turn does NOT see queued messages until its prompt is resolved. Answering is the only way to unblock it.",
  params: { sessionId: z40.string().min(1) },
  cli: { positional: ["sessionId"] },
  handler: async (_ctx, { sessionId }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError("not_found", `Session not found: ${sessionId}`);
    return serverFetch(`/sessions/${sessionId}/pending-input`);
  }
});
var answer_pending_input_action = defineAction({
  name: "answer_pending_input",
  description: "Resolve a pending permission or question prompt on a session. Permissions: allow=true/false (message = deny reason). Questions: allow=true with answers keyed by the question text (allow=false declines). Only answer on the user's clear intent. When in doubt, surface the prompt to the user instead.",
  params: {
    sessionId: z40.string().min(1),
    requestId: z40.string().min(1),
    allow: z40.boolean(),
    /** Reason shown to the blocked agent when denying. */
    message: z40.string().optional(),
    /** AskUserQuestion answers keyed by question text. Ignored for permissions. */
    answers: z40.record(z40.string()).optional()
  },
  mutating: true,
  cli: { positional: ["sessionId", "requestId"] },
  handler: async (_ctx, { sessionId, requestId, allow, message, answers }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError("not_found", `Session not found: ${sessionId}`);
    await serverFetch(`/sessions/${sessionId}/pending-input/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ allow, message, answers })
    });
    return {
      resolved: true,
      sessionId,
      requestId,
      note: "The blocked turn resumes now. Check get_session_messages for what it does next."
    };
  }
});
var send_session_message_action = defineAction({
  name: "send_session_message",
  description: "Send a message into a session: nudge a stalled execution, answer a question in prose, or steer direction. Delivered through the app server: it lands in the agent's queue mid-turn or starts a new turn. Fire-and-forget. Poll get_session_messages for the response. Never send to your own session.",
  params: {
    sessionId: z40.string().min(1),
    content: z40.string().min(1)
  },
  mutating: true,
  cli: { positional: ["sessionId"] },
  handler: async (_ctx, { sessionId, content }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError("not_found", `Session not found: ${sessionId}`);
    if (session.status === "archived") {
      throw new ActionError(
        "conflict",
        "Session is archived. Resume it from the app before messaging it."
      );
    }
    const event = await serverFetch(`/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    return {
      delivered: true,
      sessionId,
      eventId: event?.id ?? null,
      note: "Dispatched. The session processes asynchronously. Check get_session_messages shortly."
    };
  }
});
var triggerKind = z40.enum(["manual", "at", "every", "cron", "webhook"]);
var triggerTargetKind = z40.enum(["workspace", "orchestrator"]);
var triggerConcurrencyPolicy = z40.enum([
  "skip_if_running",
  "coalesce_if_active",
  "allow_concurrent"
]);
var triggerCatchUpPolicy = z40.enum(["skip_missed", "run_all"]);
var effortLevel = z40.enum(["low", "medium", "high", "xhigh", "max", "ultra"]);
var runStatusFilter = z40.enum(["queued", "running", "completed", "failed", "skipped"]);
var runTriggerFilter = z40.enum(["manual", "cron", "every", "at", "webhook"]);
function validateDeliverResultTo(ids, targetKind) {
  if (ids.length === 0) return [];
  if (targetKind !== "orchestrator") {
    throw new ActionError(
      "invalid_params",
      "deliver_result_to is only honored for target_kind=orchestrator. Workspace runs notify via the execution.finished matrix, not a digest binding"
    );
  }
  const deduped = [...new Set(ids)];
  for (const id of deduped) {
    if (!getNotificationChannel(id)) {
      throw new ActionError(
        "not_found",
        `notification channel not found: ${id} (use list_notification_channels to discover ids)`
      );
    }
  }
  return deduped;
}
var list_triggers_action = defineAction({
  name: "list_triggers",
  description: "List triggers with last-run rollup. Filters: enabled, kind, target, workspace_id.",
  params: {
    enabled: z40.boolean().optional(),
    kind: triggerKind.optional(),
    targetKind: triggerTargetKind.optional(),
    workspaceId: z40.string().nullable().optional(),
    limit: z40.number().int().positive().max(500).optional(),
    offset: z40.number().int().nonnegative().optional()
  },
  handler: (_ctx, input) => listTriggersWithLastRun(input)
});
var get_trigger_action = defineAction({
  name: "get_trigger",
  description: "Fetch a single trigger by id (or unique name within scope).",
  params: {
    id: z40.string().min(1).optional(),
    name: z40.string().min(1).optional(),
    workspaceId: z40.string().nullable().optional()
  },
  handler: (_ctx, { id, name, workspaceId }) => {
    if (!id && !name) {
      throw new ActionError("invalid_params", "Provide id or name");
    }
    const row2 = id ? getTrigger(id) : findTriggerByName(name, workspaceId ?? null);
    if (!row2) throw new ActionError("not_found", `Trigger not found: ${id ?? name}`);
    return row2;
  }
});
var createTriggerShape = {
  name: z40.string().min(1),
  description: z40.string().nullable().optional(),
  enabled: z40.boolean().optional(),
  // Optional in the contract: the handler defaults to the
  // orchestrator agent (target=orchestrator) or the workspace's bound
  // executor (target=workspace) when omitted. Same form-level default
  // policy the spec describes; surfaces the same handle to CLI + UI.
  agentId: z40.string().min(1).optional(),
  workspaceId: z40.string().nullable().optional(),
  targetKind: triggerTargetKind,
  prompt: z40.string().min(1),
  skillHints: z40.array(z40.string()).nullable().optional(),
  kind: triggerKind,
  cronExpression: z40.string().nullable().optional(),
  intervalSeconds: z40.number().int().positive().nullable().optional(),
  runAt: z40.string().nullable().optional(),
  timezone: z40.string().nullable().optional(),
  activeHoursStart: z40.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  activeHoursEnd: z40.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  concurrencyPolicy: triggerConcurrencyPolicy.optional(),
  catchUpPolicy: triggerCatchUpPolicy.optional(),
  maxCatchUpRuns: z40.number().int().positive().max(10).optional(),
  model: z40.string().nullable().optional(),
  effort: effortLevel.nullable().optional(),
  timeoutSeconds: z40.number().int().positive().nullable().optional(),
  // Notifier digest binding: notification_channel ids the run result is
  // delivered to when an orchestrator-target run completes
  // (`trigger.run_completed`). Discover ids via list_notification_channels.
  // Only honored for target_kind=orchestrator (see validateDeliverResultTo).
  deliverResultTo: z40.array(z40.string().min(1)).optional()
};
var create_trigger_action = defineAction({
  name: "create_trigger",
  description: "Create a trigger. Kind-specific fields are enforced (cron requires cron_expression, every requires interval_seconds, at requires run_at, webhook generates credentials, manual takes no cadence fields and only fires via run_trigger).",
  params: createTriggerShape,
  mutating: true,
  handler: (_ctx, input) => {
    if (input.kind === "cron") {
      if (!input.cronExpression) {
        throw new ActionError("invalid_params", "cron_expression is required when kind=cron");
      }
      const v = validateCronExpression(input.cronExpression, input.timezone ?? "UTC");
      if (!v.valid) throw new ActionError("invalid_params", `Invalid cron: ${v.error}`);
    } else if (input.kind === "every") {
      if (!input.intervalSeconds) {
        throw new ActionError("invalid_params", "interval_seconds is required when kind=every");
      }
    } else if (input.kind === "at") {
      if (!input.runAt) {
        throw new ActionError("invalid_params", "run_at is required when kind=at");
      }
    }
    if (input.targetKind === "workspace" && !input.workspaceId) {
      throw new ActionError("invalid_params", "workspace_id is required when target_kind=workspace");
    }
    if (input.targetKind === "orchestrator" && input.workspaceId) {
      throw new ActionError("invalid_params", "workspace_id must be null when target_kind=orchestrator");
    }
    const deliverResultTo = validateDeliverResultTo(
      input.deliverResultTo ?? [],
      input.targetKind
    );
    const agentId = input.agentId ?? (input.targetKind === "orchestrator" ? getOrCreateDefaultOrchestrator().id : getOrCreateDefaultExecutor("claude_code").id);
    let webhookCredentials = null;
    let webhookPublicId = null;
    let webhookSecretHash = null;
    if (input.kind === "webhook") {
      webhookCredentials = generateWebhookCredentials();
      webhookPublicId = webhookCredentials.publicId;
      webhookSecretHash = webhookCredentials.secretHash;
    }
    const draft = {
      kind: input.kind,
      cronExpression: input.cronExpression ?? null,
      intervalSeconds: input.intervalSeconds ?? null,
      runAt: input.runAt ?? null,
      timezone: input.timezone ?? "UTC",
      lastFiredAt: null
    };
    const nextRunAt = computeNextRun(draft);
    const row2 = createTrigger({
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      agentId,
      workspaceId: input.workspaceId ?? null,
      targetKind: input.targetKind,
      prompt: input.prompt,
      skillHints: input.skillHints ?? null,
      kind: input.kind,
      cronExpression: input.cronExpression ?? null,
      intervalSeconds: input.intervalSeconds ?? null,
      runAt: input.runAt ?? null,
      timezone: input.timezone ?? "UTC",
      activeHoursStart: input.activeHoursStart ?? null,
      activeHoursEnd: input.activeHoursEnd ?? null,
      concurrencyPolicy: input.concurrencyPolicy ?? "coalesce_if_active",
      catchUpPolicy: input.catchUpPolicy ?? "skip_missed",
      maxCatchUpRuns: input.maxCatchUpRuns ?? 3,
      webhookPublicId,
      webhookSecretHash,
      model: input.model ?? null,
      effort: input.effort ?? null,
      // Null when the caller omits it — no wall-clock cap. The
      // runtime `runWithTimeout` skips the race when seconds is null
      // or <= 0; the run completes whenever the executor returns.
      timeoutSeconds: input.timeoutSeconds ?? null,
      deliverResultTo,
      nextRunAt
    });
    return webhookCredentials ? {
      trigger: row2,
      // Plaintext secret — show once, never stored. Callers must
      // persist this on their side to sign future webhook requests.
      webhookSecret: webhookCredentials.secret,
      webhookPublicId
    } : { trigger: row2 };
  }
});
var update_trigger_action = defineAction({
  name: "update_trigger",
  description: "Patch a trigger. Cron / interval / runAt changes recompute nextRunAt automatically.",
  params: {
    id: z40.string().min(1),
    name: z40.string().min(1).optional(),
    description: z40.string().nullable().optional(),
    enabled: z40.boolean().optional(),
    prompt: z40.string().min(1).optional(),
    skillHints: z40.array(z40.string()).nullable().optional(),
    cronExpression: z40.string().nullable().optional(),
    intervalSeconds: z40.number().int().positive().nullable().optional(),
    runAt: z40.string().nullable().optional(),
    timezone: z40.string().nullable().optional(),
    activeHoursStart: z40.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    activeHoursEnd: z40.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    concurrencyPolicy: triggerConcurrencyPolicy.optional(),
    catchUpPolicy: triggerCatchUpPolicy.optional(),
    model: z40.string().nullable().optional(),
    effort: effortLevel.nullable().optional(),
    timeoutSeconds: z40.number().int().positive().optional(),
    disabledReason: z40.string().nullable().optional(),
    // Replace the notifier digest binding (full set, not a delta). Pass []
    // to unbind. Validated against the trigger's existing target_kind.
    deliverResultTo: z40.array(z40.string().min(1)).optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const current = getTrigger(id);
    if (!current) throw new ActionError("not_found", `Trigger not found: ${id}`);
    if (isReservedTrigger(id)) {
      const locked = RESERVED_LOCKED_FIELDS.filter(
        (f) => rest[f] !== void 0
      );
      if (locked.length > 0) {
        throw new ActionError(
          "conflict",
          `This trigger is managed by the app. You can change its schedule and delivery, but not: ${locked.join(", ")}.`
        );
      }
    }
    if (rest.deliverResultTo !== void 0) {
      rest.deliverResultTo = validateDeliverResultTo(rest.deliverResultTo, current.targetKind);
    }
    const cronExpression = rest.cronExpression !== void 0 ? rest.cronExpression : current.cronExpression;
    if (cronExpression && current.kind === "cron") {
      const tz = rest.timezone ?? current.timezone ?? "UTC";
      const v = validateCronExpression(cronExpression, tz);
      if (!v.valid) throw new ActionError("invalid_params", `Invalid cron: ${v.error}`);
    }
    const triggerChanged = rest.cronExpression !== void 0 || rest.intervalSeconds !== void 0 || rest.runAt !== void 0 || rest.timezone !== void 0;
    let nextRunAt = current.nextRunAt;
    if (triggerChanged) {
      nextRunAt = computeNextRun({
        kind: current.kind,
        cronExpression: cronExpression ?? null,
        intervalSeconds: rest.intervalSeconds !== void 0 ? rest.intervalSeconds : current.intervalSeconds,
        runAt: rest.runAt !== void 0 ? rest.runAt : current.runAt,
        timezone: rest.timezone !== void 0 ? rest.timezone : current.timezone,
        lastFiredAt: current.lastFiredAt
      });
    }
    const row2 = updateTrigger(id, { ...rest, nextRunAt });
    return row2;
  }
});
var delete_trigger_action = defineAction({
  name: "delete_trigger",
  description: "Delete a trigger. Existing runs survive (trigger_id nulled). Owned execution is preserved. Many triggers can share executions, so removing one doesn't archive shared work.",
  params: { id: z40.string().min(1) },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    if (isReservedTrigger(id)) {
      throw new ActionError(
        "conflict",
        "This trigger is managed by the app. Disable it instead of deleting."
      );
    }
    const ok2 = deleteTrigger(id);
    if (!ok2) throw new ActionError("not_found", `Trigger not found: ${id}`);
    return { id, deleted: true };
  }
});
var run_trigger_action = defineAction({
  name: "run_trigger",
  description: "Fire a trigger immediately, outside its cadence. Recorded as trigger=manual (user-initiated immediate) so the run history is consistent with chat-send dispatches.",
  params: {
    id: z40.string().min(1),
    triggerPayload: z40.unknown().optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: async (_ctx, { id, triggerPayload }) => {
    const trigger = getTrigger(id);
    if (!trigger) throw new ActionError("not_found", `Trigger not found: ${id}`);
    const { dispatchRun: dispatchRun2 } = await Promise.resolve().then(() => (init_dispatch2(), dispatch_exports));
    const result = await dispatchRun2({
      trigger,
      triggerKind: "manual",
      triggerPayload: triggerPayload ?? null
    });
    return { run: result.run, chatSessionId: result.chatSession?.id ?? null };
  }
});
var list_runs_action = defineAction({
  name: "list_runs",
  description: "List runs with filters. Defaults to newest-first across all sources.",
  params: {
    status: z40.union([runStatusFilter, z40.array(runStatusFilter)]).optional(),
    trigger: z40.union([runTriggerFilter, z40.array(runTriggerFilter)]).optional(),
    triggerId: z40.string().optional(),
    agentId: z40.string().optional(),
    executionId: z40.string().optional(),
    workspaceId: z40.string().optional(),
    since: z40.string().optional(),
    limit: z40.number().int().positive().max(500).optional(),
    offset: z40.number().int().nonnegative().optional()
  },
  handler: (_ctx, input) => listRuns(input)
});
var get_run_action = defineAction({
  name: "get_run",
  description: "Fetch a single run by id, including usage and outcome metadata.",
  params: { id: z40.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const row2 = getRun(id);
    if (!row2) throw new ActionError("not_found", `Run not found: ${id}`);
    return row2;
  }
});
var cancel_run_action = defineAction({
  name: "cancel_run",
  description: "Best-effort cancel of an in-flight run. The agent receives SIGTERM via the executor. The run row is marked failed with status_reason=cancelled. Already-terminal runs return their current state unchanged.",
  params: { id: z40.string().min(1) },
  mutating: true,
  cli: { positional: ["id"] },
  handler: async (_ctx, { id }) => {
    const run3 = getRun(id);
    if (!run3) throw new ActionError("not_found", `Run not found: ${id}`);
    if (run3.status !== "running" && run3.status !== "queued") {
      return run3;
    }
    if (run3.chatSessionId) {
      try {
        const { abort: abortChatSession } = await Promise.resolve().then(() => (init_adapter(), adapter_exports));
        await abortChatSession(run3.chatSessionId);
      } catch (err) {
        console.warn(`[cancel_run] abort failed for ${run3.chatSessionId}:`, err);
      }
    }
    return markRunFailed(id, {
      errorCode: "cancelled",
      errorMessage: "Cancelled by user",
      statusReason: "cancelled"
    }) ?? run3;
  }
});
var reset_trigger_failures_action = defineAction({
  name: "reset_trigger_failures",
  description: 'Clear the consecutive_failures counter on a trigger. Used by the "Reset failure count" affordance once the user has investigated the failures. Does not change enabled state.',
  params: { id: z40.string().min(1) },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const row2 = resetTriggerFailures(id);
    if (!row2) throw new ActionError("not_found", `Trigger not found: ${id}`);
    return row2;
  }
});
var list_notification_channels_action = defineAction({
  name: "list_notification_channels",
  description: "List the user's notification channels (Telegram connector, web push, in-app). Returns each channel's id, provider, label, target config and enabled state. Use the id to bind a trigger's result digest via create_trigger / update_trigger deliver_result_to. Channels themselves are created in the app UI (Telegram linking needs an OAuth-style claim flow).",
  params: {
    kind: z40.enum(["connector", "web_push", "in_app"]).optional(),
    providerId: z40.string().min(1).optional(),
    enabled: z40.boolean().optional()
  },
  handler: (_ctx, { kind, providerId, enabled }) => {
    let channels = listNotificationChannels({ userId: getNotifierUserId(), enabled });
    if (kind) channels = channels.filter((c) => c.kind === kind);
    if (providerId) channels = channels.filter((c) => c.providerId === providerId);
    return { channels };
  }
});
var list_skills_action = defineAction({
  name: "list_skills",
  description: "Return the merged skill inventory (brain-level + workspace-level) visible to the orchestrator. Workspace overrides global on name collision.",
  params: {
    workspaceCwd: z40.string().nullable().optional()
  },
  handler: (_ctx, { workspaceCwd }) => inventorySkills(workspaceCwd ?? null)
});
var actions = [
  describe_paths,
  describe_schema,
  list_tasks_action,
  get_task_action,
  create_task_action,
  update_task_action,
  complete_task_action,
  list_notes_action,
  get_note_action,
  create_note_action,
  update_note_action,
  list_stream_action,
  get_stream_item_action,
  create_stream_item_action,
  promote_stream_action,
  dismiss_stream_action,
  list_areas_action,
  get_area_action,
  create_area_action,
  update_area_action,
  get_deck_action,
  update_deck_action,
  regenerate_deck_action,
  reconcile_deck_action,
  search_action,
  get_user_state_action,
  update_user_state_action,
  list_workspaces_action,
  get_workspace_action,
  create_workspace_action,
  archive_workspace_action,
  list_workspace_sessions_action,
  list_executions_action,
  get_session_messages_action,
  get_pending_input_action,
  answer_pending_input_action,
  send_session_message_action,
  list_triggers_action,
  get_trigger_action,
  create_trigger_action,
  update_trigger_action,
  delete_trigger_action,
  run_trigger_action,
  list_runs_action,
  get_run_action,
  cancel_run_action,
  reset_trigger_failures_action,
  list_notification_channels_action,
  list_skills_action
];

// src/lib/orchestrator/dispatch.ts
import { z as z41 } from "zod";
function findAction(name) {
  return actions.find((a) => a.name === name);
}
async function runAction(name, rawInput, ctx) {
  const action2 = findAction(name);
  if (!action2) {
    return {
      ok: false,
      action: name,
      error: { code: "unknown_action", message: `Unknown action: ${name}` }
    };
  }
  const schema = z41.object(action2.params);
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      action: name,
      error: {
        code: "invalid_params",
        message: "Parameter validation failed",
        issues: parsed.error.issues
      }
    };
  }
  try {
    const result = await action2.handler(ctx, parsed.data);
    return { ok: true, action: name, result };
  } catch (err) {
    if (err instanceof ActionError) {
      return {
        ok: false,
        action: name,
        error: { code: err.code, message: err.message, suggestion: err.suggestion }
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action: name,
      error: { code: "internal_error", message }
    };
  }
}

// src/cli/commands/agent.ts
function registerAgentCommand(program2) {
  const agent = program2.command("agent").description(
    `Agent orchestrator surface. Typed, auto-generated CLI twin of the orchestrator MCP.`
  );
  for (const action2 of actions) {
    const positional = action2.cli?.positional ?? [];
    const positionalSet = new Set(positional);
    const posArgs = positional.map((p) => `<${p}>`).join(" ");
    const cmd = agent.command(`${action2.name}${posArgs ? " " + posArgs : ""}`).description(action2.description).option(
      "--input <json-or-@file>",
      'Full input as JSON. "@-" reads stdin. "@path.json" reads a file. Merged on top of flag/positional values.'
    );
    for (const [paramName, paramSchema] of Object.entries(action2.params)) {
      if (positionalSet.has(paramName)) continue;
      const flag = `--${paramName.replace(/_/g, "-")}`;
      cmd.option(`${flag} <value>`, describeParam(paramSchema));
    }
    cmd.action(async (...args) => {
      const cmdInstance = args[args.length - 1];
      const opts = cmdInstance.opts();
      const positionalValues = args.slice(0, positional.length);
      const input = {};
      positional.forEach((name, i) => {
        if (positionalValues[i] !== void 0) input[name] = positionalValues[i];
      });
      for (const [paramName, paramSchema] of Object.entries(action2.params)) {
        if (positionalSet.has(paramName)) continue;
        const flagKey = paramName.replace(/_/g, "");
        const camel = paramName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const raw = opts[camel] ?? opts[flagKey];
        if (raw === void 0) continue;
        input[paramName] = coerceFlag(raw, paramSchema);
      }
      if (opts.input) {
        const blob = readInputBlob(opts.input);
        Object.assign(input, blob);
      }
      const envelope = await runAction(action2.name, input, { remote: false });
      if (!envelope.ok) {
        process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(envelope.result, null, 2) + "\n");
    });
  }
  return agent;
}
function readInputBlob(ref) {
  const raw = ref === "@-" ? fs21.readFileSync(0, "utf8") : ref.startsWith("@") ? fs21.readFileSync(ref.slice(1), "utf8") : ref;
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must be a JSON object");
  }
  return parsed;
}
function coerceFlag(raw, schema) {
  const def = unwrap(schema);
  const typeName = def._def?.typeName;
  if (typeName === "ZodNumber") return Number(raw);
  if (typeName === "ZodBoolean") return raw === "true" || raw === "1";
  if (typeName === "ZodArray" || typeName === "ZodObject" || typeName === "ZodUnion") {
    try {
      return JSON.parse(raw);
    } catch {
      return typeName === "ZodArray" ? raw.split(",").map((s) => s.trim()) : raw;
    }
  }
  return raw;
}
function unwrap(schema) {
  const inner = schema._def?.innerType;
  return inner ? unwrap(inner) : schema;
}
function describeParam(schema) {
  const def = unwrap(schema);
  const typeName = def._def?.typeName;
  const hint = typeName === "ZodArray" ? "array: JSON or comma-separated" : typeName === "ZodObject" ? "object: JSON" : typeName === "ZodNumber" ? "number" : typeName === "ZodBoolean" ? "boolean" : typeName === "ZodEnum" ? `enum: ${(def.options ?? []).join("|")}` : "string";
  return hint;
}

// src/cli/commands/skills.ts
init_paths();
init_app();
init_shipped();
import pc10 from "picocolors";
async function loadAgentex2() {
  return import("@agentex/agent");
}
function registerSkillsCommand(program2) {
  const skills = program2.command("skills").description("Install and manage the skills this app ships for agent sessions");
  skills.command("install").description(
    "Symlink shipped skills into the app data dir (<app-root>/.claude/skills and <app-root>/.agents/skills). Pass --global to opt in to user-level ~/.claude/skills/ and ~/.agents/skills/."
  ).option("--global", "Install into the user-level ~/.claude/skills and ~/.agents/skills instead of the app data dir").action(async (opts) => {
    const isGlobal = !!opts.global;
    const result = isGlobal ? (await configureGlobalSkill(true)).install : await installAppRootSkills();
    for (const e of result.entries) {
      const tag = e.status === "created" ? pc10.green("+") : e.status === "skipped" ? pc10.dim("\xB7") : e.status === "conflict" ? pc10.yellow("!") : pc10.red("\xD7");
      console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc10.dim(e.targetPath)}`);
      if (e.error) console.log(`      ${pc10.red(e.error)}`);
    }
    console.log(
      pc10.dim(
        `
installed=${result.installed} skipped=${result.skipped} conflicts=${result.conflicts} errors=${result.errors}`
      )
    );
    if (result.conflicts > 0) {
      console.log(
        pc10.yellow(
          `
Some targets already exist pointing elsewhere. Remove them manually and re-run, or run \`${APP_SHORT_ID} skills remove${isGlobal ? " --global" : ""}\` first if they are ours.`
        )
      );
    }
  });
  skills.command("remove").description("Remove shipped-skill symlinks from the app data dir. Pass --global to target ~/.claude and ~/.agents.").option("--global", "Remove from the user-level ~/.claude/skills and ~/.agents/skills").action(async (opts) => {
    const result = opts.global ? (await configureGlobalSkill(false)).remove : await removeAppRootSkills();
    for (const e of result.entries) {
      const tag = e.status === "removed" ? pc10.green("-") : e.status === "not_found" ? pc10.dim("\xB7") : e.status === "conflict" ? pc10.yellow("!") : pc10.red("\xD7");
      console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc10.dim(e.targetPath)}`);
    }
    console.log(pc10.dim(`
removed=${result.removed}`));
  });
  skills.command("list").description("List skills installed in the two standard channels. Pass --global for ~/.claude and ~/.agents.").option("--global", "List from the user-level ~/.claude/skills and ~/.agents/skills").action(async (opts) => {
    const { listInstalledSkills } = await loadAgentex2();
    const installed = opts.global ? await listInstalledSkills({ location: "global" }) : await listInstalledSkills({ location: "workspace", cwd: getAppRoot() });
    for (const [channel, entries] of Object.entries(installed)) {
      console.log(pc10.bold(channel));
      if (entries.length === 0) {
        console.log(pc10.dim("  (none)"));
        continue;
      }
      for (const s of entries) {
        const tag = s.isSymlink ? pc10.green("\u2197") : pc10.dim("\xB7");
        console.log(`  ${tag} ${s.name}  ${pc10.dim(s.sourcePath ?? "?")}`);
      }
    }
  });
}

// src/cli/commands/trigger.ts
import fs22 from "fs";
import readline from "readline";
function registerTriggerCommands(program2) {
  registerTriggerCommand(program2);
  registerRunsCommand(program2);
  registerSpendCommand(program2);
}
function registerTriggerCommand(program2) {
  const trigger = program2.command("trigger").description("Manage scheduled agent work (cron, interval, one-shot, webhook).");
  trigger.command("create").description(
    "Create a new trigger. Prefer the friendly cadence flags (--manual / --hourly / --daily-at / --weekly-on / --monthly-on / --webhook / --cron) over the low-level --cron/--every/--at trio."
  ).requiredOption("--name <name>", "Human-facing name. Unique within scope.").option("--prompt <prompt>", "Prompt text. One of --prompt or --prompt-file is required.").option("--prompt-file <path>", "Path to a file containing the prompt text.").option("--description <text>", "Short description (shown alongside the name).").option("--manual", "No automatic firing. Only fires via `flow trigger run`.").option("--hourly", "Fire at the top of every hour.").option("--daily-at <time>", "Fire daily at HH:MM (e.g. 09:00).").option("--weekly-on <day>", "Weekday: monday|tuesday|... (use with --at).").option("--monthly-on <day>", "Day of month 1-28 (use with --at).", Number).option("--at <time>", "HH:MM time, used with --weekly-on / --monthly-on.").option("--cron <expr>", "5-field cron expression (advanced).").option("--every <seconds>", "Interval in seconds.", Number).option("--run-at <iso>", "Absolute ISO timestamp for a one-shot trigger.").option("--webhook", "Webhook-triggered trigger.").option("--timezone <tz>", "IANA timezone for cron interpretation.", "UTC").option("--target <kind>", "workspace | orchestrator", "workspace").option("--workspace <id-or-slug>", "Target workspace (required when target=workspace).").option("--agent <id>", "Agent id to dispatch as. Defaults to the target type default.").option("--model <model>", "Per-run model override.").option("--effort <level>", "low | medium | high | xhigh | max | ultra").option("--timeout <seconds>", "Run timeout (seconds).", Number).option(
    "--active-hours <start-end>",
    "Active-hours window, e.g. 09:00-17:00. Only fires inside the window."
  ).option(
    "--concurrency <policy>",
    "skip_if_running | coalesce_if_active | allow_concurrent",
    "coalesce_if_active"
  ).action(async (opts) => {
    const promptText = opts.promptFile ? fs22.readFileSync(opts.promptFile, "utf8") : opts.prompt;
    if (!promptText || !promptText.trim()) {
      process.stderr.write(
        'Provide --prompt "..." or --prompt-file <path>.\n'
      );
      process.exit(1);
    }
    const compiled = await compileCadence(opts);
    const [startHours, endHours] = parseActiveHours(opts.activeHours);
    const input = {
      name: opts.name,
      description: opts.description ?? null,
      prompt: promptText,
      ...opts.agent ? { agentId: opts.agent } : {},
      targetKind: opts.target,
      workspaceId: opts.workspace ?? null,
      kind: compiled.kind,
      cronExpression: compiled.cronExpression,
      intervalSeconds: compiled.intervalSeconds,
      runAt: compiled.runAt,
      timezone: opts.timezone,
      model: opts.model ?? null,
      effort: opts.effort ?? null,
      timeoutSeconds: opts.timeout,
      activeHoursStart: startHours,
      activeHoursEnd: endHours,
      concurrencyPolicy: opts.concurrency
    };
    const envelope = await runAction("create_trigger", input, { remote: false });
    unwrapAndPrint(envelope);
  });
  trigger.command("list").description("List triggers.").option("--enabled", "Only enabled triggers.").option("--workspace <id>", "Restrict to a workspace.").action(async (opts) => {
    const envelope = await runAction(
      "list_triggers",
      {
        ...opts.enabled ? { enabled: true } : {},
        ...opts.workspace ? { workspaceId: opts.workspace } : {}
      },
      { remote: false }
    );
    if (!envelope.ok) return printErrorAndExit(envelope);
    printTriggerTable(envelope.result);
  });
  trigger.command("show <idOrName>").description("Show a trigger in detail.").action(async (idOrName) => {
    const result = await resolveTriggerByIdOrName(idOrName);
    console.log(JSON.stringify(result, null, 2));
  });
  trigger.command("run <idOrName>").description("Fire a trigger immediately (records as a manual run).").option("--wait", "Block until the run terminates.").action(async (idOrName) => {
    const trigger2 = await resolveTriggerByIdOrName(idOrName);
    const envelope = await runAction(
      "run_trigger",
      { id: trigger2.id },
      { remote: false }
    );
    unwrapAndPrint(envelope);
  });
  trigger.command("pause <idOrName>").description("Disable a trigger. Existing runs are unaffected.").action(async (idOrName) => {
    const target = await resolveTriggerByIdOrName(idOrName);
    const envelope = await runAction(
      "update_trigger",
      { id: target.id, enabled: false },
      { remote: false }
    );
    unwrapAndPrint(envelope);
  });
  trigger.command("resume <idOrName>").description("Re-enable a previously paused trigger.").action(async (idOrName) => {
    const target = await resolveTriggerByIdOrName(idOrName);
    const envelope = await runAction(
      "update_trigger",
      { id: target.id, enabled: true, disabledReason: null },
      { remote: false }
    );
    unwrapAndPrint(envelope);
  });
  trigger.command("edit <idOrName>").description("Patch a trigger (prompt, cadence, etc.).").option("--prompt <text>", "New prompt text").option("--cron <expr>", "New cron expression").option("--every <seconds>", "New interval in seconds", Number).option("--timezone <tz>", "New timezone").option("--enabled <bool>", "true | false", (v) => v === "true").action(async (idOrName, opts) => {
    const target = await resolveTriggerByIdOrName(idOrName);
    const patch = { id: target.id };
    if (opts.prompt) patch.prompt = opts.prompt;
    if (opts.cron) patch.cronExpression = opts.cron;
    if (opts.every) patch.intervalSeconds = opts.every;
    if (opts.timezone) patch.timezone = opts.timezone;
    if (opts.enabled !== void 0) patch.enabled = opts.enabled;
    const envelope = await runAction("update_trigger", patch, { remote: false });
    unwrapAndPrint(envelope);
  });
  trigger.command("delete <idOrName>").description("Delete a trigger. Runs survive with trigger_id=NULL.").option("--force", "Skip the confirmation prompt.").action(async (idOrName, opts) => {
    const target = await resolveTriggerByIdOrName(idOrName);
    if (!opts.force) {
      const ans = await readLine(`Delete trigger "${target.name}" (${target.id})? [y/N] `);
      if (ans.toLowerCase() !== "y" && ans.toLowerCase() !== "yes") {
        console.log("Aborted.");
        return;
      }
    }
    const envelope = await runAction(
      "delete_trigger",
      { id: target.id },
      { remote: false }
    );
    unwrapAndPrint(envelope);
  });
}
function registerRunsCommand(program2) {
  program2.command("runs").description("List recent runs across all triggers + manual chats.").option("--unread", "Only runs whose chat is still unread.").option("--status <s>", "Filter by status.").option("--trigger <t>", "Filter by trigger.").option("--trigger-id <id>", "Filter by trigger id.").option("--limit <n>", "Max rows.", Number).action(async (opts) => {
    const splitMulti = (raw) => raw == null ? void 0 : raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
    const envelope = await runAction(
      "list_runs",
      {
        ...opts.status ? { status: splitMulti(opts.status) } : {},
        ...opts.trigger ? { trigger: splitMulti(opts.trigger) } : {},
        ...opts.triggerId ? { triggerId: opts.triggerId } : {},
        ...opts.limit ? { limit: opts.limit } : { limit: 25 }
      },
      { remote: false }
    );
    if (!envelope.ok) return printErrorAndExit(envelope);
    printRunTable(envelope.result);
  });
  const run3 = program2.command("run").description("Operate on a single run.");
  run3.command("show <id>").description("Fetch a single run.").action(async (id) => {
    const envelope = await runAction("get_run", { id }, { remote: false });
    unwrapAndPrint(envelope);
  });
  run3.command("cancel <id>").description("Cancel an in-flight run (SIGTERM the executor).").action(async (id) => {
    const envelope = await runAction("cancel_run", { id }, { remote: false });
    unwrapAndPrint(envelope);
  });
}
function registerSpendCommand(program2) {
  program2.command("spend").description("Spending rollups across runs (today / week / month).").option("--by <group>", "Group by agent or trigger.").action(async (opts) => {
    const since = /* @__PURE__ */ new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const envelope = await runAction(
      "list_runs",
      { since: since.toISOString(), limit: 500 },
      { remote: false }
    );
    if (!envelope.ok) return printErrorAndExit(envelope);
    const runs2 = envelope.result;
    const now = /* @__PURE__ */ new Date();
    const today = sumWhere(
      runs2,
      (r) => r.startedAt != null && sameUtcDay(r.startedAt, now)
    );
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    weekStart.setUTCHours(0, 0, 0, 0);
    const week = sumWhere(runs2, (r) => r.startedAt != null && r.startedAt >= weekStart.toISOString());
    const monthStart = since.toISOString();
    const month = sumWhere(runs2, (r) => r.startedAt != null && r.startedAt >= monthStart);
    console.log(`Today: $${today.toFixed(4)}`);
    console.log(`Week:  $${week.toFixed(4)}`);
    console.log(`Month: $${month.toFixed(4)}`);
    if (opts.by === "agent" || opts.by === "trigger") {
      const keyOf = (r) => opts.by === "agent" ? r.agentId : r.triggerId ?? "manual";
      const byKey2 = /* @__PURE__ */ new Map();
      for (const r of runs2) {
        const k = keyOf(r);
        byKey2.set(k, (byKey2.get(k) ?? 0) + (r.costUsd ?? 0));
      }
      console.log(`
By ${opts.by}:`);
      for (const [k, v] of byKey2) {
        console.log(`  ${k.padEnd(40)}  $${v.toFixed(4)}`);
      }
    }
  });
}
function unwrapAndPrint(envelope) {
  if (!envelope.ok) return printErrorAndExit(envelope);
  process.stdout.write(JSON.stringify(envelope.result, null, 2) + "\n");
}
function printErrorAndExit(envelope) {
  process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
  process.exit(1);
}
async function resolveTriggerByIdOrName(idOrName) {
  const byId = await runAction("get_trigger", { id: idOrName }, { remote: false });
  if (byId.ok) return byId.result;
  const byName = await runAction(
    "get_trigger",
    { name: idOrName, workspaceId: null },
    { remote: false }
  );
  if (byName.ok) return byName.result;
  printErrorAndExit(byName);
  throw new Error("unreachable");
}
async function compileCadence(opts) {
  const { frequencyToTrigger: frequencyToTrigger2 } = await Promise.resolve().then(() => (init_frequency(), frequency_exports));
  if (opts.manual) {
    return { kind: "manual", cronExpression: null, intervalSeconds: null, runAt: null };
  }
  if (opts.webhook) {
    return { kind: "webhook", cronExpression: null, intervalSeconds: null, runAt: null };
  }
  if (opts.hourly) {
    const c = frequencyToTrigger2({ kind: "hourly" });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.dailyAt) {
    const c = frequencyToTrigger2({ kind: "daily", time: opts.dailyAt });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.weeklyOn) {
    const weekday = parseWeekday(opts.weeklyOn);
    if (!opts.at) throw new Error("--weekly-on requires --at HH:MM");
    const c = frequencyToTrigger2({ kind: "weekly", weekday, time: opts.at });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.monthlyOn) {
    if (!opts.at) throw new Error("--monthly-on requires --at HH:MM");
    const c = frequencyToTrigger2({
      kind: "monthly",
      dayOfMonth: opts.monthlyOn,
      time: opts.at
    });
    return { kind: c.kind, cronExpression: c.cronExpression, intervalSeconds: null, runAt: null };
  }
  if (opts.cron) {
    return { kind: "cron", cronExpression: opts.cron, intervalSeconds: null, runAt: null };
  }
  if (opts.every) {
    return { kind: "every", cronExpression: null, intervalSeconds: opts.every, runAt: null };
  }
  if (opts.runAt) {
    return { kind: "at", cronExpression: null, intervalSeconds: null, runAt: opts.runAt };
  }
  throw new Error(
    "Pick a cadence: --manual, --hourly, --daily-at, --weekly-on, --monthly-on, --webhook, --cron, --every, or --run-at."
  );
}
var WEEKDAY_NAMES = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};
function parseWeekday(spec) {
  const key = spec.trim().toLowerCase();
  const v = WEEKDAY_NAMES[key];
  if (v == null) {
    throw new Error(
      `--weekly-on "${spec}": expected monday|tuesday|wednesday|thursday|friday|saturday|sunday`
    );
  }
  return v;
}
function parseActiveHours(spec) {
  if (!spec) return [null, null];
  const m = spec.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) throw new Error(`--active-hours must look like 09:00-17:00, got "${spec}"`);
  return [m[1], m[2]];
}
function sumWhere(runs2, pred) {
  let sum = 0;
  for (const r of runs2) if (pred(r)) sum += r.costUsd ?? 0;
  return sum;
}
function sameUtcDay(iso, ref) {
  const d = new Date(iso);
  return d.getUTCFullYear() === ref.getUTCFullYear() && d.getUTCMonth() === ref.getUTCMonth() && d.getUTCDate() === ref.getUTCDate();
}
function printTriggerTable(rows) {
  if (rows.length === 0) {
    console.log("No triggers.");
    return;
  }
  const header = ["NAME", "KIND", "TARGET", "ENABLED", "NEXT FIRE", "LAST"];
  const data3 = rows.map((s) => [
    s.name,
    s.kind,
    s.targetKind,
    s.enabled ? "yes" : "no",
    s.nextRunAt ? humanize(s.nextRunAt) : "-",
    s.lastRunStatus ?? "-"
  ]);
  printTable(header, data3);
}
function printRunTable(rows) {
  if (rows.length === 0) {
    console.log("No runs.");
    return;
  }
  const header = ["ID", "TRIGGER", "STATUS", "STARTED", "COST", "SUMMARY"];
  const data3 = rows.map((r) => [
    r.id.slice(0, 8),
    r.triggerKind,
    r.status,
    r.startedAt ? humanize(r.startedAt) : "-",
    r.costUsd != null ? `$${(r.costUsd ?? 0).toFixed(4)}` : "-",
    (r.summary ?? "").slice(0, 50)
  ]);
  printTable(header, data3);
}
function printTable(header, rows) {
  const widths = header.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0))
  );
  const pad = (cells) => cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  console.log(pad(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row2 of rows) console.log(pad(row2));
}
function humanize(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16);
}
function readLine(prompt = "") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// src/cli/commands/takeover.ts
init_paths();
import fs25 from "fs";
import path23 from "path";
import { execFile as execFile3 } from "child_process";
import { promisify as promisify3 } from "util";
import pc11 from "picocolors";

// src/cli/lib/cli-config.ts
init_paths();
import fs23 from "fs";
import path21 from "path";
var DEFAULT_CONFIG = { editor: "cursor" };
function getConfigPath2() {
  return path21.join(getConfigDir(), "cli-config.json");
}
function readCliConfig() {
  try {
    const raw = fs23.readFileSync(getConfigPath2(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      editor: parsed.editor === "cursor" || parsed.editor === "vscode" || parsed.editor === "jetbrains" ? parsed.editor : DEFAULT_CONFIG.editor
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// src/cli/lib/takeover-state.ts
init_paths();
import fs24 from "fs";
import path22 from "path";
var STATE_FILENAME = ".flow-takeover.json";
function stateFilePath(clonePath) {
  return path22.join(clonePath, STATE_FILENAME);
}
function writeState(clonePath, state5) {
  fs24.writeFileSync(stateFilePath(clonePath), JSON.stringify(state5, null, 2), {
    mode: 384
  });
}
function readState(clonePath) {
  try {
    const raw = fs24.readFileSync(stateFilePath(clonePath), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.host !== "string" || typeof parsed.token !== "string" || typeof parsed.sessionId !== "string" || typeof parsed.workspaceId !== "string" || typeof parsed.branch !== "string" || typeof parsed.startedAt !== "string") {
      return null;
    }
    return {
      host: parsed.host,
      token: parsed.token,
      sessionId: parsed.sessionId,
      workspaceId: parsed.workspaceId,
      workspaceName: parsed.workspaceName ?? parsed.workspaceId,
      branch: parsed.branch,
      startedAt: parsed.startedAt
    };
  } catch {
    return null;
  }
}
function clearState(clonePath) {
  try {
    fs24.unlinkSync(stateFilePath(clonePath));
  } catch {
  }
}
function findActiveTakeovers() {
  const root = getClonesDir();
  if (!fs24.existsSync(root)) return [];
  const out = [];
  for (const entry of fs24.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const clonePath = path22.join(root, entry.name);
    const state5 = readState(clonePath);
    if (state5) out.push({ clonePath, state: state5 });
  }
  out.sort((a, b) => b.state.startedAt.localeCompare(a.state.startedAt));
  return out;
}
function cloneDirFor(workspaceId) {
  return path22.join(getClonesDir(), workspaceId);
}

// src/cli/lib/open-editor.ts
import open2 from "open";
function pathToUrl(scheme, absPath) {
  const normalized = absPath.startsWith("/") ? absPath : `/${absPath}`;
  return `${scheme}://file${encodeURI(normalized)}`;
}
function editorUrl(editor, absPath) {
  switch (editor) {
    case "vscode":
      return pathToUrl("vscode", absPath);
    case "jetbrains":
      return `jetbrains://open?file=${encodeURIComponent(absPath)}`;
    case "cursor":
    default:
      return pathToUrl("cursor", absPath);
  }
}
async function openInEditor(absPath, editor) {
  const url = editorUrl(editor, absPath);
  try {
    await open2(url);
    return { url, ok: true };
  } catch (err) {
    return { url, ok: false, error: err };
  }
}

// src/cli/commands/takeover.ts
var execFileAsync3 = promisify3(execFile3);
function parseTakeoverUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  const tMatch = url.pathname.match(/^\/t\/([^/]+)\/?$/);
  const apiMatch = url.pathname.match(/^\/api\/takeover\/([^/]+)\/?$/);
  const token = tMatch?.[1] ?? apiMatch?.[1];
  if (!token) {
    throw new Error(
      `URL doesn't look like a takeover link. Expected ${url.origin}/t/<token>, got ${raw}`
    );
  }
  return { host: url.origin, token };
}
async function fetchInfo(host, token) {
  const url = `${host.replace(/\/+$/, "")}/api/takeover/${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        "Token not found. The takeover may have been cancelled, or this is a stale URL. Ask the browser to start a new takeover."
      );
    }
    if (res.status === 410) {
      throw new Error(
        "Token expired. Ask the browser to start a new takeover."
      );
    }
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
    }
    throw new Error(`Server returned ${res.status} ${res.statusText}. ${detail}`);
  }
  return await res.json();
}
async function ensureClone(clonePath, remoteUrl) {
  const gitDir = path23.join(clonePath, ".git");
  if (fs25.existsSync(clonePath) && !fs25.existsSync(gitDir)) {
    throw new Error(
      `Clone path exists but isn't a git repo: ${clonePath}
Move or remove it, then retry.`
    );
  }
  if (!fs25.existsSync(clonePath)) {
    ensureClonesDir();
    console.log(pc11.dim(`Cloning ${remoteUrl} \u2192 ${clonePath}`));
    await execFileAsync3("git", ["clone", remoteUrl, clonePath], { maxBuffer: 32 * 1024 * 1024 });
    return;
  }
  console.log(pc11.dim(`Reusing existing clone at ${clonePath}; fetching origin\u2026`));
  await execFileAsync3("git", ["fetch", "origin"], { cwd: clonePath, maxBuffer: 32 * 1024 * 1024 });
}
async function checkout(clonePath, branch) {
  try {
    await execFileAsync3("git", ["checkout", branch], { cwd: clonePath });
  } catch {
    await execFileAsync3(
      "git",
      ["checkout", "-b", branch, `origin/${branch}`],
      { cwd: clonePath }
    );
  }
}
async function takeoverCommand(urlArg, opts) {
  if (opts.list) {
    const active = findActiveTakeovers();
    if (active.length === 0) {
      console.log(pc11.dim("No active takeovers on this machine."));
      return;
    }
    console.log(pc11.bold("Active takeovers:"));
    for (const t of active) {
      console.log(
        `  ${pc11.cyan(t.state.workspaceName)} ` + pc11.dim(`(${t.state.branch})  started ${t.state.startedAt}
    ${t.clonePath}`)
      );
    }
    return;
  }
  if (!urlArg) {
    console.error(
      pc11.red("Missing URL argument. Run `flow takeover <url>` with the link from the browser modal.")
    );
    process.exit(1);
  }
  const { host, token } = parseTakeoverUrl(urlArg);
  console.log(pc11.dim(`Contacting ${host}\u2026`));
  const info = await fetchInfo(host, token);
  const clonePath = cloneDirFor(info.workspaceId);
  await ensureClone(clonePath, info.remoteUrl);
  await checkout(clonePath, info.branch);
  writeState(clonePath, {
    host,
    token,
    sessionId: info.sessionId,
    workspaceId: info.workspaceId,
    workspaceName: info.workspaceName,
    branch: info.branch,
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  console.log(pc11.green(`\u2713 Branch ${info.branch} checked out at ${clonePath}.`));
  if (!opts.noOpen) {
    const cfg = readCliConfig();
    const result = await openInEditor(clonePath, cfg.editor);
    if (result.ok) {
      console.log(pc11.green(`\u2713 Opened in ${cfg.editor}.`));
    } else {
      console.log(
        pc11.yellow(`Could not launch editor automatically. Open manually: ${result.url}`)
      );
    }
  }
  console.log("");
  console.log(`When you're done, run ${pc11.bold("flow resume")} to sync your changes back to the host.`);
}
function registerTakeoverCommand(program2) {
  program2.command("takeover [url]").description("Take over an agent session locally: clones the workspace and opens it in your editor").option("--no-open", "Don't auto-launch the editor after cloning").option("--list", "List active takeovers on this machine instead of starting a new one").action(takeoverCommand);
}

// src/cli/commands/resume.ts
import { execFile as execFile4 } from "child_process";
import { promisify as promisify4 } from "util";
import pc12 from "picocolors";
var execFileAsync4 = promisify4(execFile4);
function pick(active, filter) {
  if (active.length === 0) return null;
  if (!filter) {
    if (active.length === 1) return active[0];
    return null;
  }
  const lower = filter.toLowerCase();
  return active.find(
    (t) => t.state.workspaceId === filter || t.state.workspaceName.toLowerCase() === lower
  ) ?? null;
}
async function isDirty(clonePath) {
  const { stdout } = await execFileAsync4("git", ["status", "--porcelain"], { cwd: clonePath });
  return stdout.trim().length > 0;
}
async function autoCommit(clonePath) {
  console.log(pc12.dim("Committing local changes..."));
  await execFileAsync4("git", ["add", "-A"], { cwd: clonePath });
  const message = `Takeover edits ${(/* @__PURE__ */ new Date()).toISOString()}`;
  await execFileAsync4("git", ["commit", "-m", message], { cwd: clonePath });
}
async function pushBranch(clonePath, branch) {
  await execFileAsync4("git", ["push", "origin", branch], { cwd: clonePath });
}
async function callResume(host, token) {
  const url = `${host.replace(/\/+$/, "")}/api/takeover/${token}/resume`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        "Server doesn't recognise this takeover anymore. It may have been cancelled or already resumed."
      );
    }
    if (res.status === 409) {
      let body = {};
      try {
        body = await res.json();
      } catch {
      }
      throw new Error(`Pull conflict on the host worktree.${body.message ? `
${body.message}` : ""}`);
    }
    if (res.status === 410) {
      throw new Error(
        "Takeover token expired. The server cleared it after one hour."
      );
    }
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
    }
    throw new Error(`Server returned ${res.status} ${res.statusText}. ${detail}`);
  }
  return await res.json();
}
async function resumeCommand(opts) {
  const active = findActiveTakeovers();
  if (active.length === 0) {
    console.log(pc12.dim("No active takeover on this machine."));
    console.log(pc12.dim("Start one with `flow takeover <url>` from the browser modal."));
    return;
  }
  const chosen = pick(active, opts.workspace);
  if (!chosen) {
    if (active.length > 1 && !opts.workspace) {
      console.error(pc12.red("Multiple active takeovers. Disambiguate with --workspace <name-or-id>:"));
      for (const t of active) {
        console.error(
          `  ${pc12.cyan(t.state.workspaceName)} ${pc12.dim(t.state.workspaceId)}: ${t.state.branch}`
        );
      }
    } else {
      console.error(pc12.red(`No takeover matches "${opts.workspace}".`));
    }
    process.exit(1);
  }
  const { clonePath, state: state5 } = chosen;
  console.log(pc12.dim(`Resuming ${state5.workspaceName} (${state5.branch}) at ${clonePath}`));
  if (await isDirty(clonePath)) {
    await autoCommit(clonePath);
  }
  try {
    await pushBranch(clonePath, state5.branch);
    console.log(pc12.green(`\u2713 Pushed ${state5.branch} to origin.`));
  } catch (err) {
    console.error(pc12.red("Push failed. Resolve manually, then retry `flow resume`."));
    if (err instanceof Error) console.error(pc12.dim(err.message));
    process.exit(1);
  }
  let response;
  try {
    response = await callResume(state5.host, state5.token);
  } catch (err) {
    console.error(pc12.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
  clearState(clonePath);
  console.log(
    pc12.green(
      `\u2713 Host pulled ${response.filesChanged} file(s)${response.shortstat ? ` (${response.shortstat})` : ""}, posted diff to agent.`
    )
  );
  console.log(pc12.dim(`Open the session to continue: ${state5.host}`));
}
function registerResumeCommand(program2) {
  program2.command("resume").description("Push your local takeover changes back to the host and resume the agent").option("-w, --workspace <name-or-id>", "Disambiguate when multiple takeovers are active").action(resumeCommand);
}

// src/cli/index.ts
var program = new Command();
program.name(APP_SHORT_ID).description(`${APP_NAME}: productivity for humans and agents`).version("0.0.1");
program.command("start", { isDefault: true }).description(`Start ${APP_NAME} and open the app`).option("-p, --port <number>", "port to bind (default: 4224, or 42241 with --dev)").option("--no-open", "do not launch the browser").option("--pair", "open the pairing URL even if already paired").option("--dev", "run the server in dev mode (next dev) instead of production").option("--voice", "start the voice sidecar (overrides saved preference)").option("--no-voice", "skip the voice sidecar (overrides saved preference)").option(
  "--portless [name]",
  `front the dev server with portless.sh at <name>.localhost (default: ${APP_SHORT_ID})`
).option("--hot", "enable the client-side hot-path tracker (sets NEXT_PUBLIC_HOT=1)").action(startCommand);
program.command("stop").description(`Stop a running ${APP_NAME} server`).option("-p, --port <number>", "port of the instance to stop").option("--dev", "target the dev instance (dev data root, default port 42241)").option("-f, --force", "send SIGKILL immediately instead of SIGTERM").option("-t, --timeout <ms>", "how long to wait for graceful shutdown", "5000").action(stopCommand);
program.command("onboard").description("Run first-run setup (or re-configure an existing install)").option("-p, --port <number>", "port to probe for an already-running instance", "4224").option("--force", "run the full wizard even if already onboarded").action(onboardCommand);
program.command("pair").description("Mint a new device key and print its pairing URL + QR").option("-n, --name <name>", "label for the new device (shown in web UI)").option(
  "-t, --type <type>",
  "device type: desktop | laptop | phone | tablet | cli | other"
).option("--lan", "use the LAN IP instead of the remote URL").option("--local", "use localhost instead of the remote URL").option("--set-url <url>", "save a public/tunnel base URL for off-network pairing").option("--clear-url", "forget the saved public/tunnel base URL").action(pairCommand);
program.command("doctor").description("Run diagnostic checks").action(doctorCommand);
registerVoiceCommand(program);
registerSnapshotCommand(program);
registerCommitCommand(program);
registerExportCommand(program);
registerAgentCommand(program);
registerSkillsCommand(program);
registerTriggerCommands(program);
registerTakeoverCommand(program);
registerResumeCommand(program);
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
