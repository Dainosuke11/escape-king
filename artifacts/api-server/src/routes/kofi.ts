import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const kofiRouter = Router();

// Ensure ek_donor_emails table exists and is_donor column exists on ek_players
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

// POST /api/kofi/webhook — receive Ko-fi donation notifications
kofiRouter.post("/kofi/webhook", async (req, res) => {
  try {
    // Ko-fi sends the payload as form-encoded `data` field containing a JSON string
    const rawData = req.body?.data;
    if (!rawData) {
      res.status(400).json({ error: "missing data" });
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(rawData));
    } catch {
      res.status(400).json({ error: "invalid data json" });
      return;
    }

    // Verify token if configured
    const token = process.env["KOFI_VERIFICATION_TOKEN"];
    if (token && payload["verification_token"] !== token) {
      res.status(403).json({ error: "invalid token" });
      return;
    }

    const email = typeof payload["email"] === "string" ? payload["email"].toLowerCase().trim() : null;
    const txId = typeof payload["kofi_transaction_id"] === "string" ? payload["kofi_transaction_id"] : null;

    if (!email || !txId) {
      res.status(400).json({ error: "missing email or transaction id" });
      return;
    }

    await db.execute(sql`
      INSERT INTO ek_donor_emails (email, kofi_transaction_id)
      VALUES (${email}, ${txId})
      ON CONFLICT (kofi_transaction_id) DO NOTHING
    `);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "webhook error" });
  }
});

// POST /api/kofi/claim — player claims donor status by submitting their Ko-fi email
kofiRouter.post("/kofi/claim", async (req, res) => {
  try {
    const { userId, email } = req.body as Record<string, string>;
    if (!userId || !email || userId.length > 64) {
      res.status(400).json({ error: "userId and email required" });
      return;
    }

    const normalized = email.toLowerCase().trim();

    // Check for an unclaimed donation matching this email
    const result = await db.execute(sql`
      SELECT id FROM ek_donor_emails
      WHERE email = ${normalized}
      LIMIT 1
    `);

    if (!result.rows || result.rows.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const rowId = (result.rows[0] as Record<string, unknown>)["id"];

    // Mark the donation as claimed by this player
    await db.execute(sql`
      UPDATE ek_donor_emails SET claimed_by_player_id = ${userId} WHERE id = ${rowId}
    `);

    // Set is_donor = true on the player record (upsert)
    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, is_donor)
      VALUES (${userId}, 'プレイヤー', TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_donor = TRUE
    `);

    res.json({ ok: true, isDonor: true });
  } catch {
    res.status(500).json({ error: "claim error" });
  }
});

// POST /api/admin/set-donor — manually grant donor status (authenticated by ADMIN_SECRET header)
kofiRouter.post("/admin/set-donor", async (req, res) => {
  try {
    const adminSecret = process.env["ADMIN_SECRET"];
    if (adminSecret && req.headers["admin-secret"] !== adminSecret) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { userId } = req.body as Record<string, string>;
    if (!userId || userId.length > 64) {
      res.status(400).json({ error: "userId required" });
      return;
    }

    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, is_donor)
      VALUES (${userId}, 'プレイヤー', TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_donor = TRUE
    `);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "admin error" });
  }
});

export default kofiRouter;
