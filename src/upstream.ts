import CircuitBreaker from "opossum";
import type { Config } from "./config.js";
import { STATE_VALUE, type BreakerState, type Metrics } from "./metrics.js";

export class UpstreamError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, when there was a response. */
    readonly upstreamStatus: number | undefined,
    /** Worth retrying and counted by the breaker (5xx, timeout, network). 4xx is not. */
    readonly transient: boolean,
    readonly circuitOpen = false,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter: sleep = random(0, base * 2^attempt). */
async function withRetry<T>(fn: () => Promise<T>, retries: number, baseMs: number, onRetry: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !(err instanceof UpstreamError) || !err.transient) throw err;
      onRetry();
      await sleep(Math.random() * baseMs * 2 ** attempt);
    }
  }
}

export function createUpstream(name: string, baseUrl: string, cfg: Config, fetchImpl: typeof fetch, metrics: Metrics) {
  async function attempt(path: string, correlationId: string): Promise<unknown> {
    const ctrl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new UpstreamError(`${name} timed out after ${cfg.timeoutMs}ms`, undefined, true));
      }, cfg.timeoutMs);
    });
    try {
      const call = fetchImpl(baseUrl + path, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "x-correlation-id": correlationId },
      }).catch((e) => {
        if (e instanceof UpstreamError) throw e;
        throw new UpstreamError(`${name} unreachable`, undefined, true);
      });
      const res = await Promise.race([call, timeout]);
      if (!res.ok) throw new UpstreamError(`${name} answered ${res.status}`, res.status, res.status >= 500);
      return await Promise.race([res.json(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const breaker = new CircuitBreaker(
    (path: string, cid: string) => withRetry(() => attempt(path, cid), cfg.retries, cfg.backoffBaseMs, () => metrics.retries.inc({ upstream: name })),
    {
      timeout: false, // per-attempt timeouts live in attempt()
      volumeThreshold: cfg.breaker.volumeThreshold,
      errorThresholdPercentage: cfg.breaker.errorThresholdPercentage,
      resetTimeout: cfg.breaker.resetTimeoutMs,
      // true = "not a failure": a client error says nothing about upstream health
      errorFilter: (e: unknown) => e instanceof UpstreamError && !e.transient,
    },
  );

  const state = (): BreakerState => (breaker.opened ? "open" : breaker.halfOpen ? "half-open" : "closed");
  metrics.breakerState.labels({ upstream: name }).set(0);
  for (const ev of ["open", "halfOpen", "close"]) {
    (breaker as CircuitBreaker).on(ev as "open", () => metrics.breakerState.set({ upstream: name }, STATE_VALUE[state()]));
  }

  return {
    state,
    /** Fallback: an open breaker answers immediately with a structured error instead of calling out. */
    async get(path: string, correlationId: string): Promise<unknown> {
      try {
        return await breaker.fire(path, correlationId);
      } catch (err) {
        if ((err as { code?: string }).code === "EOPENBREAKER") {
          throw new UpstreamError(`${name} circuit is open`, undefined, true, true);
        }
        throw err;
      }
    },
  };
}
export type Upstream = ReturnType<typeof createUpstream>;
