/**
 * Tool type definitions used by the agent runner.
 *
 * Extracted from takos/packages/control/src/application/tools/types.ts.
 */

export type ToolCategory =
  | 'file'
  | 'deploy'
  | 'runtime'
  | 'storage'
  | 'web'
  | 'memory'
  | 'artifact'
  | 'container'
  | 'repo'
  | 'platform'
  | 'agent'
  | 'mcp'
  | 'browser'
  | 'search'
  | 'info_unit'
  | 'workspace_files'
  | 'workspace_env'
  | 'workspace_skills'
  | 'workspace_app_deployment'
  | 'discovery';

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  tool_class?: string;
  operation_id?: string;
  composed_operations?: string[];
  sensitive_read_policy?: string;
  required_roles?: string[];
  required_capabilities?: string[];
  canonical_name?: string;
  deprecated_aliases?: string[];
  namespace?: string;
  family?: string;
  risk_level?: string;
  side_effects?: boolean;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
}
