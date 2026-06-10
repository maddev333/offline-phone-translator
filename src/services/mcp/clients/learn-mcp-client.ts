import { randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { logger } from "../../../infra/logger.js";
import type { ToolRequest, ToolResult } from "../types.js";

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: string | number;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export class LearnMcpClient {
  private sessionId?: string;
  private initialized = false;

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    logger.info({ method, params, mcpServerUrl: env.MCP_SERVER_URL, sessionId: this.sessionId }, "calling MCP JSON-RPC method");

    const response = await fetch(env.MCP_SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params
      })
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    logger.info({ method, status: response.status, contentType: response.headers.get("content-type"), sessionId: this.sessionId }, "received MCP JSON-RPC response");

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const payloadText = contentType.includes("text/event-stream") ? this.extractSseData(body) : body;
    const payload = JSON.parse(payloadText) as JsonRpcSuccess<T> | JsonRpcFailure;

    if ("error" in payload) {
      throw new Error(`MCP ${method} failed: ${payload.error.message}`);
    }

    return payload.result;
  }

  private extractSseData(body: string): string {
    const lines = body.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      throw new Error("MCP SSE response did not contain data lines");
    }
    return dataLines.join("\n");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "realtime-mcp-ts",
        version: "0.1.0"
      }
    });
    this.initialized = true;
  }

  async invoke(request: ToolRequest): Promise<ToolResult> {
    await this.initialize();

    logger.info({ toolName: request.toolName, args: request.args }, "sending MCP tools/call request");

    const result = await this.rpc<McpToolCallResult>("tools/call", {
      name: request.toolName,
      arguments: request.args
    });

    const content = (result.content ?? [])
      .map((item) => item.text)
      .filter((value): value is string => Boolean(value))
      .join("\n");

    if (result.isError) {
      logger.warn({ toolName: request.toolName, content }, "MCP tool call returned error");
      return { ok: false, error: content || "MCP tool call failed" };
    }

    logger.info({ toolName: request.toolName, contentPreview: content.slice(0, 300) }, "MCP tool call succeeded");
    return { ok: true, content: content || "Tool call completed with no text content" };
  }
}
