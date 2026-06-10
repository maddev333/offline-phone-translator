import type { ToolInvocationContext, ToolRequest } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";

export class ToolPolicy {
  constructor(private readonly registry: ToolRegistry) {}

  validate(request: ToolRequest, context: ToolInvocationContext): void {
    if (!context.userId) {
      throw new Error("Tool invocation requires authenticated user context");
    }

    if (!this.registry.isAllowed(request.toolName)) {
      throw new Error(`Tool not allowed: ${request.toolName}`);
    }

    if (!request.args || typeof request.args !== "object") {
      throw new Error("Tool arguments must be an object");
    }
  }
}
