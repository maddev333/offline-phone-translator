import WebSocket from "ws";
import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { AzureAuthProvider } from "./auth-provider.js";
import { McpOrchestrator } from "../mcp/orchestrator.js";
import { toolEventBus } from "../session/tool-event-bus.js";

interface StartObserverParams {
  sessionId: string;
  location: string;
  userId?: string;
  tenantId?: string;
}

export class ObserverController {
  constructor(
    private readonly authProvider: AzureAuthProvider,
    private readonly orchestrator: McpOrchestrator
  ) {}

  async start(params: StartObserverParams): Promise<WebSocket | null> {
    const callId = params.location.split("/").pop();
    if (!callId) return null;

    const headers = await this.authProvider.getHeaders();
    const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
    const wsUrl = `${endpoint.replace(/^http/, "ws")}/openai/v1/realtime?call_id=${callId}`;

    logger.info({ azureOpenAiEndpoint: endpoint, wsUrl, callId, sessionId: params.sessionId }, "starting Azure OpenAI observer websocket");

    const ws = new WebSocket(wsUrl, { headers });

    ws.on("open", () => {
      logger.info({ sessionId: params.sessionId, callId }, "observer connected");
    });

    ws.on("message", async (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as Record<string, unknown>;
        const type = String(event.type ?? "unknown");
        logger.debug({ sessionId: params.sessionId, type }, "observer event");

        if (type === "app.tool_request") {
          const toolName = String(event.toolName ?? "");
          const argsValue = event.arguments;
          const args = argsValue && typeof argsValue === "object" ? (argsValue as Record<string, unknown>) : {};

          const context: { sessionId: string; userId?: string; tenantId?: string } = {
            sessionId: params.sessionId
          };
          if (params.userId) {
            context.userId = params.userId;
          }
          if (params.tenantId) {
            context.tenantId = params.tenantId;
          }

          logger.info({ sessionId: params.sessionId, toolName, args }, "received tool request from realtime observer");
          toolEventBus.publish(params.sessionId, {
            type: "tool_request_received",
            toolName,
            args,
            message: `tool request received: ${toolName}`
          });
          toolEventBus.publish(params.sessionId, {
            type: "tool_call_started",
            toolName,
            args,
            message: "tool call started"
          });

          const result = await this.orchestrator.invoke(
            { toolName, args },
            context
          );

          logger.info({ sessionId: params.sessionId, toolName, ok: result.ok }, "sending tool result to realtime observer");
          toolEventBus.publish(params.sessionId, {
            type: result.ok ? "tool_call_succeeded" : "tool_call_failed",
            toolName,
            ok: result.ok,
            message: result.ok ? "tool call succeeded" : "tool call failed"
          });

          ws.send(JSON.stringify({
            type: "app.tool_result",
            toolName,
            result
          }));
        }
      } catch (error) {
        logger.error({ error, sessionId: params.sessionId }, "observer message handling failed");
      }
    });

    ws.on("close", () => {
      logger.info({ sessionId: params.sessionId }, "observer closed");
    });

    ws.on("error", (error) => {
      logger.error({ error, sessionId: params.sessionId }, "observer error");
    });

    return ws;
  }
}
