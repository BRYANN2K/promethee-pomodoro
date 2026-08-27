---
id: ADR-0020
status: accepted
date: 2026-08-26
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0020: Observe Promethee on Linux through the session window server

## Context and problem

ADR-0016 froze the Windows native helper as observation-only and left Linux with no runtime at all: `bin/promethee-pomodoro.cjs` refused the target, `supportsAttachedRuntime` returned false, and `resolvePrometheeDatabasePath` returned null. Promethee's per-user application-data directory on Linux is `~/.config/Promethee`, which the existing POSIX join already produces without new path logic.

Promethee publishes official builds for macOS and Windows only. A Linux user therefore runs a locally built Promethee rather than a vendor artifact, and this companion cannot assume any vendor-defined Linux identity. What it can rely on is that the Electron app is portable and keeps its application name, so the application-data directory is unchanged and the window class is that same application name, reported as the Wayland app_id and as the X11 class whatever the executable file is called. The helper matches the window class `promethee` and never reads a window title, so it depends neither on a local build's window naming nor on how the build names its binary.

The blocking difference is window discovery. The macOS helper enumerates windows through CoreGraphics and the Windows helper through `EnumWindows`; both are global window lists that any process may read. Linux has no single equivalent. A native Wayland client cannot enumerate or measure another client's windows at all, so an X11-only helper would observe nothing on a Wayland session and report a false negative rather than a failure.

## Decision

Linux x64 SHALL be a passive target with the same authority as Windows: attachment and observation, and no action transport.

The native helper answers the frozen `self-test` / `pid` / `windows` contract and reports `ready,1,observe-only`. That receipt describes the helper's authority over Promethee, which is unchanged: read the windows, act on none of them. It resolves Promethee's windows through the session's own window server, trying in this fixed order:

- Hyprland, over the IPC socket named by `$HYPRLAND_INSTANCE_SIGNATURE`, request `j/clients`;
- Sway or i3, over `$SWAYSOCK`, `GET_TREE`; and
- any X11 display, over `$DISPLAY`, using `XQueryTree` with `XGetClassHint` and `_NET_WM_PID`.

A session that advertises a compositor the helper cannot reach returns a typed error. It does not fall through to a later backend, because the next backend would answer for a different display and silently attach the companion to windows belonging to another session. Ambiguity is a failure: as on Windows, `pid` resolves only when exactly one distinct owning process identifier survives, and returns `process-ambiguous` otherwise.

`supportsNativeAutomation` remains false on Linux. No Pause, Resume, click, permission request, or input path is added, and none of ADR-0011's or ADR-0016's action authority extends here.

Linux SHALL also gain one command the other platforms have no use for. Wayland lets a client ask for a size and never for a position, so the companion's own outline, handle, and menu cannot be put on the HUD from inside the app. The helper's `attach` command asks the compositor to place them, over the same socket the geometry is read from, on Hyprland and on Sway/i3. X11 needs no such command, because there a window places itself.

The boundary of that command is the process that spawned the helper. `attach` names a window only when the compositor reports the helper's own parent process as the window's owner, so its whole reach is the app that asked. It never synthesises input, never touches another application's windows, and Promethee's windows remain read-only on this path as on every other. What it asks for is float, pin, a position, and, for the outline alone, that the window not be a candidate for the pointer.

A compositor that cannot grant that last ask SHALL be told to place nothing rather than place the outline anyway. An outline the pointer cannot pass through sits on top of the real pill and takes Promethee's own drag and Play/Pause with it, which is worse than no outline at all. The helper refuses those surfaces and says so in its receipt, and the app takes them down for the rest of the session. Sway is such a compositor today.

The surfaces SHALL stay off screen until the compositor has confirmed the placement. Under Wayland a window is on screen where the compositor dropped it before it is on screen where the plan wanted it, so showing one as soon as its bounds are set shows it in the wrong place first. When the compositor has been asked as often as it is going to be and still has not answered, the surfaces are shown where they are: hiding them for good would take the menu, and with it every control the companion has, rather than only its position.

## Platform and evidence boundary

The helper was built with the repository's own `target:build:native` and exercised against a live Hyprland session running a locally built Promethee 1.3.x as a native Wayland client, reported by the compositor as class `promethee` with `xwayland: false`. `pid` resolved the single real Promethee process, and `windows` reported a rectangle matching `hyprctl clients` exactly. `self-test` and the invalid-command exit path behaved as specified.

The companion was then run against a live Promethee session on that same compositor. It observed the running HUD, reported Promethee as connected, and drew its consuming outline around the real pill at the real width. That is HUD attachment observed end to end on one Linux session.

The X11 backend was exercised separately, on its own display, against a synthetic client that declares `WM_CLASS` `promethee` and `_NET_WM_PID` at a chosen size and position. `pid` and `windows` both returned what had been asked of the X server. This proves the tree walk, the class match, the process read, and the coordinate translation; it does not prove the backend against a real Promethee, which no longer runs under plain X11 here.

That is the whole of the live evidence. The Sway/i3 backend has never met a real Sway session; what it has met is described below. Nothing here proves behavior against a future official Linux build, whose window class and packaging are not knowable today, and nothing proves release-tarball installation, since no Linux release has been published.

Under Wayland a client also cannot place its own windows at absolute coordinates. On the first exercise all three surfaces were mapped and correct in size, and every one of them was left where the compositor chose rather than where the app asked. The `attach` command was then exercised on that same Hyprland session, which runs the Lua configuration provider: the outline, the handle, and the menu were floated, pinned, and moved onto the real HUD, and they followed it as it moved, with no compositor configuration present for this app. On a cold start the first requests named windows the compositor had not mapped yet and placed none of them, which is why the request is repeated until the compositor answers for every surface it was given.

The pointer reaching the pill through the outline was then measured rather than assumed, because it is the one part of placement whose effect the app cannot see for itself. On Hyprland 0.55.0, commit `af923e30d1d24f1f4a4f5cb8308065173c1d9539`, with a 145x32 HUD at 1360,228 and the outline covering it at 1359,226 149x36, the session pointer was driven to the centre of the real Pause button through `zwlr_virtual_pointer_v1` and the button's own 28x28 area was captured. The reading is the button's rendered hover state, not the compositor's idea of focus, because the HUD changing its own pixels is the only proof the event was delivered to it:

- with the outline's `no_focus` property set, 2276 and 2304 of 2352 bytes moved, maximum channel delta 42 and 40, on two separate runs: the HUD rendered the hover;
- with the property cleared, 0 of 2352 bytes moved on two separate runs: the pointer stopped at the outline;
- between every leg the pointer was parked away from the HUD and the same area captured, and those control captures were byte-identical, so the button does not drift on its own.

The legs were run in both orders and the result did not depend on the order. Electron's own request to be invisible to the mouse was in force throughout, in every leg, so on this compositor that request alone does not carry the pointer through and the property is what does. Window focus was tried first as the readout and discarded: `input:follow_mouse` does not reliably move focus onto these pinned floating surfaces, and `hyprctl clients` reports `acceptsInput` as true whether the property is set or not, so neither reading says anything about where the pointer went.

The Sway placement path was exercised against a stand-in that speaks the i3 IPC protocol and answers `GET_TREE` with windows owned by the helper's own parent, because no real Sway session was available here. Asked to place an outline and a handle, it issued the `floating enable, sticky enable, move absolute position` command for the handle alone, issued nothing at all for the outline, and answered `attach-opaque,1,2`. Asked for the same two with the outline taken down, it placed the handle and answered `attached,1,1`. This proves the refusal, the command it builds, and the receipt the app reads. It does not prove the backend against a real Sway, whose tree payload and command results are taken on the protocol's word here.

What the app does when placement never happens at all was exercised live, against a stand-in helper that answers every `attach` with `attached,0,N`, standing for a compositor that maps the windows and places none of them. The app asked ten times, stopped, and reported `{detached: true, opaque: false, settled: true}`. `hyprctl clients` then listed the handle and the menu and no outline at all, and the two surfaces it did list sat in the middle of the screen rather than beside the HUD, which is what an unplaced surface looks like. The outline is down, the controls are up, and the app can tell a placement from a surrender.

That evidence covers one dialect of one compositor for the property test, and it is an observed effect of that build rather than anything the Wayland protocol or Hyprland's own documentation promises. Hyprland's legacy configuration parser takes the same dispatchers under different spellings and that spelling has not been exercised live. Where geometry is unsafe rather than merely unplaced, the surfaces fail closed and hide, exactly as they do on any other platform.

## Rationale

Reusing the existing helper contract keeps one shape across three platforms and adds no new authority, settings, or user-visible feature. Compositor IPC is the only source of another client's geometry under Wayland, so a helper that speaks it is not an optimization but the requirement. Trying backends in a fixed order, and refusing to fall through after an advertised compositor fails, keeps a misconfigured session from attaching to the wrong display.

Restricting the target to x64 matches what CI can build and verify. An arm64 path would resolve to a binary nothing builds.

Linux stays out of the release. The maintainer's call is that a target with one session of live evidence, one exercised backend out of three, and no automation does not belong in a published package yet. CI still builds the helper and runs its `self-test` on every push, so the code path cannot rot silently, but the npm artifact carries macOS and Windows helpers only and Linux runs from a source checkout.

## Consequences

### Positive

- Linux users get the same passive companion as Windows with no new feature surface and no new permission model.
- The companion attaches to the HUD on a Wayland session out of the box, with no compositor configuration to write and no second process to run.
- Window discovery works on native Wayland sessions, where an X11-only helper would report nothing.
- Path, database, and CLI support required no new logic beyond allowing the platform.

### Negative

- Three backends mean three code paths, only one of which has live evidence.
- Placement under Wayland is asked for rather than declared, so a compositor the helper does not speak to leaves the surfaces where it chose, and on Sway the pill goes uncircled because the outline there is taken down rather than left in the way of the pointer.
- A compositor that maps the surfaces and never places them leaves the handle and the menu adrift, in the middle of the screen rather than beside the HUD. They are shown anyway, because hiding them too would leave the app with no control at all and no way to quit: it has no tray icon to fall back on. The outline is the one surface held back there, because a ring drawn away from the pill circles nothing and points at the wrong thing.
- The compositor protocols are not versioned contracts; a Hyprland or Sway IPC change can break discovery, and now placement with it. Hyprland already answers two configuration dialects, which the helper has to tell apart at run time.
- Placement is asked for again whenever the plan changes, which is one more helper call on a moving HUD than observation alone required.

### Neutral

- Building from source needs a C++20 compiler and the X11 development headers.
- The CI workflow gains a `linux-x64` matrix entry. The release workflow does not, so there is no published Linux artifact to install, smoke, or verify.
- Linux users install from a source checkout rather than from npm, which means `npm ci` plus a build rather than one install command.

## Validation

- Synthetic tests cover the Linux database path, the attached-but-not-automated runtime declaration, the helper path resolution including the rejected `linux-arm64` case, and the CLI target allowlist.
- Synthetic tests also cover the placement request: which surfaces it names, the refusal of a request that cannot be stated exactly, the platform gate, the one-call-per-unchanged-placement rule, coalescing while the helper is still answering, the bounded retry of a placement the compositor did not carry out in full, and the latch that stops asking a session with no compositor to ask.
- Synthetic tests cover what the app is allowed to show: the permission withheld until the compositor has confirmed the placement, taken away when the surfaces come down, granted at once on a session with no compositor to ask, granted rather than withheld forever when the compositor will not answer, latched on a refusal so the same surfaces are not asked for again, and a refusal receipt that does not match the request read as a partial placement rather than a refusal.
- Synthetic tests cover the surrender itself: a permission granted once the asking is over says so, so the app can keep down the surfaces that are only a position, and that answer is cleared by the next plan rather than standing for the session the way a refusal of input transparency does.
- CI builds the helper on `ubuntu-24.04` and asserts the `ready,1,observe-only` receipt. The release verifier does not look for a Linux helper, because the release never produces one.
- The Hyprland, attachment, X11, and stand-in Sway exercises above are recorded separately from ordinary validation and are bounded to the sessions described.

## Revisit triggers

- Promethee publishes an official Linux build, which would fix a vendor window class and packaging identity in place of the current application-name assumption.
- The Hyprland or Sway/i3 IPC payloads change shape, or another compositor becomes a required target.
- A live exercise reaches a real Sway or i3 session rather than the stand-in, or Hyprland's legacy configuration parser, or reaches the X11 backend against a real Promethee rather than a synthetic client.
- Sway gains a per-window way to take a box out of the running for the pointer, which would let the outline be drawn there instead of taken down.
- Wayland gains a supported way for a client to position its own toplevels, which would remove the compositor round trip entirely.
- A Hyprland release changes what the `no_focus` property does to pointer delivery, which the measurement above would no longer describe.
- Linux x64 accumulates enough live evidence across compositors to earn a place in the release, tarball, and smoke matrices.
- Linux arm64 becomes buildable and verifiable in the release workflow.

## Related decisions and evidence

- Extends the observation-only helper boundary of [ADR-0016](0016-use-native-input-helpers-for-the-external-action-bridge.md) to a third platform without extending its action authority.
- Leaves the three published targets of [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) untouched; the unsigned artifact and update/rollback model is unchanged, and Linux is not a release channel target.
- Preserves [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md), [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md), [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md), and [ADR-0014](0014-compose-the-external-promethee-bridge.md).
- Implemented by: the Linux observation-only helper, the platform-gated runtime, the CI matrix entry, and synthetic tests.
