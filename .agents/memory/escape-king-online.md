---
name: Escape the King online/ranked architecture
description: Why online play is a thin WebSocket relay (not server-authoritative) and the ranked/reconnect contract.
---

# Online & ranked play

Online play uses the existing `artifacts/api-server` WebSocket server as a **thin relay**, not a game engine.

**Why:** The entire game engine lives client-side in `artifacts/escape-king/index.html` (one inline script). Firebase is unavailable on the free tier, so there is no managed realtime backend. Porting the whole engine to the server for authority is out of scope. As a result, match results and rank/RP are **client-authoritative** (the client reports `won`/`rank`/`userId`). This is a known, accepted integrity tradeoff for a free-tier hobby game — do NOT treat "client can spoof RP" as a bug to fix unless the user explicitly wants server-side authority (which means re-implementing the engine server-side).

**How to apply / contract to preserve:**
- Rank & RP persist **client-side** in localStorage (`ek_userId`, `ek_rank`, `ek_rp`, `ek_lvl8`, `ek_spwins`). Ranked unlocks after 8 single-player wins.
- RP formula (per spec): win D==0 +10; D>0 → 10+D*2; D<0 → max(1,10-|D|*2). Loss: rank1-5 →0; rank6-10 →-5; else -10. Rankup carries overflow over 100; rankdown resets to 90RP; floor at rank1/0RP.
- Server room lifecycle: rooms must be **deleted after finish** (finishRanked schedules delete) — finished rooms left in the map cause unbounded retention and stale sessionId lookups.
- Reconnect contract: `resume` rebinds by `sessionId` **only for rooms with `status==='suspended'`**. Suspend starts a grace timer (~25s) → forfeit if no resume. Clear that timer on resume AND on finish.
- Matchmaking: each queued socket runs its own `setInterval(tryMatch)`; always `clearInterval` the old `searchTimer` before splicing/removing a queue entry (re-queue, cancel, match, close) or intervals leak.
- State sync (`getGameState`/`applyGameState`) must include every mutable stage global or reconnect desyncs in non-plains stages — currently includes board/entities/turn/stage timers/treasures/digHoles/souls. Add new globals here when introduced.
- After a reconnect-driven `stateSync`, restart the per-turn 60s timer when `canIAct()` (and stop it otherwise), or auto-end-turn silently dies post-reconnect.
