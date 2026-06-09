---
name: Escape the King donor system
description: Ko-fi webhook flow, DB tables, API endpoints, and client-side full-unlock logic for donation rewards.
---

## Rule
Ko-fi 寄付でドナーになると全ステージ・全キャラクターが即アンロックされる。

## DB
- `ek_players.is_donor` (boolean, default false) — Drizzle schema + raw SQL ALTER TABLE at startup in kofi.ts
- `ek_donor_emails` table — id, email, kofi_transaction_id (UNIQUE), received_at, claimed_by_player_id

## API endpoints (artifacts/api-server/src/routes/kofi.ts)
- `POST /api/kofi/webhook` — Ko-fi sends `data` as a JSON string inside form body; parses it, verifies KOFI_VERIFICATION_TOKEN env var (optional); inserts into ek_donor_emails.
- `POST /api/kofi/claim` — player submits { userId, email }; looks up ek_donor_emails by email (not requiring unclaimed); sets is_donor=true on ek_players via upsert.
- `POST /api/admin/set-donor` — authenticated by `admin-secret` header vs ADMIN_SECRET env var; manually grants is_donor=true.
- `GET /api/player/:id` response now includes `isDonor: boolean`.

## Client-side (index.html)
- `ek_is_donor` localStorage key: '1' = donor unlocked.
- `isDonorUnlocked()` — checks localStorage.
- `applyDonorUnlock()` — sets ek_is_donor=1, ek_tutorial_done=1, ek_max_cpu_lv=99, saves ALL_JOBS to etk_unlocked_jobs, refreshes selects.
- `showDonationUnlockPopup()` — opens donation-unlock-modal.
- `claimDonorUnlock()` — calls /api/kofi/claim, on success calls applyDonorUnlock().
- `isStageUnlocked()` and `isJobUnlocked()` both check isDonorUnlocked() first.
- `checkStageUnlocked()` and `checkJobUnlocked()` call showDonationUnlockPopup() when locked.
- `loadPlayerFromServer()` — if data.isDonor && !isDonorUnlocked() → applyDonorUnlock().
- DOMContentLoaded — if isDonorUnlocked() → applyDonorUnlock() immediately.
- Ko-fi footer has "🎁 寄付特典を受け取る" button that calls showDonationUnlockPopup().

**Why:** Donation incentive that's server-verified via webhook + client-claimed by email.

**How to apply:** Any future change to stage/job unlock logic must preserve isDonorUnlocked() short-circuit. Any new locked content should check isDonorUnlocked() in its unlock predicate.
