# Notch display modes — live QA

Verified on macOS on 2026-10-16 with a built-in display containing a physical
notch and an external primary display. The isolated development profile used
frontend port `1424`, service port `5103`, and Electron debugging port `9231`.

The screenshots use a fixture snapshot containing two running sessions, one
session awaiting permission, and two completed sessions with unread output.
No agent turn was started for these visual checks.

## Primary display styles

![Primary display status styles](notch-display-styles.png)

The comparison combines actual Electron renderer captures at the same scale.

| Setting | Observed compact status |
| --- | --- |
| `4 px` | A 4 px band with three activity points and five session points |
| `8 px` | An 8 px band with the same activity and session points |
| `Built-in notch style` | The full notch layout, including the existing overflow count |
| `No status` | No compact status or hover target; notification previews remain available |

## Verified behavior

- [x] All four choices save through the settings UI and update the live notch.
- [x] `Built-in always` disables `Primary display status`; selecting `Both`
      enables it again without losing the saved style.
- [x] `Both` creates one island on the built-in display and another on the
      external primary display, with separate geometry.
- [x] Opening the panel by hovering and choosing the 30-minute snooze action
      applies the same snooze deadline to both islands.
- [x] Resuming notifications clears snooze on both islands.
- [x] An empty ambient snapshot hides the virtual notch; new activity shows it.
- [x] The built-in notch contracts into the physical cutout while idle.
- [x] A notification preview remains visible with `No status`, and its close
      action returns to the hidden compact state.
- [x] With animation enabled, running session points animate while waiting and
      completed session points remain steady.
- [x] Reduced-motion emulation stops looping activity animations.
- [x] No renderer console errors occurred during these flows.

## Automated coverage

Focused tests cover display geometry, distinct-display selection, shared
snapshot and snooze delivery, notification queues, preference parsing, and
compact rendering. Existing snooze, panel, and overflow behavior is retained.
