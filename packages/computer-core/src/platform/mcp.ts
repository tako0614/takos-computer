/**
 * MCP server listing stub.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings';

export interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
}

export async function listMcpServers(
  _db: SqlDatabaseBinding,
  _spaceId: string,
): Promise<McpServer[]> {
  return [];
}
