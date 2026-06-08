# HHC アーキテクチャ & デプロイ要件

このリポジトリから（Codespaces に限らず）一般的にシステムを構築・運用する際に**何を用意する必要があるか**をまとめます。コマンドは英語のまま、解説は日本語です。

## 1. 構成（モノレポ）

npm workspaces の3パッケージ:

- **`shared/`** … 指標KB・決定論スコアリング・スキーマ・ガードレール（依存ゼロの「真実のソース」）。
- **`web/`** … React + Vite の UI（JA/EN）。第1層（チェックリスト＋スコア）は鍵もネットも不要。
- **`agent/`** … Node 22 + Fastify。Anthropicキー・暗号化DB・認証・監査を保持。**APIキーは常にサーバ側**。

### 実行モード（2つ）
| モード | 起動 | 公開エッジ | 用途 |
|---|---|---|---|
| 開発 | `npm run dev` | Vite `5173`（`/api`→agent `8787` をプロキシ） | 開発・HMR |
| 配信 | `npm run serve` | Fastify `8787`（SPA＋APIを直接配信・`0.0.0.0`・`trustProxy`） | 本番・**実IP取得が必要なとき** |

`npm run serve` は `HHC_SERVE_WEB=1 HHC_AUTH=1` を設定し、`web` をビルドして Fastify が静的配信します。

## 2. 用意するもの（最低限 → 任意）

| 区分 | 項目 | 必須？ | 内容 |
|---|---|---|---|
| ランタイム | Node.js 20+（22推奨）, npm | 必須 | `npm install` で native の SQLCipher ドライバをビルド（C/C++ツールチェーンが要る環境あり。多くは prebuild で不要） |
| 認証 | `HHC_AUTH=1` | ログイン運用に必須 | 全体をログイン必須化 |
| 認証 | `HHC_DB_KEY` | 認証時は必須 | 暗号化DB（アカウント・セッション・監査・案件履歴）の鍵。**紛失=復旧不可・変更=既存DB読めず** |
| 認証 | `HHC_SESSION_SECRET` | 認証時は必須 | セッション署名＋TOTP秘密鍵の封緘。`openssl rand -base64 48` |
| 認証 | `HHC_ADMIN_EMAIL` / `HHC_ADMIN_INITIAL_PASSWORD` | 初回のみ必須 | 初回起動で最初のAdminを作成（初回ログインでPW変更＋MFA登録を強制） |
| DB | （外部DB不要） | — | **組込み SQLite(SQLCipher) ファイル** `data/hhc-cases.db`。DBサーバの構築は不要。`data/` を**永続化**すること |
| AI | `ANTHROPIC_API_KEY`（or `HHC_KEY`） | 任意 | §6解析・§7 OSINT。無くても第1層は動作 |
| メール | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | 任意 | **招待メール**と**メールMFA**に使用。未設定なら招待は画面のリンク共有、MFAはTOTPを使用 |
| OSINT | `HHC_HOUJIN_APP_ID` / `HHC_GBIZ_INFO_API_KEY` / `HHC_OPENCORPORATES_TOKEN` / `HHC_OPENSANCTIONS_API_KEY` / `HHC_TRADEGOV_API_KEY` | 任意 | 各外部ソース。未設定はそのソースのみ「未照会」 |
| 監査 | `HHC_AUDIT_RETENTION_DAYS`（既定30） | 任意 | 監査ログ自動削除の保持日数（0=無期限） |
| 監査 | `HHC_GEO_ENABLED` / `HHC_GEO_BASE_URL` | 任意 | アクセス元IPの地理判定（キー不要・劣化あり） |
| 監査 | `HHC_SIEM_URL` / `HHC_SIEM_TOKEN` / `HHC_SIEM_FORMAT` | 任意 | 監査イベントを Splunk HEC / 汎用Webhook へ転送 |
| 配信 | TLSリバースプロキシ | 本番推奨 | 下記参照 |

全変数の説明は [`.env.example`](../.env.example)。

## 3. 一般的な本番デプロイ手順

```bash
npm ci                 # 依存インストール（SQLCipherビルド）
npm test               # 任意：ネット・鍵不要のテスト
# .env を用意（上表の必須＋任意）。または環境変数で注入。
npm run serve          # build → Fastify が 8787 で SPA+API を配信（HHC_AUTH=1）
```

- **TLS / リバースプロキシ**：本番は nginx / Caddy / クラウドLB を前段に置き、TLS終端し `8787` へ転送。
  - 実クライアントIPのため **`X-Forwarded-For` / `X-Forwarded-Proto`** を付与（Fastify `trustProxy` が読みます）。
  - HTTPS により Cookie は `Secure`（配信モードで自動付与）。
- **プロセス管理**：systemd / pm2 / コンテナで常駐化。クラッシュ時自動再起動。
- **データ永続化**：`data/`（暗号化DB）を永続ボリュームに。コンテナなら volume マウント必須。
- **バックアップ**：アプリの「案件履歴」→ **age暗号化エクスポート(.age)**。アカウント/監査もDBファイルごとバックアップ可（鍵は別管理）。

### Docker 例（要点）
- `mcr.microsoft.com/devcontainers/typescript-node:22` 等で `npm ci && npm run build`。
- `CMD HHC_SERVE_WEB=1 HHC_AUTH=1 node --import tsx agent/src/server.ts`（または `npm run serve`）。
- `data/` を volume に。シークレットは環境変数/シークレットストアから注入。`8787` のみ公開し前段にTLSプロキシ。

## 4. データと永続化

- すべて **1つの SQLCipher ファイル** `data/hhc-cases.db` に格納（`subjects`/`inquiries`/`evidence_cache`/`users`/`mfa`/`sessions`/`login_attempts`/`invitations`/`audit_logs`）。保存時暗号化。
- **エクスポート/インポート**：案件データは age 暗号化（`.age`）でポータブル。**認証情報・監査は .age に含めません**（資格情報の持ち出し防止）。
- スキーマは起動時に冪等適用（`CREATE TABLE IF NOT EXISTS` ＋列追加マイグレーション）。

## 5. ネットワーク / ポート

- 受信：公開するのは配信ポート（既定 `8787`）のみ。
- 送信（任意・設定時のみ）：Anthropic API、各OSINTソース、SMTP、SIEM、Geo API。閉域では遮断されても**優雅に劣化**（第1層は完全オフライン可、`HHC_OFFLINE=1`）。

## 6. セキュリティ要点

- パスワード=scrypt、TOTP秘密鍵=AES-GCM封緘、セッショントークン=sha256保存（生値はCookieのみ）。
- パスワード/コード/鍵/貼付本文は**ログに出さない**。監査は人口統計学的属性を持たない。
- ログインロックアウト・列挙対策・MFA（TOTP/メール）・ロール認可（Admin/User）。
- 監査は保持期間で自動削除、SIEM転送、CSV/JSONエクスポート。

## 7. スケール・制約（重要）

- 現状は**単一ノード前提**：OSINTジョブは**プロセス内メモリ**、DBは**ローカルSQLiteファイル**。
- そのため**水平スケール（複数インスタンス）は非対応**（セッション/ジョブ/DBが共有されない）。可用性が必要なら単一の常駐＋自動再起動＋バックアップで運用してください。将来的に共有DB（Postgres等）やセッションストア外出しが必要なら `agent/src/db/db.ts`（ドライバ隔離）と `authStore`/`auditStore` を差し替える設計です。

---
関連: [README](../README.md) ・ [起動ガイド（Codespaces）](起動ガイド.md) ・ [管理者ガイド](管理者ガイド.md)
