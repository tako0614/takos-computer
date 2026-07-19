# AGENTS.md

takos-computer はエージェント向けの Linux サンドボックスコンテナと
ダッシュボードを提供する独立リポジトリ / 独立 product です。

Takosumi 上ではユーザーが選んで install する通常の Capsule app です。
MCP / sandbox surface 自体に Takos-specific な結合はなく、 MCP 互換 agent
host から利用できます。

## リポジトリ構成

- `apps/sandbox/`: Linux サンドボックスコンテナ
  (シェル実行、ファイルシステム操作)
- `packages/sandbox-service/`: サンドボックス MCP サービス
- `packages/computer-hosts/`: CF Worker コンテナホスト (dashboard proxy,
  sandbox-host)
- `packages/common/`: 共有ユーティリティ (logger, crypto, CF shim)

## 基本方針

- takos-computer はエージェントが利用するコンテナ環境を提供する
- AI エージェントの実行ロジック (LLM、LangGraph 等) は takos 本体側に置く
- コンテナは MCP (Model Context Protocol) 経由でツールを公開する
- サンドボックスコンテナ: shell_exec, file__, process__ ツール
- repository root は plain OpenTofu module。KV は Cloudflare provider、provider schema に
  ない Container image/shape lifecycle は `terraform_data` から pinned official Wrangler
  を実行し、同じ Run の apply/destroy に含める
- runtime Interface / InterfaceBinding は Takosumi service-side InstallConfig が所有する。
  module は普通の `launch_url` / `mcp_url` Output だけを返し、Interface や credential を
  Output/manifest として宣言しない

## 作業ルール

- Bun コマンドは `cd takos-apps/takos-computer && bun run ...` (test は `bun test`) を使う
- コンテナイメージのビルドは `apps/sandbox/` の Dockerfile を使用
- production install は root OpenTofu module を使う。`deploy/` Wrangler config は
  operator/debug template であり、install authority ではない
- `dist/` は local/CI 生成物で commit しない。OpenTofu deploy は source snapshot から
  Wrangler が Workerを bundleし、Dockerfileまたは明示 `container_image` を deploy する
- `install-options.json` は optional な source chooser で、Cloudflare の実 module だけを
  提示する。credential / Interface / install authority は持たせず、既存 tag は書き換えない
