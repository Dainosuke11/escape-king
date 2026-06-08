---
name: Escape the King job unlock system
description: Job lock/unlock system gating all 4 job selects by ranked match wins (ek_ranked_wins).
---

# Job Unlock System

## Architecture

- `JOB_UNLOCK_REQUIREMENTS` — const map: job → ranked wins needed (0 = always free)
- `isJobUnlocked(job)` — compares `getWins()` against requirement
- `buildJobOptions()` — builds HTML `<option>` string; locked jobs get `disabled` + 🔒 + win count hint
- `refreshAllJobSelects()` — rebuilds all 4 selects: `job-select`, `ranked-job-select`, `ol-job-select`, `ol-join-job-select`
- `checkJobUnlocked(job, errElId)` — validation guard called in each start function; shows error in element or falls back to alert

## Unlock Tiers (ranked wins)

| Wins | Jobs unlocked |
|------|--------------|
| 0 | king, knight, assassin, infantry, mage, thief, beastmaster, macho |
| 1 | cyborg, alien, mandrake, ryujin |
| 3 | shark_warrior, orca_pirate, clown, necromancer |
| 5 | angel, world_manager, onmyoji, devil |
| 8 | mafia, dwarf, sentai_hero, sennin |
| 12 | pixie, hitokiri_musha, guru, miko |
| 15 | barbarian, painter |

## Call sites for refreshAllJobSelects()

- `DOMContentLoaded` — immediately on page load
- `loadPlayerFromServer()` — after ranked wins are synced from server (wins are server-authoritative)

## Guards in start functions

- `startGame()` → error shown in `error-log`
- `startCpuRankedMatch()` / `startRankedSearch()` → error shown in `ranked-status`
- `createRoom()` / `joinRoom()` → falls back to `alert()`

## resolveJob('random')

Modified to pick only from `ALL_JOBS.filter(j => isJobUnlocked(j))` — locked jobs excluded from random selection.

**Why:** Prevents players from bypassing the lock system by using random selection, and keeps the system fair in ranked/online modes.
