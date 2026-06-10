import { Router } from "express";
import { env } from "../../config/env.js";
import { requireAuth } from "../middleware/require-auth.js";
import { AzureAuthProvider } from "../../services/azure/auth-provider.js";
import { AzureRealtimeClient } from "../../services/azure/realtime-client.js";
import { ObserverController } from "../../services/azure/observer-controller.js";
import { ToolRegistry } from "../../services/mcp/tool-registry.js";
import { ToolPolicy } from "../../services/mcp/policy.js";
import { LearnMcpClient } from "../../services/mcp/clients/learn-mcp-client.js";
import { McpOrchestrator } from "../../services/mcp/orchestrator.js";
import { SessionService } from "../../services/session/session-service.js";
import { sessionStore } from "../../services/session/store-instance.js";

export const realtimeRouter = Router();

const authProvider = new AzureAuthProvider();
const realtimeClient = new AzureRealtimeClient(authProvider);
const registry = new ToolRegistry();
const policy = new ToolPolicy(registry);
const learnMcpClient = new LearnMcpClient();
const orchestrator = new McpOrchestrator(policy, learnMcpClient);
const observer = new ObserverController(authProvider, orchestrator);
const sessionService = new SessionService(sessionStore);

realtimeRouter.post("/connect", requireAuth, async (req, res, next) => {
  try {
    const sdpOffer = typeof req.body === "string" ? req.body : req.body?.sdp;

    if (!sdpOffer || typeof sdpOffer !== "string") {
      return res.status(400).json({ error: "Missing SDP offer" });
    }

    const authContext = req.authContext!;
    const session = await sessionService.create(authContext.principalId, authContext.tenantId);

    const sessionConfig = {
      type: "realtime" as const,
      model: env.AZURE_OPENAI_DEPLOYMENT,
      instructions: "You are a helpful realtime voice assistant. Use the available tools whenever you need repository-specific, internal, or Microsoft documentation context. Use local_context_search for repository-specific or internal context, and use Microsoft Learn tools for public Microsoft documentation.",
      audio: {
        output: {
          voice: env.REALTIME_VOICE
        }
      },
      tool_choice: "auto" as const,
      tools: [
        {
          type: "function" as const,
          name: "local_context_search",
          description: "Search local repository-specific and internal context stored on the backend.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to run against local context files."
              }
            },
            required: ["query"]
          }
        },
        {
          type: "function" as const,
          name: "microsoft_docs_search",
          description: "Search Microsoft Learn documentation.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The documentation search query."
              }
            },
            required: ["query"]
          }
        },
        {
          type: "function" as const,
          name: "microsoft_docs_fetch",
          description: "Fetch a Microsoft Learn document by identifier or URL returned from search.",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "The Microsoft Learn document URL or identifier to fetch."
              }
            },
            required: ["url"]
          }
        }
      ]
    };

    const secret = await realtimeClient.createClientSecret(sessionConfig);
    const negotiated = await realtimeClient.negotiateCall(secret.value, sdpOffer);

    const connectedPatch: { callId?: string; location?: string; observerAttached?: boolean } = {
      observerAttached: Boolean(negotiated.location)
    };
    if (negotiated.callId) {
      connectedPatch.callId = negotiated.callId;
    }
    if (negotiated.location) {
      connectedPatch.location = negotiated.location;
    }

    await sessionService.markConnected(session.sessionId, connectedPatch);

    if (negotiated.location) {
      const observerParams: { sessionId: string; location: string; userId?: string; tenantId?: string } = {
        sessionId: session.sessionId,
        location: negotiated.location,
        userId: authContext.principalId
      };
      if (authContext.tenantId) {
        observerParams.tenantId = authContext.tenantId;
      }
      void observer.start(observerParams);
    }

    res.setHeader("Content-Type", "application/sdp");
    res.setHeader("X-Session-Id", session.sessionId);
    return res.status(201).send(negotiated.sdpAnswer);
  } catch (error) {
    next(error);
  }
});
