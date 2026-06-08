---
name: Escape the King profile system
description: Player profile icon, win/loss/draw stats, charUsage tracking — design decisions, security constraints, and data flow.
---

## Security: W/L/D are server-authoritative
- `wins`, `losses`, `draws` are incremented exclusively in `finishRanked()` on the server (DB update via drizzle).
- `POST /api/player` intentionally ignores these fields — clients cannot set them.
- `GET /api/player/:userId` and `GET /api/profile/:userId` both return authoritative values.
- `loadPlayerFromServer()` always overwrites local W/L/D with server values.
- **Why:** Client-side ranked stats can be forged via localStorage; keeping the server authoritative prevents leaderboard manipulation.

## Data sync rules
- **Profile preferences** (icon, fav element, fav stage): server wins if local is still default; otherwise local wins.
- **Rank/RP**: take whichever is higher between local and server.
- **charUsage**: merge with max per key (client tracks locally, server stores).
- After online ranked result: `loadPlayerFromServer()` fires 3s later to refresh authoritative W/L/D.

## DB columns (ek_players)
- `profile_icon` varchar(8), `favorite_element` varchar(16), `favorite_stage` varchar(32)
- `wins`, `losses`, `draws` integer — server-only writes
- `char_usage` jsonb — client-tracked, server-stored

## Key localStorage keys
- `ek_profile_icon`, `ek_fav_element`, `ek_fav_stage` — preferences
- `ek_ranked_wins`, `ek_ranked_losses`, `ek_ranked_draws` — local cache (overwritten from server on load)
- `ek_char_usage` — JSON usage map

## Match toast expansion
- Shows opponent icon + record + top chars + fav element directly via async fetch to `/api/profile/:userId`.
- Renders basic info immediately, then updates with full profile details once fetch resolves.
- Toast duration extended to 6s to allow time to read expanded info.

## In-battle opponent profile
- `updateOnlineInfo()` renders a button "`${opponentIcon} 相手プロフィール`" that calls `showOpponentProfile(opponentUserId)`.
- `opponentUserId` and `opponentIcon` are set from `gameStart` WS message.
