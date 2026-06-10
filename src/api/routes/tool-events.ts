import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { SessionService } from "../../services/session/session-service.js";
import { sessionStore } from "../../services/session/store-instance.js";
import { toolEventBus } from "../../services/session/tool-event-bus.js";

export const toolEventsRouter = Router();

const sessionService = new SessionService(sessionStore);

toolEventsRouter.get("/:sessionId", async (req, res, next) => {
  try {
    const bearer = typeof req.query.access_token === "string" ? `Bearer ${req.query.access_token}` : req.header("authorization") ?? undefined;
    const authContext = await import("../../services/auth/entra-jwt-validator.js").then(({ EntraJwtValidator }) => new EntraJwtValidator().validateAuthorizationHeader(bearer));
    if (!authContext) {
      return res.status(401).json({ error: "Missing authenticated bearer token" });
    }
    const rawSessionId = req.params.sessionId;
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : rawSessionId?.[0];
    if (!sessionId) {
      return res.status(400).json({ error: "Missing session ID" });
    }

    const session = await sessionService.getOwned(sessionId, authContext.principalId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    const unsubscribe = toolEventBus.subscribe(sessionId, (event) => {
      res.write(`event: tool\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  } catch (error) {
    next(error);
  }
});
