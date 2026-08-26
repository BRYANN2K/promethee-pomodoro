# Proposed Promethee bridge contract

**Status:** Proposed reference. Promethee 1.3.26 does not expose this as a public third-party API.

ADR-0014 now governs the companion's external bridge. This document remains the preferred future Promethee-owned profile for authoritative events, acknowledgements, HUD geometry, and host exclusions. Do not attribute these stronger semantics to the external profile, which composes ADR-0011/ADR-0012/ADR-0013 and exposes freshness/unknown/indeterminate outcomes.

This document defines the minimum contract Promethee Pomodoro needs from Promethee. It is transport-neutral: an in-process module can call the same service boundary directly, while a companion application needs an authenticated local transport. Names below describe semantics and are not authorization to call Promethee's private IPC channels.

## Handshake

Every connection starts with a negotiation request:

```text
ClientHello {
  client: "promethee-pomodoro"
  clientVersion: semantic version
  supportedProtocolVersions: [integer]
  requestedCapabilities: [capability name]
  requestedOperations: [operation name]
  nonce: unique connection value
}

BridgeHello {
  prometheeVersion: semantic version
  protocolVersion: selected integer
  grantedCapabilities: [capability name]
  grantedOperations: [operation name]
  connectionId: opaque identifier
}
```

The client enables only capabilities listed in `grantedCapabilities` and may invoke a mutating operation only when that exact operation appears in `grantedOperations`. A broad `session.control` grant is invalid. It rejects malformed payloads, an unoffered protocol, an unsupported Promethee version, a mismatched connection, and replayed acknowledgements. A companion transport must authenticate the local peer and bind authorization to the connection.

## Capabilities

| Capability or operation grant | Purpose |
| --- | --- |
| `session.read` | Read active session identity and running/paused state. |
| `session.events` | Subscribe to authoritative session changes and completion. |
| `session.pause` | Request pause for the matching active session. This mutating operation is granted independently. |
| `session.resume` | Request resume for the matching paused session. This mutating operation is granted independently and is optional. |
| `tasks.read` | List eligible tasks and resolve the selected stable identifier. |
| `tasks.events` | Subscribe to task creation, update, completion, and deletion. |
| `hud.read` | Read HUD placement, mode, visibility, and current control layout. |
| `hud.geometry` | Read verified bounds of the real timer pill in the declared screen-coordinate unit. |
| `hud.events` | Subscribe to geometry, placement, mode, visibility, and drag changes. |
| `hud.reserve-space` | Request bounded extra pill content width when first-party integration requires it. |
| `hud.exclusions.read` | Read authoritative host-owned Tasks and transient exclusion rectangles tied to current HUD layout. |
| `hud.exclusions.events` | Subscribe to ordered `hud.exclusions.changed` events. |
| `hud.surface.read` | Read a Promethee-owned Tasks-slot lifecycle when the host exposes one; not required for the local Pomodoro handle/menu. |
| `hud.surface.events` | Subscribe to Promethee-owned Tasks-slot lifecycle events; not a local menu invocation channel. |
| `hud.surface.release` | Host-owned Tasks-slot release/focus-return operation. The local Pomodoro handle/menu never requests or calls it. |

The safe v1 **session** mutation allowlist contains only `session.pause` and, when separately reviewed and granted, `session.resume`. It MUST NOT expose or call `session.start`, `session.stop`, or `session.end`. Started, stopped, completed, and replaced sessions are observed through reads and events only. A host-scoped `hud.surface.release` affects only the Promethee-owned Tasks slot, implies no session authority, and is never granted to or called by the local handle/menu path.

The consuming outline requires current `hud.geometry`. The interactive local handle, menu, and tooltip additionally require continuous, completely validated `hud.exclusions.read` and `hud.exclusions.events` data. If exclusions are absent, invalid, stale, mismatched, or gapped, every local interactive window stays hidden; at most one already-current local menu request may remain queued until a complete matching snapshot is live. Disconnect or connection replacement also cancels that request and queued handle presentation. The outline remains wholly input-transparent and is governed independently by current HUD geometry; exclusion unavailability never makes it a fallback trigger.

The first vertical proof must receive `session.read`, `session.events`, `session.pause`, `tasks.read`, `tasks.events`, `hud.read`, `hud.geometry`, and `hud.events`. If `session.resume` is shipped, the proof must exercise that grant separately. Missing optional capabilities disable only their dependent presentation; missing `hud.geometry` blocks the attached outline.

When the interactive handle/menu is included in a proof, it must additionally receive `hud.exclusions.read` and `hud.exclusions.events`. The local keyboard fallback dispatches the same local serialized action and does not require `hud.surface.request`.

## Commands

Every mutating command carries a unique `commandId`, expected `connectionId`, and the expected session or surface revision required by that operation. The bridge returns an acknowledgement that includes the same command identifier and the resulting authoritative state or a typed error.

| Command | Required input | Success result |
| --- | --- | --- |
| `session.getActive` | None | Active session or `null`, including stable ID, state, task link, start time, revision, and snapshot cursor. |
| `session.pause` | Active session ID and expected revision | Same session in paused state. |
| `session.resume` | Active session ID and expected revision | Same session in running state. |
| `tasks.list` | Eligibility filter and page cursor | Bounded page of stable task summaries plus snapshot cursor. |
| `hud.getState` | None | Visibility, screen, verified timer rectangle, placement, mode, layout revision, and snapshot cursor. |
| `hud.setReservedExtraWidth` | Non-negative bounded pixels | Applied width and new layout revision. |
| `hud.getExclusions` | None | Exact `HudExclusionsSnapshotV1` containing a bounded `exclusions[]` and coherent set/HUD/layout revisions plus snapshot watermark. |
| `hud.getSurfaceState` | None | Optional Promethee-owned Tasks-slot state and snapshot cursor; never assigns local Pomodoro-menu ownership. |
| `hud.releaseSurface` | Current Promethee-owned Tasks surface revision plus optional or `null` opaque focus-return token | Host-owned release only; never used to close the local handle or menu. |

Calling pause on an already paused matching session or resume on an already running matching session returns the observed state without creating a second transition. A stale session ID or revision returns a conflict and the current state for reconciliation.

`session.start`, `session.stop`, and `session.end` are not v1 commands. The bridge rejects them as unsupported even if analogous private Promethee handlers exist. A Ready action may request work only after a later reviewed contract explicitly grants a suitable start or resume operation for that action; otherwise Ready tells the user to press the real Promethee Play control.

## HUD exclusion schema v1

This proposed extension is not implemented by the current adapter spike. When approved, `hud.getExclusions` returns this exact-key value; extra or missing keys are invalid.

```text
HudExclusionsSnapshotV1 {
  schemaVersion: 1
  connectionId: string
  atSequence: non-negative safe integer
  value: HudExclusionsReadModelV1
}

HudExclusionsReadModelV1 {
  revision: non-negative safe integer
  hudRevision: non-negative safe integer
  layoutRevision: non-negative safe integer
  coordinateSpace: "electron-dip"
  exclusions: HudExclusionV1[0..64]
}

HudExclusionV1 {
  surfaceId: string
  surfaceRevision: non-negative safe integer
  layoutRevision: non-negative safe integer
  displayId: string
  role: "tasks" | "reward" | "overtime" | "other-transient"
  bounds: { x: number, y: number, width: number, height: number }
}
```

`surfaceId` and `displayId` are non-empty opaque strings of at most 160 characters. Array `surfaceId` values are unique and an ID is never reused for a different surface within one connection. Coordinates are finite with absolute magnitude at most 1,000,000; dimensions are finite, greater than zero, at most 1,000,000, and their edge addition must remain finite and inside the protocol's numeric bounds. Array order has no meaning.

`revision` identifies the complete exclusion set. `hudRevision` equals the current `HudReadModel.revision`. `layoutRevision`, every entry's `layoutRevision`, `coordinateSpace`, and each entry's display identity must agree with the current non-null `HudGeometry` used for placement. `atSequence` is the shared connection-scoped bridge event watermark: the value includes every exclusion change at or below it, while the client still consumes all event families contiguously after it. A new set change strictly increases `revision`; an update or removal for an existing surface strictly increases its `surfaceRevision`. Equal revisions are valid only when the compared value is deeply identical. Regression, equal-revision conflict, a duplicate ID, an unknown role/key, invalid bounds, or a HUD/layout/display/watermark mismatch rejects the complete snapshot; the client never salvages a subset.

The exact `hud.exclusions.changed` envelope uses the common event keys `schemaVersion`, `connectionId`, `sequence`, `occurredAtMs`, `type`, and `payload`. `type` is `hud.exclusions.changed`. Its payload has exactly `revision`, `hudRevision`, `layoutRevision`, `coordinateSpace`, and `change`, where `change` is exactly one of:

```text
{ kind: "upsert", exclusion: HudExclusionV1 }
{ kind: "remove", surfaceId: string, surfaceRevision: non-negative safe integer }
{ kind: "refresh-required" }
```

An upsert or removal applies only when the event sequence is the next contiguous sequence, its resulting set revision is newer, its HUD/layout/coordinate values match current geometry, and its surface revision is newer than the cached entry. `refresh-required`, any gap, or any schema/coherence failure hides local interactive windows and requires a complete snapshot; it does not authorize applying a partial delta or reusing last-known rectangles.

### Interactive host-surface ordering

Promethee commits and publishes the complete exclusion upsert before the corresponding Tasks, reward, overtime, or other transient surface becomes visible or hit-testable. Since publication and client application are asynchronous, the Promethee-owned interactive window also retains z-order and input precedence over every Pomodoro-owned interactive window from its first possible interactive frame until it is no longer visible or hit-testable. Removal is published only after that point. A platform or integration shape that cannot prove this precedence does not grant the local interactive handle/menu capability. Thus a delayed exclusion cannot create an interval in which a local handle, menu, or tooltip covers or intercepts `Accept`.

## Events

Events have a monotonically ordered sequence within a connection, a schema version, and a stable entity revision:

- `session.changed` — started, running, paused, resumed, stopped, or completed.
- `tasks.changed` — task upsert, completion, deletion, or a refresh-required marker.
- `hud.changed` — visibility, rectangle, screen, placement, mode, or layout revision.
- `hud.exclusions.changed` — exact-key authoritative upsert, removal, or refresh-required variant with the resulting set/HUD/layout revisions and per-entry stable `surfaceId`/monotonic `surfaceRevision` where applicable.
- `hud.surface.changed` — optional Promethee-owned Tasks-slot lifecycle event. It never grants local Pomodoro-menu ownership.
- `bridge.closing` — Promethee is shutting down or revoking the connection.

Stopped, completed, and replaced session events are observation-only. They return the Pomodoro coordinator to idle and invalidate pending commands; they never authorize Pomodoro to call start, stop, or end.

## Snapshot and event continuity

Every authoritative snapshot, including HUD exclusions and any negotiated host surface state, includes `atSequence`, the last event sequence reflected in that snapshot. The implementation MUST close the race between subscribing and reading a snapshot by using one of these equivalent patterns:

1. Establish the event subscription and buffer events before requesting the snapshot, then discard buffered events at or below `atSequence` and apply the remaining contiguous sequence.
2. Create the snapshot at `atSequence` and atomically establish delivery beginning at `atSequence + 1`.

The client does not mark session, task, HUD geometry, or HUD exclusions live until it has a snapshot plus a contiguous event cursor. After a sequence gap or reconnect, it repeats the bootstrap and performs full `session.getActive`, `tasks.list`, `hud.getState`, `hud.getExclusions`, and, only for a negotiated host-owned Tasks lifecycle, `hud.getSurfaceState` refreshes before applying later events.

Each exclusion is valid only for its current connection and coherent complete set revision/watermark, matching HUD/layout revision, current per-entry surface revision, display identity, and declared coordinate unit. The local placement solver avoids the real HUD and every current exclusion. A reward or overtime exclusion below forces the measured menu above when safe; if neither vertical menu side is safe, the serialized local surface controller keeps one request queued and the menu hidden. If neither horizontal handle side is safe, it queues handle presentation and hides handle, menu, and tooltip without top/bottom fallback, unsafe clamping, last-known geometry, or guessed placement. A current matching snapshot or event may reveal the handle at the first deterministic safe horizontal side. Escape or deactivation cancels a menu request. Disconnect cancels all presentation intent and hides local interactive windows rather than reopening the menu after reconnect.

The local handle/menu focus lifecycle is local and carries no host focus token. If Promethee separately exposes `hud.releaseSurface` for its own Tasks slot, a current authorized host release succeeds whether `focusReturnToken` is omitted, `null`, invalid, expired, or unresolved; only host focus restoration is suppressed. The local client never receives, stores, interprets, or sends that token.

## Errors

| Code | Meaning | Client behavior |
| --- | --- | --- |
| `UNAUTHORIZED` | Peer identity or operation is not allowed. | Disable integration; do not retry silently. |
| `UNSUPPORTED_PROTOCOL` | No compatible protocol version. | Fail closed and show compatibility guidance. |
| `CAPABILITY_UNAVAILABLE` | A required read or event capability is unavailable. | Disable the dependent feature. |
| `OPERATION_NOT_GRANTED` | The exact requested mutation was not granted. | Do not invoke it; keep Promethee under its real controls. |
| `INVALID_ARGUMENT` | Payload or bounds failed validation. | Treat as implementation error; do not retry unchanged. |
| `INVALID_PAYLOAD` | Snapshot/event keys, bounds, revisions, watermark, or cross-field coherence are invalid. | Reject the complete value, hide dependent local windows, and request a fresh authoritative snapshot when retryable. |
| `NO_ACTIVE_SESSION` | Session command has no current target. | Reconcile to idle. |
| `CONFLICT` | Session ID or revision is stale. | Apply returned state and reevaluate intent. |
| `TIMEOUT` | Outcome is not known within the command deadline. | Query authoritative state before retrying. |
| `INTERNAL` | Promethee could not complete an allowed operation. | Preserve user control and report a bounded diagnostic. |

## Security properties

- The bridge allowlists operations; it does not expose arbitrary channel names, SQL, filesystem paths, or code evaluation.
- Session mutation authorization is operation-level; possession of read or event capability never implies pause or resume authority.
- The safe v1 bridge exposes no start, stop, or end mutation.
- Inputs and outputs are schema validated on both sides.
- A renderer cannot access the bridge directly; a narrow, context-isolated preload contract mediates requests.
- The bridge client never opens Promethee's database, reads credentials, or copies an authenticated Supabase session. The separate ADR-0012 task provider may read only `tasks` and `task_projects` under its own fixed-query contract.
- Connection identity, nonce, and authorization prevent an unrelated local process from controlling a session.
- Diagnostics exclude tokens and minimize task content.
- Revocation or disconnect immediately removes control capability, hides the local handle/menu, cancels queued local surface intent, and clears current geometry/exclusions; it does not synthesize a session state or reopen the menu after reconnect.

## Compatibility policy

Protocol compatibility and Promethee application compatibility are distinct. A recognized protocol does not override a known incompatible Promethee version. The supported matrix is release data, covered by tests, and defaults to deny for unknown combinations. Any change to operation grants, commands, payloads, security, snapshot cursor semantics, or event ordering requires a protocol review and may require a new protocol version.

## Evidence boundary

Promethee 1.3.26 private API analysis confirms analogous internal session, task, HUD placement, and HUD mode services exist, with isolated renderer security and origin-guarded IPC. It does **not** verify exact real-timer pill bounds or authoritative Tasks/reward/overtime exclusion rectangles. `hud.geometry` and `hud.exclusions.*` therefore remain mandatory unproven capabilities for this future official profile rather than inferred parts of `hud.read`. Promethee 1.3.29 has not received source/runtime proof for that profile. A separate sanitized 1.3.29 SQLite investigation supports the accepted external observer in ADR-0013, but its lack of revision, event cursor, and acknowledgement means it is not proof of these stronger official semantics. The exclusion extension still requires an authorized source map and platform proof. This future profile is complete only after its owner approves it and its grants, cursor bootstrap, exact HUD geometry, exclusions, and required flows pass on macOS and Windows.
