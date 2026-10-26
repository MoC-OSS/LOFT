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
- **Never** for changes to private packages (`loft-base-tsconfig`, `loft-pglite`, `loft-test-suite`, `loft-kysely-pg-migrator`, `loft-middleware`, `loft-integration-tests`)
- **Never** for documentation, CI, or tooling changes that don't affect published packages

> **A peer's major release needs major changesets for its dependents.** When a package gets a major release, Changesets bumps each package that has it as a peer dependency (most packages have `@moc-global/loft-definitions` as one) by `patch` only, although their published peer range moves to the new major. Moving a peer range to a new major is a major change under the [versioning policy](#versioning-and-deprecation-policy), so add a `major` changeset for each of those packages by hand.

> **The migrator is bundled.** `@moc-global/loft-kysely-pg-migrator` is private. It is a dev dependency of `@moc-global/loft-session-pg-repository` and `@moc-global/loft-chat-history-pg-repository`, and their `tsup` builds bundle it (`noExternal`). A change to the migrator therefore does not bump either package. Add a changeset for those two packages by hand.

### Changeset Configuration

`.changeset/config.json`:
- **Base branch:** `main`
- **Access:** `public` — `changeset publish` passes `--access public`, which also keeps existing packages public
- **Changelog:** `@changesets/cli/changelog`
- **Commit:** `true` — `changeset add` and `changeset version` commit the files they change
- **Fixed / linked groups:** none
- **Internal deps:** `updateInternalDependencies: "patch"` — a patch bump on internal dependency updates
- **Peer dependents:** `onlyUpdatePeerDependentsWhenOutOfRange: true` — a package that has a bumped package as a peer dependency is bumped only when the new version leaves its peer range, and then by `patch` (see the note above)
- **Ignored packages:** none (`"ignore": []`)
- **Private packages:** `"privatePackages": false` — private packages (`"private": true`, such as `loft-base-tsconfig`, `loft-pglite`, `loft-test-suite`, `loft-kysely-pg-migrator`, `loft-middleware`, `loft-integration-tests` and the examples) are not versioned or tagged

## Versioning and Deprecation Policy

The published packages follow [Semantic Versioning](https://semver.org/). Their public API is what each package exports from its entry point and what the [documentation](../README.md) describes. Symbols marked `@experimental`, such as the Queued execution mode, the reserved `DI_TYPES` symbols and the chat streaming events (`onEvent`, `streamOptions`, `ChatStreamEvent`), are outside it and may change or disappear in a minor release.

A **major** release is needed to:

- remove or rename an export, or change its signature in a way that breaks existing callers or implementations;
- change behaviour that the documentation describes;
- drop a major version from a peer dependency range, drop a provider SDK major, or raise the minimum Node.js version (`engines.node`);
- add a migration that existing data cannot go through without manual steps.

Widening a peer range and adding an optional parameter or a new export are **minor** changes. Raising a peer range's minimum within the same major is not a breaking change and may ship in any release type, because publishing rewrites `workspace:^` to the current version.

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
- All internal dependencies must use the `workspace:` protocol (`workspace:*` for dependencies, `workspace:^` for peers)
- External dependencies referenced by multiple packages must use the same version
- These checks run in the pre-commit hook

## Publishing (CI/CD only)

Publishing is handled in CI, not locally:

```bash
# DO NOT run locally — this is for CI/CD pipelines
pnpm run publish-packages
# Runs: turbo build && changeset publish
```

On a push to `main`, the Release workflow runs [`changesets/action`](https://github.com/changesets/action). While changesets are pending, it runs `changeset version` and opens or updates the **Version Packages** pull request. Merging that pull request leaves no changesets, so the next run calls `publish-packages`, which publishes the new versions; the action then pushes the tags and creates the GitHub releases through the GitHub API.

The Release workflow (`.github/workflows/release.yaml`) publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so the repository holds no npm token. On Node.js 24, the job runs npm 11, which trusted publishing needs (11.5.1 or later). Each published package needs a trusted publisher on npmjs.com (package Settings > Trusted publishing > GitHub Actions):

- **Organization:** `MoC-OSS`
- **Repository:** `LOFT`
- **Workflow filename:** `release.yaml`
- **Environment:** `npm-release`

npm adds a provenance attestation to every version published this way. A new trusted publisher expires unless a publish succeeds within 2 days, so add it shortly before a release. A package that does not exist on npm yet needs one first publish before you can configure it.

## Pinned Dependencies

Some dependencies are pinned across all packages:

| Package | Version | Reason |
|---------|---------|--------|
| `zod` | `4.6.7` (exact) | One copy across packages, so schemas from different packages are compatible. Users get `^4.6.6` as a peer: the first version without GHSA-mrhx-c7xc-m3w5 |
| `@modelcontextprotocol/sdk` | `^1.31.0` (peer) | MCP protocol compatibility |
