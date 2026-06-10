import type { ToolRequest, ToolResult } from "../types.js";

export class DemoMcpClient {
  async invoke(request: ToolRequest): Promise<ToolResult> {
    switch (request.toolName) {
      case "search_docs":
        return { ok: true, content: `Demo search result for query="${String(request.args.query ?? "")}"` };
      case "lookup_account":
        return { ok: true, content: `Demo account lookup for accountId="${String(request.args.accountId ?? "")}"` };
      default:
        return { ok: false, error: `Unknown tool: ${request.toolName}` };
    }
  }
}
