import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import { z } from "zod";
import { requireScope } from "./auth.js";
import { PROVIDERS, type Config } from "./config.js";
import { registerErrorHandling } from "./errors.js";
import { createMetrics } from "./metrics.js";
import { getPolicy, listPolicies, type Upstreams } from "./policies.js";
import { createUpstream } from "./upstream.js";

export function buildApp(cfg: Config, fetchImpl: typeof fetch = fetch, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: true,
    requestIdHeader: "x-correlation-id", // accept an incoming id...
    genReqId: () => randomUUID(), // ...or generate one
    logController: new LogController({ requestIdLogLabel: "correlationId" }), // stamp it on every log line
    ...opts,
  });
  const metrics = createMetrics();
  const upstreams = Object.fromEntries(
    PROVIDERS.map((p) => [p, createUpstream(p, cfg.upstreams[p], cfg, fetchImpl, metrics)]),
  ) as Upstreams;

  registerErrorHandling(app);
  app.addHook("onSend", async (req, reply) => void reply.header("x-correlation-id", req.id));
  app.addHook("onResponse", async (req, reply) => {
    metrics.httpDuration.observe(
      { route: req.routeOptions.url ?? "unmatched", method: req.method, status_code: reply.statusCode },
      reply.elapsedTime / 1000,
    );
  });

  const read = { preHandler: requireScope(cfg.jwtSecret, "policies:read") };

  app.get("/v1/policies/:id", read, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { provider } = z.object({ provider: z.enum(PROVIDERS) }).parse(req.query);
    return getPolicy(upstreams, provider, id, req.id);
  });

  app.get("/v1/policies", read, async (req) => {
    const { holderId } = z.object({ holderId: z.string().min(1) }).parse(req.query);
    return listPolicies(upstreams, holderId, req.id);
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/metrics", async (_req, reply) =>
    reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()),
  );

  return app;
}
