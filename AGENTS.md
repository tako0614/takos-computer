# AGENTS.md

takos-computer はエージェント向けの Linux サンドボックスコンテナと
ダッシュボードを提供する独立リポジトリです。

## リポジトリ構成

- `apps/sandbox/`: Linux サンドボックスコンテナ
  (シェル実行、ファイルシステム操作)
- `packages/sandbox-service/`: サンドボックス MCP サービス
- `packages/computer-hosts/`: CF Worker コンテナホスト (dashboard proxy,
  sandbox-host)
- `packages/common/`: 共有ユーティリティ (logger, validation)
- `packages/cloudflare-compat/`: Cloudflare 互換

## 基本方針

- takos-computer はエージェントが利用するコンテナ環境を提供する
- AI エージェントの実行ロジック (LLM、LangGraph 等) は takos 本体側に置く
- コンテナは MCP (Model Context Protocol) 経由でツールを公開する
- サンドボックスコンテナ: shell_exec, file__, process__ ツール

## 作業ルール

- Deno コマンドは `cd takos-apps/takos-computer && deno task ...` を使う
- コンテナイメージのビルドは `apps/sandbox/` の Dockerfile を使用
- CF Worker のデプロイは `deploy/` の wrangler config を使用
