import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";

export const meRouter = Router();

meRouter.get("/", requireAuth, (req, res) => {
  const authContext = req.authContext!;
  res.json({
    authenticated: true,
    principalId: authContext.principalId,
    userId: authContext.userId,
    tenantId: authContext.tenantId ?? null,
    displayName: authContext.displayName ?? null,
    scopes: authContext.scopes
  });
});
