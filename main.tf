terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.0"
    }
  }
}

variable "enable_cloudflare_resources" {
  description = "Provision the Takos Computer Cloudflare KV namespace and deploy its Worker + Container through the official Wrangler lifecycle."
  type        = bool
  default     = false
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id. Credentials are supplied to the provider and Wrangler through the runner environment, not this module."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudflare_resources || can(regex("^[a-f0-9]{32}$", trimspace(var.cloudflare_account_id)))
    error_message = "cloudflare_account_id must be a lowercase 32-character Cloudflare account id when resources are enabled."
  }
}

variable "project_name" {
  description = "Prefix for Takos Computer resource names."
  type        = string
  default     = "takos-computer"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.project_name))
    error_message = "project_name must be a 1-63 character lowercase DNS label."
  }
}

variable "worker_name" {
  description = "Cloudflare Worker name. Defaults to project_name."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_name) == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", trimspace(var.worker_name)))
    error_message = "worker_name must be empty or a 1-63 character lowercase DNS label."
  }
}

variable "public_url" {
  description = "Canonical public origin. When empty, it is derived from worker_name and cloudflare_workers_subdomain."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.public_url) == "" || can(regex("^https://[^/?#@[:space:]]+/?$", trimspace(var.public_url)))
    error_message = "public_url must be empty or a bare-origin HTTPS URL."
  }
}

variable "cloudflare_workers_subdomain" {
  description = "Account workers.dev subdomain used to derive public_url."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_workers_subdomain) == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", trimspace(var.cloudflare_workers_subdomain)))
    error_message = "cloudflare_workers_subdomain must be empty or a lowercase DNS label."
  }
}

variable "enable_workers_dev_subdomain" {
  description = "Enable the Worker on workers.dev."
  type        = bool
  default     = true
}

variable "container_image" {
  description = "Optional prebuilt public/authorized Container image reference. Empty builds apps/sandbox/Dockerfile with Docker during apply."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.container_image) == "" || (!strcontains(trimspace(var.container_image), " ") && !strcontains(trimspace(var.container_image), "\n"))
    error_message = "container_image must be empty or a whitespace-free image reference."
  }
}

variable "container_max_instances" {
  description = "Maximum concurrent Cloudflare Container instances."
  type        = number
  default     = 100

  validation {
    condition     = floor(var.container_max_instances) == var.container_max_instances && var.container_max_instances >= 1 && var.container_max_instances <= 1000
    error_message = "container_max_instances must be an integer from 1 through 1000."
  }
}

variable "published_mcp_auth_token" {
  description = "Optional direct/self-host bearer for /mcp. Managed installs should use Interface OAuth instead."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition = trimspace(var.published_mcp_auth_token) == "" || (
      length(trimspace(var.published_mcp_auth_token)) >= 32 &&
      !startswith(trimspace(var.published_mcp_auth_token), "taksrv_")
    )
    error_message = "published_mcp_auth_token must be empty or at least 32 characters and must not use the reserved taksrv_ Interface OAuth prefix."
  }
}

variable "sandbox_host_auth_token" {
  description = "Optional direct host-admin bearer. Empty generates an internal random value."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.sandbox_host_auth_token) == "" || length(trimspace(var.sandbox_host_auth_token)) >= 32
    error_message = "sandbox_host_auth_token must be empty or at least 32 characters."
  }
}

variable "container_mcp_auth_token" {
  description = "Optional Worker-to-Container MCP bearer. Empty generates an internal random value."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.container_mcp_auth_token) == "" || length(trimspace(var.container_mcp_auth_token)) >= 32
    error_message = "container_mcp_auth_token must be empty or at least 32 characters."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional bare-origin Takosumi Accounts issuer for Interface OAuth and browser OIDC."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://[^/?#@[:space:]]+/?$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or a bare-origin HTTPS URL."
  }
}

variable "app_workspace_id" {
  description = "Owning Takosumi Workspace id required for Interface OAuth evidence."
  type        = string
  default     = ""
}

variable "app_capsule_id" {
  description = "Owning Takosumi Capsule id required for Interface OAuth evidence."
  type        = string
  default     = ""
}

variable "enable_app_oidc" {
  description = "Protect /gui with Takosumi Accounts OIDC."
  type        = bool
  default     = false
}

variable "oidc_client_id" {
  description = "OIDC client id used when enable_app_oidc is true."
  type        = string
  default     = ""
}

variable "oidc_client_secret" {
  description = "OIDC client secret used when enable_app_oidc is true."
  type        = string
  default     = ""
  sensitive   = true
}

variable "oidc_redirect_uri" {
  description = "OIDC callback URL. Empty derives <public_url>/gui/api/auth/callback."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.oidc_redirect_uri) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.oidc_redirect_uri)))
    error_message = "oidc_redirect_uri must be empty or an HTTPS URL."
  }
}

variable "app_session_secret" {
  description = "Optional OIDC session HMAC secret. Empty generates a random value when browser OIDC is enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "takos_api_url" {
  description = "Optional Takos API origin made available to sandbox sessions."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takos_api_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takos_api_url)))
    error_message = "takos_api_url must be empty or an HTTPS URL."
  }
}

variable "takos_token" {
  description = "Optional Takos API bearer made available to the host. Child shell processes receive it only by explicit tool request."
  type        = string
  default     = ""
  sensitive   = true
}

variable "max_sandbox_sessions_per_user" {
  description = "Maximum live GUI sandbox sessions per authenticated user."
  type        = number
  default     = 10

  validation {
    condition     = floor(var.max_sandbox_sessions_per_user) == var.max_sandbox_sessions_per_user && var.max_sandbox_sessions_per_user >= 1 && var.max_sandbox_sessions_per_user <= 100
    error_message = "max_sandbox_sessions_per_user must be an integer from 1 through 100."
  }
}

locals {
  worker_name        = trimspace(var.worker_name) != "" ? trimspace(var.worker_name) : var.project_name
  configured_origin  = trimsuffix(trimspace(var.public_url), "/")
  workers_dev_origin = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.worker_name}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : ""
  public_origin      = local.configured_origin != "" ? local.configured_origin : local.workers_dev_origin
  launch_url         = local.public_origin != "" ? "${local.public_origin}/gui" : null
  mcp_url            = local.public_origin != "" ? "${local.public_origin}/mcp" : null
  accounts_issuer    = trimsuffix(trimspace(var.takosumi_accounts_issuer_url), "/")
  interface_oauth_enabled = (
    local.accounts_issuer != "" &&
    trimspace(var.app_workspace_id) != "" &&
    trimspace(var.app_capsule_id) != "" &&
    local.mcp_url != null
  )
  oidc_redirect_uri = trimspace(var.oidc_redirect_uri) != "" ? trimspace(var.oidc_redirect_uri) : (local.public_origin != "" ? "${local.public_origin}/gui/api/auth/callback" : "")

  source_files = sort(distinct(concat(
    tolist(fileset(path.module, "apps/**")),
    tolist(fileset(path.module, "packages/**")),
    ["scripts/opentofu-deploy.ts", ".dockerignore"],
    tolist(fileset(path.module, "*.tf")),
    ["package.json", "bun.lock", "tsconfig.json"],
  )))
  source_digest = sha256(join("\n", [
    for file in local.source_files : "${file}:${filesha256("${path.module}/${file}")}"
  ]))
}

resource "cloudflare_workers_kv_namespace" "session_index" {
  count      = var.enable_cloudflare_resources ? 1 : 0
  account_id = trimspace(var.cloudflare_account_id)
  title      = "${local.worker_name}-sessions"
}

resource "random_password" "sandbox_host_auth" {
  count   = var.enable_cloudflare_resources && trimspace(var.sandbox_host_auth_token) == "" ? 1 : 0
  length  = 48
  special = false
}

resource "random_password" "container_mcp_auth" {
  count   = var.enable_cloudflare_resources && trimspace(var.container_mcp_auth_token) == "" ? 1 : 0
  length  = 48
  special = false
}

resource "random_password" "app_session" {
  count   = var.enable_cloudflare_resources && var.enable_app_oidc && trimspace(var.app_session_secret) == "" ? 1 : 0
  length  = 48
  special = false
}

locals {
  sandbox_host_auth_token  = trimspace(var.sandbox_host_auth_token) != "" ? var.sandbox_host_auth_token : try(random_password.sandbox_host_auth[0].result, "")
  container_mcp_auth_token = trimspace(var.container_mcp_auth_token) != "" ? var.container_mcp_auth_token : try(random_password.container_mcp_auth[0].result, "")
  app_session_secret       = trimspace(var.app_session_secret) != "" ? var.app_session_secret : try(random_password.app_session[0].result, "")
  deploy_secret_digest = sha256(jsonencode({
    sandboxHost  = local.sandbox_host_auth_token
    containerMcp = local.container_mcp_auth_token
    publishedMcp = var.published_mcp_auth_token
    appSession   = var.enable_app_oidc ? local.app_session_secret : ""
    oidcClient   = var.enable_app_oidc ? var.oidc_client_secret : ""
    takosToken   = var.takos_token
  }))
  deploy_input = {
    accountId         = trimspace(var.cloudflare_account_id)
    workerName        = local.worker_name
    publicOrigin      = local.public_origin
    workersDev        = var.enable_workers_dev_subdomain
    sessionIndexId    = try(cloudflare_workers_kv_namespace.session_index[0].id, "")
    containerImage    = trimspace(var.container_image)
    containerMax      = var.container_max_instances
    compatibilityDate = "2026-07-19"
    sourceDigest      = local.source_digest
    accountsIssuer    = local.accounts_issuer
    workspaceId       = trimspace(var.app_workspace_id)
    capsuleId         = trimspace(var.app_capsule_id)
    appOidc           = var.enable_app_oidc
    oidcClientId      = trimspace(var.oidc_client_id)
    oidcRedirectUri   = local.oidc_redirect_uri
    takosApiUrl       = trimspace(var.takos_api_url)
    maxUserSessions   = var.max_sandbox_sessions_per_user
  }
}

resource "terraform_data" "sandbox_host" {
  count = var.enable_cloudflare_resources ? 1 : 0
  input = local.deploy_input
  triggers_replace = [
    local.source_digest,
    sha256(jsonencode(local.deploy_input)),
    local.deploy_secret_digest,
  ]

  provisioner "local-exec" {
    command     = "bun run deploy:opentofu"
    working_dir = path.module
    environment = {
      TAKOS_COMPUTER_DEPLOY_CONFIG = jsonencode(local.deploy_input)
      SANDBOX_HOST_AUTH_TOKEN      = local.sandbox_host_auth_token
      MCP_AUTH_TOKEN               = local.container_mcp_auth_token
      PUBLISHED_MCP_AUTH_TOKEN     = var.published_mcp_auth_token
      APP_SESSION_SECRET           = var.enable_app_oidc ? local.app_session_secret : ""
      OIDC_CLIENT_SECRET           = var.enable_app_oidc ? var.oidc_client_secret : ""
      TAKOS_TOKEN                  = var.takos_token
    }
  }

  provisioner "local-exec" {
    when        = destroy
    command     = "bun run destroy:opentofu"
    working_dir = path.module
    environment = {
      TAKOS_COMPUTER_DEPLOY_CONFIG = jsonencode(self.input)
    }
  }

  lifecycle {
    precondition {
      condition     = local.public_origin != ""
      error_message = "public_url or cloudflare_workers_subdomain is required when Cloudflare resources are enabled."
    }

    precondition {
      condition     = trimspace(var.published_mcp_auth_token) != "" || local.interface_oauth_enabled
      error_message = "Configure either published_mcp_auth_token for direct/self-host MCP or Accounts issuer + app_workspace_id + app_capsule_id for Interface OAuth."
    }

    precondition {
      condition = (
        (trimspace(var.app_workspace_id) == "" && trimspace(var.app_capsule_id) == "") ||
        (local.accounts_issuer != "" && trimspace(var.app_workspace_id) != "" && trimspace(var.app_capsule_id) != "")
      )
      error_message = "Interface OAuth ownership requires Accounts issuer, app_workspace_id, and app_capsule_id together."
    }

    precondition {
      condition = length(distinct(compact([
        trimspace(var.published_mcp_auth_token),
        trimspace(local.sandbox_host_auth_token),
        trimspace(local.container_mcp_auth_token),
        ]))) == length(compact([
        trimspace(var.published_mcp_auth_token),
        trimspace(local.sandbox_host_auth_token),
        trimspace(local.container_mcp_auth_token),
      ]))
      error_message = "Direct MCP, host-admin, and Worker-to-Container bearers must be distinct."
    }

    precondition {
      condition = !var.enable_app_oidc || (
        local.accounts_issuer != "" &&
        trimspace(var.oidc_client_id) != "" &&
        trimspace(var.oidc_client_secret) != "" &&
        local.oidc_redirect_uri != ""
      )
      error_message = "enable_app_oidc requires the Accounts issuer, OIDC client id/secret, and a resolvable redirect URI."
    }
  }
}
