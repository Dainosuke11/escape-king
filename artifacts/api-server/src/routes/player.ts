import { Router } from "express";
import { db } from "@workspace/db";
import { ekPlayersTable } from "@workspace/db/schema";
import { eq, desc, asc } from "drizzle-orm";

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
      res.json({ userId, playerName: "プレイヤー", rank: 1, rp: 0, spWins: 0, profileIcon: "🎮", favoriteElement: "none", favoriteStage: "", wins: 0, losses: 0, draws: 0, charUsage: {}, charWins: {}, unlockedJobs: [] });
      return;
    }
    const p = rows[0]!;
    res.json({
      userId: p.userId,
      playerName: p.playerName,
      rank: p.rank,
      rp: p.rp,
      spWins: p.spWins,
      profileIcon: p.profileIcon ?? "🎮",
      favoriteElement: p.favoriteElement ?? "none",
      favoriteStage: p.favoriteStage ?? "",
      wins: p.wins ?? 0,
      losses: p.losses ?? 0,
      draws: p.draws ?? 0,
      charUsage: (p.charUsage as Record<string, number>) ?? {},
      charWins: (p.charWins as Record<string, number>) ?? {},
      unlockedJobs: (p.unlockedJobs as string[]) ?? [],
    });
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

// POST /api/player — upsert player data
router.post("/player", async (req, res) => {
  try {
    const { userId, playerName, rank, rp, spWins, profileIcon, favoriteElement, favoriteStage, charUsage, charWins, unlockedJobs } = req.body as Record<string, unknown>;
    if (!userId || typeof userId !== "string" || userId.length > 64) {
      res.status(400).json({ error: "invalid userId" });
      return;
    }
    const safeRank = typeof rank === "number" ? Math.max(1, Math.floor(rank)) : 1;
    const safeRp = typeof rp === "number" ? Math.max(0, Math.floor(rp)) : 0;
    const safeWins = typeof spWins === "number" ? Math.max(0, Math.floor(spWins)) : 0;
    const safeName = typeof playerName === "string" ? playerName.slice(0, 64) : "プレイヤー";
    const safeIcon = typeof profileIcon === "string" ? profileIcon.slice(0, 8) : "🎮";
    const safeElement = typeof favoriteElement === "string" ? favoriteElement.slice(0, 16) : "none";
    const safeStage = typeof favoriteStage === "string" ? favoriteStage.slice(0, 32) : "";
    const safeCharUsage = (charUsage && typeof charUsage === "object" && !Array.isArray(charUsage))
      ? Object.fromEntries(Object.entries(charUsage as Record<string, unknown>).slice(0, 50).map(([k, v]) => [k.slice(0, 32), Math.max(0, Math.floor(Number(v) || 0))]))
      : {};
    const safeCharWins = (charWins && typeof charWins === "object" && !Array.isArray(charWins))
      ? Object.fromEntries(Object.entries(charWins as Record<string, unknown>).slice(0, 50).map(([k, v]) => [k.slice(0, 32), Math.max(0, Math.floor(Number(v) || 0))]))
      : {};
    const safeUnlockedJobs = (Array.isArray(unlockedJobs))
      ? unlockedJobs.filter((j): j is string => typeof j === "string").map((j) => j.slice(0, 32)).slice(0, 100)
      : [];

    // Note: wins/losses/draws are NOT client-settable — only the server increments them via finishRanked().
    await db
      .insert(ekPlayersTable)
      .values({
        userId,
        playerName: safeName,
        rank: safeRank,
        rp: safeRp,
        spWins: safeWins,
        profileIcon: safeIcon,
        favoriteElement: safeElement,
        favoriteStage: safeStage,
        charUsage: safeCharUsage,
        charWins: safeCharWins,
        unlockedJobs: safeUnlockedJobs,
      })
      .onConflictDoUpdate({
        target: ekPlayersTable.userId,
        set: {
          playerName: safeName,
          rank: safeRank,
          rp: safeRp,
          spWins: safeWins,
          profileIcon: safeIcon,
          favoriteElement: safeElement,
          favoriteStage: safeStage,
          charUsage: safeCharUsage,
          charWins: safeCharWins,
          unlockedJobs: safeUnlockedJobs,
          updatedAt: new Date(),
        },
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
        profileIcon: p.profileIcon ?? "🎮",
      })),
    );
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/leaderboard/tiers — top 10 per rank tier, grouped by rank
router.get("/leaderboard/tiers", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(ekPlayersTable)
      .orderBy(asc(ekPlayersTable.rank), desc(ekPlayersTable.rp));
    const tiers: Record<number, { userId: string; playerName: string; rank: number; rp: number; profileIcon: string }[]> = {};
    for (const p of rows) {
      if (!tiers[p.rank]) tiers[p.rank] = [];
      if (tiers[p.rank].length < 10) {
        tiers[p.rank].push({ userId: p.userId, playerName: p.playerName, rank: p.rank, rp: p.rp, profileIcon: p.profileIcon ?? "🎮" });
      }
    }
    res.json(tiers);
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/profile/:userId — fetch full profile including stats (for opponent display)
router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId.length > 64) {
      res.status(400).json({ error: "invalid userId" });
      return;
    }
    const rows = await db.select().from(ekPlayersTable).where(eq(ekPlayersTable.userId, userId));
    if (rows.length === 0) {
      res.json({ userId, playerName: "プレイヤー", rank: 1, rp: 0, profileIcon: "🎮", favoriteElement: "none", favoriteStage: "", wins: 0, losses: 0, draws: 0, charUsage: {} });
      return;
    }
    const p = rows[0]!;
    res.json({
      userId: p.userId,
      playerName: p.playerName,
      rank: p.rank,
      rp: p.rp,
      profileIcon: p.profileIcon ?? "🎮",
      favoriteElement: p.favoriteElement ?? "none",
      favoriteStage: p.favoriteStage ?? "",
      wins: p.wins ?? 0,
      losses: p.losses ?? 0,
      draws: p.draws ?? 0,
      charUsage: (p.charUsage as Record<string, number>) ?? {},
      charWins: (p.charWins as Record<string, number>) ?? {},
    });
  } catch (e) {
    res.status(500).json({ error: "db error" });
  }
});

export default router;
