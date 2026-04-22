let rpcId = 0;

export async function mcpCall<T = unknown>(
  mcpUrl: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: tool, arguments: args },
      id: ++rpcId,
    }),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  const content = json.result?.content;
  if (!content || !content.length) return null;
  const first = content[0];
  if (first.type === "text") {
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text as T;
    }
  }
  return first as T;
}
