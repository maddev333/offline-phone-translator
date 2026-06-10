import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { SessionService } from "../../services/session/session-service.js";
import { sessionStore } from "../../services/session/store-instance.js";

export const sessionsRouter = Router();
const sessionService = new SessionService(sessionStore);

sessionsRouter.get("/:sessionId", requireAuth, async (req, res, next) => {
  try {
    const rawSessionId = req.params.sessionId;
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : rawSessionId?.[0];
    if (!sessionId) {
      return res.status(400).json({ error: "Missing session ID" });
    }

    const session = await sessionService.getOwned(sessionId, req.authContext!.principalId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    return res.json(session);
  } catch (error) {
    next(error);
  }
});
