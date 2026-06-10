import type { ToolRequest, ToolResult } from "./types.js";

export interface McpClient {
  invoke(request: ToolRequest): Promise<ToolResult>;
}
