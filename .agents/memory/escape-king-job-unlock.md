---
name: Escape the King job unlock system
description: Job lock/unlock system gating all 4 job selects by ranked match wins.
---

# Job Unlock System

## Architecture

- `STARTER_JOBS` — only `['king']`; locked to localStorage key `etk_unlocked_jobs`
- `UNLOCK_ORDER` — all other 29 jobs in `ALL_JOBS` order (knight→assassin→…→painter)
- `isJobUnlocked(job)` — checks `loadUnlockedJobs()` array
- `buildJobOptions()` — builds HTML `<option>` string; locked jobs get `disabled` + 🔒 + hint
- `refreshAllJobSelects()` — rebuilds all 4 selects: `job-select`, `ranked-job-select`, `ol-job-select`, `ol-join-job-select`
- `checkJobUnlocked(job, errElId)` — validation guard called in each start function

## Unlock Rules

| Trigger | Effect |
|---------|--------|
| ランクマッチ（CPU）1勝 | 次の1ジョブ解放 |
| ランクマッチ（オンライン）1勝 | 次の1ジョブ解放 |
| オフラインCPU通常戦 | 解放なし（削除済み） |

## Call sites for unlockNextJob()

- `incrementWins()` — CPUランクマッチ勝利（line ~1419）
- Online result handler — オンラインランクマッチ勝利（line ~3071）
- CPU ranked match win block — CPUランクマッチ勝利（line ~16558）
- ~~Offline 3-win block~~ — 削除済み

## Call sites for refreshAllJobSelects()

- `DOMContentLoaded` — page load
- `loadPlayerFromServer()` — after server sync

## Guards in start functions

- `startGame()` → error shown in `error-log`
- `startCpuRankedMatch()` / `startRankedSearch()` → error shown in `ranked-status`
- `createRoom()` / `joinRoom()` → falls back to `alert()`

## resolveJob('random')

Picks only from `ALL_JOBS.filter(j => isJobUnlocked(j))` — locked jobs excluded.

**Why:** Prevents bypassing lock system via random selection.
