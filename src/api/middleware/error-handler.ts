import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err }, "request failed");
  const message = err instanceof Error ? err.message : "Unexpected error";
  const clientMessage = env.NODE_ENV === "production" ? "Internal server error" : message;
  res.status(500).json({ error: clientMessage });
}
