# Compatibility and security

**Status:** Target controls and current research boundary.

Promethee Pomodoro controls a work timer and observes task metadata, so integration failure can interrupt work even when it does not expose confidential data. The design treats Promethee as a separate security authority and makes compatibility explicit.

## Current evidence

A read-only analysis of Promethee 1.3.26 found internal services for active-session control, task listing and change events, and HUD state and placement. Those services are exposed to trusted Promethee renderers through private, origin-guarded Electron IPC with `nodeIntegration` disabled, context isolation enabled, and sandboxing enabled.

Consequences:

- A third-party process cannot safely call `window.promethee.*`.
- Private IPC channel knowledge is not a public API contract.
- Direct SQLite writes would bypass invariants and are forbidden.
- Copying an application token or user session would cross an authentication boundary and is forbidden.
- A remote data API cannot safely replace local session coordination without an approved independent authentication and product contract.

The local analysis artifact is not committed because it describes another application's private surface. This repository records only the minimum conclusions required for design.

A separately authorized read-only investigation of Promethee 1.3.29 on macOS established sanitized capability facts only: the database existed at the legacy expected path, used WAL, reported `user_version=0`, and exposed the documented `sessions` schema. One content-free worked-time derivation matched the visible HUD within capture delay. There is no session revision or command acknowledgement. ADR-0014 accepts this minimal observer with ADR-0012 task/project reads and ADR-0011 Pause/Resume as the external bridge; ADR-0016 selects the native input helper.

On 2026-08-25, a separate explicitly authorized live macOS exercise against Promethee 1.3.29 passed one full same-session focus → pause → short break → resume → focus flow. Its bounded geometry evidence was `159 × 32` for the running HUD and `191 × 32` for the paused HUD. No live identifier, content, timestamp, or raster is retained. The outcome is current-state evidence, not an authoritative command acknowledgement or proof of causation. It does not establish Linux, Windows, a general compatibility matrix, installation, packaging, signing, or release support.

On 2026-08-26, a separate local application-lifecycle smoke check confirmed that opening a second instance brought the existing popup forward and that a `TERM` quit followed by manual reopen succeeded. It did not exercise a real Screen Recording grant or the automatic relaunch path; that user-run macOS proof remains pending.

## Threat boundaries

| Boundary | Main risks | Required control |
| --- | --- | --- |
| Companion ↔ Promethee bridge | Unauthorized local control, replay, confused version | Peer authentication, nonce/connection binding, capability allowlist, schema validation, fail-closed negotiation |
| Companion ↔ native OS input helper | Broad OS input permission, wrong process/window/coordinate, rendered-layout drift, indeterminate action | ADR-0011/0014/0016: explicit consent, native app/PID/window revalidation, two direct fresh SQLite reads plus two bounded HUD captures/classifications (second immediately before dispatch), exact geometry/generation/layout/glyph agreement for one Pause/Resume action, no acknowledgement/retry, immediate revocation |
| Companion ↔ Promethee SQLite task source | Scope creep, write side effects, schema/path drift, content leakage | ADR-0012: main-process-only read-only open, `query_only`, fixed `tasks`/`task_projects` statements, bounds, sanitized diagnostics, no bulk persistence |
| Session observer ↔ Promethee SQLite | Private session data, stale/ambiguous state, false command acknowledgement | ADR-0013: exact eight-field read, bounded freshness, no content logs, no ack/retry authority |
| Companion ↔ Linux compositor socket | Moving, pinning, or unfocusing a window this app did not draw; answering from a different display; an unbounded reply on a session socket | ADR-0020: `attach` names a window only when the compositor reports the helper's own parent process as its owner; Hyprland, then Sway/i3, then X11, with no fall-through to a backend answering for another display; bounded reads, bounded reply size, and a bounded timeout on every exchange |
| Companion ↔ Linux capture and injection slots | Reading a rectangle of somebody else's screen instead of Promethee's window; moving the seat pointer with no system permission to revoke; pressing a control on a session whose behaviour is unmeasured | ADR-0021: capture asks for one toplevel's own surface, or for that window's own off-screen pixmap on X11, and never for a region of the root; a raster is written only after the process, rectangle and generation are re-verified, and a refusal writes no file; the press repeats the macOS preflight and returns `sent-unconfirmed` with no retry; a session with no slot answers `automation-unsupported` rather than claiming a denial; i3 is refused outright; the pointer is left where the press put it and the consent copy says so before the fact, because on these slots the in-app switches are the whole of the permission |
| Renderer ↔ Electron main | Arbitrary IPC, Node authority, forged payload | Context isolation, sandbox, narrow preload API, sender validation, strict schemas |
| Adapter ↔ cycle coordinator | Duplicate, stale, or reordered observation; timeout ambiguity | Serialized intents, observation freshness/session identity, unknown-state suspension, `sent-unconfirmed`, and no automatic retry; revision/idempotence rules apply only to a future official profile |
| App ↔ local storage | Corrupt or future snapshots, secret leakage | Versioned schema, atomic writes, bounded non-secret data, safe fallback |
| Task-time history/export | Client/work metadata disclosure, spreadsheet formula execution, false billing authority, unbounded growth or destructive recovery | ADR-0019 local-only task/project snapshots and interval timestamps, no Promethee session ID, paged explicit deletion/export, RFC 4180 escaping and formula protection, newest-10,000 and `<8 MiB` deterministic retention, corrupt/future-file preservation |
| Local windows ↔ Promethee HUD | Covered controls/`Accept`, transient interception during exclusion delivery, stale or partial geometry | Exact exclusion schemas, pre-interactive publication, Promethee z-order/input precedence, wholly click-through outline, hide-on-unknown behavior |
| Update UI ↔ GitHub Releases | Malicious metadata/link, downgrade, privacy leakage | Exact repository, bounded stable metadata, allowlisted URL, no download/install, no Promethee content |
| Release workflow ↔ npm/GitHub | Artifact substitution, unauthorized `latest`, compromised publisher | Exact tag/version, one reviewed tarball/digest, pinned actions, protected approval, OIDC Trusted Publishing, registry/GitHub readback; configured controls are not evidence until run |
| One-time npm bootstrap | Unclaimed-name race, leaked token, wrong artifact/account/tag | Separate exact approval, short-lived granular token, account 2FA, no repository/CI/history/log exposure, immediate registry readback and revocation, then exact Trusted Publisher configuration; traditional tokens prohibited afterward |
| Local ad hoc macOS install ↔ TCC | Changing `cdhash` leaves stale/inapplicable grants or grants the wrong build | Installer resets only Accessibility and ScreenCapture for current/retired bundle IDs after install; it never grants access, user revalidation/regrant is required after every V1 rebuild/install, and the reset is retired when stable Developer ID identity exists |

## Data policy

Allowed local data is limited to Pomodoro configuration, one explicitly selected bounded task reference, the separately unwired cycle snapshot contract, non-sensitive diagnostics, and ADR-0019's local reporting ledger. That ledger may persist a bounded task/project snapshot and locally derived interval start/end timestamps for each tracked period. It may not persist, expose to the renderer, log, or export the observed Promethee session identifier. ADR-0012 permits the main-process provider to load only the minimum `tasks`/`task_projects` rows into memory; it does not permit a bulk Promethee snapshot. Credentials, access tokens, cookies, embedded API keys, raw session stores, and arbitrary database content are never collected. Promethee content is never sent in update requests or telemetry.

`task-time-v1.json` is local work-history data. It retains the newest 10,000 closed entries while the encoded snapshot stays strictly below 8 MiB, with deterministic oldest-first eviction. A corrupt, inaccessible, or unsupported future file is preserved and checkpoints fail closed. Users may page through 100 entries at a time and delete individual entries anywhere in the retained ledger. Today and Monday-based week totals follow DST-aware local calendar boundaries. CSV export occurs only after an explicit user action and destination choice, uses spreadsheet-safe escaping, and contains UTC interval timestamps plus task/project snapshots but no Promethee session identifier. Exported files are outside application retention and may contain client-sensitive work metadata; the user owns their storage, sharing, and deletion.

## Compatibility negotiation

For the accepted external profile, the adapter validates:

1. explicit product consent and current OS permission;
2. installed-app, process, database-file, and HUD identity;
3. Promethee/OS/layout/schema compatibility against the tested matrix;
4. exact required read/action capability availability; and
5. current session, task, HUD, and action-precondition schemas plus freshness.

Failure at any mandatory step disables the integration. A missing optional capability disables only its feature. Unknown versions are unsupported until tested; they are never accepted merely because an older payload happens to parse. A future official bridge would add peer/protocol/grant negotiation without changing this fail-closed rule.

The external bridge negotiates each provider independently and enables only the complete current capability composition. ADR-0012 requires exact path/file/schema/query fixtures for task snapshots. ADR-0013 requires exact session schema, safe time arithmetic, and bounded freshness but cannot manufacture a revision/acknowledgement. ADR-0011/ADR-0016 require explicit OS permission, strong application/process/window identity, one exact HUD layout and rendered Pause/Play glyph, and one native Pause/Resume click.

## Failure behavior

- If any external-bridge provider disappears, stop issuing actions, freeze or safely cancel Pomodoro coordination according to fresh observed state, hide geometry-dependent UI, and re-establish every required source before continuing.
- If an action times out or returns an uncertain receipt, mark it `sent-unconfirmed`, read current state only for reconciliation/display, and never retry automatically.
- If exclusion ordering has a gap or its schema/revisions/watermark do not match current HUD geometry, discard the complete exclusion set, hide handle/menu/tooltip, retain at most one current local request, and refresh; never place from a partial or last-known set.
- If the connection closes or is replaced, also cancel queued local presentation intent and do not reopen the menu after reconnect.
- If HUD geometry is absent or stale, hide the outline and attached handle rather than guess. Permission/onboarding and geometry recovery may keep only the local menu centered inside the current display, independently of the HUD; once current safe geometry returns, restore attached placement. Exclusion-only unavailability does not make an independently geometry-valid outline interactive; it remains wholly click-through.
- If both right and left handle candidates are unsafe, keep handle presentation queued and hidden until a current matching snapshot or event provides a safe side; do not invent another placement.
- If storage is corrupt, retain valid configuration when separable and return the cycle to idle.
- If the task-time ledger is corrupt, unsupported, or oversized, reject it without broad recovery reads; never extend a recovered active interval beyond its last persisted observation or invent downtime. Storage/export failure leaves Promethee unchanged and surfaces a bounded local error.
- If update verification fails, keep the installed version and show a non-destructive diagnostic.
- If the accepted task database path, identity, schema, lock, bound, or read-only guarantee fails, return no current task snapshot and do not search other tables or paths.
- If the host-wired `sessions` observer fails its exact current compatibility or freshness gates, return unknown and suspend dependent behavior. Observation never becomes command acknowledgement or retry authority.
- New installations initially default automatic Pause enabled and automatic Resume disabled; existing stored preferences remain unchanged. On macOS, first-launch onboarding first preflights bounded screen reading and Input Events independently. After that startup refresh and visible onboarding, the host may automatically invoke the native permission request at most once per process if required; macOS may show Accessibility/register the app, but only the user controls final System Settings toggles. **Check again**, Settings review, and phase transitions never request permission; **Allow** remains the explicit retry. Input Events comes from the native helper. Screen reading requires both helper-reported Screen Recording and a bounded readiness probe through the real `/usr/sbin/screencapture`; the probe image is never retained. The panel stays usable as a centered current-display surface without HUD geometry and returns to attached placement only after mandatory screen reading plus current safe geometry are available. When Screen Recording changes from false to true during a request, one guarded relaunch revokes automation authority, aborts any native control, prevents runtime polls from rescheduling, waits at most 750 ms for queued preference and task-time checkpoints, then invokes `app.relaunch()` and `app.exit(0)`; ordinary quit uses the same bounded flush and `app.exit(0)` without relaunch. After both checks pass the button becomes **Continue**. Once screen reading passes, **Not now** may skip Input Events: it atomically completes onboarding with automatic Pause and Resume both off, exposes passive attached behavior, and prevents recovery or native request from recurring solely for absent timer-control permission on later launches. **Not now** is refused while screen reading is unavailable because the app cannot safely attach to the HUD. Enabling automation later remains explicit. A green check is capability observation, not broader action authority: every action still requires verified screen reading, Input Events, identity, HUD-layout, and freshness gates. Denial or revocation remains fail-closed and is never re-prompted by a phase transition or passive review. A second application launch brings the existing popup forward instead of creating another host. Local ad hoc rebuilds may require regrant. The environment kill switch always overrides both settings. Windows exposes no native Promethee automation and fails closed; it asks for no permission grant, so it never shows this onboarding. Linux carries the same two actions under ADR-0021 where the session offers a capture and an injection mechanism, and shows no onboarding either, because no such session has an operating-system grant to preflight: the two automation settings are the whole of the permission there, the panel says so before the fact, and a session with no mechanism reports the absent protocol rather than a denial. Failure must leave Promethee untouched. A 2026-08-26 native-helper check returned both flags granted (`1,1`), and the second-launch plus `TERM` quit/manual-reopen smoke has local evidence; the Screen Recording grant/relaunch transition still lacks post-build user-run proof.
- Skip focus reuses the same bounded Pause intent and never bypasses its freshness, permission, identity, or one-action/no-retry gates. Skip break is local to the Pomodoro state machine and enters Ready without an OS action.

## Verification requirements

- Contract tests reject unknown fields where security-relevant, invalid enums, out-of-range geometry, stale revisions, replayed IDs, and unsupported versions.
- Platform tests prove each host exclusion is published before interactivity and that Promethee retains z-order/input precedence during delivery latency, so no Pomodoro-owned interactive window covers or intercepts `Accept`.
- Integration tests use a real approved bridge on each target operating system.
- ADR-0012 task-source tests use synthetic `tasks`/`task_projects` fixtures, verify no database/WAL/journal change, and keep live content out of logs and evidence; each platform path/schema needs separate proof.
- ADR-0019 tests use synthetic observations and temporary directories to cover running-only accrual, task switching, disappeared-task snapshots, recovery, deletion, CSV escaping/formula protection, no-session-ID schemas, and deterministic count/byte bounds. They do not establish accounting accuracy or platform data-protection policy.
- ADR-0011/ADR-0013/ADR-0016 automated tests remain fixture-backed. The one authorized macOS 1.3.29 flow above is recorded separately from ordinary validation; every broader macOS, Linux, or Windows exercise still requires separate authorization. The live Linux exercise covers a single Hyprland session, including one authorized Pause and Resume round trip; the Linux placement path is otherwise tested against an injected executor, and the capture and injection slots have answered on nested Sway and X11 sessions against a synthetic client only. Ordinary validation sends no live command and reads no live session rows.
- Security review verifies the preload surface, sender validation, local peer authentication, secret-free logging, and updater trust chain.
- Real UI checks prove Promethee controls remain clickable at every supported HUD size and edge.
- Release compatibility is stated only for combinations actually exercised in the release matrix. The configured macOS arm64/macOS x64/Windows x64/Linux x64 workflows, public npm manifest, and Trusted Publishing job are not runtime, publication, provenance, or platform-support evidence until they execute and are read back. No published package contains a Linux helper, so Linux carries no release-matrix evidence at all.

## Revisit triggers

Review these controls when Promethee changes its bridge, session model, task identifiers, HUD layout, Electron security settings, or release channel; when the companion/embedded packaging decision changes; or when a new storage, telemetry, or updater dependency is proposed.
