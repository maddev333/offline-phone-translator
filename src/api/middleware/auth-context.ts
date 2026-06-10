import type { NextFunction, Request, Response } from "express";
import type { AuthContext } from "../../domain/auth.js";
import { EntraJwtValidator } from "../../services/auth/entra-jwt-validator.js";

const validator = new EntraJwtValidator();

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

export async function authContextMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authContext = await validator.validateAuthorizationHeader(req.header("authorization") ?? undefined);
    if (authContext) {
      req.authContext = authContext;
    }
    next();
  } catch (error) {
    next(error);
  }
}
