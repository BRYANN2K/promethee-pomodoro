---
id: ADR-0008
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0008: Use npm for the first public beta

> **V1 channel amendment (2026-08-26):** [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) activates and narrows this decision to the public unscoped `promethee-pomodoro@1.0.1` package, three candidate helper targets, a stable `latest` approval gate, and the configured OIDC workflow. The preserved `v1.0.0` workflow failed before publication. [ADR-0015](0015-use-github-releases-and-a-source-installer-for-v1.md) retains only a secondary macOS source path. The historical provider assumptions and staged-beta design below are preserved and do not override ADR-0017.

## Context and problem

The project needs a cross-platform beta before native macOS and Windows signing ownership is available. It has no publishable package contract, lockfile, Git HEAD, verified public source repository, npm scope ownership, release workflow, or native package proof. A channel must be selected without presenting a development spike as a native installation.

**Provider-constraint correction (2026-08-25):** npm staged publishing cannot create a brand-new package. This ADR therefore distinguishes the explicitly authorized one-time direct bootstrap publication from the staged Trusted Publishing path used only after the public package exists. The npm-first channel decision is unchanged.

## Scope and non-goals

This decision covers the first public beta's registry, entry points, update instructions, publishing identity, provenance, and approval boundary. It does not select the final public scoped package name, authorize publication, create workflow or package fields, promise native installation, bypass Gatekeeper or SmartScreen, or cancel later signed native packages under [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md).

## Decision drivers

- One reviewable path serves macOS and Windows early adopters.
- Publication avoids long-lived npm write tokens.
- Every public version maps to an immutable source commit and public repository.
- Users control installation and updates.
- Node/npm and unsigned-native limitations are explicit.
- Native signing remains possible later.

## Constraints

- `<public-npm-package>` is a non-executable placeholder until ownership of the exact public npm scope/name is verified.
- The package exposes `promethee-pomodoro` for global installation and one-off `npx` execution.
- The consumer target is Node.js 22.14 or newer and npm 10.9.2 or newer, subject to clean macOS/Windows smoke tests before publication.
- GitHub Actions Trusted Publishing currently requires a supported hosted runner, job-scoped OIDC `id-token: write`, npm CLI 11.5.1 or newer, Node.js 22.14 or newer, and exact package/repository/workflow configuration. npm staged publishing has the stricter npm CLI 11.15.0 minimum and requires the package to exist already, so the combined post-bootstrap pipeline targets npm CLI 11.15.0 or newer. Recheck these provider facts before implementation.
- npm provenance requires a public package from a public repository through a supported provider. It links package, source, and build; it is not native code signing or a safety claim.
- This workspace has no Git HEAD. A configured remote alone does not prove a public repository or publishable revision exists.
- Publication requires exact authorization for the version, package, dist-tag, source commit, and registry target.

## Considered options

1. Public scoped npm package with global and `npx` entry points.
2. Wait for signed native macOS and Windows installers.
3. Publish unsigned native archives immediately.
4. Offer only a cloned-source installer.

## Decision

We will **use a public scoped npm package as the first beta channel**, with `<public-npm-package>` remaining a placeholder until ownership is verified. The package will expose `promethee-pomodoro`; users may install it globally or execute it through `npx`, pinned to `beta` or an explicit version.

Because npm cannot stage a brand-new package, the first publication is a one-time bootstrap exception. Only after the exact package, version, `beta` dist-tag, public Git HEAD, and registry mutation receive explicit authorization may a maintainer directly publish the reviewed tarball as a public scoped beta with interactive npm 2FA. The bootstrap must use the reviewed `--access public` and `--tag beta` settings, follow a dry-run and packed-content review, and pass public readback. It is not an unattended CI publication and must not be represented as Trusted Publishing or provenance evidence when those mechanisms did not produce it.

After the public package exists, the target publisher is GitHub Actions using npm Trusted Publishing over OIDC, `contents: read`, job-scoped `id-token: write`, no long-lived npm publish token, and npm-generated provenance when public-source conditions hold. Automation stages subsequent versions rather than directly publishing them. A maintainer reviews the tarball and evidence, then approves each staged package interactively with npm 2FA. GitHub environment approval may add an earlier gate but does not replace npm staged approval or exact publication authorization.

The beta may compare its installed version with public registry metadata and show manual update instructions. It never silently downloads, replaces, or relaunches itself. Global users update with an explicit npm install; `npx` users select the registry version on invocation.

## Rationale

npm fits the TypeScript/Electron shape and provides one early cross-platform channel without pretending native signing exists. The direct bootstrap is a constrained cost imposed by npm's new-package rule; exact authorization, dry-run/content review, interactive 2FA, and public readback bound that exception. For later versions, Trusted Publishing replaces a long-lived write token with workflow-bound identity, provenance gives a verifiable source/build link when its conditions hold, and staging plus 2FA keeps final registry mutation outside unattended automation. Waiting delays feedback; unsigned native archives create platform-warning expectations; source-only installation is less repeatable for Windows users.

## Option comparison

| Driver | npm-first beta | Wait for signed native | Unsigned native archives | Source-only | Evidence |
| --- | --- | --- | --- | --- | --- |
| Early cross-platform access | One Node/npm path | Delayed | Platform-specific | Toolchain-dependent | Project constraint |
| Publication identity | Interactive npm 2FA for bootstrap; OIDC-bound later actions | Platform certificates | Weak | Source host | npm publishing and Trusted Publishing docs |
| Provenance | Required for staged post-bootstrap versions under public-source conditions; not claimed for a direct bootstrap unless verified | Separate native provenance | Usually absent | Git history only | npm provenance docs |
| Native UX | No | Yes | Partial with warnings | No | Delivery shape |
| Human gate | Exact authorization + 2FA for bootstrap; staged approval + 2FA later | Future environment | Ad hoc | Git operations | Target workflow |
| Reversibility | Pin immutable version/dist-tag | Native rollback needed | Manual replacement | Prior revision | Registry semantics |

## Consequences

### Positive

- The first beta has one macOS/Windows distribution contract.
- No long-lived npm publication token is required by the post-bootstrap target pipeline.
- Provenance can bind post-bootstrap staged packages, public source, and workflow.
- Installation and updates stay explicit.

### Negative

- Users must install supported Node.js and npm.
- npm/global/npx execution runs package and dependency code with user permissions.
- The beta is not a native `.app`, `.dmg`, `.pkg`, `.exe`, or `.msi` and gains no project-specific Gatekeeper or SmartScreen identity.
- Registry outages can block new installs or one-off execution.
- The one-time direct bootstrap does not receive the staged Trusted Publishing boundary and may lack npm provenance; its evidence relies on the authorized maintainer action, interactive 2FA, reviewed tarball, immutable source, and public readback.
- Later native migration adds support work.

### Neutral

- Native signing remains deferred under ADR-0007.
- Exact npm name and account owner remain unresolved.
- Registry detection grants no self-update authority.

## Implementation and migration

1. Establish a Git HEAD in the intended public repository and verify public read access.
2. Confirm npm scope/name ownership and replace `<public-npm-package>` in one reviewed change.
3. Complete the project contract, lockfile, public package metadata, packed-file allowlist, and executable mapping.
4. Prove clean global and `npx` execution on supported macOS and Windows.
5. Obtain separate exact authorization for the one-time bootstrap, then have an authorized maintainer directly publish the reviewed public scoped package with `--access public`, `--tag beta`, and interactive npm 2FA. Verify the package, version, tag, integrity, executable, repository link, and clean install through public readback.
6. After the package exists, configure its exact stage-only npm Trusted Publisher.
7. Add a least-privilege GitHub-hosted workflow using Node.js 22.14 or newer and npm CLI 11.15.0 or newer after reviewing actions, versions, permissions, triggers, environment, and provenance conditions.
8. For each subsequent beta, stage an immutable candidate, inspect contents/provenance, obtain interactive 2FA approval and exact authorization, then read it back publicly.
9. Add registry-only detection and manual update instructions without self-replacement.

## Validation

- `npm pack --dry-run` and the tarball contain only reviewed runtime files and metadata.
- Clean macOS and Windows environments run both documented entry paths.
- The bootstrap package version, `beta` tag, Git HEAD, repository URL, reviewed tarball, public registry state, and maintainer-authorized 2FA action agree; no OIDC or provenance claim is made unless independently verified.
- For subsequent staged versions, package version, `beta` tag, Git HEAD, repository URL, workflow identity, and provenance agree.
- Fork and pull-request jobs cannot mint an accepted npm publication identity.
- A staged post-bootstrap candidate remains non-public until authorized 2FA approval.
- Detection never installs/downloads/relaunches code and failures do not stop Pomodoro.
- Public readback confirms package, version, tag, integrity, provenance, executable, and docs.

## Revisit triggers

- npm changes Trusted Publishing, staged publication, or provenance requirements.
- The package scope changes owner or the repository moves.
- Node/npm prerequisites exclude intended testers.
- Native demand makes ADR-0007 ready for acceptance.
- npm/Electron packaging cannot provide reliable cross-platform execution.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none.
- Defers: [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md) for the first beta only.
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Related: [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Implemented by: the current package manifest, CLI, verifier, and release workflows; release run `32966038040` provides exact `promethee-pomodoro@1.0.1` npm and matching GitHub Release evidence.
- Evidence: [npm staged publishing](https://docs.npmjs.com/staged-publishing/), [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), [public scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [global installation](https://docs.npmjs.com/downloading-and-installing-packages-globally/), [npm exec/npx](https://docs.npmjs.com/cli/npm-exec/), and [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
