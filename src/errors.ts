import type { FastifyError, FastifyInstance } from "fastify";
import { STATUS_CODES } from "node:http";
import { ZodError } from "zod";

/** Anything thrown with an HTTP meaning. Rendered by the central handler only. */
export class HttpError extends Error {
  constructor(readonly status: number, detail: string, readonly headers: Record<string, string> = {}) {
    super(detail);
  }
}

const problem = (status: number, detail: string, instance: string, correlationId: string) => ({
  type: "about:blank", title: STATUS_CODES[status] ?? "Error", status, detail, instance, correlationId,
});

/** The single place where errors become RFC 7807 responses. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    let status = 500;
    let detail = "Internal server error";
    if (err instanceof HttpError) {
      status = err.status;
      detail = err.message;
      reply.headers(err.headers);
    } else if (err instanceof ZodError) {
      status = 400;
      detail = err.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
    } else if ("statusCode" in err && err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      detail = err.message;
    }
    if (status >= 500) req.log.error({ err }, "request failed");
    return reply.code(status).type("application/problem+json").send(problem(status, detail, req.url, req.id));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).type("application/problem+json").send(problem(404, `Route ${req.method} ${req.url} not found`, req.url, req.id)),
  );
}
