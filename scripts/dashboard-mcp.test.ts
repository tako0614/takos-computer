import { expect, test } from "bun:test";

import { mcpCall } from "../packages/dashboard/src/lib/mcp.ts";

test("dashboard MCP client rejects tool errors and preserves ordinary text", async () => {
  const originalFetch = globalThis.fetch;
  let payload: unknown = {
    result: { content: [{ type: "text", text: "plain text response" }] },
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    await expect(
      mcpCall<string>("http://localhost/mcp", "file_list"),
    ).resolves.toBe("plain text response");

    payload = {
      result: {
        isError: true,
        content: [{ type: "text", text: "Error: path is outside workspace" }],
      },
    };
    await expect(
      mcpCall<string>("http://localhost/mcp", "file_list"),
    ).rejects.toThrow("Error: path is outside workspace");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
