# Security policy

## Report a vulnerability

Do not report security problems in public issues, discussions or pull requests.

Report them privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [private vulnerability reporting](https://github.com/MoC-OSS/LOFT/security/advisories/new). Only the maintainers can see the report. If you cannot use GitHub, email [oss@masterofcode.com](mailto:oss@masterofcode.com).

Please include:

- the affected package and version, and the Node.js version;
- what an attacker can do, and under which configuration;
- steps or a minimal project that reproduces it;
- whether you plan to publish your findings, and when.

## What happens next

| Step | Target |
| --- | --- |
| We acknowledge the report | within 3 working days |
| We confirm or reject it, and agree a severity with you | within 7 days |
| We release a fix for a medium, high or critical vulnerability | within 60 days of confirming it |

We rate severity with [CVSS v4.0](https://www.first.org/cvss/v4-0/). While we work on a fix we keep you informed, and the discussion stays in the private advisory.

When the fix is released we publish a [GitHub security advisory](https://github.com/MoC-OSS/LOFT/security/advisories), request a CVE identifier through it, and credit you unless you ask us not to. Please keep the details private until the advisory is published, or for 90 days after your report, whichever comes first. If a vulnerability is already being exploited or is public, we may publish sooner, with a workaround if no fix is ready.

## Supported versions

Security fixes are released for the latest minor version of each `@moc-global` package's current major version. Older versions do not get fixes; upgrade to the latest release to receive them. The examples in `examples/` are demonstration code and are not released.

## Scope

In scope: the published `@moc-global` packages in this repository, and the CI and release workflows that build and publish them.

Out of scope:

- Vulnerabilities in a dependency that LOFT does not make worse. Report them to the dependency's maintainers; we update LOFT once a fixed version is released.
- Problems in your own manifests, prompts, middleware or MCP servers, or in an LLM provider's service.
- Prompt injection that only changes the model's text. Report it when it makes LOFT call a tool, reach data or run code that the application did not allow.

## Our security practices

- Every pull request is checked by CI: build, typecheck, lint, unit and integration tests, a secret scan with gitleaks, and checks of the published package contents.
- Releases are built and published from CI, not from a developer's machine.
- GitHub Actions in the workflows are pinned to a commit.

## Cybersecurity policy under the EU Cyber Resilience Act

Master of Code Global is the open-source software steward of LOFT under the EU Cyber Resilience Act (Regulation (EU) 2024/2847). LOFT is free and open source, and its downloads and updates are free for everyone. This document is the steward's cybersecurity policy for LOFT. Under it we:

- accept vulnerability reports as described above, and encourage everyone who finds one to report it;
- handle, fix and disclose vulnerabilities as described above;
- tell users about fixes through the security advisories, the changelogs and the npm releases;
- cooperate with market surveillance authorities on request.
