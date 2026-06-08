---
name: Escape the King online emote system
description: Online emote implementation — button, bubbles, per-turn cap, WebSocket relay.
---

## Feature scope
- 4 preset emotes: 👋こんにちは、🙏よろしく、😱やられた、😤どうだ
- Max 3 emotes per player turn (resets at start of OWN turn only)
- Emote bubbles appear above the sender's piece on the board

## HTML elements
- `#emote-btn-main` — fixed circular button (bottom-right, display:flex when online game active)
- `#emote-menu` — dropdown panel with 4 buttons + count indicator
- `#emote-count` — span showing remaining emotes this turn
- `.emote-bubble` / `.emote-bubble.opponent` — CSS class for pop-up speech bubble

## Key JS functions
- `emoteUsedThisTurn` — global counter, reset in `startTurn()` when team==='player' and isOnlineMode
- `toggleEmotePanel()` — show/hide emote-menu
- `sendEmote(text)` — validates cap, increments counter, wsSend({type:'emote',text}), calls showEmoteBubble
- `showEmoteBubble(text, side)` — 'self' or 'opponent'; finds entity via `entities.find(e => e.team === selfTeam && (e.id==='p1'||e.id==='p2'))`; positions bubble over piece using board rect + --tile-size CSS var

## WebSocket relay
- api-server/src/index.ts: relay list `["stateSync","turnEnd","chat","emote"]` — emote is just forwarded to the opponent socket, no server processing.

## Show/hide lifecycle
- Show: in gameStart handler, right after `game-screen` display = 'flex' → `emote-btn-main` display = 'flex'
- Hide: in `backToHome()` → both emote-btn-main and emote-menu hidden

**Why:** Emotes are purely cosmetic/social; server-authoritative validation is not needed, relay-only is sufficient.
