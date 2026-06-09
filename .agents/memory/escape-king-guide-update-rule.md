---
name: Escape the King guide update rule
description: User preference — always update キャラ図鑑 text whenever ability changes are made.
---

# Escape the King — キャラ図鑑更新ルール

## The rule
アビリティを追加・変更・削除するたびに、必ず関連するキャラ図鑑テキストも同時に更新する。

**Why:** ユーザーから「アップデートのたびにキャラ図鑑も最新のものにして」と明示的に指示があった。

## How to apply
アビリティ変更があるたびに、以下の3箇所を確認・更新する：

1. **NPC_DATAのnote**（index.html 3300行台〜）
   - 対象ユニットの note フィールドを最新アビリティ名・効果に合わせて書き換える
   - 例: 召喚元アビリティ名が変わったらnoteの呼称も変える

2. **JOB_HINT_DATAのnote**（index.html 2416行台〜）
   - 対象ジョブの note フィールドに主要アビリティの簡易説明を列挙する
   - 新アビリティ追加時は追記、削除時は除去、数値変更時は数値更新

3. **ABILITY_NAMES（短縮）とABILITY_TIPS（詳細）**（index.html 1760行台・1982行台〜）
   - 既存エントリの文言を最新効果・回数に合わせて修正する
   - アビリティ名が変わった場合は古いキーを削除して新キーを追加する
