import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import type { AuthContext } from "../../domain/auth.js";

const tenantBase = `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`;
const validIssuers = [
  `${tenantBase}/v2.0`,
  `https://sts.windows.net/${env.ENTRA_TENANT_ID}/`
];
const jwks = createRemoteJWKSet(new URL(`${tenantBase}/discovery/v2.0/keys`));

interface EntraClaims {
  oid?: string;
  sub?: string;
  tid?: string;
  name?: string;
  preferred_username?: string;
  scp?: string;
  roles?: string[];
}

export class EntraJwtValidator {
  async validateAuthorizationHeader(value?: string): Promise<AuthContext | null> {
    if (!value) return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    const token = match?.[1];
    if (!token) return null;
    return this.validateToken(token);
  }

  async validateToken(token: string): Promise<AuthContext> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: validIssuers,
      audience: env.ENTRA_AUDIENCE
    });

    const claims = payload as EntraClaims;
    const principalId = claims.oid ?? claims.sub;
    if (!principalId) {
      throw new Error("Validated token is missing oid/sub claim");
    }

    const authContext: AuthContext = {
      userId: claims.preferred_username ?? principalId,
      principalId,
      scopes: claims.scp ? claims.scp.split(" ").filter(Boolean) : claims.roles ?? []
    };

    if (claims.tid) {
      authContext.tenantId = claims.tid;
    }
    if (claims.name) {
      authContext.displayName = claims.name;
    }

    return authContext;
  }
}
