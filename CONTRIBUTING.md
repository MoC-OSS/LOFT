# Contributing to LOFT

Thanks for helping with LOFT. Bug reports, fixes, documentation and examples are all welcome. By taking part you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

- Questions and ideas go to [GitHub Discussions](https://github.com/MoC-OSS/LOFT/discussions); see [SUPPORT.md](./SUPPORT.md).
- Report security problems privately, never in a public issue; see [SECURITY.md](./SECURITY.md).
- For a larger change, open an issue or a discussion first, so we can agree on the approach before you write the code.

## Set up

You need Node.js 22 or later and Corepack, which installs the pnpm version pinned in `package.json`.

```bash
git clone https://github.com/MoC-OSS/LOFT.git
cd LOFT
corepack enable
pnpm install
pnpm build-packages
```

[Local setup](./docs/contributing/local-setup.md) covers the details, and [build system](./docs/contributing/build-system.md) explains how the packages are built.

## Make a change

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests. Unit tests sit next to the code in `packages/*/src/__tests__/`; the integration suite is in `integration/`. [Testing](./docs/contributing/testing.md) shows how to run and write both.
3. Follow the [code style](./docs/contributing/code-style.md). ESLint and Prettier enforce most of it, and the pre-commit hook fixes what it can in the files you stage.
4. If you change a published `@moc-global` package, add a changeset (see below).
5. Update the documentation in `docs/` or the package README when you change behaviour or an API. CI compiles every `typescript` block of the READMEs (`pnpm check:readme-snippets`, after the build); put `<!-- snippet-check: skip -->` right before a block that is not meant to compile on its own.
6. Sign off every commit (see below) and open a pull request against `main`.

Before you push, run the same checks as CI:

```bash
pnpm build-packages && pnpm typecheck && pnpm lint:check && pnpm test:unit
pnpm test:integration
```

The integration tests run offline by default, on an in-process PostgreSQL (PGlite) with a scripted LLM. The `*.live.test.ts` files call real providers and run only when you set the keys described in `integration/.env.test.example`.

## Changesets

Releases are made with [Changesets](https://github.com/changesets/changesets). If your pull request changes a published package, add a changeset that names the package, the kind of change and a one-line summary for the changelog:

```bash
pnpm changeset
```

Use `patch` for fixes, `minor` for new features that keep compatibility, and `major` for breaking changes; the [versioning and deprecation policy](./docs/contributing/releasing.md#versioning-and-deprecation-policy) says what counts as breaking and how to deprecate an API. Changes to documentation, tests, examples, CI or the private packages (`loft-base-tsconfig`, `loft-kysely-pg-migrator`, `loft-pglite`, `loft-test-suite`) need no changeset. [Releasing](./docs/contributing/releasing.md) describes the rest of the process.

## Sign off your commits (DCO)

LOFT uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) instead of a contributor license agreement. By signing off a commit you certify that you wrote the change, or otherwise have the right to submit it under the project's [MIT license](./LICENSE).

Sign off by adding `-s` to `git commit`:

```bash
git commit -s -m "fix: keep each message's ctx when patching chat history"
```

This adds a line with your name and email, which must match the commit author:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

A check on each pull request fails if a commit has no sign-off. To sign off commits you have already made on your branch, run `git rebase --signoff main` and force-push the branch.

## Pull requests

- Keep each pull request to one change, and describe what it changes and why.
- Commit messages start with a type, as in the history: `fix:`, `feat:`, `docs:`, `test:`, `chore:`.
- CI must pass: build, typecheck, lint, unit and integration tests, package checks and the documentation link check.
- A maintainer listed in [CODEOWNERS](./.github/CODEOWNERS) reviews each pull request. Expect a first response within 7 days.

## License

Contributions are released under the [MIT license](./LICENSE), the same as the rest of LOFT.
