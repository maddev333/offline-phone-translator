export interface AuthContext {
  userId: string;
  principalId: string;
  tenantId?: string;
  displayName?: string;
  scopes: string[];
}
