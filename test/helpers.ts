import { SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

export const SECRET = "test-secret-test-secret-test-secret";

export const testConfig = (over: Partial<Config> = {}): Config => ({
  port: 0,
  jwtSecret: SECRET,
  upstreams: { north: "http://north", south: "http://south", east: "http://east" },
  timeoutMs: 200,
  retries: 2,
  backoffBaseMs: 1,
  breaker: { volumeThreshold: 3, errorThresholdPercentage: 50, resetTimeoutMs: 60 },
  ...over,
});

export const token = (scope = "policies:read", secret = SECRET) =>
  new SignJWT({ scope }).setProtectedHeader({ alg: "HS256" }).setSubject("tester").setExpirationTime("5m").sign(new TextEncoder().encode(secret));

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type FakeHandler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** Fake network: routes by upstream host, records every call. */
export function fakeUpstreams(handlers: Partial<Record<"north" | "south" | "east", FakeHandler>>) {
  const calls: { host: string; url: URL; headers: Headers }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ host: url.hostname, url, headers: new Headers(init?.headers) });
    const handler = handlers[url.hostname as "north"];
    if (!handler) throw new TypeError("fetch failed");
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const northPolicy = (id = "N-1") => ({
  policy_number: id, holder_id: "H-1", state: "ACTIVE",
  start_date: "2025-01-02", end_date: "2026-01-02", premium_amount: 120.5, currency: "USD",
});
export const southPolicy = (id = "S-1") => ({
  id, customer: { id: "H-1" }, status: 1,
  effective: "02/01/2025", expiry: "02/01/2026", premium: { amount_cents: 9900, currency: "USD" },
});
export const eastPolicy = (id = "E-1") => ({
  ref: id, insured: "H-1", status: "X", from: 1735776000, to: 1767312000, total: "75.25", ccy: "USD",
});

export async function appWith(handlers: Parameters<typeof fakeUpstreams>[0], over: Partial<Config> = {}) {
  const net = fakeUpstreams(handlers);
  const app = buildApp(testConfig(over), net.fetchImpl, { logger: false });
  return { app, ...net };
}
