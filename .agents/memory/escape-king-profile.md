---
name: Escape the King profile system
description: Player profile icon, win/loss stats, charUsage tracking — DB schema, API, client localStorage keys, and sync contract.
---

## DB columns added to ek_players (drizzle push applied)
- `profile_icon` varchar(8) default '🎮'
- `favorite_element` varchar(16) default 'none'
- `favorite_stage` varchar(32) default ''
- `wins` integer default 0
- `losses` integer default 0
- `char_usage` jsonb default {}

## API additions
- `GET /api/profile/:userId` — full profile for opponent card display
- `GET/POST /api/player` — now includes all new fields
- `GET /api/leaderboard/tiers` — now includes `profileIcon` per entry
- `QueueEntry` and `PlayerSlot` interfaces now include `profileIcon`
- `gameStart` WebSocket message now includes `opponentIcon` and `opponentUserId`

## Client localStorage keys
- `ek_profile_icon` — selected emoji icon
- `ek_fav_element` — favorite element ('none'|'fire'|'water'|etc)
- `ek_ranked_wins` / `ek_ranked_losses` — ranked W/L counters
- `ek_char_usage` — JSON object {jobKey: count}

## Key functions
- `getProfileIcon()` / `setProfileIcon(icon)` — icon helpers
- `openIconPicker()` / `selectIcon(icon)` — 64-emoji grid modal
- `refreshProfileUI()` — updates icon display + stats bar in ranked panel; called from `refreshRankDisplay()`
- `showOpponentProfile(userId)` — fetches /api/profile/:userId and shows profile card modal
- `updateCharUsage(job)` — increments the job's use count in localStorage
- `syncPlayerToServer()` — now sends all new profile fields
- `loadPlayerFromServer()` — server-wins merge for icon/element/wins/losses/charUsage

## Win/loss tracking flow
- Online ranked: `handleRankResult()` calls `incrementWins()` or `incrementLosses()`, then `updateCharUsage(window._lastOnlineJob)` (set in gameStart handler)
- CPU ranked: same in cpuRankResultApplied block, uses `window._lastCpuRankedJob` (set in `startCpuRankedMatch()`)

## post-merge.sh Fly.io fix
- Changed `fly deploy` to non-fatal: failure prints warning instead of exiting 1.
- **Why:** Fly.io trial ending causes the entire post-merge to fail; DB push succeeds but deploy error aborts the script.
