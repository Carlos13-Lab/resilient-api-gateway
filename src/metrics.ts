import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type BreakerState = "closed" | "half-open" | "open";
export const STATE_VALUE: Record<BreakerState, number> = { closed: 0, "half-open": 1, open: 2 };

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const httpDuration = new Histogram({
    name: "http_request_duration_seconds", help: "Gateway request duration",
    labelNames: ["route", "method", "status_code"], registers: [registry],
  });
  const retries = new Counter({
    name: "upstream_retries_total", help: "Retry attempts per upstream",
    labelNames: ["upstream"], registers: [registry],
  });
  const breakerState = new Gauge({
    name: "circuit_breaker_state", help: "0=closed 1=half-open 2=open",
    labelNames: ["upstream"], registers: [registry],
  });
  return { registry, httpDuration, retries, breakerState };
}
export type Metrics = ReturnType<typeof createMetrics>;
