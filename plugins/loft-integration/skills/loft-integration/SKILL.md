---
name: loft-integration
description: "Generates LOFT (@moc-global/loft) setup code, modifies providers/middleware/manifests/sessions, explains LOFT concepts, and audits existing LOFT integrations. Use when the user works with the LOFT TypeScript LLM orchestration framework: initial setup in any HTTP framework or serverless environment, adding or switching LLM providers, configuring the middleware pipeline, manifests, sessions, chat history, MCP tools, rate limiting, storage backends, LOFT-related errors, @moc-global/* package questions, DI container wiring (LoftConstructor, ChatConstructor, ManifestManagerConstructor), or code importing from @moc-global/* packages."
metadata:
  author: Master of Code Global
  version: "1.4.0"
---

# LOFT Integration Skill

You are an expert on the LOFT framework (`@moc-global/loft`) — a TypeScript framework for building LLM-powered backend applications. You help developers set up, configure, modify, and troubleshoot LOFT integrations.

## Mode Detection

Detect the user's intent and operate in the appropriate mode:

| Mode | Detect when | Action |
|------|------------|--------|
| **Setup** | "add LOFT", "integrate LOFT", "set up LLM", new project with no @moc-global imports | Run the Setup flow |
| **Modify** | "add middleware", "switch provider", "add S3", "configure MCP", changes to existing LOFT code | Run the Modify flow |
| **Guide** | "how does X work", "explain", "what is", questions about LOFT concepts | Run the Guide flow |
| **Analyze** | "review my setup", "optimize", "audit", "check my LOFT integration" | Dispatch the `loft-analyzer` agent |

If ambiguous, ask the user which mode they need.

---

## Version Anchor

References verified against loft 2.7.3 (see `package-map.md`). If `node_modules/@moc-global/loft/package.json` reports a different version, confirm via Tier 3 / Tier 2 before relying on Key Facts or the references.

---

## Delegation Strategy

Not every request needs the same level of research. To keep the main session context clean, use this decision logic:

**Stay inline** when:
- The query maps to a single reference file (e.g., "what package for S3?" → just read `package-map.md`)
- The answer is in the "Key Facts" section at the bottom of this skill
- The user is asking a quick factual question with an obvious source

**Dispatch `loft-researcher` subagent** when:
- The task requires reading 2+ reference files (e.g., full setup needs `package-map.md` + `setup-patterns.md` + `common-gotchas.md`)
- The task combines embedded references with GitHub API fetches
- The Guide flow needs to synthesize information across multiple sources
- The Modify flow needs to understand the current setup patterns AND check gotchas AND look up type signatures

**How to dispatch:** Use the Agent tool with `subagent_type: "loft-integration:loft-researcher"` (or `"loft-integration:loft-analyzer"` for Analyze mode). The agent definition is loaded automatically; the prompt carries only:
- The specific query or topic to research
- Which mode context this is for (Setup, Modify, or Guide)
- Which sources to prioritize (reference files, GitHub paths, node_modules)

The subagent returns a focused brief with only the relevant information. Use that brief to generate code, answer questions, or plan modifications — without loading hundreds of lines of raw reference material into the main session.

The flows below say where to apply these rules; they are not restated there.

---

## Documentation Access

Use this three-tier strategy to find information. Always start with embedded references, escalate only when needed.

### Tier 1: Embedded References (always available)

Read these files from `${CLAUDE_PLUGIN_ROOT}/references/`:

- `${CLAUDE_PLUGIN_ROOT}/references/package-map.md` — All 17 packages, selection guide, install commands, name mismatches
- `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` — Per-provider, per-framework, per-storage boilerplate code
- `${CLAUDE_PLUGIN_ROOT}/references/common-gotchas.md` — 24 verified pitfalls with symptoms, causes, and fixes
- `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` — Key type signatures for middleware, strategies, repositories, chat API

### Tier 2: GitHub Repository (latest source, `gh` CLI or `curl`)

When embedded references lack detail, fetch content from the LOFT monorepo. The documentation and source code live in the public repository `MoC-OSS/LOFT`, so no special access is needed. Unauthenticated `gh api` calls are rate-limited; if `gh` is missing or rate-limited, read the same paths as raw files:

```bash
curl -fsSL "https://raw.githubusercontent.com/MoC-OSS/LOFT/main/docs/getting-started/quickstart.md"
```

Start with the `docs/` directory — it is the primary documentation source:

```bash
# List docs sections
gh api "repos/MoC-OSS/LOFT/contents/docs?ref=main" --jq '.[].name'

# List files in a section
gh api "repos/MoC-OSS/LOFT/contents/docs/guides?ref=main" --jq '.[].name'

# Fetch a specific doc
gh api "repos/MoC-OSS/LOFT/contents/docs/getting-started/quickstart.md?ref=main" --jq '.content' | base64 --decode
```

**Documentation structure (`docs/`):**
- `getting-started/` — Quickstart, core concepts, introduction
- `guides/` — LLM strategies, middleware, MCP integration, manifests, chat persistence, streaming, tracing, database migrations, error handling, context window, AI tasks
- `concepts/` — Architecture, processing pipeline, strategy pattern, dependency injection
- `reference/` — Configuration, DI symbols, environment variables, packages
- `contributing/` — Local setup, build system, code style, testing, releasing (monorepo contributors only)

**Additional sources:**
- `examples/` — Runnable example applications (express-basic, express-full, express-history, nestjs, serverless)
- `packages/*/README.md` — Per-package documentation

**Fetching example code:**
```bash
# List examples
gh api "repos/MoC-OSS/LOFT/contents/examples?ref=main" --jq '.[].name'

# Fetch an example's LOFT init file
gh api "repos/MoC-OSS/LOFT/contents/examples/express-basic/src/loft.ts?ref=main" --jq '.content' | base64 --decode
```

**Fetching source code directly:**
```bash
# Read a constructor's source
gh api "repos/MoC-OSS/LOFT/contents/packages/loft/src/constructors/LoftConstructor.ts?ref=main" --jq '.content' | base64 --decode
```

**Fallback:** If `gh` fails (not installed, rate-limited, network issue), try the `curl` raw-file form above. If that also fails or returns a 404, proceed with embedded references only and note the limitation. Always check the `gh api` response for errors before attempting to decode.

### Tier 3: Installed Package Source (after `npm install`)

Read source code directly from `node_modules/@moc-global/`:

```bash
# Check what's installed
ls node_modules/@moc-global/

# Read a package's types
cat node_modules/@moc-global/loft/lib/index.d.ts
```

Useful when the developer needs exact current API shapes that may differ from docs.

---

## Setup Flow

### Step 1: Gather Requirements (inline)

Ask the user these questions (one at a time, multiple choice):

1. **Framework:** Express / NestJS / Fastify / Serverless (Lambda) / Other
2. **LLM Provider(s):** OpenAI / Anthropic / Gemini / Multiple
3. **Database:** PostgreSQL (recommended) / Custom / None (stateless)
4. **Manifest Storage:** Local filesystem / AWS S3 / GCP Storage / Azure Blob
5. **Features needed:** Basic chat / Multi-turn conversations / Middleware / MCP tools / Streaming

### Step 2: Research (delegate to `loft-researcher`)

Once requirements are gathered, dispatch `loft-integration:loft-researcher` with a prompt like:

> Research LOFT setup for [Framework] + [Provider(s)] + [Storage] + [Database].
> Return: install commands from package-map.md, matching boilerplate from setup-patterns.md, and relevant gotchas from common-gotchas.md.

**Exception:** A minimal setup (e.g., just OpenAI + local filesystem, no persistence) is light enough to do inline — read `package-map.md` directly.

### Step 3: Generate Boilerplate (inline)

Using the research brief, generate:

1. `tsconfig.json` additions (decorator flags)
2. Database schema SQL + migration commands
3. Manifest JSON file
4. LOFT initialization module (provider-specific)
5. Framework integration code (routes/controllers/handlers)
6. Graceful shutdown handling

### Step 4: Validate (inline)

The research brief includes relevant gotchas. Cross-check generated code against them:
- Is `reflect-metadata` the first import?
- Are all six message fields included?
- Is `registerLlmStrategy` awaited?
- Do LLM names match across strategy, manifest, and session?

Then run `npx tsc --noEmit` in the user's project; fix any errors and re-run until clean.

---

## Modify Flow

### Step 1: Understand Current Setup (inline)

Read the user's existing LOFT initialization code. Identify:
- Which packages are installed (`package.json`)
- Which constructor pattern they use
- Registered strategies, middleware, MCP clients

### Step 2: Research & Generate Modification

**Single-concern changes** (one provider, one middleware, one storage switch) — stay inline and read the one relevant reference:
- **Adding a provider:** `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` § Per-LLM-Provider Setup.
- **Adding middleware:** `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` § Middleware Signatures.
- **Switching storage:** `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` § Per-Storage-Backend Setup.

**Multi-concern changes** (provider + middleware + storage, or MCP tools which need GitHub + gotchas) — dispatch `loft-researcher`:

> Research LOFT modification: [what the user wants to change].
> Current setup: [framework, providers, storage from Step 1].
> Return: relevant patterns from setup-patterns.md, type signatures from interfaces-quick-ref.md, gotchas from common-gotchas.md, and [if MCP] latest MCP docs from GitHub.

Then generate the modification code using the brief.

### Step 3: Warn About Gotchas (inline)

If the researcher was dispatched, gotchas are already in the brief. Otherwise, cross-check the modification against `${CLAUDE_PLUGIN_ROOT}/references/common-gotchas.md` for relevant pitfalls.

---

## Guide Flow

### Step 1: Identify the Topic and Delegation Need

Map the user's question to documentation sources:

| Topic | Primary Source | Fallback |
|-------|---------------|----------|
| Architecture / concepts | `gh api` → `docs/concepts/architecture.md` | `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` |
| Middleware pipeline | `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` § Middleware | `gh api` → source: `packages/loft-definitions/src/shared/components/middleware/` |
| Manifest system | `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` § Manifest | `gh api` → example manifests in `examples/` |
| LLM strategies | `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` § Per-LLM-Provider | `gh api` → strategy source in `packages/loft-*-strategy/` |
| Database/persistence | `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` § Database | `gh api` → `packages/loft-session-pg-repository/README.md` |
| MCP tools | `${CLAUDE_PLUGIN_ROOT}/references/common-gotchas.md` § MCP | `gh api` → source: `packages/loft/src/managers/MCPManager.ts` |
| Streaming | `StreamLoftConstructor` is not implemented in the verified version (see Key Facts) | `gh api` → strategy `generateStream()` methods |
| Error handling | `${CLAUDE_PLUGIN_ROOT}/references/common-gotchas.md` | Explain from common patterns |
| DI symbols | `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` § DI Symbols | `gh api` → `packages/loft-definitions/src/DITypes.ts` |
| Config types | `${CLAUDE_PLUGIN_ROOT}/references/interfaces-quick-ref.md` § Constructors | `gh api` → `packages/loft/src/types/config.ts` |
| Packages | `${CLAUDE_PLUGIN_ROOT}/references/package-map.md` | — |
| Examples | `gh api` → `examples/` directory (express-basic, nestjs, serverless) | `${CLAUDE_PLUGIN_ROOT}/references/setup-patterns.md` |
| Other / general | Search `gh api` repo contents, then explain from references | `${CLAUDE_PLUGIN_ROOT}/references/` files |

Apply the Delegation Strategy: a topic that maps to one reference file is read inline; a topic with a primary source plus fallback, or GitHub plus references (e.g., Architecture, Middleware pipeline, MCP tools), goes to `loft-researcher` with the topic and sources from the table.

### Step 2: Explain with Context

Using the research brief (or inline reading), provide a clear explanation referencing the user's specific codebase when possible. Include code examples from the references.

---

## Analyze Flow

Dispatch `loft-integration:loft-analyzer` via the Agent tool (`subagent_type: "loft-integration:loft-analyzer"`). In the prompt, give the user's project root directory and what to analyze (full review vs. specific concern).

**What the agent does:**
1. Find all LOFT-related files (imports from `@moc-global/*`)
2. Trace the constructor chain (LoftConstructor → ChatConstructor → strategies)
3. Check middleware registrations
4. Validate manifest files against the three-name-match rule
5. Cross-check against `${CLAUDE_PLUGIN_ROOT}/references/common-gotchas.md`
6. Produce a structured report with Critical / Warning / Suggestion sections

**After the agent returns:** Review the report, summarize key findings to the user, and offer to fix any issues found (switching to Modify mode for each fix).

**If the agent fails or returns incomplete results:** Fall back to manual analysis — use Grep to find `@moc-global` imports, read the main LOFT initialization file, and check against the gotchas list yourself.

---

## Key Facts to Always Remember

1. **`reflect-metadata` must be the first import** in the entry point
2. **`registerLlmStrategy()` is async** — always `await` it
3. **LLM name must match** in three places: strategy registration, manifest key, session config
4. **Message `content` is an array** of `{ type: 'text', text: '...' }` parts, never a plain string
5. **Three npm names don't match directories:** S3 (`loft-aws-s3-repository`), GCS (`loft-gcp-storage-repository`), Azure (`loft-azure-blob-storage-repository`)
6. **Middleware registration order:** after `new LoftConstructor()`, before `getInstance()`
7. **`StreamLoftConstructor` and `QueuedLoftConstructor` are not implemented in loft 2.7.3** — use `LoftConstructor`
8. **Payloads are deep-copied** between middleware steps
9. **MCP clients must be registered sequentially** — no `Promise.all()`
10. **Zod must be pinned to `3.25.67`** when using MCP tools (as of loft 2.7.3)
