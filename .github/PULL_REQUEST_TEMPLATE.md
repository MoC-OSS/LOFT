## What and why

<!-- What does this change, and why? Link the issue it fixes, for example "Fixes #123". -->

## How it was tested

<!-- Tests added or changed, and anything you checked by hand. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`), see [CONTRIBUTING.md](../CONTRIBUTING.md#sign-off-your-commits-dco)
- [ ] Tests cover the change, and `pnpm build-packages && pnpm typecheck && pnpm lint:check && pnpm test:unit` passes
- [ ] A changeset is added (`pnpm changeset`) if a published package changes
- [ ] The documentation and the package README are updated if behaviour or an API changes
