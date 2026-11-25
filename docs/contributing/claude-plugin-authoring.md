# Claude Code Plugin Authoring

How to write and refactor the skills, commands, agents and supporting files of the Claude Code
plugins in [`plugins/`](../../plugins/). The marketplace registry is
[`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json).
Distilled from Anthropic's *Skill authoring best practices*, the Claude Code skills and plugins docs
(code.claude.com/docs/en/skills and code.claude.com/docs/en/plugins), and the lessons of a
2026-10 best-practices audit of these plugins.

## Contents
- Checklist for a new or changed skill
- Plugin layout and paths
- Frontmatter
- Body: size and progressive disclosure
- Writing the instructions
- Scripts
- Agents
- Evals
- Refactoring an existing skill
- Linter reference
- Anti-patterns found in the 2026-10 audit

---

## Checklist for a new or changed skill

Copy into your task and tick off:

```
- [ ] name: lowercase-hyphen, ≤64 chars, equals the skill directory, consistent with sibling skills
- [ ] description: third person, WHAT it does then WHEN to use it, concrete trigger terms, ≤1024 chars
- [ ] description does not overlap a sibling skill's triggers (add a "Not for …" clause if close)
- [ ] only valid frontmatter keys; allowed-tools is minimal (see Frontmatter)
- [ ] SKILL.md body < 500 lines; branch-only detail lives in references/
- [ ] every reference is linked directly from SKILL.md (one level deep)
- [ ] every reference > 100 lines starts with "## Contents" (not templates/examples)
- [ ] plugin resources referenced as ${CLAUDE_PLUGIN_ROOT}/…, agents as <plugin>:<agent>
- [ ] fragile/deterministic steps are scripts; scripts state deps and fail with clear messages
- [ ] multi-step workflows have a copyable checklist and a validate → fix → repeat loop
- [ ] no costs, model names, dates or version history in SKILL.md / references
- [ ] no counts or rules that contradict another file in the plugin
- [ ] ≥3 eval scenarios with achievable expected_behavior; evals.json tracked in git
- [ ] version bumped in plugin.json only (not in marketplace.json); CHANGELOG entry added
- [ ] python3 scripts/lint_skills.py --plugin <name> --strict passes
- [ ] claude plugin validate ./plugins/<dir> --strict and claude plugin validate . --strict pass
```

## Plugin layout and paths

```
plugins/<dir>/
├── .claude-plugin/plugin.json   # name, version, description, author, homepage, repository, license "MIT", keywords
├── README.md  CHANGELOG.md
├── skills/<skill-name>/SKILL.md # entry point; skill-local references/ and scripts/ allowed
├── references/                  # plugin-level references shared by several skills
├── scripts/                     # plugin-level scripts (+ tests)
├── agents/<agent>.md            # subagents, dispatched as <plugin-name>:<agent>
├── commands/<name>.md           # legacy; prefer skills (see below)
└── evals/evals.json             # tracked; run outputs go to evals/workspace/ (gitignored)
```

**Paths are resolved from the skill's directory, not the plugin root.** A bare `references/x.md`
in `skills/foo/SKILL.md` points at `skills/foo/references/x.md`. Use the variables Claude Code
substitutes inside plugin SKILL.md / command / agent bodies:

| Variable | Resolves to | Use for |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | installed plugin directory | plugin-level `references/`, `scripts/`, `templates/`, other skills' files |
| `${CLAUDE_SKILL_DIR}` | the skill's own directory | skill-local files |
| `${CLAUDE_PROJECT_DIR}` | the user's project root | project files |
| `${CLAUDE_PLUGIN_DATA}` | persistent per-plugin data dir | caches/installs that must survive updates |

Never reference `.claude/scripts/…` — that resolves in the user's project, where the plugin's
files do not exist. Use forward slashes only.

**Agents** are registered as `<plugin-name>:<agent-name>` (the plugin `name`, e.g.
`loft-integration:loft-analyzer`, not the directory name if it differs). Dispatch them by that `subagent_type`;
do not tell Claude to "read agents/x.md and paste it into a general-purpose agent".

## Frontmatter

Valid SKILL.md keys: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`,
`effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, `metadata`, `license`,
`compatibility`. Anything else (e.g. `tools:`) is silently ignored — the linter flags it.

### name
- `^[a-z0-9-]{1,64}$`, must equal the directory name, no `anthropic` / `claude`.
- Gerund form (`processing-pdfs`) is preferred; consistency inside a plugin matters more
  (`loft-setup`, `loft-review`, … is fine).
- Avoid generic names that collide with other installed plugins (`code-review`, `review`). If you
  keep one, make it `disable-model-invocation: true` with a specific description.

### description
The only text Claude sees when choosing among 100+ skills. Rules:
- Third person or imperative. Never "I can…" / "You can…".
- **What first, then when**: `Generates X from Y, including Z. Use when the user asks to …, or mentions …`.
  A "Use when…"-only description loses the *what*.
- Name the domain. `Reviews code for best practices` hijacks any review request;
  `Audits LOFT integrations…` does not.
- Add a negative clause when a sibling skill is close: `Not for reviewing an existing setup (use …-review)`.
- No implementation detail (scanner lists, ID schemes) — that belongs in the body.
- No over-trigger nudges (`When in doubt, use this skill`).
- Limits: ≤1024 chars, no XML-like `<tags>`; `description` + `when_to_use` are truncated at
  1,536 chars in the skill listing.

### allowed-tools — a permission grant, not a restriction
`allowed-tools` **pre-approves** the listed tools for the turn that invokes the skill; it does not
limit which tools exist. Keep it minimal:
- Never pre-approve unrestricted `Bash`, `Write` or `WebFetch` in a skill that reads untrusted
  input (customer repos, web pages) — that turns prompt injection into unprompted execution.
- Scope Bash to what the skill actually runs (`Bash(uv run *)` only if the skill runs uv scripts).
- Leave tools out and let them prompt rather than over-grant.

### Who invokes the skill
- Commands are merged into skills: `commands/x.md` and `skills/x/SKILL.md` both create `/x`.
  Prefer skills (supporting files, frontmatter). Existing commands keep working; if kept, they
  need `description` frontmatter and should be thin wrappers that hand off to the skill.
- `disable-model-invocation: true` for heavy, file-writing, or name-colliding workflows the user
  should start explicitly. Its description then **is not in Claude's context** — so:
  - a skill that another skill chains into (`setup` → `<plugin>:review`) must stay model-invocable;
  - evals cannot expect Claude to "suggest running" it.
- `argument-hint` must cover every input form the skill accepts.

## Body: size and progressive disclosure

- SKILL.md body **< 500 lines**. It is an entry point: workflow, decision points, links.
- Move branch-only material (a second mode, a renderer grammar, a long template, platform primers)
  to `references/` and link it from SKILL.md at the step that needs it.
- **One level deep.** Every reference SKILL.md needs is linked from SKILL.md itself. A reference
  may *mention* siblings, but must not be the only route to content Claude needs
  (Claude may only `head` a file reached through another file).
- References > 100 lines start with `## Contents` (the file's H2 list) directly under the H1.
  **Exception:** templates and examples whose text is copied into output — a TOC there leaks into
  generated artifacts. Name such files `*-template.md` / `*example*` or keep them in `templates/`.
- Prefer merging moved content into an existing reference on the same topic over a new file.
- Name files by content (`dialog-writing-rules.md`, not `notes2.md`).

## Writing the instructions

**Concise.** Claude is smart; every line must earn its tokens. Cut explanations of what a
channel/metric/library is, "why this order" essays, and rules repeated in several places —
state each rule once and point to it.

**Degrees of freedom** — match specificity to fragility:

| Task type | Form | Examples |
|---|---|---|
| Judgment, many valid answers | goal-oriented text | explain a LOFT concept, review an integration |
| Preferred pattern, some variation | template / parameterised script | setup boilerplate per provider and framework, report template |
| Fragile, deterministic, destructive | script, run as-is | scoring, layout geometry, writes to external systems, ID allocation, structural validators |

Walls of MUST/NEVER/ALL-CAPS degrade strong models; a fragile step left to prose degrades weak
ones. Move the fragile step into a script instead of shouting.

**Workflows.** For multi-step flows give a copyable progress checklist and mark exits
(`--dry-run`, missing credentials, HITL refusal). Put human approval gates before anything
external or destructive (dry-run first, explicit `--live`).

**Feedback loops.** validate → fix → re-run until clean: run the validator script, the layout
audit, `tsc --noEmit`, or a checklist pass, and say what to do on failure ("show the stderr line,
fix the plan, re-run").

**Consistency.** One term per concept. Counts and contracts (number of dimensions, checklist
items, error codes, CLI flags) live in one file and every other file points to it — stale counts
after a version bump were the most damaging defect class in the audit.

**No time-sensitive content** in SKILL.md / references: no dollar costs, model version names,
calendar dates, "new in vX", "planned for V2", "used to…". History goes to CHANGELOG.md. For
facts that rot (library versions, APIs), anchor them to a version and tell Claude how to verify:
*"References verified against loft 3.0.0 (see `package-map.md`). If
`node_modules/@moc-global/loft/package.json` reports a different version, confirm via Tier 3 /
Tier 2 before relying on Key Facts or the references."*

**MCP tools** are named fully qualified (`ServerName:tool_name`).

## Scripts

- Prefer a script for anything deterministic; Claude runs it without loading its source.
- Invoke with resolvable paths: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/x.py" …`. Say whether
  Claude should **run** it or **read** it.
- State dependencies where the script is used (`pip install pyyaml markdown beautifulsoup4`,
  `uv` inline metadata, Node ≥ N) and fail with an install hint instead of a traceback.
- Solve, don't punt: handle missing files, bad input and missing tools with clear messages and
  documented exit codes; degrade gracefully when an optional tool is absent.
- No voodoo constants — comment why `timeout=30` or `OBSTACLE_MARGIN = 8`.
- Shared constants live in one module, not "kept in sync by hand" across scripts.
- Tests next to the script (`test_*.py`), TDD for new behaviour; the docs that describe a
  script's contract (CLI, output keys, error codes, geometry rules) must match the code exactly.
- A script must accept every input the skills/agents actually emit (node types, shapes) —
  check the producer's spec, not just the happy path.

## Agents

- Frontmatter needs `name` and `description`; pin a cheap `model` for mechanical agents.
- Give each agent a JSON input/output contract; skills pass exactly those fields.
- If an "agent" is really a deterministic algorithm (layout, parsing, scoring), make it a script.
- Agents are loaded whole: keep them focused, no duplicated rule lists from the skill.

## Evals

Build evals before writing lots of instructions, and keep them tracked.

- **≥3 scenarios per skill**, each with concrete, observable expectations. Shapes used here:
  - `evals/evals.json` — `{"skill_name", "evals": [{"id", "prompt", "expected_output", "files", "expected_behavior"?}]}`
    (one file per plugin may add a `"skill"` field per entry), or one `*.evals.json` per skill.
  - `evals/trigger-eval.json` — `[{"query", "should_trigger": true|false}]` for triggering tests,
    including negative queries for `disable-model-invocation` skills.
- **Assertions must be achievable** by a run with the skill loaded: no "suggests running a skill
  Claude cannot see", no checks a generic prompt cannot exercise.
- **Fixtures must exist** or the scenario must state its setup (`"setup": "Run after eval 6; uses
  its output"`). Avoid literal placeholders and hard-coded dates in prompts.
- Track `evals.json`, trigger files and small fixtures; gitignore only `evals/workspace/`.
  Before un-ignoring, scan for secret-shaped strings; if fixtures must hold fake keys, decide
  explicitly whether to track them.
- Run evals on **Sonnet** by default; run with and without the skill to show a
  baseline, and add Haiku/Opus runs before claiming multi-model support. Record real model IDs.
- A cheap smoke eval catches what static review misses: a fresh agent follows SKILL.md literally
  (variables substituted, agents inlined, scripts executed) and records any path that does not
  resolve. In the 2026-10 upgrade this found two real layout-script bugs.

## Refactoring an existing skill

1. Read the plugin README, CHANGELOG and every SKILL.md / reference before editing.
2. **Move, don't lose.** For every block removed from SKILL.md, record where it went (linked
   reference) or which surviving text it duplicated. Review the removed lines against that list.
3. Fix contradictions before restructuring — they mislead more than verbosity.
4. Keep invocation names stable (`/plugin:name`); a rename is a breaking change → minor bump.
5. Bump the version in `plugin.json` only (the marketplace entry carries no `version`; if both
   are set, `plugin.json` wins and `claude plugin validate` reports the mismatch). Add a dated
   CHANGELOG entry; keep the licence `MIT`. Without a version bump, users keep their cached copy.
6. Run the linter and the plugin's tests; reinstall the plugin locally to try it.

## Linter reference

```bash
python3 scripts/lint_skills.py --plugin <marketplace-name> --strict   # one plugin
python3 scripts/lint_skills.py --strict                               # every plugin in marketplace.json
python3 -m pytest scripts/                                            # linter tests
claude plugin validate . --strict                                     # the marketplace
claude plugin validate ./plugins/<dir> --strict                       # one plugin (manifest, skills, agents)
```
The linter requires PyYAML (and pytest for its tests). Exit 1 on errors (and on warnings with `--strict`).
CI does not run these checks; run them locally before opening a pull request.

| Code | Level | Meaning |
|---|---|---|
| SK001 | error | SKILL.md frontmatter missing/unparseable |
| SK002 | error | invalid name, name ≠ directory, or reserved word |
| SK003 | error | description empty, not a string, > 1024 chars, or contains `<tag>` |
| SK004 | error | description + when_to_use > 1536 chars |
| SK005 | error | unknown frontmatter key |
| SK006 | error | body ≥ 500 lines |
| SK007 | warning | description in first/second person |
| PA001 | error | `${CLAUDE_PLUGIN_ROOT}/…`, `${CLAUDE_SKILL_DIR}/…` or `./` `../` path does not exist |
| PA002 | error | bare path exists only under plugin root — prefix with `${CLAUDE_PLUGIN_ROOT}/` |
| PA003 | error | `.claude/scripts/` referenced |
| RF001 | warning | reference > 100 lines without `## Contents` (templates/examples exempt) |
| CM001 | error | command without `description` frontmatter |
| AG001 | error | agent without `name` / `description` |
| VS001 | error | plugin.json missing, or (when the marketplace entry sets one) its version ≠ marketplace.json |

## Anti-patterns found in the 2026-10 audit

| Anti-pattern | Example | Fix |
|---|---|---|
| Plugin-root paths written bare | `references/flow.md` from `skills/x/SKILL.md` | `${CLAUDE_PLUGIN_ROOT}/references/flow.md` |
| Project-relative script path | `bash .claude/scripts/init-adr.sh` | `bash "${CLAUDE_PLUGIN_ROOT}/scripts/init-adr.sh"` |
| Invalid frontmatter key | `tools: Read, Bash` | `allowed-tools:` — and keep it minimal |
| Over-broad pre-approval | `allowed-tools: Bash, Write, WebFetch` on a repo-reading skill | read-only tools; let the rest prompt |
| Stale counts after a release | "6 dimensions" vs "7", "12 items" vs "13" | one source of truth, others point to it |
| Docs disagree with code | doc says "unassigned", script exits | change one, test the other |
| Two files give opposite rules | `file=` in fence header vs "never put file= there" | delete one; grep for the pattern |
| LLM doing deterministic work | Haiku agent computing layout coordinates | tested script with a JSON contract |
| Body over 500 lines | 679-line skill | move branch-only sections to references |
| Reference chains | playbook → pattern file → "Step 3.0" of another skill | link each file from SKILL.md |
| Missing TOC on long references | 447-line styles reference | `## Contents` under the H1 |
| Time-sensitive text | "$1.50–$3.50", "GPT-4o", "planned for V2" | remove; history to CHANGELOG |
| Client/project leakage | client API names in a generic reviewer | read project specifics from CLAUDE.md/ADRs |
| Hard-wired stack | NestJS/TypeORM checks for every repo | stack reference loaded only when detected |
| Evals untracked or missing | `evals` in .gitignore; 0 evals for a skill | track evals.json; ≥3 scenarios |
| Unachievable eval assertions | "suggests /x" for a hidden skill | assert observable behaviour only |
| Wrong platform claims | "`/` separator works in Rasa/Lex/Watson" | verify against platform docs |
