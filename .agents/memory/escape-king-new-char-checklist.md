---
name: Escape the King — new character checklist
description: Steps required every time a new playable job is added to the game.
---

# New character implementation checklist

When adding any new job/character, ALL of the following must be updated in the same commit:

## 1. Four job-select dropdowns (index.html)
All must stay in sync — missing any one causes "character missing from X mode" bugs.

| Select ID | Location in HTML | Mode |
|-----------|-----------------|------|
| `#job-select` | CPU battle screen | CPU vs player |
| `#ol-job-select` | Online create-room panel | Online create |
| `#ol-join-job-select` | Online join-room panel | Online join |
| `#ranked-job-select` | Ranked match panel | Ranked |

## 2. Core data tables
- `JOB_DATA` — abilities, hp, ap, special flags (flying, oceanUnit, hitokiriUnit, etc.)
- `ALL_JOBS` — master list used for random CPU job selection
- `JOB_ELEMENT` — base element
- `JOB_ELEMENT_SECONDARY` — secondary element (if applicable)
- `JOB_STAGE` — home stage name
- `JOB_DATA_DETAIL` — emoji + fullName + note shown in job encyclopedia

## 3. Ability definitions
- `ABILITY_DETAIL` — description strings
- `ABILITY_ELEMENT` — element per ability
- Any new ability handlers in `resolveAbility()`

**Why:** The four dropdowns are maintained as separate HTML `<select>` blocks and are easy to get out of sync. Past bug: `#job-select` (CPU mode) was missed when pixie/hitokiri_musha were added to the other three.

**How to apply:** Before marking any new-character task complete, grep for `job-select`, `ol-job-select`, `ol-join-job-select`, `ranked-job-select` and confirm the new value appears in all four.
