/**
 * DBバックアップスクリプト
 *
 * 使い方:
 *   pnpm db:backup
 *
 * 実行すると backups/ ディレクトリに以下のファイルが生成されます:
 *   backup_YYYY-MM-DD_HH-MM-SS.json
 *
 * 前提条件:
 *   DATABASE_URL 環境変数が設定されていること
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Client } = pg;

const TABLES = [
  "ek_players",
  "ek_donor_emails",
  "ek_friends",
  "ek_claim_tokens",
] as const;

async function backup() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL が設定されていません");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .replace(/\..+/, "");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const backupsDir = path.resolve(__dirname, "../../backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  const outPath = path.join(backupsDir, `backup_${ts}.json`);

  const result: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    try {
      const res = await client.query(`SELECT * FROM ${table}`);
      result[table] = res.rows;
      console.log(`  ✅ ${table}: ${res.rows.length} 件`);
    } catch (err) {
      console.warn(`  ⚠️  ${table}: スキップ (${(err as Error).message})`);
      result[table] = [];
    }
  }

  await client.end();

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n📦 バックアップ完了: ${outPath}`);
}

backup().catch((err) => {
  console.error("❌ バックアップ失敗:", err);
  process.exit(1);
});
