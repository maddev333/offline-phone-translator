import type { NextFunction, Request, Response } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authContext?.principalId) {
    res.status(401).json({ error: "Missing authenticated bearer token" });
    return;
  }

  next();
}
