output "takos_app_manifest" {
  value = {
    name    = "takos-computer"
    version = "0.1.0"

    compute = {
      web = {
        kind      = "worker"
        icon      = "/icons/computer.svg"
        readiness = "/readyz"
        containers = {
          sandbox = {
            image = "apps/sandbox/Dockerfile"
            dockerfile = "apps/sandbox/Dockerfile"
            port  = 8080
            cloudflare = {
              container = {
                className         = "SandboxSessionContainer"
                binding           = "SANDBOX_CONTAINER"
                name              = "takos-computer-sandbox"
                imageBuildContext = "."
                instanceType      = "basic"
                maxInstances      = 100
                migrationTag      = "v1"
                sqlite            = true
              }
            }
          }
        }
      }
    }

    resources = {
      session_index = {
        type = "key-value"
        bind = "SESSION_INDEX"
        to   = ["web"]
      }
      sandbox_host_auth_token = {
        type     = "secret"
        bind     = "SANDBOX_HOST_AUTH_TOKEN"
        to       = ["web"]
        generate = true
      }
      published_mcp_auth_token = {
        type     = "secret"
        bind     = "PUBLISHED_MCP_AUTH_TOKEN"
        to       = ["web"]
        generate = true
      }
      container_mcp_auth_token = {
        type     = "secret"
        bind     = "MCP_AUTH_TOKEN"
        to       = ["web"]
        generate = true
      }
      app_session_secret = {
        type     = "secret"
        bind     = "APP_SESSION_SECRET"
        to       = ["web"]
        generate = true
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/gui"
      },
      {
        id      = "health"
        target  = "web"
        path    = "/health"
        methods = ["GET"]
      },
      {
        id      = "readyz"
        target  = "web"
        path    = "/readyz"
        methods = ["GET"]
      },
      {
        id      = "mcp"
        target  = "web"
        path    = "/mcp"
        methods = ["POST"]
      },
    ]

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "UiSurface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "Computer"
          description = "Browser automation and sandbox computer with a Streamable HTTP MCP server."
          icon        = "/icons/computer.svg"
          category    = "app"
          sortOrder   = 40
        }
        spec = {
          launcher = true
        }
      },
      {
        name      = "takos-computer-mcp"
        publisher = "web"
        type      = "McpServer"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "mcp"
          }
        }
        auth = {
          bearer = {
            secretRef = "PUBLISHED_MCP_AUTH_TOKEN"
          }
        }
        display = {
          title       = "Computer MCP"
          description = "Sandbox shell, file, and process tools exposed over Streamable HTTP."
        }
        spec = {
          protocol = "streamable-http"
        }
      },
    ]

    env = {}
  }
}
