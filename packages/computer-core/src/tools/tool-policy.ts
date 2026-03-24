/**
 * Tool policy constants used by the agent runner.
 *
 * Extracted from takos/packages/control/src/application/tools/tool-policy.ts.
 */

export const AGENT_DISABLED_BUILTIN_TOOLS = [
  'kv_get',
  'kv_put',
  'kv_delete',
  'kv_list',
  'd1_query',
  'd1_tables',
  'd1_describe',
  'r2_upload',
  'r2_download',
  'r2_list',
  'r2_delete',
  'r2_info',
  'create_d1',
  'create_kv',
  'create_r2',
  'list_resources',
] as const;

const AGENT_DISABLED_TOOL_SET = new Set<string>(AGENT_DISABLED_BUILTIN_TOOLS);

export function isToolAllowedForAgent(toolName: string): boolean {
  return !AGENT_DISABLED_TOOL_SET.has(toolName);
}

export function filterAgentAllowedToolNames(toolNames: readonly string[]): string[] {
  return toolNames.filter(isToolAllowedForAgent);
}
