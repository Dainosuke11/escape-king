import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import crypto from "crypto";

const kofiRouter = Router();

// ─── DB setup ──────────────────────────────────────────────────────────────
// Create ek_donor_emails and ek_claim_tokens tables; add is_donor column if needed.
db.execute(sql`
  CREATE TABLE IF NOT EXISTS ek_donor_emails (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    kofi_transaction_id TEXT UNIQUE NOT NULL,
    received_at TIMESTAMP DEFAULT NOW()
  )
`).catch(console.error);

// Single-use, time-bounded claim tokens. The server mints these after verifying
// the email; the client presents the token (not a userId) to redeem donor status.
// donor_email_id ties the token to the specific donation row.
db.execute(sql`
  CREATE TABLE IF NOT EXISTS ek_claim_tokens (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    donor_email_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    redeemed_by TEXT,
    redeemed_at TIMESTAMPTZ
  )
`).catch(console.error);

db.execute(sql`
  ALTER TABLE ek_players ADD COLUMN IF NOT EXISTS is_donor BOOLEAN NOT NULL DEFAULT FALSE
`).catch(console.error);

// Warn loudly at startup if KOFI_VERIFICATION_TOKEN is absent
if (!process.env["KOFI_VERIFICATION_TOKEN"]) {
  logger.warn(
    "KOFI_VERIFICATION_TOKEN is not set — /api/kofi/webhook will reject all requests until the env var is configured"
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/kofi/webhook
 * Receive Ko-fi donation notifications.
 * KOFI_VERIFICATION_TOKEN is REQUIRED (fail closed). If absent, every webhook
 * is rejected so that fake payloads cannot seed ek_donor_emails.
 */
kofiRouter.post("/kofi/webhook", async (req, res) => {
  try {
    const token = process.env["KOFI_VERIFICATION_TOKEN"];
    if (!token) {
      logger.warn("kofi/webhook called but KOFI_VERIFICATION_TOKEN is not configured — rejecting");
      res.status(503).json({ error: "webhook not configured" });
      return;
    }

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
 * Phase 1 of donor claim flow. Accepts only an email address.
 * If the email matches a donation in ek_donor_emails, the server mints a
 * single-use, 15-minute claim token and returns it. The userId is NOT accepted
 * here — identity binding happens in /api/kofi/redeem.
 *
 * Any previous unused tokens for this email are invalidated so a fresh claim
 * always produces exactly one live token.
 */
kofiRouter.post("/kofi/claim", async (req, res) => {
  try {
    const { email } = req.body as Record<string, string>;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "email required" }); return;
    }

    const normalized = email.toLowerCase().trim();

    // Verify the email corresponds to a known donation
    const donorResult = await db.execute(sql`
      SELECT id FROM ek_donor_emails WHERE email = ${normalized} LIMIT 1
    `);
    if (!donorResult.rows || donorResult.rows.length === 0) {
      res.status(404).json({ error: "not_found" }); return;
    }

    const donorEmailId = (donorResult.rows[0] as Record<string, unknown>)["id"];

    // Invalidate any still-pending (unredeemed) tokens for this email
    await db.execute(sql`
      DELETE FROM ek_claim_tokens
      WHERE donor_email_id = ${donorEmailId} AND redeemed_by IS NULL
    `);

    // Mint a fresh single-use token
    const claimToken = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await db.execute(sql`
      INSERT INTO ek_claim_tokens (token, donor_email_id, expires_at)
      VALUES (${claimToken}, ${donorEmailId}, ${expiresAt.toISOString()})
    `);

    res.json({ ok: true, claimToken });
  } catch { res.status(500).json({ error: "claim error" }); }
});

/**
 * POST /api/kofi/redeem
 * Phase 2 of donor claim flow. Accepts the server-issued claimToken and the
 * player's userId. The token was minted by the server in /api/kofi/claim after
 * verifying the donor email — it cannot be forged by the client.
 *
 * Security properties:
 * - Single-use: token is marked redeemed_by on first use
 * - Time-bounded: expires 15 minutes after creation
 * - Binding: once redeemed by a userId it cannot be used again
 */
kofiRouter.post("/kofi/redeem", async (req, res) => {
  try {
    const { userId, claimToken } = req.body as Record<string, string>;
    if (!userId || !claimToken || userId.length > 64) {
      res.status(400).json({ error: "userId and claimToken required" }); return;
    }

    // Look up the token
    const tokenResult = await db.execute(sql`
      SELECT id, redeemed_by, expires_at FROM ek_claim_tokens
      WHERE token = ${claimToken}
      LIMIT 1
    `);

    if (!tokenResult.rows || tokenResult.rows.length === 0) {
      res.status(404).json({ error: "invalid_token" }); return;
    }

    const row = tokenResult.rows[0] as Record<string, unknown>;
    const tokenId = row["id"];
    const redeemedBy = row["redeemed_by"];
    const expiresAt = new Date(row["expires_at"] as string);

    // Reject expired tokens
    if (Date.now() > expiresAt.getTime()) {
      res.status(410).json({ error: "token_expired" }); return;
    }

    // Allow idempotent re-use by the same player; reject use by another player
    if (redeemedBy !== null && redeemedBy !== undefined) {
      if (redeemedBy === userId) {
        res.json({ ok: true, isDonor: true }); return;
      }
      res.status(409).json({ error: "token_already_redeemed" }); return;
    }

    // Mark token as redeemed
    await db.execute(sql`
      UPDATE ek_claim_tokens
      SET redeemed_by = ${userId}, redeemed_at = NOW()
      WHERE id = ${tokenId}
    `);

    // Grant donor status (upsert)
    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, is_donor)
      VALUES (${userId}, 'プレイヤー', TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_donor = TRUE
    `);

    res.json({ ok: true, isDonor: true });
  } catch { res.status(500).json({ error: "redeem error" }); }
});

/**
 * POST /api/admin/set-donor
 * Manually grant donor status. The ADMIN_SECRET env var is REQUIRED; the
 * endpoint is disabled (503) when the secret is not configured (fail closed).
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
