---
id: ADR-0017
status: accepted
date: 2026-08-26
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0017: Use the public npm package as the V1 release channel

## Context and problem

ADR-0015 selected a private npm-shaped project, GitHub Releases, and a macOS-only source installer for V1. That path does not provide one installation and execution model for both macOS and Windows. The project owner has now selected a public npm release candidate for both target operating systems while Apple Developer ID, notarization, Windows Authenticode, and native installers remain unavailable.

The exact public package is the unscoped `promethee-pomodoro` package at version `1.0.0`. The current work prepares and reviews a local candidate and its pipeline. It does not authorize or perform npm publication, a Git tag, a GitHub Release, or any `latest` dist-tag mutation.

At the 2026-08-26 release freeze, npm lookup returned `E404`; the name was still unclaimed. npm Trusted Publishing cannot create a new package, so the configured OIDC job applies only after a separately authorized bootstrap publication establishes the package.

## Scope and non-goals

This decision governs the V1 package name, registry channel, user entry point, artifact model, update/rollback responsibility, publication identity, and unsigned-platform boundary. It does not establish that the package is already public, prove Windows runtime behavior, authorize any external mutation, provide a native `.app`, `.dmg`, `.pkg`, `.exe`, or `.msi`, or claim Apple/Windows publisher identity.

## Decision drivers

- Give macOS and Windows early adopters one reviewable command-line distribution shape.
- Keep installation, updates, and rollback explicit and user-controlled.
- Publish one immutable package version from one immutable source revision.
- Avoid long-lived registry write tokens.
- Make the lack of project Apple/Windows certificates explicit.
- Preserve a later migration to signed native packages.

## Considered options

1. Publish the unscoped `promethee-pomodoro` package to npm.
2. Retain ADR-0015's GitHub Release plus macOS source-installer path as the primary V1 channel.
3. Publish unsigned native archives for both platforms.
4. Delay V1 until Apple Developer ID and Windows Authenticode identities exist.

## Decision

V1 SHALL use the public, unscoped npm package `promethee-pomodoro`, version `1.0.0`, as its primary release channel. The npm tarball is a source/runtime package executed through its `promethee-pomodoro` binary mapping. It is not a native platform installer or a project-signed binary artifact.

The package MAY be installed globally, executed through npm's one-off execution path, or installed from the exact reviewed local tarball during candidate verification. The CLI SHALL provide foreground execution for diagnostics and a version query. Removal SHALL use npm's package removal flow; it SHALL NOT silently delete Pomodoro preferences.

The stable npm `latest` dist-tag MAY be created or changed only after explicit manual approval of the exact package name, version, source revision, candidate digest/integrity, publication identity, and registry target. If the name remains unclaimed, V1.0.0 requires one separately authorized bootstrap publication of the reviewed tarball by an authorized maintainer using a short-lived granular npm token and account 2FA. The token SHALL NOT enter repository files, GitHub Actions, shell history, logs, or documentation and SHALL be revoked after exact registry readback.

After bootstrap, npm Trusted Publisher configuration SHALL name the exact public repository, `.github/workflows/release.yml`, and `npm-release` environment. Later publications use the job-scoped OIDC identity; traditional npm tokens are prohibited. The configured workflow is publication intent until those external settings exist, it runs successfully, and its registry result is read back. This task performs no publication.

V1 uses no Promethee Pomodoro Apple Developer ID certificate, Apple notarization, Windows Authenticode certificate, or native installer identity. Upstream Node/Electron artifacts may carry their publishers' own metadata; that does not sign or certify this project. Users need the declared Node/npm and platform build/runtime prerequisites and may encounter platform permission or reputation prompts.

Update detection remains non-mutating. It may report a newer reviewed version and show or open manual update guidance, but it SHALL NOT download, install, replace, relaunch, move a dist-tag, or run npm. Users update or roll back by explicitly selecting an immutable npm version.

GitHub source and release pages may remain supplementary evidence or navigation surfaces. `install-electron.sh` remains a separately documented macOS source path, not the primary cross-platform V1 artifact.

## Rationale

npm fits the existing Electron/TypeScript package and supplies one early distribution interface without implying native signing. The GitHub/source path is transparent but macOS-specific; unsigned native archives create stronger installer expectations without publisher identity; waiting for certificates delays the cross-platform candidate. Explicit package versions and manual approval preserve user control and rollback while Trusted Publishing can avoid a long-lived npm token.

## Consequences

### Positive

- macOS and Windows share one package name and CLI contract.
- Candidate contents can be inspected with npm's native pack tooling before publication.
- Exact versions provide a straightforward manual rollback target.
- After the one-time bootstrap, Trusted Publishing can bind later publications to the reviewed workflow without a stored npm token.

### Negative

- Users must install compatible Node.js/npm and any native build prerequisites required by the final package.
- npm installation and one-off execution run package/dependency code with the user's privileges.
- There is no Promethee Pomodoro Gatekeeper, notarization, Authenticode, or SmartScreen publisher identity.
- Platform permission, native-helper build, and Promethee compatibility failures remain support concerns.
- The one-time bootstrap temporarily uses token-based authority and therefore requires narrower approval, short lifetime, 2FA, non-disclosure, revocation, and readback controls.
- A public registry outage can block new installs and one-off execution.

### Neutral

- Configured CI, OIDC, provenance, and package metadata are not proof of a successful publication.
- macOS and Windows support claims remain independent and require real clean-environment evidence.
- Signed native distribution remains a later phase under ADR-0007.

## Implementation and migration

1. Make `package.json` and the lockfile describe the exact public package without changing version `1.0.0`.
2. Include only reviewed production/runtime/native-build files in the tarball and exclude tests, private data, previews, and repository-only artifacts.
3. Prove local tarball install, version, foreground launch, normal launch, update, rollback, and uninstall on clean macOS and Windows candidates.
4. Review the exact tarball contents and integrity, source identity, release notes, known issues, and public documentation.
5. If the package remains unclaimed, obtain exact approval and perform the one-time granular-token/2FA bootstrap; read it back and revoke the token.
6. Configure the exact npm Trusted Publisher and protected `npm-release` environment for subsequent versions; prohibit traditional tokens in CI.
7. Reconcile the stable workflow's npm-before-GitHub ordering so the V1 tag path cannot try to republish the bootstrapped `1.0.0`.
8. Obtain explicit manual approval before any stable tag, GitHub Release, or later publication/`latest` mutation.
9. Read back every public package/version/dist-tag/integrity/provenance and repeat clean install/run/uninstall checks before declaring availability.

## Validation

- The package manifest, lockfile, tarball, CLI version, and source tag all agree on `promethee-pomodoro@1.0.0`.
- Candidate inspection contains only the documented runtime/build allowlist and no credential, live Promethee data, test fixture, preview, or repository-only file.
- Clean macOS and Windows runs exercise install, detached launch, foreground launch, version, update to an explicit version, rollback, and uninstall.
- New installations default automatic Pause on and automatic Resume off; existing stored preferences remain unchanged, Windows exposes no automation, and platform permissions are requested only for the documented capabilities.
- CI and release workflows use pinned actions, least privilege, immutable inputs, and no long-lived npm token.
- The unclaimed-name bootstrap uses only the separately approved short-lived granular token/2FA procedure, then revokes it and configures the exact Trusted Publisher; the current workflow is not misrepresented as a first-publication path.
- No availability claim is made until registry and clean-platform readback pass.

## Revisit triggers

- Clean npm installation cannot build or run the native helper on either target platform.
- Node/npm prerequisites prevent intended adoption.
- npm Trusted Publishing, provenance, or dist-tag behavior changes materially.
- Apple/Windows signing ownership makes native packages viable.
- Promethee publishes a supported plugin or companion distribution mechanism.

## Related decisions and evidence

- Supersedes for the V1 primary channel: [ADR-0015](0015-use-github-releases-and-a-source-installer-for-v1.md).
- Activates and narrows: [ADR-0008](0008-use-npm-for-the-first-public-beta.md) with the exact unscoped name, version, and `latest` approval boundary.
- Defers but does not supersede: [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md).
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Approval evidence: explicit project-owner ruling in the current conversation on 2026-08-26.
- Publication evidence: unavailable; the current work prepares a local candidate and does not publish.
