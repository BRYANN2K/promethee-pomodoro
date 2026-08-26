# Promethee visual calibration

**Status:** Target design reference; not implementation evidence

**Calibrated:** 2026-08-25
**Scope:** Promethee timer HUD, Pomodoro outline, Tasks attachment, and proposed Pomodoro menu

This document converts the supplied Promethee screenshots into implementation values. The Pomodoro layer must look attached to the real Promethee HUD, not like a second timer.

## Evidence and confidence

Values use three confidence labels:

- **Measured** — read from the supplied live crop or explicitly sampled from it; allow ±1 px or small color variation from antialiasing.
- **Estimated** — inferred from a screenshot whose display scale or capture provenance is not fully known; use the stated tolerance.
- **Proposed** — an implementation decision made to complete the system where no real reference exists; verify visually before acceptance.

Reference priority:

1. The 160×48 live running crop is the dimensional and neutral-color authority.
2. The 229×63 paused crop is the paused-width authority.
3. The Tasks composition is the attachment, density, and panel-size reference.
4. The large active screenshot supports long-duration width estimates.
5. Earlier outlined pause and break review captures showed intended outline/readout relationships, but their large synthetic timer was not a real-HUD size reference.

Static screenshots provide no measured animation timing. Every motion value below is either retained historical calibration or labelled as a proposed target.

## Aesthetic identity

The interface combines a compact high-performance HUD with a dark, low-depth desktop surface.

| Dimension | Implementable direction | Confidence |
|---|---|---|
| Palette | Neutral surfaces from `#252525` to `#5C5C5C`; primary text near `#E9E9E9`; one warm phase accent | Measured / specified |
| Type | Compact sans-serif UI text; monospaced or tabular timer numerals; modest weight contrast | Estimated |
| Texture | Matte fills, 1 px borders, no visible grain, blur limited to detached panels | Measured / proposed |
| Shape | Fully rounded 32 px timer capsule; circular controls; 18 px Tasks panel radius | Measured / estimated |
| Motion | Immediate geometry tracking, short state morphs, linear time consumption, no bounce | Proposed |
| Spatial convention | Dense 4 px HUD gaps, 6 px attachment gap, 10 px screen safety margin | Measured / estimated |
| Cultural markers | Promethee's existing session icon, Play/Pause/Stop, XP orange, and attached Tasks hierarchy; no tomato or generic Pomodoro motif | Measured / proposed |

Non-negotiables:

- The real Promethee timer remains the only timer surface and the only Play/Pause control.
- The progress path surrounds the current real bounds; it is never a second capsule beside them.
- Surface density stays close to the 32 px HUD height and 36 px task-row rhythm.
- Orange is a functional focus/XP signal, not decorative ambient color.

## Coordinate model

All dimensions below are Electron device-independent CSS pixels. The host must consume authoritative Promethee HUD bounds and display scale rather than infer them from a screenshot.

- Snap the HUD rectangle and outline path to the target display pixel grid before rendering.
- Recalculate from live bounds after every move, resize, pause-state width change, display change, and scale-factor change.
- Never stretch an SVG created for one width to another width.
- Hide the outline when geometry is missing, stale, invalid, or off-display.

## Real timer geometry

### Outer capsule

| State | Width | Height | Radius | Confidence |
|---|---:|---:|---:|---|
| Running, synthetic review fixture | `144px` | `32px` | `16px` | Reviewed synthetic fixture |
| Running, Promethee 1.3.29 authorized live flow | `159px` | `32px` | `16px` | Live macOS observation, 2026-08-25 |
| Paused, synthetic review fixture | `173px` | `32px` | `16px` | Reviewed synthetic fixture |
| Paused, Promethee 1.3.29 authorized live flow | `191px` | `32px` | `16px` | Live macOS observation, 2026-08-25 |

The width is content-driven. `144px` and `173px` are calibration fixtures, not hard-coded universal widths. The `159px` and `191px` measurements prove only the recorded Promethee 1.3.29 macOS flow. Longer durations, localization, display settings, or future Promethee controls must be followed from actual native-helper geometry.

The paused `MM:SS` state adds approximately `29px` over the running `MM:SS` state. That delta corresponds to one additional circular control plus its compact gap.

### Internal HUD rhythm

| Token | Value | Confidence |
|---|---:|---|
| Outer capsule horizontal inset | `4px` | Estimated, ±1 px |
| Session display height | `24px` | Estimated, ±1 px |
| Session display radius | `12px` | Estimated |
| Circular action size | `27px × 27px` | Estimated, ±1 px |
| Circular action radius | `13.5px` | Derived |
| Gap between HUD regions | `3px–4px` | Estimated |
| Session icon box | `11px × 11px` | Estimated, ±1 px |
| Action icon box | `10px–12px` | Estimated, ±1 px |

Do not recreate these internal regions in the production overlay. They are calibration fixtures for the HTML review artifact; production renders only around the real HUD.

## Pomodoro outline geometry

The production outline is one rounded-rectangle path derived from the real HUD rectangle.

```text
outlineBounds.x      = hudBounds.x - 2px
outlineBounds.y      = hudBounds.y - 2px
outlineBounds.width  = hudBounds.width + 4px
outlineBounds.height = hudBounds.height + 4px
outlineRadius        = hudBounds.height / 2 + 2px
```

For the measured running fixture, the outline visual bounds are therefore `148px × 36px` with an `18px` radius. For the measured paused fixture, they are `177px × 36px` with the same `18px` radius.

| Outline token | Value | Confidence |
|---|---:|---|
| HUD-to-path outset | `2px` on every side | Estimated from outlined captures, ±0.5 px |
| Track stroke | `1px` | Proposed from observed border weight |
| Progress stroke | `1.5px` | Proposed from outlined captures, ±0.5 px |
| Stroke line cap | `round` | Measured visually |
| Endpoint dot radius | `1.5px` | Estimated, ±0.5 px |
| Input behavior | `pointer-events: none` across the complete outline window | Required |

Path construction:

- Use a rounded rectangle whose path begins after the top-left radius on the top edge, approximately `18px` from its left visual bound.
- Normalize the path to `pathLength="1"`.
- Set visible progress to the clamped remaining ratio: `stroke-dasharray: remaining (1 - remaining)` and update dash offset only if the chosen consumption direction requires it.
- Focus and break both begin at a full perimeter and consume toward zero.
- A paused focus freezes the ratio. A running break continues from its wall-clock deadline while Promethee stays paused.
- Rebuild the rounded path when HUD width changes. Do not scale a fixed `144px` or `328px` path.

The track may stay visible below consumed progress at low opacity, but it must not resemble a second full-strength timer border.

## Palette

### Live neutral tokens

These values were sampled from the live running crop. Antialiasing can introduce adjacent shades, so compare flat interior pixels rather than edges.

| Token | Value | Role | Confidence |
|---|---|---|---|
| `--promethee-host-background` | `#252525` | Surrounding host background in live crop | Measured, antialias tolerance |
| `--promethee-capsule` | `#353535` | Main HUD capsule fill | Measured, antialias tolerance |
| `--promethee-border` | `#484848` | 1 px capsule and region border | Measured, antialias tolerance |
| `--promethee-action` | `#5C5C5C` | Circular action fill | Measured, antialias tolerance |
| `--promethee-primary` | `#E9E9E9` | Primary icon and timer text | Measured, antialias tolerance |

The approximate contrast of `#E9E9E9` on `#353535` is greater than `9:1`; verify the final composited surface rather than relying on this token calculation alone.

### Phase tokens

| Token | Value | Role | Confidence |
|---|---|---|---|
| `--focus-progress` | `#DB8057` | Focus outline and intentional Pomodoro emphasis | Approved project token |
| `--focus-track` | `rgba(219, 128, 87, 0.12)` | Consumed focus track | Proposed |
| `--break-progress` | `#A6A5A3` | Break outline | Approved project token |
| `--break-track` | `rgba(166, 165, 163, 0.12)` | Consumed break track | Proposed |
| `--break-label` | `#CC794F` | Break label border/text and Ready-phase emphasis | Approved project token |

Keep `#A6A5A3` on the consuming outline and `#CC794F` on the compact `BREAK 05:00` label. Do not turn the complete break outline orange. Approximate token contrast against `#252525` is above `5:1` for both focus and break progress; verify at the final 1–1.5 px stroke thickness because thin-stroke perception is weaker than text contrast.

### Attached surface tokens

The Tasks values are estimated from the supplied composition and should be verified against a direct live crop before being promoted to measured tokens.

| Token | Value | Confidence |
|---|---|---|
| `--panel-fill` | `rgba(24, 25, 25, 0.97)` | Estimated |
| `--panel-border` | `#3B3D3D` | Estimated, ± one sampled shade |
| `--panel-selected` | `#2B2D2D` | Estimated |
| `--panel-primary` | `#F1F1F1` | Estimated |
| `--panel-secondary` | `#999999` | Estimated |
| `--panel-tertiary` | `#737373` | Estimated |
| `--panel-accent` | `#DB8057` | Approved project token |
| `--panel-shadow` | `0 10px 28px rgba(0, 0, 0, 0.30)` | Proposed upper bound |
| `--panel-backdrop` | `blur(12px) saturate(110%)` | Proposed; omit when the host surface is already opaque |

## Full-app menu and settings calibration

This section derives the Pomodoro menu and settings surface from the supplied `2422px × 1914px` full-app Promethee screenshot. The screenshot shows Home rather than Settings, so app-shell and component tokens are observed while menu/settings composition values remain proposed applications of that system.

### Sampling method and caveats

- Source coordinates below use the screenshot's physical pixel grid with origin at its top-left.
- The screenshot appears to be a `2×` macOS capture: the `80px` physical top chrome corresponds to an approximately `40px` device-independent row. Layout targets therefore show both source pixels and normalized CSS pixels.
- Colors below were sampled from decoded RGBA pixels in the supplied PNG. Each normative flat value is the modal color for its semantic filter or a large recurring flat-color region: orange `#DF643B` (8,018 pixels), green `#1CB061` (1,647 pixels), and blue focus `#99C8FF` (795 pixels). The five most frequent relevant neutral flats are `#303030`, `#272727`, `#3B3A3A`, `#1E1E1E`, and `#393939`.
- Text colors remain lower-confidence because antialiasing creates intermediate shades; `#F5F5F5`, `#B2B2B2`, and `#7B7B7B` are recurring decoded values assigned by visual role.
- The PNG may include display color management. These values are normative for reproducing this supplied reference, not claims about Promethee's source tokens. Do not mix them with the separately measured live-HUD tokens without semantic role separation.

### Full-app palette

| Token | Implementable value | Source region in `2422×1892` screenshot | Role | Confidence |
|---|---|---|---|---|
| `--app-canvas` | `#272727` | large shell/canvas flats | Window canvas and rail background | Decoded modal flat |
| `--app-top-chrome` | `#1E1E1E` | global-navigation chrome flats | Global navigation chrome | Decoded recurring flat |
| `--app-top-divider` | `#393939` | top chrome and shell boundaries | Top-chrome divider | Decoded recurring flat |
| `--app-panel` | `#303030` | center and side panel flats | Primary panel and friends panel fill | Decoded modal flat |
| `--app-card` | `#3B3A3A` | rank/apps cards and nested controls | Nested card and settings group fill | Decoded recurring flat |
| `--app-row-hover` | `#3B3A3A` | mapped from nested-card contrast | Hovered menu/settings row | Proposed semantic mapping |
| `--app-control` | `#3B3A3A` | button and nested-control flats | Quiet icon-button fill | Decoded recurring flat |
| `--app-border` | `#4B4B4B` | repeated component-edge shade | Strong component border | Decoded recurring flat |
| `--app-divider` | `#393939` | repeated panel-boundary shade | Section and row divider | Decoded recurring flat |
| `--app-text-primary` | `#F5F5F5` | recurring bright glyph interior | Primary text | Decoded recurring value; role inferred |
| `--app-text-secondary` | `#B2B2B2` | recurring secondary glyph interior | Secondary text | Decoded recurring value; role inferred |
| `--app-text-tertiary` | `#7B7B7B` | recurring muted glyph interior | Disabled/tertiary text only | Decoded recurring value; role inferred |
| `--app-orange` | `#DF643B` | active progress, underline, and emphasis | Brand action, active tab, XP, focus/status emphasis | Decoded modal orange, 8,018 pixels |
| `--app-orange-muted` | `rgba(223, 100, 59, 0.16)` | derived | Selected/hover background, never primary text | Proposed |
| `--app-green` | `#1CB061` | friend status dots and positive text | Online/success status | Decoded modal green, 1,647 pixels |
| `--app-green-muted` | `rgba(28, 176, 97, 0.14)` | derived | Success background | Proposed |
| `--app-focus-ring` | `#99C8FF` | selected Home outline | Keyboard/focus or selected global-nav ring | Decoded modal blue, 795 pixels |

Semantic separation:

- Use `--app-orange: #DF643B` for Pomodoro menu selection, active navigation, and settings actions that should match the full Promethee app.
- Keep the currently approved outline tokens `#DB8057`, `#A6A5A3`, and `#CC794F` until their normative contract is deliberately changed. The brighter app orange is not an automatic replacement for phase progress.
- Use green only for live, online, success, or positive-delta states. A green dot requires an accessible text equivalent.
- Use `--app-text-tertiary` only for disabled or supplementary copy. Its estimated contrast on `--app-panel` is approximately `3.3:1`, below the `4.5:1` target for normal body text. Use `--app-text-secondary` for actionable labels and essential values.

Approximate contrast checks from the proposed tokens:

| Pair | Approximate ratio | Usage |
|---|---:|---|
| `#F5F5F5` on `#303030` | `≈ 12.0:1` | Primary text |
| `#B2B2B2` on `#303030` | `≈ 6.2:1` | Secondary text |
| `#7B7B7B` on `#303030` | `3.12:1` | Large, disabled, or nonessential text only |
| `#DF643B` on `#303030` | `3.79:1` | Large text, thick icons, markers, and underlines only; use primary text for normal-size active labels |
| `#1CB061` on `#303030` | `4.67:1` | Success text and indicators |

These ratios are calculated from the decoded tokens with the WCAG relative-luminance formula. Recheck the final composited Electron surface and platform font rendering.

### App-shell layout

| Region | Source pixels | Normalized target | Confidence |
|---|---:|---:|---|
| Window content | approximately `2364px × 1882px` | approximately `1182px × 941px` | Estimated from visible window edge |
| Top chrome height | `80px` | `40px` | Estimated, ±1 CSS px |
| Left rail | approximately `658px` | `329px` | Estimated, ±2 CSS px |
| Center column | approximately `1048px` | `524px` | Estimated, ±2 CSS px |
| Right rail | approximately `658px` | `329px` | Estimated, ±2 CSS px |
| Center-to-right gutter | approximately `40px` | `20px` | Estimated, ±2 CSS px |
| Rail outer content inset | approximately `74px` | `37px` | Estimated, ±2 CSS px |
| Main top content offset after chrome | approximately `64px` | `32px` | Estimated, ±2 CSS px |

The layout reads as `329px 524px 329px` at the captured window width. This is a full-window reference, not a fixed minimum layout: the Pomodoro quick menu remains a compact attached surface rather than copying a full rail.

### Chrome, panels, cards, and rows

| Component token | Target | Evidence/confidence |
|---|---:|---|
| Top-chrome bottom divider | `1px solid #393939` | Measured reference mapping |
| Global-nav icon box | `16px–18px` | Estimated after `2×` normalization |
| Global-nav hit region | `44px × 30px` | Estimated, ±2 px |
| Selected global-nav radius | `15px` | Estimated |
| Selected/focus ring | `2px solid #99C8FF`, `2px` inset gap | Decoded reference color |
| Primary panel radius | `16px` | Estimated, ±2 px |
| Primary panel horizontal padding | `16px` | Estimated, ±2 px |
| Primary panel header | `48px` | Estimated, ±2 px |
| Nested card radius | `10px–12px` | Estimated |
| Nested card padding | `12px` | Estimated, ±2 px |
| Section gap | `16px` | Estimated |
| Standard row | `40px–44px` | Estimated |
| Dense metadata row | `32px–36px` | Estimated |
| Row divider | `1px solid #393939` | Measured reference mapping |
| Active-tab underline | `2px solid #DF643B` | Decoded reference color |
| Progress bar height | `4px` | Estimated after `2×` normalization |
| Status dot | `6px × 6px` | Estimated after `2×` normalization |
| Avatar | `35px × 35px` | Estimated, ±2 px |
| Quiet icon button | `28px × 28px`, radius `8px` | Estimated, ±2 px |

Surfaces are matte. Use no backdrop blur inside a full settings window. Reserve `backdrop-filter: blur(12px) saturate(110%)` for a detached timer-attached menu only when content visibly passes behind it.

### Application to the Pomodoro quick menu

Retain the previously proposed `288px` preferred width and `6px` timer attachment gap, then apply the full-app hierarchy:

```text
menu background       #303030
menu border           1px solid #4B4B4B
menu radius           16px
menu padding          12px
section background    #3B3A3A
section radius        10px
section padding       8px
section gap           12px
information row       32px
action/settings row   40px
row divider           1px solid #393939
primary action        #DF643B
focus ring            2px solid #99C8FF
```

- Use primary text for current phase, remaining time, and selected task.
- Use secondary text for cycle position, next break, and today's summary.
- Use tertiary text only for disabled or unavailable settings.
- Use orange for the selected setting, active section indicator, Skip/Restart emphasis, or XP-like summary—not for every icon.
- End Pomodoro remains a clearly labelled neutral/destructive action and must not inherit success green.

### Application to the settings surface

No Settings screen is visible in this screenshot, so the following values are proposed from the observed center-panel/card system:

| Settings token | Target | Confidence |
|---|---:|---|
| Preferred standalone width | `420px–524px` | Proposed from center-column width |
| Responsive minimum width | `360px` | Proposed |
| Outer panel padding | `16px` | Proposed from observed panels |
| Settings-group fill | `#3B3A3A` | Decoded source token |
| Settings-group radius | `12px` | Proposed within observed range |
| Settings-group gap | `16px` | Proposed |
| Section heading | `12px`, weight `600`, tracking `0.04em` | Proposed; exact font family unknown |
| Setting label | `13px`, weight `500` | Proposed |
| Setting description | `11px–12px`, line-height `16px`, `#B2B2B2` | Proposed |
| Setting row | minimum `44px`; `52px–60px` with description | Proposed |
| Numeric field/control height | `32px` | Proposed |
| Footer/action row | minimum `48px` | Proposed |

Settings groups should be separated by surface value and `16px` space, not a border around every row. Use `1px` dividers only between related rows inside a group. The resulting hierarchy matches the full app's large panels containing compact nested cards.

## Break label

The break label is attached to the outline rather than placed beside the timer.

| Token | Value | Confidence |
|---|---:|---|
| Height | `18px` | Proposed from the earlier 20 px review reference |
| Width | intrinsic, `96px–122px` for English reference copy | Estimated |
| Horizontal padding | `8px` | Proposed |
| Border | `1px solid #CC794F` | Approved token / proposed weight |
| Radius | `6px 6px 0 0` above; reverse corners when below | Proposed |
| Outline overlap | `1px` | Proposed |
| Label-to-content gap | `5px` | Proposed |

The label must follow the same above/below reversal as the attached surfaces. It must not widen the real timer or change its clickable bounds.

## Tasks surface calibration

The supplied Tasks composition gives an approximately `348px × 232px` panel with two task rows, one coach row, and an add row.

### Panel geometry

| Token | Value | Confidence |
|---|---:|---|
| Preferred width | `348px` | Estimated from 420 px composition, ±2 px |
| Responsive width | `min(348px, workAreaWidth - 20px)` | Proposed |
| Border | `1px` | Estimated |
| Radius | `18px` | Estimated, ±2 px |
| Horizontal screen margin | `10px` | Estimated / approved placement rule |
| Timer attachment gap | `6px` | Estimated, ±1 px |
| Internal horizontal padding | `12px` | Estimated, ±2 px |
| Product-tab row | `42px` | Estimated, ±2 px |
| Project-tab row | `40px` | Estimated, ±2 px |
| Optional coach row | `40px` | Estimated, ±2 px |
| Task row | `36px` | Estimated, ±2 px |
| Done-summary row | `32px` | Estimated, ±2 px |
| Add-task row | `36px` | Estimated, ±2 px |

Use measured content height, not a task-count guess, for final placement. The following formula is a review fixture for the supplied composition:

```text
naturalHeight = 2px borders
              + 42px product tabs
              + 40px project tabs
              + optional 40px coach row
              + taskCount × 36px
              + optional 32px done row
              + 36px add row
```

For two tasks plus the coach row and no done row, this yields `232px`, matching the screenshot estimate.

Placement:

1. Center the measured surface on the timer's horizontal center.
2. Use a `6px` attachment gap.
3. Prefer the requested side only when the complete measured surface fits inside a `10px` work-area margin.
4. Reverse above/below before clamping.
5. Clamp horizontally to the `10px` margin.
6. If neither side fits, constrain height to available space and scroll only the task-list region; never cover the timer.

### Tasks internal rhythm

| Element | Target | Confidence |
|---|---:|---|
| Selected top-tab chip height | `24px` | Estimated, ±2 px |
| Selected top-tab chip radius | `12px` | Derived |
| Top-tab icon | `12px–13px` | Estimated |
| Top-tab gap | `18px–22px` | Estimated |
| Project-tab underline | `1px` | Estimated |
| Task selection circle | `14px` | Estimated, ±1 px |
| Task title to XP gap | minimum `12px` | Proposed |
| Coach/accent rule | `2px × 16px` | Estimated |

## Pomodoro menu calibration

No supplied screenshot shows the accepted management menu. These are proposed values, deliberately denser and narrower than the Tasks surface.

| Token | Value | Confidence |
|---|---:|---|
| Preferred width | `288px` | Proposed |
| Responsive width | `min(288px, workAreaWidth - 20px)` | Proposed |
| Minimum content height | `96px` | Proposed |
| Maximum height | `min(420px, availableAttachmentSpace)` | Proposed |
| Radius | `16px` | Proposed |
| Border | `1px solid #3B3D3D` | Proposed from Tasks |
| Padding | `12px` | Proposed |
| Section gap | `12px` | Proposed |
| Information row | `32px` | Proposed |
| Action row | `36px` | Proposed |
| Timer attachment gap | `6px` | Shared measured rule |

The menu uses the same placement solver and surface tokens as Tasks. Opening one must close or safely queue the other before placement. The menu contains no Play/Pause duplicate.

## Typography traits

The exact font family cannot be established from screenshots. Do not encode a named font as a visual fact.

| Role | Implementable traits | Confidence |
|---|---|---|
| Timer | compact monospace or sans with `font-variant-numeric: tabular-nums`; `11px–12px`; weight `500–600`; tracking `0.02em` | Estimated |
| Break label | monospace or tabular sans; `9px`; weight `700`; uppercase; tracking `0.08em` | Estimated / proposed |
| Product tabs | compact sans; `11px`; selected weight `600`, inactive weight `500` | Estimated |
| Project tabs | compact sans; `11px`; weight `450–500` | Estimated |
| Task title | compact sans; `12px`; weight `500–550`; line-height `16px` | Estimated |
| XP and metadata | compact sans; `11px–12px`; weight `500`; tabular digits for time/XP values | Estimated |
| Menu label | compact sans; `11px`; weight `500`; line-height `16px` | Proposed |
| Menu value | compact sans; `12px`; weight `600`; tabular digits for durations | Proposed |

Use the operating-system UI font stack for non-numeric copy. Validate French strings at the same menu width rather than shrinking type below `11px`.

## Motion

Motion cannot be measured from the supplied static images.

| Transition | Target | Source/confidence |
|---|---|---|
| HUD move or display change | `0ms`; update on authoritative geometry frame | Proposed |
| Running ↔ paused width | `140ms–180ms cubic-bezier(0.22, 1, 0.36, 1)` | Historical review timing; proposed for validation |
| Attached surface appear | `100ms–120ms ease-out`, opacity `0→1`, translate `2px→0` | Proposed |
| Attached surface disappear | `80ms–100ms ease-in`, opacity `1→0` | Proposed |
| Progress consumption | linear interpolation between authoritative remaining ratios; never accumulated from animation frames | Required / proposed rendering |
| Button press | `80ms–100ms ease-out`, scale floor `0.96` | Proposed |

Do not apply spring, bounce, overshoot, or blur animation. The outline must not visibly lag behind a dragged Promethee timer.

Reduced Motion behavior:

- Set geometry, width, translate, and scale transitions to `0ms`.
- Render attached surfaces without transform; an opacity transition of at most `80ms` is permitted, or use `0ms` when the platform preference indicates stronger reduction.
- Continue to update the consumable outline because it conveys time, but snap to authoritative ratios without decorative interpolation.
- Preserve phase labels and numeric time so motion is never the only state signal.

## Prototype scale corrections

Retired review artifacts used calibrated synthetic `144 × 32px` and `173 × 32px` HUD fixtures. A separately authorized Promethee 1.3.29 macOS exercise on 2026-08-25 measured `159 × 32px` while running and `191 × 32px` while paused during one same-session focus → pause → short break → resume → focus flow. Those live measurements supersede the older fixture widths for that exact version/layout only; they are not Windows or general compatibility evidence. The obsolete oversized HTML prototype and local design-preview tree were removed on 2026-08-26; they must not be recreated as implementation fixtures.

| Prototype value | Real/target value | Required correction |
|---|---:|---:|
| Running shell `328px × 66px` | observed Promethee 1.3.29 running `159px × 32px` | width × `0.485` (`-51.5%`); height × `0.485` (`-51.5%`) |
| Paused shell `383px × 66px` | observed Promethee 1.3.29 paused `191px × 32px` | width × `0.499` (`-50.1%`); height × `0.485` (`-51.5%`) |
| Inner timer `inset: 5px` | production uses real HUD; outline outset `2px` | remove recreated inner timer in production; use verified bounds |
| Action `48px × 48px` | approximately `27px × 27px` | × `0.563` (`-43.7%`) |
| Session display height `46px` | approximately `24px` | × `0.522` (`-47.8%`) |
| Action gap `7px` | `3px–4px` | use `4px` fixture (`-42.9%`) |
| Timer font `18px` | `11px–12px` | start at `11.5px` (`-36.1%`) |
| Timer/session icon `18px` | approximately `11px` | × `0.611` (`-38.9%`) |
| Tasks width `620px` | approximately `348px` | × `0.561` (`-43.9%`) |
| Tasks tab row `70px` | approximately `42px` | × `0.600` (`-40.0%`) |
| Task row `76px` | approximately `36px` | × `0.474` (`-52.6%`) |
| Add-task row `64px` | approximately `36px` | × `0.563` (`-43.7%`) |
| Tasks radius `24px` | approximately `18px` | × `0.750` (`-25.0%`) |
| Task attachment gap `6px` | `6px` | keep unchanged |

The retired fixed SVG `viewBox="0 0 328 66"` combined with a `383px` paused shell and `preserveAspectRatio="none"` stretched the rounded path horizontally. That behavior explained malformed long horizontal strokes in the old review capture. The implementation must generate the path from current real bounds and must not resize a fixed rounded rectangle.

The current `5px` inset also makes the outline read as a separate enclosing capsule. The calibrated `2px` path outset keeps the layer discreet and visually attached.

## Acceptance checks

### Geometry

- Synthetic running review fixture: HUD `144px × 32px`; outline visual bounds `148px × 36px`.
- Synthetic paused review fixture: HUD `173px × 32px`; outline visual bounds `177px × 36px`.
- Authorized Promethee 1.3.29 live geometry: running HUD `159px × 32px`, paused HUD `191px × 32px`; outline follows those current bounds rather than a fixed fixture width.
- Outline centerline stays within `2px ± 0.5px` outside the reported HUD bounds.
- No outline pixel covers Promethee Play, Pause, Stop, disclosure, time, or session icon content.
- Tasks and menu preserve `6px ± 1px` visual separation from the timer.
- Attached surfaces remain at least `10px` inside the active display work area after reversal and clamping.

### Color

- Compare flat sRGB regions, not antialiased edges.
- Neutral live-token screenshots should remain within `ΔE00 ≤ 3` of the sampled target under the same capture conditions.
- Focus outline uses `#DB8057`; break outline uses `#A6A5A3`; break label uses `#CC794F`.
- Color is not the sole phase indicator: accessible phase text is always available.

### Interaction

- The outline window is click-through across its complete bounds.
- Real Promethee controls retain their original hit areas.
- Width changes follow measured bridge bounds instead of duration-format assumptions.
- Progress starts full, consumes monotonically, freezes only for paused focus, and reaches zero at the authoritative deadline.
- Tasks and Pomodoro menu never appear as overlapping interactive surfaces.

## Recalibration triggers

Repeat direct live capture and update this document when any of the following changes:

- Promethee changes its HUD renderer, action count, border, font metrics, or placement contract.
- A tested Promethee version changes the running or paused bounds by more than `2px`.
- Windows and macOS differ by more than `2px` in the same state after device-scale normalization.
- The bridge begins exposing exact internal layout tokens, superseding screenshot estimates.
- French localization forces truncation at the calibrated menu or Tasks widths.
