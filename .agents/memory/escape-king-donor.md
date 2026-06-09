---
name: Escape the King donor system
description: Ko-fi donation reward flow — key design constraints and durable decisions.
---

## Rule
Ko-fi 寄付（1円以上）で全ステージ・全キャラクターが即アンロックされる。

## Auth architecture constraint
This game uses client-issued UUIDs (`getUserId()`) stored in localStorage as the only player identity. There is no server-side session or JWT. Every API endpoint (including this one) accepts `userId` from the request body. This is a systemic property of the game, not a bug in the donor flow.

**Why:** Adding server-side auth is a separate, major feature outside the scope of the donor task.

**How to apply:** Any future donor or identity-sensitive endpoint must accept this limitation and mitigate within the existing model (UUID format check, player-must-exist check, one-email-per-player enforcement).

## Key design decisions
- Webhook (`POST /api/kofi/webhook`) is **fail-closed**: requires `KOFI_VERIFICATION_TOKEN` env var; returns 503 if absent. Prevents fake-payload seeding.
- Admin endpoint (`POST /api/admin/set-donor`) is **fail-closed**: requires `ADMIN_SECRET` env var; authenticated via `x-admin-secret` header.
- Claim (`POST /api/kofi/claim`): one donor-email row → one player only (`claimed_by_player_id`); idempotent for same player; cross-player re-claim returns 409.
- Client stores `ek_is_donor=1` in localStorage; `applyDonorUnlock()` also sets `ek_tutorial_done=1`, `ek_max_cpu_lv=99`, and saves ALL_JOBS.

## Tables
- `ek_donor_emails`: stores Ko-fi donation emails; `claimed_by_player_id` records which game player claimed each row.
- `ek_players.is_donor` (boolean): donor flag synced from server on login.
