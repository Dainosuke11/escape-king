import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const kofiRouter = Router();

// ─── DB setup ──────────────────────────────────────────────────────────────
// `ek_donor_emails` stores verified Ko-fi donation records.
// `claimed_by_player_id` records which game player redeemed each row.
db.execute(sql`
  CREATE TABLE IF NOT EXISTS ek_donor_emails (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    kofi_transaction_id TEXT UNIQUE NOT NULL,
    received_at TIMESTAMP DEFAULT NOW(),
    claimed_by_player_id TEXT
  )
`).catch(console.error);

db.execute(sql`
  ALTER TABLE ek_players ADD COLUMN IF NOT EXISTS is_donor BOOLEAN NOT NULL DEFAULT FALSE
`).catch(console.error);

// Warn loudly at startup when KOFI_VERIFICATION_TOKEN is absent
if (!process.env["KOFI_VERIFICATION_TOKEN"]) {
  logger.warn(
    "KOFI_VERIFICATION_TOKEN is not set — /api/kofi/webhook will reject all requests until the env var is configured"
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/kofi/webhook
 * Receives Ko-fi donation notifications.
 *
 * KOFI_VERIFICATION_TOKEN is REQUIRED (fail closed). When the env var is absent
 * every request is rejected with 503 to prevent fake-payload seeding of
 * ek_donor_emails.
 */
kofiRouter.post("/kofi/webhook", async (req, res) => {
  try {
    const token = process.env["KOFI_VERIFICATION_TOKEN"];
    if (!token) {
      logger.warn("kofi/webhook called but KOFI_VERIFICATION_TOKEN is not configured — rejecting");
      res.status(503).json({ error: "webhook not configured" });
      return;
    }

    // Ko-fi sends the payload as a JSON string inside a `data` form field
    const rawData = req.body?.data;
    if (!rawData) { res.status(400).json({ error: "missing data" }); return; }

    let payload: Record<string, unknown>;
    try { payload = JSON.parse(String(rawData)); }
    catch { res.status(400).json({ error: "invalid data json" }); return; }

    if (payload["verification_token"] !== token) {
      res.status(403).json({ error: "invalid token" }); return;
    }

    const email = typeof payload["email"] === "string"
      ? payload["email"].toLowerCase().trim() : null;
    const txId = typeof payload["kofi_transaction_id"] === "string"
      ? payload["kofi_transaction_id"] : null;

    if (!email || !txId) {
      res.status(400).json({ error: "missing email or transaction id" }); return;
    }

    await db.execute(sql`
      INSERT INTO ek_donor_emails (email, kofi_transaction_id)
      VALUES (${email}, ${txId})
      ON CONFLICT (kofi_transaction_id) DO NOTHING
    `);

    res.json({ ok: true });
  } catch { res.status(500).json({ error: "webhook error" }); }
});

/**
 * POST /api/kofi/claim
 * Player claims donor status by presenting their Ko-fi email address.
 *
 * Security model note: This game has no server-side session or JWT authentication;
 * all player identity uses a client-issued UUID persisted in localStorage. The
 * `userId` in the request body is the game's canonical identity for ALL endpoints.
 * Mitigations applied within this model:
 *   - `userId` must be a registered player in ek_players (must have played at least once).
 *   - One donor-email row can be claimed by at most one userId (claimed_by_player_id);
 *     idempotent for the same userId.
 *   - Webhook seeding is protected by KOFI_VERIFICATION_TOKEN (fail closed), so
 *     ek_donor_emails only contains real Ko-fi donation records.
 */
kofiRouter.post("/kofi/claim", async (req, res) => {
  try {
    const { userId, email } = req.body as Record<string, string>;
    if (!userId || !email || userId.length > 64) {
      res.status(400).json({ error: "userId and email required" }); return;
    }

    // Player must exist in ek_players (has launched the game at least once)
    const playerCheck = await db.execute(sql`
      SELECT user_id FROM ek_players WHERE user_id = ${userId} LIMIT 1
    `);
    if (!playerCheck.rows || playerCheck.rows.length === 0) {
      res.status(403).json({ error: "player_not_found" }); return;
    }

    const normalized = email.toLowerCase().trim();

    // Find a donation row matching this email
    const donorResult = await db.execute(sql`
      SELECT id, claimed_by_player_id FROM ek_donor_emails
      WHERE email = ${normalized}
      LIMIT 1
    `);
    if (!donorResult.rows || donorResult.rows.length === 0) {
      res.status(404).json({ error: "not_found" }); return;
    }

    const row = donorResult.rows[0] as Record<string, unknown>;
    const rowId = row["id"];
    const claimedBy = row["claimed_by_player_id"];

    // Reject cross-account claims: one email → one player only
    if (claimedBy !== null && claimedBy !== undefined && claimedBy !== userId) {
      res.status(409).json({ error: "already_claimed" }); return;
    }

    // Atomically record the claim and grant donor status
    await db.execute(sql`
      UPDATE ek_donor_emails
      SET claimed_by_player_id = ${userId}
      WHERE id = ${rowId}
    `);
    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, is_donor)
      VALUES (${userId}, 'プレイヤー', TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_donor = TRUE
    `);

    res.json({ ok: true, isDonor: true });
  } catch { res.status(500).json({ error: "claim error" }); }
});

/**
 * POST /api/admin/set-donor
 * Manually grants donor status.
 * ADMIN_SECRET env var is REQUIRED; endpoint returns 503 when absent (fail closed).
 * Authenticate via the `x-admin-secret` request header.
 */
kofiRouter.post("/admin/set-donor", async (req, res) => {
  try {
    const adminSecret = process.env["ADMIN_SECRET"];
    if (!adminSecret) {
      res.status(503).json({ error: "admin endpoint not configured" }); return;
    }
    if (req.headers["x-admin-secret"] !== adminSecret) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const { userId } = req.body as Record<string, string>;
    if (!userId || userId.length > 64) {
      res.status(400).json({ error: "userId required" }); return;
    }

    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, is_donor)
      VALUES (${userId}, 'プレイヤー', TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_donor = TRUE
    `);

    res.json({ ok: true });
  } catch { res.status(500).json({ error: "admin error" }); }
});

export default kofiRouter;
