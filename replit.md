# Escape the King

将棋×囲碁ハイブリッドのオンライン対戦ストラテジーゲーム。

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## GitHub Backup

コードは以下のGitHubリポジトリにバックアップされています。

- **リポジトリ**: https://github.com/Dainosuke11/escape-king
- **ブランチ**: `main`
- **連携方法**: ReplitのGitHubインテグレーション（Replit connectors SDK）

### 今後のコミットをGitHubへpushする方法

Replitは毎チェックポイントで `gitsafe-backup` リモートに自動保存しますが、GitHubへの同期は現在手動またはAPI経由です。

**方法1: ReplitのGit連携UI（推奨）**
- Replitの左サイドバー「Git」タブから「Connect to GitHub」を選択
- リポジトリを選択するとPushボタンが使えるようになります

**方法2: Replit GitHub Integrationを使った自動化**
- 今後 `scripts/post-merge.sh` にpushステップを追加することで自動化可能（Task #177参照）

### バックアップ済み確認（2026-06-09時点）
- GitHub最新コミット: `6424af67` — `.env` を `.gitignore` に追加
- 全ファイルがGitHub mainブランチに同期済み

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
