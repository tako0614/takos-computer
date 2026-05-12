# AGENTS.md

takos-computer はエージェント向けの Linux サンドボックスコンテナと
ダッシュボードを提供する独立リポジトリ / 独立 product です。

Takos distribution が bundled として ship する 1st-party InstallableApp であり、
新規 space 作成時に auto-install されますが、これは user convenience であって
architectural privilege ではありません。通常の AppInstallation entry として
記録され、user は uninstall できます。 MCP / sandbox surface 自体に
Takos-specific な結合はなく、 MCP 互換 agent host から利用できます。

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
