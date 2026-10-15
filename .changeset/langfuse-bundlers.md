---
'@moc-global/loft': patch
---

`LangfuseTracer` works in bundled applications.

`LangfuseTracer` loads the optional `langfuse` package when it is created, in a way that esbuild and webpack cannot see, so a bundled application failed with "LangfuseTracer needs the langfuse package". Pass the class you import, `new LangfuseTracer(config, { Langfuse })`, and the bundler includes it. An application that a bundler turned from the ES module build into CommonJS, as esbuild does for AWS Lambda, no longer fails when it creates the tracer; without the class it gets the same hint. The install hint now appears only when `langfuse` itself is missing, not when one of its own dependencies is.
