output "launch_url" {
  description = "Ordinary URL Output mapped by Takosumi's service-side launcher Interface blueprint."
  value       = local.launch_url
}

output "url" {
  description = "Alias for launch_url for generic public URL smoke checks."
  value       = local.launch_url
}

output "public_url" {
  description = "Public Worker origin."
  value       = local.public_origin != "" ? local.public_origin : null
}

output "api_url" {
  description = "Public Worker API origin."
  value       = local.public_origin != "" ? local.public_origin : null
}

output "mcp_url" {
  description = "Ordinary MCP resource URL mapped by Takosumi's service-side MCP Interface blueprint."
  value       = local.mcp_url
}

output "worker_name" {
  description = "Cloudflare Worker name."
  value       = local.worker_name
}

output "worker_managed_by_opentofu" {
  description = "Whether this apply owns the Worker/Container deployment through the official Wrangler lifecycle."
  value       = var.enable_cloudflare_resources
}

output "session_index_kv_namespace_id" {
  description = "Provider-native KV namespace id used for the session index."
  value       = try(cloudflare_workers_kv_namespace.session_index[0].id, null)
}

output "cloudflare_account_id" {
  description = "Cloudflare account id used for deployed resources."
  value       = var.enable_cloudflare_resources ? trimspace(var.cloudflare_account_id) : null
}

output "container_class_name" {
  description = "Cloudflare Container Durable Object class exported by the Worker."
  value       = "SandboxSessionContainer"
}

output "container_instance_type" {
  description = "Cloudflare Container instance type used by the current module."
  value       = "basic"
}

output "container_max_instances" {
  description = "Configured maximum concurrent Container instances."
  value       = var.container_max_instances
}
