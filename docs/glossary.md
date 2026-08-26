# Glossary

**Adapter** — typed client boundary that converts the accepted external bridge providers, or a future official profile, into bounded product observations and operations.

**Bridge** — a narrow, owner-approved Promethee interface for session, task, and HUD capabilities. It is not Promethee's private renderer IPC.

**Native input transport** — the accepted macOS action/geometry portion of the external bridge under ADR-0011/ADR-0016. Active Electron uses a native process/window helper and a target derived from the rendered Pause/Play glyph; CoreGraphics posts at most one macOS click. New installs default automatic Pause on and automatic Resume off, persisted values remain unchanged, and current permission/evidence plus the environment kill switch gate both. Windows V1 is observation-only and has no input transport. No action acknowledges state or retries.

**Passive Windows runtime** — the Windows x64 V1 candidate can locate the Promethee HUD, read only allowlisted task/session observations, render attached local surfaces, and accept manual Pomodoro transitions. It cannot Pause or Resume Promethee automatically and fails closed when required evidence is unavailable.

**Release candidate** — the prepared `promethee-pomodoro@1.0.1` package, helper targets, and configured workflows before verified npm/GitHub publication, registry readback, or platform support claim.

**Read-only task source** — the accepted ADR-0012 main-process contract, with a host-wired synthetic-tested reader, for fixed, bounded queries of only Promethee `tasks` and `task_projects`; it grants no write, session, credential, or arbitrary database authority.

**Session observation** — the accepted point-in-time, non-authoritative timer-state/time view in ADR-0013. It cannot acknowledge/correlate a command or authorize automatic retry.

**Task-time ledger** — ADR-0019's local `task-time-v1.json` reporting record. It opens an interval only for a selected task while the real Promethee session is observed as running, retains task/project snapshots and local interval timestamps, and never persists a Promethee session identifier.

**Stop tracking** — select no task through the typed selection boundary. It closes the current local interval, clears the selected task, and keeps already saved history; it does not stop Promethee.

**Tracked interval** — a locally derived start/end/duration record attributed to one selected task snapshot. Switching tasks or observing a non-running/replaced session closes the current interval; it is reporting data, not a Promethee session event or command acknowledgement.

**Retained task snapshot** — the bounded task ID/title and optional project ID/title stored with a local interval so history remains intelligible when the source task later disappears from Promethee's current list.

**Freelance CSV export** — the explicit user-requested UTF-8/RFC 4180 projection of local task-time history for spreadsheet reporting. It includes UTC interval timestamps and task/project snapshots, excludes Promethee session IDs, and is not an invoice or tamper-evident accounting format.

**History page** — the newest-first bounded projection of 100 task-time entries. **Load older** advances through the retained ledger so any closed entry can be reached and deleted; pagination is not retention.

**Local calendar aggregate** — Today and This week totals computed from the host's local day and Monday-week boundaries. Native local-date arithmetic makes the boundaries daylight-saving-aware; CSV timestamps remain UTC.

**Skip phase** — user action that ends the current Pomodoro phase early. Focus skip reuses the existing bounded Pause authority and gives no completion credit; break skip is local and moves to Ready.

**Adaptive geometry polling** — the HUD scheduler's 16 ms cadence during geometry change/recovery and 100 ms cadence after 750 ms of stability. Window plans are applied only when geometry changes or recovers.

**Capability negotiation** — connection handshake that selects a compatible protocol and explicitly grants supported operations.

**Consume / consuming outline** — progress begins as a complete outline around the real Promethee timer and decreases toward empty as a focus or break phase elapses.

**Neutral break outline** — the gray `#A6A5A3` consuming progress stroke used during breaks, distinct from the orange focus stroke and from Promethee session authority.

**Coordinator** — component that serializes Pomodoro effects with authoritative Promethee observations, acknowledgements, and reconnects.

**Current** — behavior represented by executable repository code and its active project contract.

**HUD** — Promethee's compact on-screen session timer and controls.

**Four-tab menu** — the attached local menu with Context, Tasks, History, and Settings views.

**Local planning contract** — ignored, unpackaged planning material for one reviewable capability. It is not a public runtime dependency or repository link.

**Promethee authority** — rule that Promethee, not the Pomodoro UI or persisted snapshot, decides whether a work session is running, paused, or stopped.

**Ready** — state after a break ends in which the product waits for the user to press Play in Promethee; dismissing the prompt does not resume work.

**Target** — approved designed behavior that is not yet evidence of implementation.

**Vertical proof** — a bounded end-to-end bridge exercise against a recorded Promethee/OS/version combination. The authorized macOS 1.3.29 same-session flow is one platform proof; Windows requires its own exercise.
