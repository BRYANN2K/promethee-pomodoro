---
id: ADR-0007
status: proposed
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0007: Deliver native signed releases and updates through CI

> **V1 sequence amendment (2026-08-26):** [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) now governs V1 through the unsigned public npm package; [ADR-0015](0015-use-github-releases-and-a-source-installer-for-v1.md) retains only a secondary macOS source path and manual GitHub Release check. This proposal still governs only a later project-signed/notarized macOS and signed Windows phase. The historical context below is preserved.

## Context and problem

Native macOS and Windows packages eventually need platform identity, installation verification, update authenticity, and recovery. Those controls remain important, but the project owner selected the source/GitHub Release path in [ADR-0015](0015-use-github-releases-and-a-source-installer-for-v1.md) for V1. Native project-signed application bundles, installers, notarization, Authenticode, and a native updater are therefore deferred to a later release phase, not cancelled. ADR-0008's public npm registry path is also future work.

The signing identities, certificate custodians, native package formats, updater, metadata-signing scheme, and operating budget remain unresolved. This ADR stays Proposed and does not govern V1 source installation or GitHub Releases.

## Scope and non-goals

This proposal covers a later native distribution phase: signed/notarized macOS artifacts, signed Windows artifacts/installers, authenticated native update metadata, explicit installation, rollback, and revocation. It does not govern V1, authorize certificate enrollment, create signing workflows, or publish anything.

## Decision drivers

- Native installers identify their publisher to platform trust systems.
- Pull-request code cannot access signing or publication authority.
- Native update installation cannot trust an unauthenticated response.
- macOS and Windows artifacts are tested on their claimed platforms.
- Operators can revoke and recover a defective native release.

## Constraints

- npm provenance does not replace Apple notarization, macOS code signing, Windows Authenticode, or SmartScreen reputation.
- Native publication remains blocked until identities, custody, formats, compatibility evidence, and clean-system tests are owned.
- Installation stays user-controlled unless a later accepted decision changes that policy.
- Publication and credential provisioning require separate explicit authorization.

## Considered options

1. Deliver platform-signed native packages through protected CI after the V1 source/GitHub Release phase.
2. Publish unsigned native archives alongside npm.
3. Sign native releases manually on a maintainer workstation.
4. Keep npm as the only distribution channel indefinitely.

## Decision

The proposed later-phase decision is to **deliver native macOS and Windows releases through protected CI with platform signatures, required notarization, authenticated update metadata, and user-approved installation**. Work starts only after V1 and after unresolved ownership inputs are decided.

## Rationale

Protected CI can make source, validation, artifact identity, and promotion reviewable. Platform signing is the appropriate publisher-identity mechanism for native packages. Unsigned archives remain warning-prone; manual workstation releases concentrate credentials; npm alone does not deliver a native installation experience.

## Option comparison

| Driver | Protected signed CI | Unsigned native archives | Manual signing | npm only | Evidence |
| --- | --- | --- | --- | --- | --- |
| Platform identity | Designed explicitly | Absent | Possible but operator-bound | Not a native package | Platform model; implementation unverified |
| Repeatability | High after pipeline proof | Build-repeatable only | Low | Covered by ADR-0008 | Architectural analysis |
| Credential isolation | Protected jobs | No signing credentials | Maintainer workstation | npm OIDC only | Target controls |
| Native update safety | Signed metadata target | Ad hoc | Manual | Out of scope | Target controls |
| Delivery timing | Later | Earlier but warning-prone | Operator-dependent | First beta | Project-owner decision |

## Consequences

### Positive

- Native signing remains a planned compatibility and trust improvement.
- V1 source/GitHub Release delivery can proceed without pretending native credentials exist.
- Later native artifacts can reuse validated behavior while adding platform proof.

### Negative

- Early beta users need Node.js and npm and do not receive a native installer.
- Native packaging, signing, updater, and platform tests remain outstanding.
- Maintaining npm and native channels later adds support complexity.

### Neutral

- npm provenance and native platform signatures solve different trust problems.
- Deferral changes sequence, not native release acceptance criteria.

## Implementation and migration

1. Complete the current V1 npm/GitHub Release contract in ADR-0017.
2. Assign native signing identities, custodians, formats, updater, and supported platforms.
3. Produce unpublished signed candidates on protected runners.
4. Verify installation, identity, update rejection, rollback, and revocation on clean systems.
5. Accept this ADR before native publication work becomes governing.

## Validation

- macOS establishes the expected identity and notarization result.
- Windows establishes the expected publisher, timestamp, and installer identity.
- Untrusted workflows cannot request signing or native publication authority.
- Modified metadata/artifacts, wrong architecture, downgrade, and revoked targets fail closed.
- Clean-system install, update, cancellation, recovery, and rollback pass on every claimed platform.

## Revisit triggers

- npm distribution blocks required adoption or enterprise deployment.
- A first-party Promethee bundle or marketplace requires native packaging.
- Signing ownership and budget become available.
- Platform policy materially changes for unsigned Node/Electron applications.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none.
- Deferred by: [ADR-0008](0008-use-npm-for-the-first-public-beta.md) for the first public beta only.
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md), [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Implemented by: deferred native-release work; no signed-native implementation exists.
- Evidence: [cross-platform distribution plan](../../releases/distribution-and-updates.md); current platform requirements must be revalidated before implementation.
