# V1 npm distribution and updates

**Status:** Local `promethee-pomodoro@1.0.0` release candidate and configured pipeline. The package is not published, no `v1.0.0` workflow run exists, and npm `latest` has not been created or changed.

On 2026-08-26, registry lookup returned `E404` for the unscoped name: it was unclaimed at that observation. npm Trusted Publishing cannot create a package that does not yet exist. The checked-in OIDC job is therefore subsequent-publication configuration, not a working V1 bootstrap path. Claiming/publishing `1.0.0` requires a separately authorized one-time bootstrap described below.

The dependency lock now pins the explicitly approved Electron `43.4.1`. The lock update was installed without lifecycle scripts and the current TypeScript/native source validation passes locally; this does not establish clean npm installation, a running packaged-runtime identity, or Windows runtime support.

This is the operational reference for users and release maintainers. [ADR-0017](../architecture/decisions/0017-use-public-npm-as-the-v1-release-channel.md) selects the public unscoped npm package as the V1 channel. [ADR-0007](../architecture/decisions/0007-deliver-signed-releases-and-updates-through-ci.md) keeps Apple/Windows-signed native delivery as a later phase.

## Availability and support matrix

| Target | Candidate artifact | Product behavior evidence | Current claim |
| --- | --- | --- | --- |
| macOS arm64 (macOS 14+) | Prebuilt `darwin-arm64` native helper in the npm tarball | Local helper architecture/minimum-OS verification and one Promethee 1.3.29 live flow passed; CI is configured | Candidate, not registry-verified or generally supported |
| macOS x64 | Prebuilt `darwin-x64` native helper in the npm tarball | CI is configured; no recorded clean npm/runtime result | Candidate, unverified |
| Windows x64 | Prebuilt `win32-x64` native helper in the npm tarball | CI and package smoke are configured; no recorded Promethee runtime result | Candidate, unverified; automatic Pause/Resume is unavailable |
| Windows arm64, Linux, other targets | None | None | Unsupported |

The macOS evidence is one authorized Promethee 1.3.29 same-session focus → pause → short break → resume → focus exercise. It does not establish every macOS version, architecture, Promethee build, permission state, display topology, or install path. Configured CI is not execution evidence.

## What the npm artifact is

The release workflow is configured to assemble one npm tarball containing:

- compiled production Electron/core JavaScript and reviewed HTML/CSS resources;
- task-time tracking/storage and the four-tab Context/Tasks/History/Settings menu resources;
- the `promethee-pomodoro` CLI shim;
- prebuilt native helpers for macOS arm64, macOS x64, and Windows x64;
- the packaged SVG and ICNS application icons;
- package metadata, README, and license.

The allowlist excludes tests, internal packaging scripts, OpenSpec, design-review artifacts, local previews, repository workflows, credentials, live Promethee data, declarations, source maps, and TypeScript build metadata. The repository-only `scripts/verify-release-package.mjs` checks the required targets and performs a bounded `npm pack --dry-run --json --ignore-scripts` content review; it is deliberately absent from the consumer tarball. The packaged `package-command.cjs` keeps npm commands honest in both contexts: source checkouts retain the declared validation/build commands, while an installed package starts through the public launcher, performs a bounded payload self-check for `npm test`, reports that it is already prebuilt for `npm run build`, and refuses republication.

This tarball is a source/runtime npm artifact. It is not a native `.app`, `.dmg`, `.pkg`, `.exe`, or `.msi`. The native helpers are binaries inside the package, but the project does not sign them with Apple Developer ID or Windows Authenticode and does not notarize them. npm provenance, if a future workflow successfully emits it, binds package/source/workflow identity; it does not replace platform signing.

## Prerequisites

All users need:

- Node.js `22.12.0` or newer, as declared by `package.json`;
- npm and network access to the npm registry and Electron dependency download;
- a supported CPU/OS candidate listed above; and
- a local Promethee installation with an active or paused compact timer.

The packaged macOS helpers declare macOS 14.0 as their minimum. The release verifier inspects each Mach-O architecture and minimum-OS load command and the Windows helper's x64 PE header. Windows V1 remains passive regardless of helper presence.

The configured workflows use Node.js `22.14.0` for build/smoke jobs and exact Node.js `24.19.0` plus npm `11.17.0` for Trusted Publishing. Those workflow versions do not raise the package's declared consumer minimum.

Registry/tarball users receive prebuilt native helpers and do not need Xcode or Visual Studio merely to install the package. Building a helper from source requires Apple `clang` and the AppKit/ApplicationServices/Foundation frameworks on macOS, or Visual Studio C++ x64 build tools plus `dwmapi.lib` and `user32.lib` on Windows.

### macOS permissions

- Read-only task/session observation does not grant input authority.
- The attached outline/window locator uses the native Promethee window helper.
- Pause/Resume additionally needs permission to capture the bounded Promethee HUD and post input events. On first launch, the setup panel first checks **Control the timer** and **Read the timer** without showing an OS prompt. **Check again** performs the same prompt-free preflight. After the startup refresh and onboarding presentation, the app may invoke the native permission request automatically at most once per process when required; macOS may show Accessibility/register the app, but only the user controls final System Settings toggles. **Allow** remains the explicit request retry. **Check again**, Settings review, and all phase transitions are request-free. The control check comes from native-helper Input Events status. The reading check requires both helper-reported Screen Recording and a bounded probe through the real `/usr/sbin/screencapture`; its image is never retained. If Screen Recording changes from missing to granted during a request, Promethee Pomodoro relaunches itself once so macOS applies capture access to the running app actor. After relaunch and detection of both checks, the button becomes **Continue**. **Open** remains available for manual review in System Settings. Screen reading is mandatory for attachment. Once it passes, choose **Not now** to skip Input Events only if automatic Pause and Resume are both persisted off; passive attached tasks, history, settings, tracking, and local Pomodoro behavior remain available, and missing Input Events alone does not reopen recovery or trigger the startup request on later launches. **Not now** is refused while screen reading is unavailable. Enabling automation later remains a separate explicit Settings choice.
- Every V1 local rebuild/install uses a new ad hoc `cdhash` identity. The source installer therefore resets only Accessibility and ScreenCapture for the current and retired bundle identifiers after installation; it grants nothing. Revalidate and regrant both capabilities to the installed build on every V1 rebuild/install. The app trusts neither a stale helper status nor a prior build: screen reading must pass the current helper status plus real bounded capture probe.

For new installations, automatic Pause initially defaults to on and automatic Resume defaults to off. After screen reading passes, choosing **Not now** persists both off and skips Input Events without reopening permission recovery; before that, it is refused. Existing stored preferences remain unchanged; later enabling either setting remains user-controlled, and `PROMETHEE_POMODORO_DISABLE_AUTOMATION=1` overrides them.

The application is single-instance and hides its Dock icon. Opening the installed app again asks the existing process to show the attached popup; it does not launch a second tracking runtime.

### Windows limitations

The current Windows x64 host can use the packaged observation-only helper for Promethee process/window discovery, read the fixed SQLite observations, and render local attached surfaces when current geometry validates. Windows automatic Pause/Resume is unavailable and fails closed; the frozen V1 helper exposes no input action. No Windows Promethee runtime exercise has been recorded.

Run Promethee and Promethee Pomodoro at the same integrity level. An elevated target can prevent a normal user process from observing or interacting with it. The project has no Authenticode certificate, installer publisher, or SmartScreen reputation.

## Install from npm after publication

The following commands are the intended public path only after registry readback proves `promethee-pomodoro@1.0.0` exists. They are not currently executable publication evidence.

Install the exact V1 version globally:

```bash
npm install --global promethee-pomodoro@1.0.0 --no-audit --no-fund
```

Do not add `--ignore-scripts` to the consumer install: Electron's dependency installation must obtain the matching runtime. Review npm's output before continuing.

Confirm the installed CLI version:

```bash
promethee-pomodoro --version
```

Start normally as a detached desktop process:

```bash
promethee-pomodoro
```

For diagnostics, keep Electron attached to the terminal:

```bash
promethee-pomodoro --foreground
```

`--version` exits after printing the package version and does not launch Electron. Normal and foreground launch accept only macOS arm64, macOS x64, or Windows x64 and fail before spawning Electron on any other target. On macOS, `--install-only` assembles or reuses the branded application without launching it. `--smoke-test` is reserved for the release matrix: it disables automation, bypasses installation, waits for Electron readiness, then exits. One-off `npx` execution is possible through the package's bin mapping but remains unverified by the configured smoke matrix; it is not the recommended V1 path.

In the Pomodoro menu, **Reset timer** restarts only the current local phase at its configured duration. It never resets, pauses, resumes, stops, or otherwise controls the Promethee session.

The **History** tab records local intervals only while a selected task and the real Promethee timer are observed as running. Changing tasks or choosing **Stop tracking** closes the old interval; Stop tracking clears the selected task but keeps saved history. History loads newest-first in 100-entry pages with **Load older**, so any retained entry can be deleted. Today and Monday-based week totals use DST-aware local calendar boundaries. **Export CSV** writes a freelancer-oriented file to a user-selected location. The ledger contains local interval timestamps and task/project snapshots but no Promethee session identifier; neither history nor export writes to Promethee.

**Skip phase** uses the same bounded Pause authority as focus completion when a focus is skipped; skipping a break is local and enters Ready. The action adds no new Promethee operation. Focus progress remains orange and the consuming break outline is neutral gray.

## Install the reviewed local candidate

Before publication, maintainers may verify the exact assembled tarball in a disposable prefix. Producing the complete tarball requires all three native build artifacts; a single-platform source build is not equivalent.

On macOS/Linux shells, install a reviewed tarball without changing the normal global prefix:

```bash
candidate_prefix="$(mktemp -d)"
npm install --global --prefix "$candidate_prefix" ./promethee-pomodoro-1.0.0.tgz --no-audit --no-fund
"$candidate_prefix/bin/promethee-pomodoro" --version
```

On Windows PowerShell:

```powershell
$candidatePrefix = Join-Path $env:TEMP 'promethee-pomodoro-candidate'
npm install --global --prefix $candidatePrefix .\promethee-pomodoro-1.0.0.tgz --no-audit --no-fund
& (Join-Path $candidatePrefix 'promethee-pomodoro.cmd') --version
```

These commands install and execute package/dependency code. Use only a reviewed tarball and disposable target. The configured release smoke checks installation, CLI version, expected helper presence, and bounded Electron readiness on all three targets. On macOS it also assembles the branded application in the runner's temporary directory, verifies its plist and ad hoc signature, and smoke-launches that exact executable. Smoke mode creates no product window, does not access Promethee, and does not exercise permissions or end-to-end behavior.

### Secondary local macOS Electron application

From an explicitly reviewed source checkout on macOS 14 or newer with Node.js 22.12+ and npm, the checked-in secondary installer is invoked as:

```bash
./install-electron.sh
open "$HOME/Applications/Promethee Pomodoro.app"
```

The script is a mutating installer, not a validation command. Source inspection shows that it installs the exact lockfile with package lifecycle scripts disabled, explicitly runs only the pinned Electron installer, builds the application, copies the allowlisted production runtime and ICNS icon into a local `.app`, applies an ad hoc local signature, and replaces the target only after creating a backup. It then runs `tccutil reset` only for Accessibility and ScreenCapture under `io.github.bryann2k.promethee-pomodoro` and the retired `io.github.bryann2k.PrometheePomodoro`; reset failure is a warning. This grants no permission—the user must revalidate and regrant after each V1 build/install because the ad hoc designated requirement is a changing `cdhash`. `PROMETHEE_POMODORO_INSTALL_DIR` selects another destination root. This reset is a temporary local workaround, not a long-term update or permission-migration strategy. Future Apple Developer ID signed delivery is the stable application-identity solution. This path is macOS-only, has not passed a clean public-checkout installation/rollback matrix, and is neither Apple Developer ID signed nor notarized.

## Update model

The application checks for updates only when the user selects **Check**. Current source queries the exact GitHub repository's latest Release API with a five-second timeout and 64 KiB response bound. It accepts only a stable semantic version and a release URL under the allowlisted repository prefix, then may open that page. It sends no Promethee or user content.

The application never runs npm, downloads a tarball, changes `latest`, replaces itself, or relaunches. After a newer version is independently verified, a global user updates explicitly:

```bash
npm install --global promethee-pomodoro@<exact-version> --no-audit --no-fund
```

Prefer an exact version during the candidate phase. `@latest` is safe to recommend only after the registry dist-tag and package have been read back and approved.

## Uninstall and local data

Close Promethee Pomodoro, then remove the global package:

```bash
npm uninstall --global promethee-pomodoro
```

This removes the npm package and CLI from the active global prefix. It does not remove Node/npm, Promethee, or Promethee Pomodoro's Electron user data. That data includes bounded preferences and `task-time-v1.json`, which can contain task/project names and local interval timestamps. Corrupt/future ledgers are deliberately preserved rather than silently reset. Data cleanup is a separate destructive action; first export or back up any history that must be retained, then identify the exact Electron `userData` path on that machine before deleting anything. Exported CSV files live wherever the user selected and are never removed by npm or application uninstall.

On macOS, npm uninstall also leaves the separately assembled default application at `~/Applications/Promethee Pomodoro.app`. After closing it, move that exact bundle to the Trash separately:

```bash
mv "$HOME/Applications/Promethee Pomodoro.app" "$HOME/.Trash/"
```

If `PROMETHEE_POMODORO_INSTALL_DIR` was used, resolve and review that exact custom bundle path instead. No npm lifecycle hook removes the app or local history automatically.

If the command remains on `PATH`, compare the executable location with the active npm global prefix and remove other independently installed copies through their original installer/package manager. Do not delete broad npm or application-data directories.

## Rollback

npm versions are immutable. To roll back after a later version is installed, explicitly install a previously verified public version:

```bash
npm install --global promethee-pomodoro@<previous-version> --no-audit --no-fund
promethee-pomodoro --version
```

V1.0.0 has no earlier public Promethee Pomodoro npm version unless registry readback proves otherwise. A local tarball rollback is valid only when the exact prior tarball and its reviewed integrity are retained. Preferences and the local task-time ledger use versioned bounded formats, but cycle-snapshot lifecycle persistence is not wired; always verify settings, history, and an active Promethee session after changing versions. Rollback does not import or rewrite Promethee data.

A maintainer may later deprecate a bad immutable version or move `latest` to a verified replacement, but both are separate npm mutations requiring exact authorization and registry readback. Never overwrite or silently unpublish a released version as a routine rollback.

## CI and release pipeline

### Pull request and main validation

`.github/workflows/ci.yml` is configured with read-only contents permission and immutable action revisions. Its matrix targets:

- `darwin-arm64` on `macos-15`;
- `darwin-x64` on `macos-15-intel`; and
- `win32-x64` on `windows-2025`.

Each job installs the lockfile with lifecycle scripts disabled, builds the platform helper and app, runs the npm test suite, confirms the expected target directory, and checks whitespace. macOS jobs also syntax-check the source installer. No configured run is evidence until GitHub reports it for the intended commit.

### Stable-tag release graph

Pushing `vMAJOR.MINOR.PATCH` is configured to start a mutating release workflow:

```text
tag/source validation
  → three native helper builds
  → one assembled npm tarball + SHA256SUMS
  → three clean-prefix install/version/helper smoke jobs
  → npm Trusted Publishing through the npm-release environment
  → GitHub Release creation
```

The workflow validates that the stable tag equals `package.json` version, uses pinned actions, and passes artifacts between jobs. The assembly job builds the application once around the three native helper artifacts, verifies the package allowlist, produces one tarball, and records its SHA-256. Smoke jobs consume that exact artifact.

The npm job uses job-scoped `id-token: write`, no stored npm token, Node.js 24, and npm `11.5.1` or newer. It references the `npm-release` GitHub environment and publishes the exact downloaded tarball with public access. Repository YAML cannot prove that environment protection, npm Trusted Publisher ownership, provenance emission, or manual approval is configured externally. Because the package is still unclaimed, this job is only ready for a later publication after the bootstrap and exact Trusted Publisher configuration; it cannot create V1.0.0 today.

Because the package version is stable, its authorized first publish creates npm's `latest` tag. For V1, protect the `npm-release` environment before pushing the tag so the workflow builds and smokes the exact candidate, then pauses before its publication job.

### One-time package bootstrap

If the name is still available and the project owner separately approves the exact registry mutation, an authorized maintainer downloads the single artifact produced by the paused tag workflow, verifies `SHA256SUMS`, and claims the name with the authenticated npm maintainer session and required account 2FA. Because direct local publication has no supported GitHub provenance context, the one-time bootstrap command must explicitly use `--provenance=false`; V1 must not claim npm provenance:

```bash
npm publish ./promethee-pomodoro-1.0.0.tgz --ignore-scripts --access public --tag latest --provenance=false
```

The approval must name the package/version, tarball digest, source revision, `latest` mutation, npm account, and command. Do not put an npm token in GitHub Actions, repository files, shell history, logs, or documentation. After registry readback, approve the paused environment job: it compares the exact tarball SHA-512 to npm `dist.integrity`, skips duplicate publication only on an exact match, verifies `latest`, and then permits the GitHub Release.

Immediately after verified registry readback, revoke the bootstrap token and configure the npm Trusted Publisher to the exact public repository, `.github/workflows/release.yml`, and `npm-release` environment. Protect that environment with the required manual approver. All later publications use OIDC; traditional npm tokens are prohibited. This repository has not performed any of these external steps.

The stable workflow creates the GitHub Release only after exact npm integrity and `latest` readback succeed. A pre-existing version with different integrity fails closed.

## Release checklist

### Before tag or publication

- [ ] Public Git HEAD and repository URL are verified and immutable for the candidate.
- [ ] `package.json`, lockfile, CLI `--version`, release notes, and intended tag all say `promethee-pomodoro@1.0.0` / `v1.0.0`.
- [ ] The public unscoped npm name and maintainer/Trusted Publisher ownership are verified.
- [ ] Because the name is currently unclaimed, the one-time exact bootstrap publication, short-lived granular token, account 2FA, tarball digest, command, and `latest` mutation receive separate approval.
- [ ] Registry readback passes, the bootstrap token is revoked, and the exact repository/workflow/environment Trusted Publisher is configured before any later workflow publication.
- [ ] GitHub `npm-release` environment protection actually requires the intended manual approval.
- [ ] Pinned workflow actions, permissions, runner labels, Node/npm versions, and native toolchains are reviewed.
- [x] Electron `43.4.1` is explicitly approved and locked; current source tests/build pass. Clean package installation and platform runtime checks remain separate gates below.
- [ ] Core, integration, persistence, Electron, typecheck, build, and release-package checks pass on the intended revision.
- [ ] The exact tarball file list, unpacked content, license, dependency graph, executable mode, three helpers, SHA-256, and absence of secrets/private artifacts are reviewed.
- [ ] The four-tab menu, task-time tracker/store, `task-time-v1.json` schema, no-session-ID invariant, deterministic newest-10,000/`<8 MiB` retention, deletion, and CSV projection are reviewed with synthetic data only.
- [ ] The packaged SVG/ICNS icons and secondary macOS local application bundle are reviewed; no Apple Developer ID or notarization claim is made.
- [ ] Clean candidate install/version checks pass on macOS arm64, macOS x64, and Windows x64.
- [ ] Real GUI/Promethee/permission checks are recorded separately from package smoke and supported claims are narrowed to that evidence.
- [ ] Known issues, changelog, rollback, uninstall, and unsigned-platform warnings are approved.
- [ ] The project owner explicitly approves the exact tag, package/version, tarball digest, `latest` mutation, GitHub Release, workflow, and registry target.
- [ ] The V1 tag/GitHub Release procedure is reconciled with the workflow's npm-before-GitHub ordering so it cannot attempt to republish `1.0.0` after bootstrap.

### After an authorized workflow

- [ ] Every required job passed against the same source tag and assembled tarball.
- [ ] GitHub Release tag, source, tarball, `SHA256SUMS`, and generated notes agree.
- [ ] npm readback confirms package, version, `latest`, integrity, executable mapping, repository/license metadata, and provenance when expected.
- [ ] A fresh public-registry install, `--version`, normal/foreground launch, and uninstall pass on every claimed platform.
- [ ] Update detection points users to the matching reviewed release and never installs code.
- [ ] Documentation status changes from candidate/unpublished only after all relevant readback passes.

## Troubleshooting

### `promethee-pomodoro: command not found`

Run `npm prefix --global` and confirm its executable directory is on `PATH`. On Windows, confirm the prefix directory containing `promethee-pomodoro.cmd` is on `PATH`. Avoid using administrator/root installation merely to work around a prefix configuration problem.

### Electron is missing after install

Consumer installation needs Electron's dependency installation. Reinstall the exact package without `--ignore-scripts` and inspect proxy/firewall/network errors. Do not run a copied `install.js` from an unreviewed path.

### The native helper is missing or unsupported

Confirm the runtime is macOS arm64, macOS x64, or Windows x64 and that the installed package contains `dist/native/<platform>-<arch>/`. Reinstall from the exact reviewed/public artifact. Other targets fail closed.

### The outline or menu does not appear

Start or pause a Promethee session so the compact timer is visible. The app hides its outline and attached handle when it cannot identify exactly one current HUD, database, session, or safe placement. Permission onboarding or geometry recovery can still show the menu centered in the current display without relying on the HUD; it returns to attached placement after current safe geometry recovers. Unknown Promethee layouts and multiple matching windows fail closed. Launching the app a second time brings the existing popup forward rather than starting another host.

### History is empty or stops increasing

Select a task in **Tasks** and verify that the real Promethee timer is running. Paused, stopped, missing, stale, or replaced observations accrue no time. Selecting another task or **Stop tracking** closes the prior interval; Stop tracking preserves saved history. A disappeared source task remains visible through its retained local snapshot, but it cannot be newly selected until it returns to the read-only task list. Use **Load older** to page through entries beyond the newest 100.

If the History tab reports a storage error after a corrupt or future-version file is found, the app intentionally preserves the file and disables checkpoints rather than overwriting possible recoverable data. Back up the exact file before any manual recovery action.

### CSV export fails

Choose a writable destination and retry. Export is a local user-requested file write; it never writes to Promethee. Existing exported files are not governed by the application's 10,000-entry/`<8 MiB` retention and must be protected or deleted separately.

### macOS Pause/Resume remains unavailable

Keep the compact HUD visible and review the relevant automation setting. Open **Settings → Permissions → Review**; opening the panel and choosing **Check again** reads native-helper status and performs the bounded non-retained `/usr/sbin/screencapture` readiness probe without opening an OS prompt. If a capability is missing, choose **Allow** to explicitly request it, or use **Open** to change the final Screen Recording or Accessibility/Input Events toggle yourself in System Settings before checking again. The panel remains centered and usable even if the HUD is unavailable. Screen reading is mandatory for HUD attachment. Once the helper Screen Recording status and capture probe pass, **Not now** may skip Input Events and saves both automation settings off without reopening recovery solely for missing control; while screen reading is unavailable, **Not now** is refused and setup stays visible. A newly detected Screen Recording grant schedules one intentional relaunch after automation is revoked, in-flight native work and polling are stopped, and queued local preference/history checkpoints receive at most 750 ms; the host then calls `app.relaunch()` and `app.exit(0)`. After relaunch, current valid HUD geometry restores attached placement. Confirm both rows are green before enabling automation. Existing stored choices are otherwise preserved. Each ad hoc V1 rebuild/install changes the `cdhash`; the installer resets only this app's current/retired Accessibility and ScreenCapture rows, so revalidate and regrant after every rebuild/install. Restart manually only when macOS explicitly requires it or the current grant still does not refresh after rechecking. The environment kill switch always wins. A native-helper check returned `1,1`, and a local second-launch plus `TERM` quit/manual-reopen smoke passed on 2026-08-26, but the real Screen Recording grant/relaunch transition still requires user validation after build. Future Developer ID signing, not repeated TCC reset, is the stable update identity.

### Windows Pause/Resume remains unavailable

This is the current product boundary: Windows automatic Pause/Resume is disabled. The Windows candidate currently targets passive attached surfaces and read-only observation only.

### The update check reports unavailable

The manual checker needs access to the exact GitHub Releases endpoint and rejects missing, oversized, malformed, non-semantic, or wrong-repository responses. Pomodoro operation continues. Check the release page manually; do not treat a failed check as permission to run an unreviewed installer.

## Evidence and mutation boundary

Configured manifests, workflows, local tarballs, tests, and documentation are preparation evidence. They are not registry publication, GitHub Release, clean public install, platform support, signing, notarization, or deployment evidence.

This document grants no permission to install dependencies, publish, tag, push, create a release, approve an environment, move a dist-tag, deprecate/unpublish a package, provision credentials, sign/notarize code, or deploy.
