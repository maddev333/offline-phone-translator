import type { ToolInvocationContext, ToolRequest, ToolResult } from "./types.js";
import { logger } from "../../infra/logger.js";
import { LocalContextClient } from "../local-context/local-context-client.js";
import { ToolPolicy } from "./policy.js";
import type { McpClient } from "./mcp-client.js";

export class McpOrchestrator {
  constructor(
    private readonly policy: ToolPolicy,
    private readonly client: McpClient,
    private readonly localContextClient = new LocalContextClient()
  ) {}

  async invoke(request: ToolRequest, context: ToolInvocationContext): Promise<ToolResult> {
    logger.info({ toolName: request.toolName, args: request.args, context }, "validating MCP tool request");
    this.policy.validate(request, context);
    logger.info({ toolName: request.toolName }, "invoking tool");
    const result = request.toolName === "local_context_search"
      ? await this.localContextClient.invoke(request)
      : await this.client.invoke(request);
    logger.info({ toolName: request.toolName, ok: result.ok }, "completed MCP tool invocation");
    return result;
  }
}
