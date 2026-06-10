export interface ToolInvocationContext {
  sessionId: string;
  userId?: string;
  tenantId?: string;
}

export interface ToolRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  content?: string;
  error?: string;
}
