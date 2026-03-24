# AGENTS.md

takos-computer は Takos のブラウザ自動化とエージェント実行サービスを提供する独立リポジトリです。

## リポジトリ構成

- `apps/browser/`: ブラウザコンテナ (Playwright + Chromium)
- `apps/executor/`: エグゼキュータコンテナ (LLM エージェント実行)
- `packages/browser-service/`: ブラウザ HTTP API
- `packages/executor-service/`: エグゼキュータ HTTP API
- `packages/agent-core/`: 実行フレームワーク + Control RPC クライアント
- `packages/computer-core/`: LangGraph エージェントランナー
- `packages/computer-agent/`: エージェントランナーの薄いラッパー
- `packages/computer-hosts/`: CF Worker コンテナホスト
- `packages/common/`: 共有ユーティリティ (logger, validation)
- `packages/actions-engine/`: CI エンジン
- `packages/cloudflare-compat/`: Cloudflare 互換

## 基本方針

- takos-computer は takos のツールとして利用される
- コンテナホスト (executor-host, browser-host) は TAKOS_CONTROL サービスバインディング経由で takos main worker と通信
- バインディングプロキシ (DB, R2, Vectorize 等) はコンテナホスト上で直接処理
- Control RPC (tool execution, memory, conversation history 等) は main worker に転送

## 作業ルール

- Node/pnpm コマンドは `pnpm -C takos-computer ...` を使う
- コンテナイメージのビルドは `apps/browser/` と `apps/executor/` の Dockerfile を使用
- CF Worker のデプロイは `deploy/` の wrangler config を使用
