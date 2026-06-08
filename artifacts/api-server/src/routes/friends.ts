import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const friendsRouter = Router();

db.execute(sql`
  CREATE TABLE IF NOT EXISTS ek_friends (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    friend_user_id TEXT NOT NULL,
    friend_name TEXT NOT NULL DEFAULT '',
    friend_icon TEXT NOT NULL DEFAULT '🎮',
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, friend_user_id)
  )
`).catch(console.error);

friendsRouter.get("/friends/:userId", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT friend_user_id, friend_name, friend_icon
      FROM ek_friends
      WHERE user_id = ${req.params.userId}
      ORDER BY added_at DESC
      LIMIT 10
    `);
    res.json(result.rows || []);
  } catch {
    res.status(500).json({ error: "Failed to get friends" });
  }
});

friendsRouter.post("/friends", async (req, res) => {
  const { userId, friendUserId, friendName, friendIcon } = req.body as Record<string, string>;
  if (!userId || !friendUserId || userId === friendUserId) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const count = await db.execute(sql`SELECT COUNT(*) AS c FROM ek_friends WHERE user_id = ${userId}`);
    const c = Number((count.rows[0] as Record<string, unknown>)?.c ?? 0);
    if (c >= 10) return res.status(400).json({ error: "フレンド上限は10人です" });
    await db.execute(sql`
      INSERT INTO ek_friends (user_id, friend_user_id, friend_name, friend_icon)
      VALUES (${userId}, ${friendUserId}, ${friendName || 'プレイヤー'}, ${friendIcon || '🎮'})
      ON CONFLICT (user_id, friend_user_id) DO UPDATE SET friend_name = EXCLUDED.friend_name, friend_icon = EXCLUDED.friend_icon
    `);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to add friend" });
  }
});

friendsRouter.delete("/friends", async (req, res) => {
  const { userId, friendUserId } = req.body as Record<string, string>;
  if (!userId || !friendUserId) return res.status(400).json({ error: "Invalid" });
  try {
    await db.execute(sql`DELETE FROM ek_friends WHERE user_id = ${userId} AND friend_user_id = ${friendUserId}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to remove friend" });
  }
});

export default friendsRouter;
