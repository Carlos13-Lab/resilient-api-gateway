import type { FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { HttpError } from "./errors.js";

/** Route guard: valid HS256 bearer token whose space-separated `scope` claim contains `scope`. */
export const requireScope = (secret: string, scope: string) => {
  const key = new TextEncoder().encode(secret);
  return async (req: FastifyRequest) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m) throw new HttpError(401, "Missing bearer token", { "www-authenticate": "Bearer" });
    let scopes: string[];
    try {
      const { payload } = await jwtVerify(m[1]!, key, { algorithms: ["HS256"] });
      scopes = String(payload.scope ?? "").split(" ");
    } catch {
      throw new HttpError(401, "Invalid or expired token", { "www-authenticate": 'Bearer error="invalid_token"' });
    }
    if (!scopes.includes(scope)) throw new HttpError(403, `Missing required scope: ${scope}`);
  };
};
