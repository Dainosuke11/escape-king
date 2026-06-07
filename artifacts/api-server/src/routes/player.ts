import { Router } from "express";
import { db } from "@workspace/db";
import { ekPlayersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

// GET /api/player/:userId — fetch player data
router.get("/player/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId.length > 64) {
      res.status(400).json({ error: "invalid userId" });
      return;
    }
    const rows = await db.select().from(ekPlayersTable).where(eq(ekPlayersTable.userId, userId));
    if (rows.length === 0) {
      res.json({ userId, playerName: "プレイヤー", rank: 1, rp: 0, spWins: 0 });
      return;
    }
    const p = rows[0]!;
    res.json({ userId: p.userId, playerName: p.playerName, rank: p.rank, rp: p.rp, spWins: p.spWins });
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

// POST /api/player — upsert player data
router.post("/player", async (req, res) => {
  try {
    const { userId, playerName, rank, rp, spWins } = req.body as Record<string, unknown>;
    if (!userId || typeof userId !== "string" || userId.length > 64) {
      res.status(400).json({ error: "invalid userId" });
      return;
    }
    const safeRank = typeof rank === "number" ? Math.max(1, Math.floor(rank)) : 1;
    const safeRp = typeof rp === "number" ? Math.max(0, Math.floor(rp)) : 0;
    const safeWins = typeof spWins === "number" ? Math.max(0, Math.floor(spWins)) : 0;
    const safeName = typeof playerName === "string" ? playerName.slice(0, 64) : "プレイヤー";

    await db
      .insert(ekPlayersTable)
      .values({ userId, playerName: safeName, rank: safeRank, rp: safeRp, spWins: safeWins })
      .onConflictDoUpdate({
        target: ekPlayersTable.userId,
        set: { playerName: safeName, rank: safeRank, rp: safeRp, spWins: safeWins, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/leaderboard — top 20 players by RP desc
router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(ekPlayersTable)
      .orderBy(desc(ekPlayersTable.rp))
      .limit(20);
    res.json(
      rows.map((p) => ({
        userId: p.userId,
        playerName: p.playerName,
        rank: p.rank,
        rp: p.rp,
      })),
    );
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

export default router;
