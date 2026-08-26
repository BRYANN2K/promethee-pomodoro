---
id: ADR-0015
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0015: Use GitHub Releases and a source installer for V1

> **Primary-channel supersession (2026-08-26):** [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) replaces this record's private-package/GitHub-first V1 channel with the public unscoped `promethee-pomodoro@1.0.1` npm package. `install-electron.sh` remains a secondary macOS source path and the bounded manual GitHub Release check remains active. The failed `v1.0.0` tag is preserved; no package or GitHub Release was published. The decision history below is intentionally unchanged.

## Context and problem

The project owner wants the first release to remain open source, installable from the Git repository with a shell script, and independent of Apple or Windows signing certificates. ADR-0008 previously selected a public npm registry package as the first beta channel. The V1 implementation now has a different, narrower delivery shape: a private npm-shaped project, a macOS source installer, a tag-gated GitHub Release workflow, and a manual GitHub Releases update check.

The repository currently has no Git HEAD or release tag. No workflow run, GitHub Release, public tarball, installation smoke test, signed identity, notarization, or Windows package exists. This decision records the intended V1 boundary without turning local implementation into publication evidence.

## Scope and non-goals

This decision governs V1 source installation, GitHub Release artifacts, version detection, CI intent, and the relationship to the future npm registry and native signed channels. It does not authorize a commit, tag, push, release, registry publication, dependency change, certificate enrollment, notarization, Windows support claim, or live Promethee action.

## Decision drivers

- Keep V1 inspectable and installable from public source.
- Avoid requiring Apple or Windows certificates for the first release.
- Reuse the approved npm lockfile and Electron build without publishing to the npm registry.
- Keep installation and updates explicit and user-controlled.
- Preserve rollback when a local application already exists.
- Make source, tag, version, artifact, and release-page identity reviewable.

## Decision

V1 will use **GitHub Releases plus the checked-in `install-electron.sh` source installer**. npm remains the build and dependency toolchain, but `package.json` stays `private: true`; V1 does not publish to the npm registry.

The macOS source installer:

1. runs only on Darwin and requires Node.js 22.12 or newer plus npm;
2. runs `npm ci --ignore-scripts --no-audit --no-fund` against the checked-in lockfile, then explicitly runs only pinned `electron@43.2.0`'s `install.js` to download that runtime before `npm run target:build`;
3. assembles the installed application from the locked Electron runtime and an explicit allowlist of production JavaScript/resources plus package/license metadata, excluding the local preview/demo and build metadata;
4. applies a local ad hoc signature, which is not Apple Developer ID signing or notarization;
5. installs to `${PROMETHEE_POMODORO_INSTALL_DIR}` or `~/Applications` by default; and
6. backs up an existing application before replacement and restores it if the new copy fails.

Running the installer is an explicit local mutation and network/dependency operation. Documentation must show it as a user-invoked install path, not a validation command. A clean macOS smoke test remains required before V1 is called installable. No Windows installer or runtime proof exists.

The V1 release workflow is triggered only by a stable `vMAJOR.MINOR.PATCH` tag. It verifies that the tag equals `package.json` version, installs locked dependencies with lifecycle scripts disabled, validates the installer syntax, builds, runs the test suite, creates the private package's reviewed source/runtime tarball with `npm pack`, and attaches that tarball to a GitHub Release. It does not run `npm publish`. Its pinned actions and least-privilege permissions are implementation intent until a real immutable Git HEAD, matching tag, workflow run, artifact, and public release readback exist.

The in-app update control performs a bounded, user-requested check of the repository's latest GitHub Release. It accepts only a stable semantic tag and a release URL under the exact repository release prefix. It reports current, available, or unavailable and may open the validated release page. It never downloads, installs, replaces, relaunches, or runs the shell installer.

ADR-0008's public npm registry, Trusted Publishing, provenance, global install, and `npx` design remains a future open channel. This decision supersedes only its claim that npm registry publication is the first V1 channel. ADR-0007's project-signed native distribution remains deferred.

## Consequences

### Positive

- V1 has a transparent repository-first installation and release path.
- The package cannot be accidentally published to npm while it remains private.
- The installer uses the reviewed lockfile and leaves a recoverable backup.
- Update detection is manual and non-mutating.

### Negative

- Users need Node.js, npm, network access, and a source checkout.
- An ad hoc signed application has no stable Apple publisher identity, notarization, or Gatekeeper trust.
- Rebuilding locally may cause Accessibility permission prompts or identity churn.
- The current path is macOS-only; it does not satisfy the product's Windows target.
- GitHub availability is required for release discovery and source distribution.

### Neutral

- `npm pack` is used as an artifact builder, not evidence of npm registry publication.
- A configured workflow is not evidence that a release exists.
- Future npm registry or signed-native channels require their own remaining gates and explicit external-mutation authorization.

## Implementation and migration

1. Keep the package private and retain the reviewed production-only `bin`/`files`, version, repository, license, and runtime metadata; exclude local preview/demo, tests, source maps, declarations, and build metadata.
2. Validate `install-electron.sh` syntax and review every download, build, replacement, backup, and cleanup side effect.
3. Maintain pinned, least-privilege CI and release workflows; do not add npm publication authority to V1.
4. Test the installer from a clean public checkout on a disposable supported macOS system before documenting install support.
5. Establish an immutable public Git HEAD, create a matching authorized V1 tag, then verify the workflow, tarball contents, GitHub Release, and source readback.
6. Keep update checks manual and restricted to the exact GitHub repository release surface.
7. Add Windows delivery only after a separately reviewed implementation and real Windows proof.

## Validation

- Shell syntax validation passes without installing anything.
- Local type-check, build, and test commands pass with the locked dependencies.
- `npm pack` dry-run and produced-tarball review show only the allowlisted runtime/source files and no secret or repository-only content.
- A clean macOS source checkout installs, launches, backs up/replaces safely, and can be rolled back.
- The workflow rejects a malformed or version-mismatched tag and publishes no external state during pull-request CI.
- Public release proof requires exact Git HEAD/tag/artifact/workflow/release-page readback; local files alone are insufficient.
- Update checks reject oversized, malformed, non-semantic, or wrong-repository responses and never install code.
- Windows, npm registry, Developer ID/notarization, Authenticode, and native updater claims remain absent.

## Revisit triggers

- V1 needs Windows installation.
- GitHub Releases or source installation is too difficult for intended users.
- A public npm registry package is ready to pass ADR-0008's ownership and publication gates.
- Apple or Windows signing ownership becomes available.
- The installer, package shape, repository identity, update endpoint, or release workflow changes.

## Related decisions and evidence

- Supersedes for V1 channel only: [ADR-0008](0008-use-npm-for-the-first-public-beta.md); its npm registry plan remains future/open.
- Defers: [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md).
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Implemented by: the secondary macOS source installer and bounded GitHub Releases update check; ADR-0017 governs the primary V1 channel.
- Approval evidence: explicit project-owner direction in the current conversation on 2026-08-25.
- Current implementation evidence: local `package.json`/lockfile, `bin/promethee-pomodoro.cjs`, `install-electron.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and the bounded GitHub Releases checker. None is publication or platform-support proof.
