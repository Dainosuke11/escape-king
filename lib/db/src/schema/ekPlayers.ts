import { pgTable, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ekPlayersTable = pgTable("ek_players", {
  userId: varchar("user_id", { length: 64 }).primaryKey(),
  playerName: varchar("player_name", { length: 64 }).notNull().default("プレイヤー"),
  rank: integer("rank").notNull().default(1),
  rp: integer("rp").notNull().default(0),
  spWins: integer("sp_wins").notNull().default(0),
  profileIcon: varchar("profile_icon", { length: 8 }).default("🎮"),
  favoriteElement: varchar("favorite_element", { length: 16 }).default("none"),
  favoriteStage: varchar("favorite_stage", { length: 32 }).default(""),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  charUsage: jsonb("char_usage").default({}),
  charWins: jsonb("char_wins").default({}),
  unlockedJobs: jsonb("unlocked_jobs").default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEkPlayerSchema = createInsertSchema(ekPlayersTable).omit({ updatedAt: true });
export type InsertEkPlayer = z.infer<typeof insertEkPlayerSchema>;
export type EkPlayer = typeof ekPlayersTable.$inferSelect;
