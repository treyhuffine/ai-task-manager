# AI-Native Human+Agent Productivity App

Open source agentic productivity tool built with Next.js 16 (App Router), React 19, and TypeScript. Combines tasks, notes, and AI chat into a single dashboard. It allows agents+humans to seamlessly handle tasks. The goal is to minimize decisions and maintance overhead that lead to system and task/note rot. We enable the user to: get into flow, minimal context switching between tasks, and focus on execution.

Our design constraint is to remove the pieces of digital system that were created only for human organization. We want to be simple/minimal and only have the necessary structure to make it easy for a human to utilize and straightforward for agents to engage. The rest relies on AI intelligence to manage. We believe simple systems are ultimately the most robust and what will have longevity.

Local-first with SQLite (via better-sqlite3 + Drizzle ORM) and vector search (sqlite-vec) for semantic embeddings.

## Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Database:** SQLite (better-sqlite3) with Drizzle ORM — schema at `src/lib/db/schema.ts`
- **AI:** Vercel AI SDK, Anthropic SDK, OpenAI SDK
- **UI:** Tailwind CSS v4, shadcn/ui (Radix primitives), Vercel AI Elements, Tiptap rich editor
- **State:** TanStack Query
- **Voice:** Parakeet STT — Git submodule at `modules/parakeet-stt`, runs as a Docker sidecar (`pnpm dev:stt`)

## Commands

- `pnpm dev` — starts dev server on port 4224
- `pnpm build` — production build
- `pnpm ts` — typecheck (tsc --noEmit)
- `pnpm lint` — ESLint
- `pnpm db:push` — push schema to SQLite
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm db:seed` — seed dev data
- `pnpm db:reset` — reset and re-seed

## Rules

- **Use pnpm** — not npm or yarn
- **Dev server runs on port 4224** by default
- **Installable UI components** (shadcn, Vercel AI elements, ElevenLabs, etc.) must be added via their CLI tool — do not manually write or copy component source files
- **Types** are derived from the Drizzle schema in `src/db/types.ts` — do not duplicate type definitions
- **API routes** use shared query functions from `src/lib/db/queries.ts` — do not write raw SQL in route handlers

## Boil the Ocean

The marginal cost of completeness is near zero with AI. Do the whole thing.
Do it right. Do it with tests. Do it with documentation. Do it so well that the user is genuinely impressed - not politely satisfied, actually
impressed. Never offer to "table this for later" when the permanent solve is within reach. Never leave a dangling thread when tying it off takes five more minutes. Never present a workaround when the real fix exists.
The standard isn't "good enough" - it's "holy shit, that's done." Search before building. Test before shipping.
Ship the complete thing. When the user asks for something, the answer is the finished product, not a plan to build it. Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse. Boil the ocean. That doesn't mean over-engineer. It means don't leave work on the table. Do it well.