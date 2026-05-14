# takos-computer

AI エージェント向けのコンテナ化サンドボックス実行環境を、MCP
と簡易ダッシュボードで公開する独立 product です。Cloudflare Workers + Containers
上で動作し、サンドボックスコンテナとワーカー側のダッシュボード /
プロキシ層に分かれています。

Takos ディストリビューションに同梱される 1st-party InstallableApp として
Takosumi 上で動作します。サンドボックス / MCP 表面自体は Takos
固有の結合を持たず、任意の MCP 対応エージェントホストから利用できます。

## 主要技術

- Deno 2
- Hono 4
- MCP SDK
- Zod
- Cloudflare Containers
- SolidJS 1.9 + Vite 6.3

## パッケージ構成

### Container Apps

| Package     | Path            | 説明                                                           |
| ----------- | --------------- | -------------------------------------------------------------- |
| **sandbox** | `apps/sandbox/` | シェル実行・ファイル操作用の Deno ベースサンドボックスコンテナ |

### Service Packages

| Package                             | Path                        | 説明                                                                                |
| ----------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| **@takos-computer/sandbox-service** | `packages/sandbox-service/` | Hono MCP サーバー。`shell_exec`, `file_*`, `process_*` ツールを提供                 |
| **@takos-computer/computer-hosts**  | `packages/computer-hosts/`  | ダッシュボードプロキシ / サンドボックスホスト用 Cloudflare Workers エントリポイント |

### Shared Packages

| Package                               | Path                          | 説明                                                                                  |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| **@takos-computer/common**            | `packages/common/`            | logger, ID 生成, validation, error クラス, JWT helper, CF shim 等の共通ユーティリティ |
| **@takos-computer/cloudflare-compat** | `packages/cloudflare-compat/` | Cloudflare Workers 型の再エクスポート                                                 |
| **@takos-computer/dashboard**         | `packages/dashboard/`         | サンドボックスセッション一覧 / オープン用の SolidJS ダッシュボード                    |

## MCP ツールリファレンス

エージェントは公開された MCP Streamable HTTP エンドポイント `/mcp` を使います。
安定した `computer_*` ツールを公開し、サンドボックスセッションを作成 /
再利用して
コンテナにプロキシします。既にセッションプロキシトークンを持つ呼び出し元向けに
直接 `/session/:id/mcp` も利用可能です。

`POST` が MCP リクエスト用メソッドです。`OPTIONS` は許可メソッドを返します。
他の MCP メソッド (Streamable HTTP の server-to-client `GET` ストリームを含む)
は `405 Method Not Allowed` で fail-fast
し、サンドボックスコンテナにはプロキシしません。

### 公開 MCP ツール

| Tool                       | 説明                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `computer_session_create`  | サンドボックスセッションを作成 / 再利用。任意: `session_id`, `space_id`, `user_id`            |
| `computer_session_status`  | セッション状態を取得。任意: `session_id`                                                      |
| `computer_session_destroy` | セッションを破棄。任意: `session_id`                                                          |
| `computer_shell_exec`      | シェルコマンドを実行。`command`, `timeout_ms?`, `cwd?`, `env?`, `session_id?`                 |
| `computer_file_read`       | ワークスペースのファイルを読む。`path`, `offset?`, `limit?`, `encoding?`, `session_id?`       |
| `computer_file_write`      | ワークスペースのファイルを書く。`path`, `content`, `encoding?`, `create_dirs?`, `session_id?` |
| `computer_file_list`       | ディレクトリを一覧。`path`, `recursive?`, `glob?`, `session_id?`                              |
| `computer_file_info`       | ファイルメタデータを取得。`path`, `session_id?`                                               |
| `computer_process_list`    | 実行中プロセスを一覧。任意: `session_id`                                                      |
| `computer_process_kill`    | 管理プロセスを kill。`pid`, `signal?`, `session_id?`                                          |

### Sandbox Tools

| Tool           | 説明                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `shell_exec`   | シェルコマンド (bash -c) を実行。`command`, `timeout_ms?`, `cwd?`, `env?`, `allow_takos_token?`, `takos_token?` |
| `file_read`    | ワークスペースのファイルを読む。`path`, `offset?`, `limit?`, `encoding?`                                        |
| `file_write`   | ワークスペースのファイルを書く。`path`, `content`, `encoding?`, `create_dirs?`                                  |
| `file_list`    | ディレクトリを一覧。`path`, `recursive?`, `glob?`                                                               |
| `file_info`    | ファイルメタデータを取得。`path`                                                                                |
| `process_list` | 実行中プロセスを一覧                                                                                            |
| `process_kill` | 管理プロセスを kill。`pid`, `signal?`                                                                           |

ファイルツールは `/home/sandbox/workspace` 配下に制約されています。相対パスは
このディレクトリ下に解決され、絶対パスはシンボリックリンク解決後もこの中に
収まる必要があります。

## HTTP エンドポイント

### セッションライフサイクル

| Method   | Path               | 説明                                                                    |
| -------- | ------------------ | ----------------------------------------------------------------------- |
| `POST`   | `/mcp`             | エージェント向け公開 MCP エンドポイント。Auth: 公開 MCP bearer トークン |
| `GET`    | `/mcp`             | `405` を返す                                                            |
| `POST`   | `/create`          | サンドボックスセッション作成。Body: `{ sessionId, spaceId, userId }`    |
| `GET`    | `/session/:id`     | セッション状態を取得                                                    |
| `DELETE` | `/session/:id`     | セッションとコンテナを破棄                                              |
| `POST`   | `/session/:id/mcp` | MCP リクエストをコンテナへ転送                                          |
| `GET`    | `/session/:id/mcp` | `405` を返す                                                            |
| `GET`    | `/health`          | ヘルスチェック                                                          |

### ダッシュボードルート

| Method   | Path                               | 説明                                   |
| -------- | ---------------------------------- | -------------------------------------- |
| `GET`    | `/gui`                             | ダッシュボード UI                      |
| `GET`    | `/gui/*`                           | ダッシュボード UI ルートフォールバック |
| `GET`    | `/gui/api/sandbox-sessions`        | サンドボックスセッション一覧           |
| `POST`   | `/gui/api/sandbox-create`          | サンドボックスセッション作成           |
| `GET`    | `/gui/api/sandbox-session/:id`     | サンドボックスセッション状態取得       |
| `DELETE` | `/gui/api/sandbox-session/:id`     | サンドボックスセッション破棄           |
| `POST`   | `/gui/api/sandbox-session/:id/mcp` | サンドボックス向け MCP プロキシ        |
| `GET`    | `/gui/api/sandbox-session/:id/mcp` | `405` を返す                           |
| `GET`    | `/gui/api/auth/login`              | Takosumi Accounts OIDC login 開始      |
| `GET`    | `/gui/api/auth/callback`           | OIDC callback / GUI session 発行       |
| `GET`    | `/gui/api/auth/launch`             | install launch token consume           |
| `GET`    | `/gui/api/auth/me`                 | GUI session 確認                       |
| `POST`   | `/gui/api/auth/logout`             | GUI session cookie 削除                |

ダッシュボード直接アクセスには GUI 認証 cookie または API 呼び出し時の明示的な
bearer / ヘッダートークンが必要です。スタンドアロン運用者は
`/gui?authToken=<host-token>` でアクセスでき、ワーカーがトークンを検証して
HttpOnly `SameSite=Strict` cookie を `/gui` 配下に設定し、クリーン URL に
リダイレクトします。セッションプロキシトークンは `Authorization: Bearer`、
`X-Proxy-Token`、または HttpOnly GUI cookie からのみ受け付けます (`proxyToken`
クエリ認証は拒否)。

Takosumi Install では `APP_AUTH_REQUIRED=1` と `identity.oidc@v1` の `OIDC_*`
env が注入されます。GUI は `state` + `nonce` + PKCE S256 の OIDC authorization
code flow を使い、`/gui` scoped の HttpOnly session cookie を
発行します。install 直後の `/gui/api/auth/launch?launch_token=...` は Takosumi
Accounts の launch-token consume endpoint を呼び、one-time token を local GUI
session に交換してから `/gui` に戻します。

## 開発

### 前提条件

- [Deno](https://deno.land/) >= 2.0
- [Docker](https://www.docker.com/) — コンテナイメージビルド用
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — Cloudflare
  デプロイ用

### Setup

```bash
cd takos-apps/takos-computer

deno cache apps/sandbox/src/index.ts
deno task test:all
deno task lint
deno task fmt
deno task check:dist
```

### ローカル起動

```bash
cd apps/sandbox && deno task start
```

サンドボックスサービスはデフォルトでポート 8080 を待ち受けます。

Cloudflare Containers / Durable Objects なしで Worker host と sandbox MCP を
同一 Deno process につなぐ local simulator も使えます。これは開発用であり、
本番と同じコンテナ分離を提供しません。セッションごとの workspace は
`.takos-computer-local/workspaces/` 配下に作られます。

```bash
cd takos-apps/takos-computer
deno task dev:local
```

既定では `http://127.0.0.1:8788` を待ち受けます。

- Dashboard: `http://127.0.0.1:8788/gui?authToken=local-host-token`
- Published MCP: `POST http://127.0.0.1:8788/mcp` with
  `Authorization: Bearer local-published-mcp-token`

`PORT`、`TAKOS_COMPUTER_LOCAL_WORKSPACE`、`SANDBOX_HOST_AUTH_TOKEN`、
`PUBLISHED_MCP_AUTH_TOKEN`、`MCP_AUTH_TOKEN` で上書きできます。

### コンテナイメージのビルド

```bash
docker build -f apps/sandbox/Dockerfile -t takos-sandbox .
```

### ダッシュボード開発

```bash
cd packages/dashboard
deno task dev
```

## アーキテクチャ

```
                  Internet / Service Bindings
                            |
        +-------------------+-------------------+
        |                                       |
  Takos computer host worker             Takos sandbox host
        |                                       |
Dashboard + sandbox proxy              SandboxSessionContainer
        |                                       |
CF Worker routes /gui, /session        CF Container (basic)
        |                                       |
 Dashboard UI + sandbox MCP            Deno runtime, shell tools
```

セッションのライフサイクルは Cloudflare Containers のサイドカーとして動作する
Durable Object で管理されます。各セッションは個別のコンテナインスタンスを持ち、
プロキシトークン認証と非アクティブ時の自動スリープを備えます。

## 環境変数

| Variable                         | デフォルト  | 説明                                                                                                                      |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                           | `8080`      | HTTP サーバーの待ち受けポート                                                                                             |
| `PUBLISHED_MCP_AUTH_TOKEN`       | _(none)_    | 公開 `/mcp` エンドポイントを保護する bearer トークン。マニフェストデプロイでは `auth.bearer.secretRef` から生成されます   |
| `SANDBOX_HOST_AUTH_TOKEN`        | _(none)_    | サンドボックスホストの管理 / セッションルートを保護する bearer トークン。サンドボックスコンテナには注入しない             |
| `MCP_AUTH_TOKEN`                 | _(none)_    | ワーカー ↔ コンテナの `/mcp` 認証トークン。サンドボックスサービスに注入されるが、シェル子プロセスからは除去される         |
| `APP_AUTH_REQUIRED`              | `0`         | `1` で `/gui` を Takosumi Accounts OIDC session で保護。Takosumi Install manifest では `1`                                |
| `APP_SESSION_SECRET`             | _(none)_    | `/gui` session / OIDC state cookie の HMAC secret。manifest deploy では生成される                                         |
| `OIDC_ISSUER_URL`                | _(none)_    | Takosumi Accounts OIDC issuer URL                                                                                         |
| `OIDC_CLIENT_ID`                 | _(none)_    | Takosumi Accounts OIDC client ID                                                                                          |
| `OIDC_CLIENT_SECRET`             | _(none)_    | Takosumi Accounts OIDC client secret                                                                                      |
| `OIDC_REDIRECT_URI`              | _(derived)_ | OIDC callback URI。未設定時は request host + `/gui/api/auth/callback`                                                     |
| `ACCOUNTS_BASE_URL`              | _(none)_    | launch token consume に使う Takosumi Accounts base URL                                                                    |
| `INSTALL_LAUNCH_INSTALLATION_ID` | _(none)_    | launch token consume 対象 AppInstallation ID                                                                              |
| `INSTALL_LAUNCH_CONSUME_PATH`    | _(none)_    | launch token consume path。Takosumi Install では `/gui/api/auth/launch`                                                   |
| `MCP_ALLOW_UNAUTHENTICATED`      | `false`     | `true` でローカル / 開発時のみ `MCP_AUTH_TOKEN` 無しでサンドボックスサービス `/mcp` を許可                                |
| `TAKOS_TOKEN`                    | _(none)_    | サンドボックスサービスに渡せる Takos CLI bearer トークン。シェル子プロセスは `allow_takos_token` が設定された場合のみ継承 |
| `TAKOS_API_URL`                  | _(none)_    | サンドボックスコンテナに `TAKOS_API_URL` として注入される Takos API エンドポイント                                        |
| `TAKOS_TRUST_ROUTED_GUI_API`     | _(none)_    | Takos dispatch 経由でルーティングされた GUI / API 要求の `X-Takos-Internal-Marker: 1` 認証を有効化する場合のみ `1` を設定 |
| `SHUTDOWN_GRACE_MS`              | `15000`     | SIGTERM 時の強制終了までの猶予 (ms)                                                                                       |

## Cloudflare Worker Bindings

| Binding             | Type           | 説明                                         |
| ------------------- | -------------- | -------------------------------------------- |
| `SANDBOX_CONTAINER` | Durable Object | サンドボックスセッションコンテナの namespace |
| `SESSION_INDEX`     | KV Namespace   | GUI 一覧用のセッションメタデータインデックス |

消費側ワーカーはこのデプロイ済みワーカーを `SANDBOX_HOST` としてバインドします
(サンドボックスホストワーカー内部の binding ではありません)。

## デプロイ

デプロイは `deploy/` 配下の Wrangler 設定ファイルで行います。

## Takosumi Install

リポジトリには takosumi-git による Git URL install 用 `.takosumi/app.yml` が
含まれています。インストールメタデータは、アプリ ID、OIDC binding、Takos
リソースの AppGrants、公開 MCP エンドポイント、`.takosumi/workflows/build.yml`
から生成される Cloudflare Worker ホストバンドルを宣言します。

カーネルマニフェストはホスト Worker を `worker@v1` としてモデル化します。
Cloudflare Containers、Durable Object binding、KV セッションインデックス、
生成された MCP トークンは provider-specific メタデータとして記録されます。

`.takosumi/manifest.yml` はサンドボックスホストワーカーをビルドし、
ダッシュボードを `/gui` で、MCP を `/mcp` で公開します。managed `SESSION_INDEX`
KV namespace と生成された `SANDBOX_HOST_AUTH_TOKEN`、
`MCP_AUTH_TOKEN`、`PUBLISHED_MCP_AUTH_TOKEN`、`APP_SESSION_SECRET` サービス env
要件も記録します。

- `PUBLISHED_MCP_AUTH_TOKEN`: 公開 `/mcp` エンドポイントを保護
- `SANDBOX_HOST_AUTH_TOKEN`: ホストの管理 / セッションルートを保護
- `MCP_AUTH_TOKEN`: ワーカー ↔ コンテナ間の MCP トラフィックを保護

これら 3 つのトークンはそれぞれ異なる値でなければなりません。マニフェストは
サンドボックス内 CLI 用に managed Takos API キーを `TAKOS_TOKEN` /
`TAKOS_API_URL` として消費し、`TAKOS_TRUST_ROUTED_GUI_API=1` を設定して dispatch
ルーティング された GUI / API 呼び出しが Takos の `X-Takos-Internal-Marker`
ヘッダーを使えるようにします。 ネイティブの Cloudflare Containers Durable Object
binding `SANDBOX_CONTAINER` (`SandboxSessionContainer`)
と、`apps/sandbox/Dockerfile` コンテナイメージ メタデータを宣言します。`/readyz`
がマニフェストの readiness パス、`/healthz` は bootstrap-safe な liveness probe
です。

公開 `/mcp` エンドポイントはエージェント向けの静的カタログエントリで、
セッションライフサイクルをラップしてサンドボックス操作を `/session/:id/mcp`
コンテナエンドポイントに転送します。Wrangler は Takos マニフェストフロー外で
デプロイしたい運用者向けのフォールバック経路です。

```bash
wrangler deploy -c deploy/wrangler.sandbox-host.toml
wrangler deploy -c deploy/wrangler.sandbox-host.toml --env staging
```

### 生成済み Worker バンドル

`dist/sandbox-host.js` は git に保持される生成済み Worker バンドルで、
artifact-based な Takos デプロイで使われます。ソースは
`packages/computer-hosts/src/` 配下とダッシュボード生成 GUI
アセットが真実の源です。`dist/` は lint / format の対象外で、ソース変更後は
`deno task build:all` を実行し、`deno task check:dist`
でバンドルのドリフトを検出します。

### コンテナ仕様

| Host         | Instance Type | vCPU | RAM   | 最大インスタンス数        |
| ------------ | ------------- | ---- | ----- | ------------------------- |
| sandbox-host | `basic`       | 0.25 | 1 GiB | 100 (prod) / 10 (staging) |

デプロイ前に wrangler 設定ファイルのプレースホルダー ID を置き換えます。

- `REPLACE_WITH_KV_NAMESPACE_ID`
- `REPLACE_WITH_STAGING_KV_NAMESPACE_ID`

そのあと、各環境にサンドボックスホストの secret を設定します。シェル子プロセスは
デフォルトで小さな安全な環境変数のみを継承し、`TAKOS_TOKEN` は `shell_exec` を
`allow_takos_token: true` で呼び出した場合のみ転送されます。`takos_token`
で範囲を絞ったトークンを渡すこともできます。MCP / ホスト管理トークンは除去され、
コマンド毎の `env` オーバーライドは機微な変数名を拒否します。

```bash
wrangler secret put MCP_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml
wrangler secret put MCP_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml --env staging
wrangler secret put PUBLISHED_MCP_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml
wrangler secret put PUBLISHED_MCP_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml --env staging
wrangler secret put SANDBOX_HOST_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml
wrangler secret put SANDBOX_HOST_AUTH_TOKEN -c deploy/wrangler.sandbox-host.toml --env staging
wrangler secret put TAKOS_TOKEN -c deploy/wrangler.sandbox-host.toml
wrangler secret put TAKOS_TOKEN -c deploy/wrangler.sandbox-host.toml --env staging
```

## ライセンス

リポジトリルートを参照してください。
