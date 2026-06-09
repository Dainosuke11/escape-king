# scripts

このディレクトリにはゲーム運用用のユーティリティスクリプトが入っています。

## DBバックアップ

### 実行方法

```bash
pnpm db:backup
```

実行すると `backups/` ディレクトリに以下の形式のファイルが生成されます:

```
backups/backup_YYYY-MM-DD_HH-MM-SS.json
```

### バックアップ対象テーブル

| テーブル | 内容 |
|---|---|
| `ek_players` | プレイヤープロフィール・ランク・ドナー状態 |
| `ek_donor_emails` | Ko-fi 寄付メールアドレス記録 |
| `ek_friends` | フレンドリスト |
| `ek_claim_tokens` | 寄付特典クレームトークン |

### 前提条件

- `DATABASE_URL` 環境変数が設定されていること
- Replit 環境では自動で設定されています

### リストア方法

`backups/*.json` ファイルには全テーブルのデータが JSON 形式で保存されています。
必要に応じて psql や Node.js スクリプトでインポートしてください。

### 注意

- `backups/` ディレクトリは `.gitignore` に追加することを推奨します（個人情報を含むため）
