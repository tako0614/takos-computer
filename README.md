# takos-computer

AI エージェント向けのコンテナ化サンドボックス実行環境を、MCP
と簡易ダッシュボードで公開する独立 product です。Cloudflare Workers + Containers
上で動作し、サンドボックスコンテナとワーカー側のダッシュボード /
プロキシ層に分かれています。

Takos Workspace へユーザーが明示的に install する通常の Capsule App として
Takosumi 上で動作します。サンドボックス / MCP 表面自体は Takos 固有の結合を持たず、任意の
MCP 対応エージェントホストから利用できます。

## 主要技術

- Bun tooling + Bun-based sandbox container
- Hono 4
- MCP SDK
- Zod
- Cloudflare Containers
- SolidJS 1.9 + Vite 6.3

## パッケージ構成

### Container Apps

| Package     | Path            | 説明                                                          |
| ----------- | --------------- | ------------------------------------------------------------- |
| **sandbox** | `apps/sandbox/` | シェル実行・ファイル操作用の Bun ベースサンドボックスコンテナ |

### Service Packages

| Package                             | Path                        | 説明                                                                                |
| ----------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| **@takos-computer/sandbox-service** | `packages/sandbox-service/` | Hono MCP サーバー。`shell_exec`, `file_*`, `process_*` ツールを提供                 |
| **@takos-computer/computer-hosts**  | `packages/computer-hosts/`  | ダッシュボードプロキシ / サンドボックスホスト用 Cloudflare Workers エントリポイント |

### Shared Packages

| Package                       | Path                  | 説明                                                               |
| ----------------------------- | --------------------- | ------------------------------------------------------------------ |
| **@takos-computer/common**    | `packages/common/`    | logger, crypto helper, CF shim 等の共通ユーティリティ              |
| **@takos-computer/dashboard** | `packages/dashboard/` | サンドボックスセッション一覧 / オープン用の SolidJS ダッシュボード |

## MCP ツールリファレンス

エージェントは公開された MCP Streamable HTTP エンドポイント `/mcp` を使います。managed
install は `mcp.invoke` permission、`mcp_url` audience、Workspace / Capsule / InterfaceBinding
evidence が完全一致する短命の Takosumi Interface OAuth bearer を使います。direct/self-host
では、明示的に設定した `PUBLISHED_MCP_AUTH_TOKEN` も利用できます。
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

| Method   | Path               | 説明                                                                 |
| -------- | ------------------ | -------------------------------------------------------------------- |
| `POST`   | `/mcp`             | エージェント向け公開 MCP。Auth: Interface OAuth または direct bearer |
| `GET`    | `/mcp`             | `405` を返す                                                         |
| `POST`   | `/create`          | サンドボックスセッション作成。Body: `{ sessionId, spaceId, userId }` |
| `GET`    | `/session/:id`     | セッション状態を取得                                                 |
| `DELETE` | `/session/:id`     | セッションとコンテナを破棄                                           |
| `POST`   | `/session/:id/mcp` | MCP リクエストをコンテナへ転送                                       |
| `GET`    | `/session/:id/mcp` | `405` を返す                                                         |
| `GET`    | `/health`          | ヘルスチェック                                                       |

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
| `GET`    | `/gui/api/auth/me`                 | GUI session 確認                       |
| `POST`   | `/gui/api/auth/logout`             | GUI session cookie 削除                |

ダッシュボード直接アクセスには GUI 認証 cookie または API 呼び出し時の明示的な
bearer / ヘッダートークンが必要です。スタンドアロン運用者は
`/gui?authToken=<host-token>` でアクセスでき、ワーカーがトークンを検証して
HttpOnly `SameSite=Strict` cookie を `/gui` 配下に設定し、クリーン URL に
リダイレクトします。セッションプロキシトークンは `Authorization: Bearer`、
`X-Proxy-Token`、または HttpOnly GUI cookie からのみ受け付けます (`proxyToken`
クエリ認証は拒否)。

Takosumi install では、service-side InstallConfig が `APP_AUTH_REQUIRED=1` と
`OIDC_*` の入力を通常の module 変数へ写像します。GUI は `state` + `nonce` +
PKCE S256 の OIDC authorization code flow を使い、`/gui` scoped の HttpOnly
session cookie を発行します。

## 開発

### 前提条件

- [Bun](https://bun.sh/) >= 1.3
- [Docker](https://www.docker.com/) —コンテナイメージビルド用
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — Cloudflare
  デプロイ用

### Setup

```bash
cd takos-apps/takos-computer

bun install
bun run test:all
bun run check
bun run check:dist
```

### ローカル起動

```bash
cd apps/sandbox && bun run start
```

サンドボックスサービスはデフォルトでポート 8080 を待ち受けます。

Cloudflare Containers / Durable Objects なしで Worker host と sandbox MCP を
同一 Bun process につなぐ local simulator も使えます。これは開発用であり、
本番と同じコンテナ分離を提供しません。セッションごとの workspace は
`.takos-computer-local/workspaces/` 配下に作られます。

```bash
cd takos-apps/takos-computer
bun run dev:local
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
bunx vite --config vite.config.ts
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
 Dashboard UI + sandbox MCP            Bun runtime, shell tools
```

セッションのライフサイクルは Cloudflare Containers のサイドカーとして動作する
Durable Object で管理されます。各セッションは個別のコンテナインスタンスを持ち、
プロキシトークン認証と非アクティブ時の自動スリープを備えます。

## 環境変数

| Variable                     | デフォルト  | 説明                                                                                                                                         |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                       | `8080`      | HTTP サーバーの待ち受けポート                                                                                                                |
| `PUBLISHED_MCP_AUTH_TOKEN`   | _(none)_    | direct/self-host `/mcp` 用の任意 bearer。managed install は Interface OAuth を使います                                                       |
| `SANDBOX_HOST_AUTH_TOKEN`    | _(none)_    | サンドボックスホストの管理 / セッションルートを保護する bearer トークン。サンドボックスコンテナには注入しない                                |
| `MCP_AUTH_TOKEN`             | _(none)_    | ワーカー↔コンテナの `/mcp` 認証トークン。サンドボックスサービスに注入されるが、シェル子プロセスからは除去される                              |
| `APP_AUTH_REQUIRED`          | `0`         | `1` で `/gui` を Takosumi Accounts OIDC session で保護                                                                                       |
| `APP_SESSION_SECRET`         | _(none)_    | `/gui` session / OIDC state cookie の HMAC secret                                                                                            |
| `OIDC_ISSUER_URL`            | _(none)_    | Takosumi Accounts OIDC issuer URL                                                                                                            |
| `OIDC_CLIENT_ID`             | _(none)_    | Takosumi Accounts OIDC client ID                                                                                                             |
| `OIDC_CLIENT_SECRET`         | _(none)_    | Takosumi Accounts OIDC client secret                                                                                                         |
| `OIDC_REDIRECT_URI`          | _(derived)_ | OIDC callback URI。managed install では Cloud が確定した redirect URI を inject。standalone/dev のみ trusted configured base URL から derive |
| `MCP_URL`                    | _(none)_    | Interface OAuth の exact resource audience (`mcp_url` Output と同じ URL)                                                                     |
| `APP_WORKSPACE_ID`           | _(none)_    | Interface OAuth evidence で照合する owning Workspace                                                                                         |
| `APP_CAPSULE_ID`             | _(none)_    | Interface OAuth evidence で照合する owning Capsule                                                                                           |
| `MCP_ALLOW_UNAUTHENTICATED`  | `false`     | `true` でローカル / 開発時のみ `MCP_AUTH_TOKEN` 無しでサンドボックスサービス `/mcp` を許可                                                   |
| `TAKOS_TOKEN`                | _(none)_    | サンドボックスサービスに渡せる Takos API bearer トークン。シェル子プロセスは `allow_takos_token` が設定された場合のみ継承                    |
| `TAKOS_API_URL`              | _(none)_    | サンドボックスコンテナに `TAKOS_API_URL` として注入される Takos API エンドポイント                                                           |
| `TAKOS_TRUST_ROUTED_GUI_API` | _(none)_    | Takos dispatch 経由でルーティングされた GUI / API 要求の `X-Takos-Internal-Marker: 1` 認証を有効化する場合のみ `1` を設定                    |
| `SHUTDOWN_GRACE_MS`          | `15000`     | SIGTERM 時の強制終了までの猶予 (ms)                                                                                                          |

## Cloudflare Worker Bindings

| Binding             | Type           | 説明                                         |
| ------------------- | -------------- | -------------------------------------------- |
| `SANDBOX_CONTAINER` | Durable Object | サンドボックスセッションコンテナの namespace |
| `SESSION_INDEX`     | KV Namespace   | GUI 一覧用のセッションメタデータインデックス |

消費側ワーカーはこのデプロイ済みワーカーを `SANDBOX_HOST` としてバインドします
(サンドボックスホストワーカー内部の binding ではありません)。

## OpenTofu Capsule deploy

repository root は実行可能な plain OpenTofu module です。Takosumi 専用 manifest / DSL
を必要とせず、通常の generated root から child module として呼べます。

```hcl
module "computer" {
  source = "git::https://github.com/tako0614/takos-computer.git?ref=<reviewed-stable-tag>"

  enable_cloudflare_resources   = true
  cloudflare_account_id         = var.cloudflare_account_id
  project_name                  = "takos-computer"
  cloudflare_workers_subdomain  = var.cloudflare_workers_subdomain

  # direct/self-host only。managed install は下記 Interface OAuth inputs を使う。
  published_mcp_auth_token = var.published_mcp_auth_token
}
```

module は Cloudflare provider で `SESSION_INDEX` KV namespace を管理します。Cloudflare
provider 5.19.1 は Container image / instance type / max instances を resource schema に
持たないため、Worker + Durable Object + Container の作成・更新・削除は
`terraform_data` lifecycle が pinned Wrangler 4.111.0 を実行します。これは一回の
`tofu apply` / `tofu destroy` に収まり、架空 provider/resource や Takosumi 固有
manifest は使いません。Docker が利用できない runner は、事前にレビュー済みの
`container_image` を明示してください。

managed install は `takosumi_accounts_issuer_url`、`app_workspace_id`、
`app_capsule_id` を設定します。Takosumi 側の service-side
`InstallConfig.interfaceBlueprints` が普通の `mcp_url` / `launch_url` Output を
Interface input へ明示 mapping し、Interface ledger / binding / authorization を所有
します。この module は Interface を宣言・付与せず、credential を Output に出しません。

主な通常 Output:

- `launch_url` / `public_url` / `api_url` / `mcp_url`
- `worker_name` / `session_index_kv_namespace_id` / `cloudflare_account_id`
- `container_class_name` / `container_instance_type` / `container_max_instances`

`app_deployment` / `service_exports` のような旧 runtime manifest Output はありません。
`/readyz` は strict readiness、`/healthz` は liveness probe です。

### コンテナ仕様

| Host         | Instance Type | vCPU | RAM   | 最大インスタンス数        |
| ------------ | ------------- | ---- | ----- | ------------------------- |
| sandbox-host | `basic`       | 0.25 | 1 GiB | 100 (prod) / 10 (staging) |

secret は sensitive module variable または runner の Provider Connection / Credential
Recipe から apply 時だけ materialize され、Wrangler の一時 secrets file は mode
`0600` で作成後に削除されます。値は config・通常 Output・log に書きません。secret
material の sensitive digest も lifecycle trigger に含めるため、値の rotation は次の
`tofu apply` で Worker secret を更新します。

root の `install-options.json` は optional な Capsule Source Options chooser 文書です。
Cloudflare の実 module だけを提示し、credential / provider config / Interface / install
authority は持ちません。`source.ref` を省略しているため、外部 install link では
Takosumi が最高の stable SemVer Git tag を解決し、通常の Capsule flow へ渡します。

## ライセンス

リポジトリルートを参照してください。
