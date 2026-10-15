# Releasing

LOFT uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

## Creating a Changeset

Before merging a PR that changes published packages, create a changeset:

```bash
pnpm changeset
```

This interactive prompt asks:
1. Which packages changed? (select from list)
2. What kind of change? (`major` / `minor` / `patch`)
3. Summary of the change

It creates a markdown file in `.changeset/` describing the version bump.

### When to Create a Changeset

- **Always** when changing published package source code
- **Never** for changes to private packages (`loft-base-tsconfig`, `loft-pglite`, `loft-test-suite`, `loft-kysely-pg-migrator`, `loft-integration-tests`)
- **Never** for documentation, CI, or tooling changes that don't affect published packages

> **The migrator is bundled.** `@moc-global/loft-kysely-pg-migrator` is private. It is a dev dependency of `@moc-global/loft-session-pg-repository` and `@moc-global/loft-chat-history-pg-repository`, and their `tsup` builds bundle it (`noExternal`). A change to the migrator therefore does not bump either package. Add a changeset for those two packages by hand.

### Changeset Configuration

`.changeset/config.json`:
- **Base branch:** `main`
- **Access:** `restricted` (private npm)
- **Changelog:** `@changesets/cli/changelog`
- **Commit:** `true` — `changeset add` and `changeset version` commit the files they change
- **Fixed / linked groups:** none
- **Internal deps:** `updateInternalDependencies: "patch"` — a patch bump on internal dependency updates
- **Peer dependents:** `onlyUpdatePeerDependentsWhenOutOfRange: true` — a package that has a bumped package as a peer dependency is bumped only when the new version leaves its peer range
- **Ignored packages:** none (`"ignore": []`)
- **Private packages:** `"privatePackages": false` — private packages (`"private": true`, such as `loft-base-tsconfig`, `loft-pglite`, `loft-test-suite`, `loft-kysely-pg-migrator`, `loft-integration-tests` and the examples) are not versioned or tagged

## Versioning and Deprecation Policy

The published packages follow [Semantic Versioning](https://semver.org/). Their public API is what each package exports from its entry point and what the [documentation](../README.md) describes. Symbols marked `@experimental`, such as the Stream and Queued execution modes, are outside it and may change or disappear in a minor release.

A **major** release is needed to:

- remove or rename an export, or change its signature in a way that breaks existing callers or implementations;
- change behaviour that the documentation describes;
- narrow a peer dependency range, drop a provider SDK major, or raise the minimum Node.js version (`engines.node`);
- add a migration that existing data cannot go through without manual steps.

Widening a peer range and adding an optional parameter or a new export are **minor** changes.

To deprecate part of the API:

1. Mark it with a `@deprecated` JSDoc tag that names the replacement, for example `@deprecated Use GeminiStrategyConfig instead`.
2. Add a `minor` changeset that announces the deprecation and the replacement, so it appears in the changelog.
3. Keep it working until the next major release at the earliest, and for at least one minor release.
4. Remove it in a major release whose changeset says what to use instead.

## Version Consistency

Manypkg enforces version consistency across the workspace:

```bash
# Check for mismatches
pnpm run versions:check

# Auto-fix
pnpm run versions:align
```

Rules:
- All internal dependencies must use `workspace:*` protocol
- External dependencies referenced by multiple packages must use the same version
- These checks run in the pre-commit hook

## Publishing (CI/CD only)

Publishing is handled in CI, not locally:

```bash
# DO NOT run locally — this is for CI/CD pipelines
pnpm run publish-packages
# Runs: turbo build && changeset version && changeset publish
```

## Pinned Dependencies

Some dependencies are pinned across all packages:

| Package | Version | Reason |
|---------|---------|--------|
| `zod` | `3.25.67` (exact) | Consistency across packages; MCP SDK compatibility: from 3.25.68, registering an MCP server tool fails to compile with TS2589 under `moduleResolution: node` |
| `@modelcontextprotocol/sdk` | `^1.25.0` | MCP protocol compatibility |
| `p-queue` | `6.6.2` (exact) | ESM/CJS compatibility in call manager |
