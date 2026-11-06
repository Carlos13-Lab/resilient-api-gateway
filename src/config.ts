export const PROVIDERS = ["north", "south", "east"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface Config {
  port: number;
  jwtSecret: string;
  upstreams: Record<Provider, string>;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Extra attempts after the first one, transient errors only. */
  retries: number;
  backoffBaseMs: number;
  breaker: { volumeThreshold: number; errorThresholdPercentage: number; resetTimeoutMs: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (k: string, d: number) => (env[k] ? Number(env[k]) : d);
  return {
    port: num("PORT", 3000),
    jwtSecret: env.JWT_SECRET ?? "demo-secret-change-me-demo-secret-change-me",
    upstreams: {
      north: env.NORTH_URL ?? "http://localhost:4001",
      south: env.SOUTH_URL ?? "http://localhost:4002",
      east: env.EAST_URL ?? "http://localhost:4003",
    },
    timeoutMs: num("UPSTREAM_TIMEOUT_MS", 1000),
    retries: num("UPSTREAM_RETRIES", 2),
    backoffBaseMs: num("BACKOFF_BASE_MS", 100),
    breaker: {
      volumeThreshold: num("BREAKER_VOLUME", 5),
      errorThresholdPercentage: num("BREAKER_ERROR_PCT", 50),
      resetTimeoutMs: num("BREAKER_RESET_MS", 10_000),
    },
  };
}
