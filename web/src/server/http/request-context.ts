import "server-only";
import { getEnv } from "@/server/config/env";
import { getClientIp } from "@/server/security/client-ip";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip: getClientIp(req.headers, getEnv().TRUST_PROXY),
    userAgent: req.headers.get("user-agent"),
  };
}
