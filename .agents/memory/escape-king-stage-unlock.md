---
name: Escape the King stage unlock system
description: How stages are locked/unlocked via tutorial + CPU level; functions and localStorage keys.
---

## System overview
- Tutorial clears → plains unlocked; CPU level N cleared → stages requiring ≤ N unlocked
- `STAGE_UNLOCK_REQUIREMENTS` maps each stage to required CPU level (0 = tutorial only)
- forest→lv1, desert→lv2, … misty_lake→lv14, colosseum/factory/volcano_summit→lv15

## localStorage keys
- `ek_tutorial_done` = '1' when tutorial complete
- `ek_max_cpu_lv` = highest CPU difficulty level beaten

## Key functions
- `isTutorialDone()` / `setTutorialDone()` — get/set tutorial flag
- `getMaxCpuLvBeaten()` / `setMaxCpuLvBeaten(lv)` — get/set highest CPU level cleared
- `isStageUnlocked(stage)` — returns true if the stage is available to play
- `buildStageOptions(forFav)` — builds `<option>` HTML for all stage selects
- `refreshAllStageSelects()` — rebuilds stage-select, ol-stage-select, fav-stage-select
- `checkStageUnlocked(stage, errElId)` — validates stage before game start; shows error if locked

## Hook points
- `showTutorialResult()` → calls `setTutorialDone()` + `refreshAllStageSelects()`
- Offline single-player win handler → calls `setMaxCpuLvBeaten(diff)` + `refreshAllStageSelects()` + appends unlock message to title
- `DOMContentLoaded` → calls `refreshAllStageSelects()` after `refreshAllJobSelects()`
- `startGame()` → calls `checkStageUnlocked(rawStage, 'error-log')` before init

## Static HTML
- All 3 stage selects (stage-select, ol-stage-select, fav-stage-select) have empty `<select>` tags — populated entirely by JS on load.

**Why:** Mirrors the job unlock pattern already in place; keeps unlock state in localStorage consistent with UI state at all times.
