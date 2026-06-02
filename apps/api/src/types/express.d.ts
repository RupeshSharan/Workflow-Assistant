import type { AuthenticatedUser, TenantContext } from "../domain/types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
      tenant?: TenantContext;
    }
  }
}

export {};
