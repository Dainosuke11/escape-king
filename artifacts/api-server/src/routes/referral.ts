import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";

const referralRouter = Router();

const UNLOCK_ORDER = [
  'knight','assassin','infantry','mage','thief','beastmaster','macho','cyborg',
  'alien','mandrake','ryujin','shark_warrior','orca_pirate','clown','necromancer',
  'angel','world_manager','onmyoji','devil','mafia','dwarf','sentai_hero','sennin',
  'pixie','hitokiri_musha','guru','miko','barbarian','painter',
];
const BONUS_STAGE_ORDER = [
  'forest','desert','demon','castle','bigriver','mountain','graveyard',
  'nighttown','skyfort','chaos','dungeon','underwater','lavaland',
  'misty_lake','colosseum','factory','volcano_summit',
];
const REWARD_COUNT = 5;

// ─── DB setup ──────────────────────────────────────────────────────────────
db.execute(sql`
  CREATE TABLE IF NOT EXISTS ek_referral_codes (
    code TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    used_by_user_id TEXT,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(console.error);

db.execute(sql`
  ALTER TABLE ek_players ADD COLUMN IF NOT EXISTS referral_bonus_stages JSONB NOT NULL DEFAULT '[]'::jsonb
`).catch(console.error);

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes as Uint8Array).map((b: number) => chars[b % chars.length]).join('');
}

function pickNext(order: string[], already: string[], count: number): string[] {
  const result: string[] = [];
  for (const item of order) {
    if (result.length >= count) break;
    if (!already.includes(item)) result.push(item);
  }
  return result;
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/referral/my-code/:userId
 * Returns the invite code for the given user, generating one if needed.
 */
referralRouter.get("/referral/my-code/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId.length > 64) {
      res.status(400).json({ error: "invalid userId" }); return;
    }
    const existing = await db.execute(sql`
      SELECT code, used_by_user_id FROM ek_referral_codes
      WHERE owner_user_id = ${userId} LIMIT 1
    `);
    if (existing.rows && existing.rows.length > 0) {
      const row = existing.rows[0] as Record<string, unknown>;
      res.json({ code: row["code"], used: row["used_by_user_id"] !== null && row["used_by_user_id"] !== undefined });
      return;
    }
    let code = '';
    for (let i = 0; i < 10; i++) {
      const candidate = generateCode();
      const check = await db.execute(sql`
        SELECT code FROM ek_referral_codes WHERE code = ${candidate} LIMIT 1
      `);
      if (!check.rows || check.rows.length === 0) { code = candidate; break; }
    }
    if (!code) { res.status(500).json({ error: "code generation failed" }); return; }
    await db.execute(sql`
      INSERT INTO ek_referral_codes (code, owner_user_id) VALUES (${code}, ${userId})
      ON CONFLICT DO NOTHING
    `);
    res.json({ code, used: false });
  } catch { res.status(500).json({ error: "db error" }); }
});

/**
 * POST /api/referral/use
 * Uses an invite code. Grants 5 jobs + 5 stages to both the user and the code owner.
 * One-time use per code; one use per player.
 */
referralRouter.post("/referral/use", async (req, res) => {
  try {
    const { userId, code } = req.body as Record<string, string>;
    if (!userId || !code || userId.length > 64 || code.length > 16) {
      res.status(400).json({ error: "invalid params" }); return;
    }
    const normalizedCode = code.toUpperCase().trim();

    const codeResult = await db.execute(sql`
      SELECT code, owner_user_id, used_by_user_id
      FROM ek_referral_codes WHERE code = ${normalizedCode} LIMIT 1
    `);
    if (!codeResult.rows || codeResult.rows.length === 0) {
      res.status(404).json({ error: "code_not_found" }); return;
    }
    const codeRow = codeResult.rows[0] as Record<string, unknown>;
    const ownerUserId = codeRow["owner_user_id"] as string;
    const usedBy = codeRow["used_by_user_id"];

    if (ownerUserId === userId) { res.status(400).json({ error: "own_code" }); return; }
    if (usedBy !== null && usedBy !== undefined) { res.status(409).json({ error: "already_used" }); return; }

    const alreadyUsedCheck = await db.execute(sql`
      SELECT code FROM ek_referral_codes WHERE used_by_user_id = ${userId} LIMIT 1
    `);
    if (alreadyUsedCheck.rows && alreadyUsedCheck.rows.length > 0) {
      res.status(409).json({ error: "already_used_code" }); return;
    }

    // Fetch user data
    const userResult = await db.execute(sql`
      SELECT unlocked_jobs, referral_bonus_stages FROM ek_players WHERE user_id = ${userId} LIMIT 1
    `);
    const userRow = userResult.rows?.[0] as Record<string, unknown> | undefined;
    const userJobs: string[] = Array.isArray(userRow?.["unlocked_jobs"]) ? (userRow!["unlocked_jobs"] as string[]) : [];
    const userBonusStages: string[] = Array.isArray(userRow?.["referral_bonus_stages"]) ? (userRow!["referral_bonus_stages"] as string[]) : [];

    // Fetch owner data
    const ownerResult = await db.execute(sql`
      SELECT unlocked_jobs, referral_bonus_stages FROM ek_players WHERE user_id = ${ownerUserId} LIMIT 1
    `);
    const ownerRow = ownerResult.rows?.[0] as Record<string, unknown> | undefined;
    const ownerJobs: string[] = Array.isArray(ownerRow?.["unlocked_jobs"]) ? (ownerRow!["unlocked_jobs"] as string[]) : [];
    const ownerBonusStages: string[] = Array.isArray(ownerRow?.["referral_bonus_stages"]) ? (ownerRow!["referral_bonus_stages"] as string[]) : [];

    // Compute rewards
    const newUserJobs = pickNext(UNLOCK_ORDER, userJobs, REWARD_COUNT);
    const newOwnerJobs = pickNext(UNLOCK_ORDER, ownerJobs, REWARD_COUNT);
    const newUserStages = pickNext(BONUS_STAGE_ORDER, userBonusStages, REWARD_COUNT);
    const newOwnerStages = pickNext(BONUS_STAGE_ORDER, ownerBonusStages, REWARD_COUNT);

    const updatedUserJobs = [...new Set([...userJobs, ...newUserJobs])];
    const updatedUserStages = [...new Set([...userBonusStages, ...newUserStages])];
    const updatedOwnerJobs = [...new Set([...ownerJobs, ...newOwnerJobs])];
    const updatedOwnerStages = [...new Set([...ownerBonusStages, ...newOwnerStages])];

    // Apply to user
    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, unlocked_jobs, referral_bonus_stages)
      VALUES (${userId}, 'プレイヤー', ${JSON.stringify(updatedUserJobs)}::jsonb, ${JSON.stringify(updatedUserStages)}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        unlocked_jobs = ${JSON.stringify(updatedUserJobs)}::jsonb,
        referral_bonus_stages = ${JSON.stringify(updatedUserStages)}::jsonb
    `);

    // Apply to owner
    await db.execute(sql`
      INSERT INTO ek_players (user_id, player_name, unlocked_jobs, referral_bonus_stages)
      VALUES (${ownerUserId}, 'プレイヤー', ${JSON.stringify(updatedOwnerJobs)}::jsonb, ${JSON.stringify(updatedOwnerStages)}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        unlocked_jobs = ${JSON.stringify(updatedOwnerJobs)}::jsonb,
        referral_bonus_stages = ${JSON.stringify(updatedOwnerStages)}::jsonb
    `);

    // Mark code as used
    await db.execute(sql`
      UPDATE ek_referral_codes
      SET used_by_user_id = ${userId}, used_at = NOW()
      WHERE code = ${normalizedCode}
    `);

    res.json({ ok: true, newJobs: newUserJobs, newStages: newUserStages });
  } catch { res.status(500).json({ error: "db error" }); }
});

export default referralRouter;
