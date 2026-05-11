# takos-computer

Containerized sandbox execution environment for Takos, exposed through MCP and a
small dashboard. It runs on Cloudflare Workers + Containers and is split between
a sandbox container and the worker-side dashboard/proxy layer.

## Architecture

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

Session lifecycle is managed by Durable Objects that act as sidecars for
Cloudflare Containers. Each sandbox session gets its own container instance with
proxy-token authentication and auto-sleep after inactivity.

## Package Layout

### Container Apps

| Package     | Path            | Description                                                                 |
| ----------- | --------------- | --------------------------------------------------------------------------- |
| **sandbox** | `apps/sandbox/` | Deno-based sandbox container for shell execution and filesystem operations. |

### Service Packages

| Package                             | Path                        | Description                                                                                                            |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **@takos-computer/sandbox-service** | `packages/sandbox-service/` | Hono MCP server for shell execution and filesystem operations. Provides `shell_exec`, `file_*`, and `process_*` tools. |
| **@takos-computer/computer-hosts**  | `packages/computer-hosts/`  | Cloudflare Workers entry points for the dashboard proxy and sandbox host.                                              |

### Shared Packages

| Package                               | Path                          | Description                                                                                |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| **@takos-computer/common**            | `packages/common/`            | Shared utilities: logger, ID generation, validation, error classes, JWT helpers, CF shims. |
| **@takos-computer/cloudflare-compat** | `packages/cloudflare-compat/` | Centralized re-exports of Cloudflare Workers types.                                        |
| **@takos-computer/dashboard**         | `packages/dashboard/`         | SolidJS dashboard for listing and opening sandbox sessions.                                |

## MCP Tools Reference

Agents use the published MCP Streamable HTTP endpoint at `/mcp`. It exposes
stable `computer_*` tools, creates or reuses a sandbox session, and proxies tool
calls into the session container. Direct session MCP remains available at
`/session/:id/mcp` for callers that already hold a session proxy token.

`POST` is the supported MCP request method. `OPTIONS` returns the allowed
methods. Other MCP methods, including Streamable HTTP server-to-client `GET`
streams, fail fast with `405 Method Not Allowed` and are not proxied to the
sandbox container.

### Published MCP Tools

| Tool                       | Description                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `computer_session_create`  | Create or reuse a sandbox session. Optional: `session_id`, `space_id`, `user_id`              |
| `computer_session_status`  | Get sandbox session state. Optional: `session_id`                                             |
| `computer_session_destroy` | Destroy a sandbox session. Optional: `session_id`                                             |
| `computer_shell_exec`      | Execute a shell command. Params: `command`, `timeout_ms?`, `cwd?`, `env?`, `session_id?`      |
| `computer_file_read`       | Read workspace file contents. Params: `path`, `offset?`, `limit?`, `encoding?`, `session_id?` |
| `computer_file_write`      | Write a workspace file. Params: `path`, `content`, `encoding?`, `create_dirs?`, `session_id?` |
| `computer_file_list`       | List workspace directory entries. Params: `path`, `recursive?`, `glob?`, `session_id?`        |
| `computer_file_info`       | Get workspace file metadata. Params: `path`, `session_id?`                                    |
| `computer_process_list`    | List running processes. Optional: `session_id`                                                |
| `computer_process_kill`    | Kill a managed process. Params: `pid`, `signal?`, `session_id?`                               |

### Sandbox Tools

| Tool           | Description                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `shell_exec`   | Execute a shell command (bash -c). Params: `command`, `timeout_ms?`, `cwd?`, `env?`, `allow_takos_token?`, `takos_token?` |
| `file_read`    | Read workspace file contents. Params: `path`, `offset?`, `limit?`, `encoding?`                                            |
| `file_write`   | Write a workspace file. Params: `path`, `content`, `encoding?`, `create_dirs?`                                            |
| `file_list`    | List workspace directory entries. Params: `path`, `recursive?`, `glob?`                                                   |
| `file_info`    | Get workspace file metadata. Params: `path`                                                                               |
| `process_list` | List running processes.                                                                                                   |
| `process_kill` | Kill a managed process. Params: `pid`, `signal?`                                                                          |

File tools are constrained to `/home/sandbox/workspace`. Relative paths resolve
under that directory, and absolute paths must stay inside it after symlink
resolution.

## HTTP Endpoints

### Session Lifecycle

| Method   | Path               | Description                                                              |
| -------- | ------------------ | ------------------------------------------------------------------------ |
| `POST`   | `/mcp`             | Published MCP endpoint for agent tools. Auth: published MCP bearer token |
| `GET`    | `/mcp`             | Returns `405`; server-to-client MCP stream GET is unsupported.           |
| `POST`   | `/create`          | Create a new sandbox session. Body: `{ sessionId, spaceId, userId }`     |
| `GET`    | `/session/:id`     | Get session state.                                                       |
| `DELETE` | `/session/:id`     | Destroy a session and its container.                                     |
| `POST`   | `/session/:id/mcp` | Forward MCP request to the container.                                    |
| `GET`    | `/session/:id/mcp` | Returns `405`; server-to-client MCP stream GET is unsupported.           |
| `GET`    | `/health`          | Health check.                                                            |

### Dashboard Routes

| Method   | Path                               | Description                                                    |
| -------- | ---------------------------------- | -------------------------------------------------------------- |
| `GET`    | `/gui`                             | Dashboard UI.                                                  |
| `GET`    | `/gui/*`                           | Dashboard UI route fallback.                                   |
| `GET`    | `/gui/api/sandbox-sessions`        | List dashboard sandbox sessions.                               |
| `POST`   | `/gui/api/sandbox-create`          | Create a dashboard sandbox session.                            |
| `GET`    | `/gui/api/sandbox-session/:id`     | Get dashboard sandbox session state.                           |
| `DELETE` | `/gui/api/sandbox-session/:id`     | Destroy a dashboard sandbox session.                           |
| `POST`   | `/gui/api/sandbox-session/:id/mcp` | Proxy MCP route for the sandbox dashboard.                     |
| `GET`    | `/gui/api/sandbox-session/:id/mcp` | Returns `405`; server-to-client MCP stream GET is unsupported. |

Direct dashboard access requires a GUI auth cookie or an explicit bearer/header
token on API calls. For standalone operator access, open
`/gui?authToken=<host-token>`; the worker validates the token, sets an HttpOnly
`SameSite=Strict` cookie under `/gui`, and redirects to the clean URL. Session
proxy tokens are accepted only through `Authorization: Bearer`, `X-Proxy-Token`,
or an existing HttpOnly GUI cookie; `proxyToken` query authentication is
rejected.

## Development

### Prerequisites

- [Deno](https://deno.land/) >= 2.0
- [Docker](https://www.docker.com/) for building container images
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for Cloudflare
  deploys

### Setup

```bash
cd takos-apps/takos-computer

deno cache apps/sandbox/src/index.ts
deno task test:all
deno task lint
deno task fmt
deno task check:dist
```

### Running Locally

```bash
cd apps/sandbox && deno task start
```

The sandbox service listens on port 8080 by default.

### Building Container Images

```bash
docker build -f apps/sandbox/Dockerfile -t takos-sandbox .
```

### Dashboard Development

```bash
cd packages/dashboard
deno task dev
```

## Environment Variables

| Variable                     | Default  | Description                                                                                                                                                                                               |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                       | `8080`   | HTTP server listen port                                                                                                                                                                                   |
| `PUBLISHED_MCP_AUTH_TOKEN`   | _(none)_ | Required bearer token for the published `/mcp` endpoint. Manifest deploys generate this from `auth.bearer.secretRef`; direct Wrangler deploys must configure it separately from `SANDBOX_HOST_AUTH_TOKEN` |
| `SANDBOX_HOST_AUTH_TOKEN`    | _(none)_ | Required bearer token for sandbox-host admin/session routes; never injected into sandbox containers                                                                                                       |
| `MCP_AUTH_TOKEN`             | _(none)_ | Required worker-to-container `/mcp` auth token; injected into the sandbox service but stripped from shell child processes                                                                                 |
| `MCP_ALLOW_UNAUTHENTICATED`  | `false`  | Set to `true` only for local/dev sandbox-service `/mcp` access without `MCP_AUTH_TOKEN`                                                                                                                   |
| `TAKOS_TOKEN`                | _(none)_ | Optional Takos CLI bearer token available to the sandbox service; shell child processes only inherit it when `allow_takos_token` is set                                                                   |
| `TAKOS_API_URL`              | _(none)_ | Optional Takos API endpoint injected into sandbox containers as `TAKOS_API_URL`                                                                                                                           |
| `TAKOS_TRUST_ROUTED_GUI_API` | _(none)_ | Set to `1` only behind Takos dispatch so `X-Takos-Internal-Marker: 1` can authenticate routed GUI/API requests                                                                                            |
| `SHUTDOWN_GRACE_MS`          | `15000`  | Grace period before force-exit on SIGTERM                                                                                                                                                                 |

## Cloudflare Worker Bindings

| Binding             | Type           | Description                            |
| ------------------- | -------------- | -------------------------------------- |
| `SANDBOX_CONTAINER` | Durable Object | Sandbox session container namespace    |
| `SESSION_INDEX`     | KV Namespace   | Session metadata index for GUI listing |

Consumer workers bind this deployed worker as `SANDBOX_HOST`; it is not a
binding inside the sandbox-host worker itself.

## Deployment

Deployment uses Wrangler with configuration files in `deploy/`.

## Takosumi Install

This repository includes `.takosumi/app.yml` for Git URL install through
takosumi-git. The install metadata declares the app identity, OIDC binding,
Takos resource AppGrants, the published MCP endpoint, and the Cloudflare Worker
host bundle generated from `.takosumi/workflows/build.yml`.

The kernel manifest models the host Worker as `worker@v1`. Cloudflare
Containers, Durable Object binding, KV session index, and generated MCP tokens
are recorded as provider-specific metadata because the current portable Takosumi
shape catalog does not yet expose an attached-container binding.

The checked-in `.takosumi/app.yml` declares install metadata, and
`.takosumi/manifest.yml` builds the sandbox host worker, exposes the dashboard
under `/gui`, exposes `/mcp`, and records the managed `SESSION_INDEX` KV
namespace plus generated `SANDBOX_HOST_AUTH_TOKEN`, `MCP_AUTH_TOKEN`, and
`PUBLISHED_MCP_AUTH_TOKEN` service env requirements. `PUBLISHED_MCP_AUTH_TOKEN`
protects the published `/mcp` endpoint, `SANDBOX_HOST_AUTH_TOKEN` protects host
admin/session routes, and `MCP_AUTH_TOKEN` protects MCP traffic between the
worker and container. These tokens must be different. The manifest also consumes
a managed Takos API key as `TAKOS_TOKEN`/`TAKOS_API_URL` for CLI use inside
sandboxes and sets `TAKOS_TRUST_ROUTED_GUI_API=1` so dispatch-routed GUI/API
calls can use Takos' stripped-and-injected `X-Takos-Internal-Marker` header. It
declares the native Cloudflare Containers Durable Object binding for
`SANDBOX_CONTAINER` (`SandboxSessionContainer`) and the
`apps/sandbox/Dockerfile` container image metadata. `/readyz` is the manifest
readiness path; `/healthz` remains a bootstrap-safe liveness probe.

The published `/mcp` endpoint is the agent-facing static catalog entry. It wraps
session lifecycle and forwards sandbox operations to the concrete
`/session/:id/mcp` container endpoint. Direct session MCP still requires a
session id and proxy token. If the sandbox needs to run Takos CLI commands,
provide a downscoped `TAKOS_TOKEN` instead. `shell_exec` only forwards that
token when `allow_takos_token: true` is supplied; otherwise the child process
sees the safe default environment. Wrangler remains a fallback production
deployment path for operators that want to deploy outside the Takos manifest
flow.

```bash
wrangler deploy -c deploy/wrangler.sandbox-host.toml
wrangler deploy -c deploy/wrangler.sandbox-host.toml --env staging
```

### Generated Worker Bundles

`dist/sandbox-host.js` is a generated Worker bundle kept in git for artifact
based Takos deploys. Source files under `packages/computer-hosts/src/` and the
dashboard-generated GUI assets are the source of truth. `dist/` stays excluded
from lint and format checks; run `deno task build:all` after source changes and
`deno task check:dist` to detect bundle drift.

`dist/browser-host.js` is a legacy generated bundle retained in the repository
for now, but it is not a current deploy target.

### Container Specifications

| Host         | Instance Type | vCPU | RAM   | Max Instances             |
| ------------ | ------------- | ---- | ----- | ------------------------- |
| sandbox-host | `basic`       | 0.25 | 1 GiB | 100 (prod) / 10 (staging) |

Before deploying, replace placeholder IDs in the wrangler config files:

- `REPLACE_WITH_KV_NAMESPACE_ID`
- `REPLACE_WITH_STAGING_KV_NAMESPACE_ID`

Then provision the required sandbox-host secrets for each environment.
`PUBLISHED_MCP_AUTH_TOKEN` protects the published `/mcp` endpoint and must be
different from `SANDBOX_HOST_AUTH_TOKEN`. `SANDBOX_HOST_AUTH_TOKEN` protects
host admin/session routes. `MCP_AUTH_TOKEN` protects host-to-container MCP
traffic and is intentionally stripped from shell child processes. Use
`TAKOS_TOKEN` for Takos CLI access inside the sandbox. Shell child processes
inherit only a small safe environment allowlist by default; `TAKOS_TOKEN` is
forwarded only when `shell_exec` is called with `allow_takos_token: true`, and
`takos_token` can be supplied for a downscoped token. MCP and host admin tokens
are stripped, and per-command `env` overrides reject sensitive variable names.

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

## Key Technologies

- Deno 2
- Hono 4
- MCP SDK
- Zod
- Cloudflare Containers
- SolidJS 1.9 + Vite 6.3

## License

See the repository root for license information.
